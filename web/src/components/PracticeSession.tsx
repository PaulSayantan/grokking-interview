/** @jsxImportSource preact */
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Difficulty, Question } from "@lib/types";
import {
  DEFAULT_SAMPLE_SIZE,
  SESSION_PRESETS,
  pickN,
  seededShuffle,
  type SessionPreset,
} from "@lib/sample";
import {
  recordAnswers,
  registerPractice,
  missedIds,
  missedCount,
  claimStreakMilestone,
} from "@lib/progress";

/**
 * PracticeSession — the interactive MCQ quiz. The ONLY Preact island on the site.
 *
 * Fetches a flat question pool from `poolUrl` (a static /questions/... JSON file),
 * samples up to 25 questions, shuffles both question order and the options within
 * each question (remapping the correct-answer index), then runs an immediate
 * per-question-feedback flow. Score + best are persisted to localStorage keyed by
 * the resolved pool URL.
 *
 * Load optimization: the island actually fetches the `.slim.json` twin of `poolUrl`
 * (same questions minus explanation/tags/difficulty) so the initial payload is small,
 * then lazily fetches the domain's `_explanations.json` map in the background. The
 * explanation shown after answering is looked up from that map (with a brief
 * "Loading explanation…" placeholder if the map hasn't arrived yet).
 *
 * For system-design domain practice, an optional `groups` list lets the component
 * pick a `_group-<key>.json` pool client-side from a `?group=` query param and adapt
 * the scope heading accordingly (per CONTRACT.md §10).
 *
 * Animation is pure CSS (see ANIM_CSS): enter animations replay via keyed
 * remounts, hover/tap scaling uses :hover/:active transforms, and everything
 * motion-related is gated behind `@media (prefers-reduced-motion: no-preference)`
 * — the same accessibility behavior `MotionConfig reducedMotion="user"` provided
 * before the motion/react dependency was dropped.
 */

interface GroupOption {
  key: string;
  label: string;
  url: string;
}

interface Props {
  /** Default question pool URL (e.g. /questions/system-design/_all.json). */
  poolUrl: string;
  /** Where "Back to topic" links to. */
  backHref: string;
  /** Scope heading, e.g. a subtopic title or "System Design". */
  title: string;
  /** Optional group pools; if a matching ?group= is present it overrides poolUrl/title. */
  groups?: GroupOption[];
}

/** A question with its options shuffled and the correct index remapped. */
interface PreparedQuestion {
  q: Question;
  options: string[];
  correctIndex: number;
}

interface StoredStats {
  attempts: number;
  best: number; // best score (count correct)
  bestPct: number;
  lastPct: number;
}

const STORAGE_PREFIX = "ip:practice:v1:";

function statsKey(poolUrl: string): string {
  return STORAGE_PREFIX + poolUrl;
}

function readStats(poolUrl: string): StoredStats {
  const fallback: StoredStats = { attempts: 0, best: 0, bestPct: 0, lastPct: 0 };
  try {
    const raw = localStorage.getItem(statsKey(poolUrl));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredStats>;
    return {
      attempts: parsed.attempts ?? 0,
      best: parsed.best ?? 0,
      bestPct: parsed.bestPct ?? 0,
      lastPct: parsed.lastPct ?? 0,
    };
  } catch {
    return fallback;
  }
}

function writeStats(poolUrl: string, correct: number, total: number): StoredStats {
  const prev = readStats(poolUrl);
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const next: StoredStats = {
    attempts: prev.attempts + 1,
    best: Math.max(prev.best, correct),
    bestPct: Math.max(prev.bestPct, pct),
    lastPct: pct,
  };
  try {
    localStorage.setItem(statsKey(poolUrl), JSON.stringify(next));
  } catch {
    /* storage unavailable — non-fatal */
  }
  return next;
}

/** `/questions/d/_all.json` -> `/questions/d/_all.slim.json` (the light payload). */
function slimUrl(poolUrl: string): string {
  return poolUrl.replace(/\.json$/, ".slim.json");
}

/** `/questions/d/<anything>.json` -> `/questions/d/_explanations.json`. */
function explanationsUrl(poolUrl: string): string {
  return poolUrl.replace(/[^/]+$/, "_explanations.json");
}

/** Build the /study Learn-more link from a question's optional ref. */
function learnMoreHref(q: Question): string | null {
  if (!q.ref) return null;
  const hash = q.ref.replace(/^concepts\.md#/, "");
  return `/study/${q.domain}/${q.topic_slug}#${hash}`;
}

/** Humanize a topic_slug for display when no title is available (slim pools). */
function humanizeSlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Sample + shuffle a pool into prepared questions (options shuffled, answer remapped). */
function prepare(pool: Question[], size: number): PreparedQuestion[] {
  const sampled = pickN(pool, size);
  return sampled.map((q) => {
    const order = seededShuffle(q.options.map((_, i) => i));
    const options = order.map((i) => q.options[i]);
    const correctIndex = order.indexOf(q.answer);
    return { q, options, correctIndex };
  });
}

/** The four concrete difficulty tiers offered as filter pills (green→amber). */
const DIFFICULTY_TIERS: { key: Difficulty; label: string; accent: string }[] = [
  { key: "beginner", label: "Beginner", accent: "var(--accent-green)" },
  { key: "intermediate", label: "Intermediate", accent: "var(--accent-blue)" },
  { key: "advanced", label: "Advanced", accent: "var(--accent-violet)" },
  { key: "expert", label: "Expert", accent: "var(--accent-amber)" },
];

/**
 * Pure-CSS replacements for the previous motion/react animations.
 * - Enter animations are keyframes with `animation-fill-mode: both` so delayed
 *   elements stay hidden until their delay elapses.
 * - The question card is keyed by question index, so its enter animation
 *   replays on every question change (exit animation intentionally omitted).
 * - Hover/tap scaling uses :hover/:active; springs are approximated with the
 *   design-system ease-out curve.
 * - Everything except color transitions is gated behind
 *   `prefers-reduced-motion: no-preference`.
 */
const ANIM_CSS = `
.ps-press-opt {
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
}
@media (prefers-reduced-motion: no-preference) {
  .ps-card-in {
    animation: ps-fade-up-12 var(--dur-med, 240ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
  }
  .ps-results-in {
    animation: ps-results-in 320ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
  }
  .ps-score-in {
    animation: ps-score-in 300ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) 120ms both;
  }
  .ps-best-in {
    animation: ps-fade-up-6 var(--dur-med, 240ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) 400ms both;
  }
  .ps-feedback-in {
    animation: ps-fade-up-6 var(--dur-med, 240ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
  }
  .ps-mark-in {
    display: inline-block;
    animation: ps-mark-in 200ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) 50ms both;
  }
  .ps-press-btn {
    transition: transform var(--dur-fast, 140ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
  }
  .ps-press-btn:hover:not(:disabled) { transform: scale(1.03); }
  .ps-press-btn:active:not(:disabled) { transform: scale(0.97); }
  .ps-press-opt {
    transition:
      transform var(--dur-fast, 140ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
      background-color 150ms ease, border-color 150ms ease, color 150ms ease;
  }
  .ps-press-opt:hover:not(:disabled):not([aria-disabled="true"]) { transform: scale(1.01); }
  .ps-press-opt:active:not(:disabled):not([aria-disabled="true"]) { transform: scale(0.985); }
  .ps-answer-pulse { animation: ps-answer-pulse 300ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
  .ps-answer-dip { animation: ps-answer-dip 300ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
  .ps-progress-fill {
    transition: transform 400ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
  }
  @keyframes ps-fade-up-12 {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes ps-fade-up-6 {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes ps-results-in {
    from { opacity: 0; transform: scale(0.96) translateY(8px); }
    to { opacity: 1; transform: none; }
  }
  @keyframes ps-score-in {
    from { opacity: 0; transform: scale(0.6); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes ps-mark-in {
    from { opacity: 0; transform: scale(0); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes ps-answer-pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.02); }
    100% { transform: scale(1); }
  }
  @keyframes ps-answer-dip {
    0% { transform: scale(1); }
    50% { transform: scale(0.99); }
    100% { transform: scale(1); }
  }
}
/* Streak-milestone celebration. Confetti pieces default to opacity:0 so
   reduced-motion / unsupported browsers see NO frozen dots — the static badge
   carries the message. Motion is added only inside the gate below. */
.ps-confetti {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.ps-confetti span {
  position: absolute;
  top: -12px;
  width: 8px;
  height: 8px;
  border-radius: 1px;
  opacity: 0;
}
.ps-milestone-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
@media (prefers-reduced-motion: no-preference) {
  .ps-confetti span {
    animation: ps-confetti-fall 1500ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
  }
  .ps-milestone-badge {
    animation: ps-fade-up-6 var(--dur-med, 240ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) 200ms both;
  }
}
@keyframes ps-confetti-fall {
  0% { opacity: 1; transform: translateY(0) rotate(0deg); }
  100% { opacity: 0; transform: translateY(340px) rotate(360deg); }
}
`;

export default function PracticeSession({ poolUrl, backHref, title, groups }: Props) {
  // Resolve the active pool + scope from an optional ?group= query param, and
  // detect ?review=1 (review-missed mode: filter the pool to missed questions).
  const resolved = useMemo(() => {
    const params =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : null;
    const review = params?.get("review") === "1";
    if (groups && groups.length && params) {
      const key = params.get("group");
      const match = key ? groups.find((g) => g.key === key) : undefined;
      if (match) return { url: match.url, scope: match.label, review };
    }
    return { url: poolUrl, scope: title, review };
  }, [poolUrl, title, groups]);

  // Scope the missed-question count to what this pool actually reviews: a
  // subtopic pool (/questions/<d>/<slug>.json) scopes to that subtopic; a
  // domain/group pool (_all / _group-*) scopes to the whole domain.
  const missedFilter = useMemo(() => {
    const m = resolved.url.match(/\/questions\/([^/]+)\/([^/]+)\.json$/);
    if (!m) return {};
    const [, domain, file] = m;
    if (file.startsWith("_")) return { domain };
    return { domain, topic_slug: file };
  }, [resolved.url]);

  // Which preset the learner picked; null => show the pre-quiz chooser first.
  const [preset, setPreset] = useState<SessionPreset | null>(null);
  // Selected difficulty tiers; empty Set => all tiers (the default).
  const [tiers, setTiers] = useState<Set<Difficulty>>(new Set());
  // Per-tier counts for the chooser pills (null until the pool is sampled once).
  const [tierCounts, setTierCounts] = useState<Record<string, number> | null>(null);
  // Why the pool ended up empty, so the empty state can explain it.
  const [emptyReason, setEmptyReason] = useState<"pool" | "review" | "tiers">("pool");
  const [status, setStatus] = useState<
    "choosing" | "loading" | "error" | "empty" | "ready"
  >("choosing");
  const [prepared, setPrepared] = useState<PreparedQuestion[]>([]);
  // Lazily-loaded { questionId -> explanation } map (null until the fetch lands).
  const [explanations, setExplanations] = useState<Record<string, string> | null>(
    null,
  );
  const [current, setCurrent] = useState(0);
  // selections[i] = chosen option index for question i (undefined = unanswered)
  const [selections, setSelections] = useState<(number | undefined)[]>([]);
  const [finished, setFinished] = useState(false);
  const [stats, setStats] = useState<StoredStats | null>(null);
  // Streak milestone just reached this session (null = none), for celebration.
  const [milestone, setMilestone] = useState<number | null>(null);
  // roving focus target within the current option list
  const [focusIndex, setFocusIndex] = useState(0);

  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const savedRef = useRef(false); // guards double-persist of a finished session
  const nextBtnRef = useRef<HTMLButtonElement | null>(null);
  // Previous attempt's pct, captured on finish before writeStats overwrites it.
  const prevPctRef = useRef<number | null>(null);
  // Which _explanations.json URL is loaded/in-flight (skips refetch on retry).
  const explanationsUrlRef = useRef<string | null>(null);

  /** Background-fetch the domain's explanations map; never blocks quiz start. */
  const loadExplanations = useCallback((url: string) => {
    if (explanationsUrlRef.current === url) return;
    explanationsUrlRef.current = url;
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setExplanations((await res.json()) as Record<string, string>);
      } catch {
        // Allow a later loadPool() (e.g. Retry) to attempt the fetch again.
        explanationsUrlRef.current = null;
      }
    })();
  }, []);

  const loadPool = useCallback(async () => {
    // Wait for a preset choice before loading anything.
    if (!preset) {
      setStatus("choosing");
      return;
    }
    const review = preset.review;
    setStatus("loading");
    try {
      const res = await fetch(slimUrl(resolved.url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let pool = (await res.json()) as Question[];
      if (!Array.isArray(pool) || pool.length === 0) {
        setEmptyReason("pool");
        setStatus("empty");
        return;
      }
      // Difficulty filter (empty Set => all tiers). Before review + sampling.
      if (tiers.size > 0) {
        pool = pool.filter(
          (q) => q.difficulty != null && tiers.has(q.difficulty as Difficulty),
        );
        if (pool.length === 0) {
          setEmptyReason("tiers");
          setStatus("empty");
          return;
        }
      }
      // Review-missed mode: keep only questions the learner last got wrong.
      if (review) {
        const missed = new Set(missedIds(missedFilter));
        pool = pool.filter((q) => missed.has(q.id));
        if (pool.length === 0) {
          setEmptyReason("review");
          setStatus("empty");
          return;
        }
      }
      const q = prepare(pool, preset.size ?? pool.length);
      setPrepared(q);
      setSelections(new Array(q.length).fill(undefined));
      setCurrent(0);
      setFinished(false);
      setFocusIndex(0);
      setMilestone(null);
      savedRef.current = false;
      setStatus("ready");
      // Deferred: fetch explanations in the background (quiz starts without them).
      loadExplanations(explanationsUrl(resolved.url));
    } catch {
      setStatus("error");
    }
  }, [resolved.url, preset, missedFilter, tiers, loadExplanations]);

  const toggleTier = useCallback((t: Difficulty) => {
    setTiers((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  // Deep-link ?review=1 auto-selects the "missed" preset so it skips the chooser.
  useEffect(() => {
    if (preset) return;
    if (resolved.review) {
      setPreset(SESSION_PRESETS.find((p) => p.key === "missed") ?? null);
    }
  }, [resolved.review, preset]);

  // Tally per-tier counts once for the chooser pills (best-effort; ignores errors).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(slimUrl(resolved.url));
        if (!res.ok) return;
        const pool = (await res.json()) as Question[];
        if (cancelled || !Array.isArray(pool)) return;
        const counts: Record<string, number> = {};
        for (const q of pool) {
          if (q.difficulty) counts[q.difficulty] = (counts[q.difficulty] ?? 0) + 1;
        }
        setTierCounts(counts);
      } catch {
        /* counts are optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolved.url]);

  useEffect(() => {
    void loadPool();
  }, [loadPool]);

  useEffect(() => {
    setStats(readStats(resolved.url));
  }, [resolved.url]);

  const total = prepared.length;
  const answeredCount = selections.filter((s) => s !== undefined).length;
  const score = prepared.reduce(
    (n, pq, i) => (selections[i] === pq.correctIndex ? n + 1 : n),
    0,
  );

  const activeQ = prepared[current];
  const activeSelection = activeQ ? selections[current] : undefined;
  const isLocked = activeSelection !== undefined;

  const select = useCallback(
    (optionIndex: number) => {
      if (finished) return;
      setSelections((prev) => {
        if (prev[current] !== undefined) return prev; // lock: ignore re-answer
        const next = prev.slice();
        next[current] = optionIndex;
        return next;
      });
    },
    [current, finished],
  );

  const goNext = useCallback(() => {
    if (current < total - 1) {
      setCurrent((c) => c + 1);
      setFocusIndex(0);
    } else {
      setFinished(true);
    }
  }, [current, total]);

  // If the background explanations fetch failed, retry whenever an explanation
  // is actually needed (a question was just answered). No-op while in flight.
  useEffect(() => {
    if (isLocked && explanations === null) {
      loadExplanations(explanationsUrl(resolved.url));
    }
  }, [isLocked, explanations, resolved.url, loadExplanations]);

  // Persist once when a session finishes: pool stats + per-question answer
  // history (feeds mastery grid + review-missed) + daily streak.
  useEffect(() => {
    if (finished && !savedRef.current && total > 0) {
      savedRef.current = true;
      // Capture the previous attempt's pct BEFORE writeStats overwrites lastPct.
      prevPctRef.current = readStats(resolved.url).attempts > 0
        ? readStats(resolved.url).lastPct
        : null;
      setStats(writeStats(resolved.url, score, total));
      recordAnswers(
        prepared.map((pq, i) => ({
          id: pq.q.id,
          correct: selections[i] === pq.correctIndex,
          domain: pq.q.domain,
          topic_slug: pq.q.topic_slug,
        })),
      );
      const streak = registerPractice();
      const reached = claimStreakMilestone(streak.current);
      if (reached) setMilestone(reached);
    }
  }, [finished, total, score, resolved.url, prepared, selections]);

  // Move focus to the option list / next button as the question changes.
  useEffect(() => {
    if (status !== "ready" || finished) return;
    if (isLocked) {
      nextBtnRef.current?.focus();
    } else {
      optionRefs.current[focusIndex]?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, status, finished]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (finished || !activeQ) return;
      const count = activeQ.options.length;

      // Number keys select an option directly.
      if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (idx < count) {
          e.preventDefault();
          if (!isLocked) {
            setFocusIndex(idx);
            select(idx);
          }
        }
        return;
      }

      if (isLocked) {
        if (e.key === "Enter" || e.key === "ArrowRight") {
          e.preventDefault();
          goNext();
        }
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        setFocusIndex((i) => {
          const n = (i + 1) % count;
          optionRefs.current[n]?.focus();
          return n;
        });
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusIndex((i) => {
          const n = (i - 1 + count) % count;
          optionRefs.current[n]?.focus();
          return n;
        });
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select(focusIndex);
      }
    },
    [activeQ, finished, isLocked, focusIndex, select, goNext],
  );

  // ---- Render states -------------------------------------------------------

  // Pre-quiz preset chooser (microlearning: match session length to time on hand).
  if (status === "choosing") {
    const missed = missedCount(missedFilter);
    return (
      <div class="card p-6">
        <style>{ANIM_CSS}</style>
        <p class="text-sm font-semibold uppercase tracking-wide" style="color: var(--color-text-muted);">
          {resolved.scope}
        </p>
        <h2 class="mt-1 text-lg font-bold">Choose a session</h2>

        <div class="mt-4">
          <p class="text-xs font-semibold uppercase tracking-wide" style="color: var(--color-text-muted);">
            Difficulty
          </p>
          <div class="mt-2 flex flex-wrap gap-2" role="group" aria-label="Filter by difficulty">
            {DIFFICULTY_TIERS.map((t) => {
              const on = tiers.has(t.key);
              const count = tierCounts?.[t.key];
              return (
                <button
                  type="button"
                  key={t.key}
                  aria-pressed={on}
                  class="ps-press-btn rounded-full border px-3 py-1 text-sm font-medium"
                  style={
                    on
                      ? `background: color-mix(in srgb, ${t.accent} 18%, transparent); border-color: ${t.accent}; color: ${t.accent};`
                      : "background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
                  }
                  onClick={() => toggleTier(t.key)}
                >
                  {t.label}
                  {typeof count === "number" ? ` (${count})` : ""}
                </button>
              );
            })}
          </div>
          <p class="mt-1 text-xs" style="color: var(--color-text-muted);">
            {tiers.size === 0 ? "All difficulties" : `${tiers.size} selected`}
          </p>
        </div>

        <div class="mt-4 flex flex-col gap-3">
          {SESSION_PRESETS.map((p) => {
            const isMissed = p.key === "missed";
            const disabled = isMissed && missed === 0;
            return (
              <button
                type="button"
                key={p.key}
                disabled={disabled}
                class="ps-press-btn card p-4 text-left"
                style={`border-color: var(--color-border); opacity: ${disabled ? 0.5 : 1}; cursor: ${disabled ? "default" : "pointer"};`}
                onClick={() => {
                  if (!disabled) setPreset(p);
                }}
              >
                <span class="font-semibold">
                  {p.label}
                  {isMissed && missed > 0 ? ` (${missed})` : ""}
                </span>
                <span class="mt-1 block text-sm" style="color: var(--color-text-muted);">
                  {disabled ? "Nothing missed yet — practice a round first." : p.hint}
                </span>
              </button>
            );
          })}
        </div>
        <div class="mt-4">
          <a
            href={backHref}
            class="rounded-md border px-4 py-2 text-sm font-medium no-underline"
            style="border-color: var(--color-border); color: var(--color-text);"
          >
            Back to topic
          </a>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div class="card p-6" aria-busy="true">
        <p style="color: var(--color-text-muted);">Loading questions…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div class="card p-6">
        <p style="color: var(--color-incorrect);">
          Could not load the question pool.
        </p>
        <div class="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            class="rounded-md px-4 py-2 text-sm font-semibold no-underline"
            style="background: var(--color-primary); color: var(--color-primary-contrast);"
            onClick={() => void loadPool()}
          >
            Try again
          </button>
          <a
            href={backHref}
            class="rounded-md border px-4 py-2 text-sm font-medium no-underline"
            style="border-color: var(--color-border); color: var(--color-text);"
          >
            Back to topic
          </a>
        </div>
      </div>
    );
  }

  if (status === "empty") {
    return (
      <div class="card p-6">
        <p style="color: var(--color-text-muted);">
          {emptyReason === "tiers"
            ? "No questions match the difficulty levels you picked. Clear or widen the difficulty filter and try again."
            : resolved.review
              ? "Nothing to review here — you haven't missed any questions in this scope. Practice a round first, then come back to drill what you got wrong."
              : "There are no practice questions available for this selection yet."}
        </p>
        <div class="mt-4 flex flex-wrap gap-3">
          {emptyReason === "tiers" && (
            <button
              type="button"
              class="rounded-md px-4 py-2 text-sm font-semibold no-underline"
              style="background: var(--color-primary); color: var(--color-primary-contrast);"
              onClick={() => {
                setPreset(null);
                setStatus("choosing");
              }}
            >
              Adjust difficulty
            </button>
          )}
          <a
            href={backHref}
            class="rounded-md border px-4 py-2 text-sm font-medium no-underline"
            style="border-color: var(--color-border); color: var(--color-text);"
          >
            Back to topic
          </a>
        </div>
      </div>
    );
  }

  const pct = total > 0 ? Math.round((score / total) * 100) : 0;

  // ---- Results summary -----------------------------------------------------
  if (finished) {
    const passed = pct >= 60;
    const newBest = stats != null && pct >= stats.bestPct && pct > 0;

    // Trend vs the previous attempt (hidden on the first-ever attempt).
    const prevPct = prevPctRef.current;
    const delta = prevPct == null ? null : pct - prevPct;

    // Per-subtopic breakdown — only meaningful when the pool spans >1 subtopic.
    const bySlug = new Map<string, { title: string; right: number; wrong: number }>();
    prepared.forEach((pq, i) => {
      const key = pq.q.topic_slug;
      const row = bySlug.get(key) ?? { title: humanizeSlug(key), right: 0, wrong: 0 };
      if (selections[i] === pq.correctIndex) row.right++;
      else row.wrong++;
      bySlug.set(key, row);
    });
    const breakdown = [...bySlug.values()].sort(
      (a, b) => b.wrong - a.wrong || a.title.localeCompare(b.title),
    );
    const multiTopic = bySlug.size > 1;

    // Next CTA: review is only offered when misses exist in this pool's scope.
    const missedNow = missedCount(missedFilter);

    return (
      <div>
        <style>{ANIM_CSS}</style>
        <div class="card surface-brand ps-results-in relative overflow-hidden p-6 text-center">
          {milestone != null && (
            <>
              <div class="ps-confetti" aria-hidden="true">
                {Array.from({ length: 24 }).map((_, i) => {
                  const colors = [
                    "var(--accent-blue)",
                    "var(--accent-violet)",
                    "var(--accent-amber)",
                    "var(--accent-teal)",
                    "var(--accent-green)",
                    "var(--accent-rose)",
                  ];
                  return (
                    <span
                      key={i}
                      style={{
                        left: `${(i * 100) / 24}%`,
                        background: colors[i % colors.length],
                        animationDelay: `${(i % 8) * 90}ms`,
                      }}
                    />
                  );
                })}
              </div>
              <p
                class="ps-milestone-badge relative z-10 mx-auto mb-2 rounded-full px-3 py-1 text-sm font-bold"
                style="background: color-mix(in srgb, var(--accent-amber) 16%, transparent); color: var(--accent-amber);"
                role="status"
              >
                🔥 {milestone}-day streak! Keep it going.
              </p>
            </>
          )}
          <p
            class="text-sm font-semibold uppercase tracking-wide"
            style="color: var(--color-text-muted);"
          >
            {resolved.scope}
          </p>
          <p class="ps-score-in mt-2 text-5xl font-bold">
            <span class="text-gradient">
              {score} / {total}
            </span>
          </p>
          <p class="mt-1 text-lg" style="color: var(--color-text-muted);">
            {pct}% correct
          </p>
          {delta != null && (
            <p
              class="mt-1 text-sm font-semibold"
              style={`color: ${
                delta > 0
                  ? "var(--color-correct)"
                  : delta < 0
                    ? "var(--color-incorrect)"
                    : "var(--color-text-muted)"
              };`}
            >
              {delta > 0
                ? `▲ +${delta}% vs last`
                : delta < 0
                  ? `▼ ${delta}% vs last`
                  : "Same as last attempt"}
            </p>
          )}
          {newBest && (
            <p
              class="ps-best-in mt-2 text-sm font-semibold"
              style="color: var(--color-accent);"
            >
              {passed ? "New best score!" : "New best!"}
            </p>
          )}
          {stats && (
            <p class="mt-3 text-sm" style="color: var(--color-text-muted);">
              Best: {stats.bestPct}% · Attempts: {stats.attempts}
            </p>
          )}
          <div class="mt-6 flex flex-wrap justify-center gap-3">
            {missedNow > 0 && !preset?.review ? (
              <button
                type="button"
                class="ps-press-btn min-h-[44px] rounded-md px-5 py-2.5 font-semibold no-underline shadow-1"
                style="background: var(--color-primary); color: var(--color-primary-contrast);"
                onClick={() => {
                  // Switching the preset re-triggers loadPool via its effect —
                  // don't also call loadPool here (avoids a double load).
                  setPreset(SESSION_PRESETS.find((p) => p.key === "missed") ?? null);
                  setFinished(false);
                }}
              >
                Review {missedNow} missed
              </button>
            ) : (
              <button
                type="button"
                class="ps-press-btn min-h-[44px] rounded-md px-5 py-2.5 font-semibold no-underline shadow-1"
                style="background: var(--color-primary); color: var(--color-primary-contrast);"
                onClick={() => void loadPool()}
              >
                Retry
              </button>
            )}
            <a
              href={backHref}
              class="inline-flex min-h-[44px] items-center rounded-md border px-5 py-2.5 font-medium no-underline"
              style="border-color: var(--color-border); color: var(--color-text);"
            >
              Back to topic
            </a>
          </div>

          {multiTopic && (
            <div class="mt-6 text-left">
              <h3 class="mb-2 text-sm font-bold uppercase tracking-wide" style="color: var(--color-text-muted);">
                By subtopic
              </h3>
              <ul class="flex flex-col gap-1.5 text-sm">
                {breakdown.map((row) => (
                  <li key={row.title} class="flex items-center justify-between gap-3">
                    <span style="color: var(--color-text);">{row.title}</span>
                    <span class="shrink-0 tabular-nums">
                      <span style="color: var(--color-correct);">{row.right}</span>
                      <span style="color: var(--color-text-muted);"> / {row.right + row.wrong}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <h2 class="mb-3 mt-8 text-lg font-bold">Review</h2>
        <ol class="flex flex-col gap-3">
          {prepared.map((pq, i) => {
            const chosen = selections[i];
            const correct = chosen === pq.correctIndex;
            const href = learnMoreHref(pq.q);
            return (
              <li class="card reveal p-4" key={pq.q.id}>
                <div class="flex items-start justify-between gap-3">
                  <p class="font-medium">
                    <span style="color: var(--color-text-muted);">{i + 1}.</span>{" "}
                    {pq.q.question}
                  </p>
                  <span
                    class="shrink-0 rounded px-2 py-0.5 text-xs font-semibold"
                    style={`background: color-mix(in srgb, ${
                      correct ? "var(--color-correct)" : "var(--color-incorrect)"
                    } 15%, transparent); color: ${
                      correct ? "var(--color-correct)" : "var(--color-incorrect)"
                    };`}
                  >
                    {correct ? "Correct" : "Incorrect"}
                  </span>
                </div>
                <ul class="mt-2 flex flex-col gap-1 text-sm">
                  {pq.options.map((opt, oi) => {
                    const isCorrect = oi === pq.correctIndex;
                    const isChosen = oi === chosen;
                    const color = isCorrect
                      ? "var(--color-correct)"
                      : isChosen
                        ? "var(--color-incorrect)"
                        : "var(--color-text-muted)";
                    return (
                      <li key={oi} style={`color: ${color};`}>
                        <span aria-hidden="true">
                          {isCorrect ? "✓" : isChosen ? "✗" : "·"}
                        </span>{" "}
                        {opt}
                        {isChosen && !isCorrect && (
                          <span class="sr-only"> (your answer)</span>
                        )}
                        {isCorrect && <span class="sr-only"> (correct answer)</span>}
                      </li>
                    );
                  })}
                </ul>
                {href && (
                  <a
                    href={href}
                    class="mt-2 inline-block text-sm font-medium"
                    style="color: var(--color-primary);"
                  >
                    Learn more →
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  // ---- Active question -----------------------------------------------------
  const href = activeQ ? learnMoreHref(activeQ.q) : null;

  return (
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
    <div onKeyDown={onKeyDown as unknown as (e: Event) => void}>
      <style>{ANIM_CSS}</style>
      {/* Progress + running score */}
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p
            class="text-xs font-semibold uppercase tracking-wide"
            style="color: var(--color-text-muted);"
          >
            {resolved.scope}
          </p>
          <p class="text-sm" style="color: var(--color-text-muted);">
            Q {current + 1} / {total}
          </p>
        </div>
        <p
          class="text-sm font-medium"
          style="color: var(--color-text-muted);"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          Score: {score} / {answeredCount}
        </p>
      </div>

      {/* Progress bar — compositor-only: animate scaleX (never width). */}
      <div
        class="mb-6 h-2 w-full overflow-hidden rounded-full"
        style="background: var(--color-surface-2);"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={current + 1}
        aria-label="Quiz progress"
      >
        <div
          class="ps-progress-fill h-full w-full rounded-full"
          style={{
            background: "var(--gradient-brand)",
            transformOrigin: "left center",
            transform: `scaleX(${total ? (current + 1) / total : 0})`,
          }}
        />
      </div>

      {activeQ && (
        /* Keyed by question index so the CSS enter animation replays on change. */
        <div key={current} class="card ps-card-in p-5 sm:p-6">
          <h2
            id={`ps-q-${current}`}
            class="text-lg font-semibold"
            style="white-space: pre-wrap;"
            tabIndex={-1}
          >
            {activeQ.q.question.trim()}
          </h2>

          {/* The answer group is labelled by the question stem, so a screen
              reader announces the new question when focus moves here on Next. */}
          <div
            class="mt-4 flex flex-col gap-2"
            role="group"
            aria-labelledby={`ps-q-${current}`}
          >
            {activeQ.options.map((opt, oi) => {
              const chosen = activeSelection === oi;
              const isCorrect = oi === activeQ.correctIndex;
              let bg = "var(--color-surface)";
              let border = "var(--color-border)";
              let fg = "var(--color-text)";
              if (isLocked) {
                if (isCorrect) {
                  bg = "color-mix(in srgb, var(--color-correct) 14%, transparent)";
                  border = "var(--color-correct)";
                  fg = "var(--color-correct)";
                } else if (chosen) {
                  bg = "color-mix(in srgb, var(--color-incorrect) 14%, transparent)";
                  border = "var(--color-incorrect)";
                  fg = "var(--color-incorrect)";
                }
              }
              // One-shot settle animation when the answer locks in: the correct
              // option pulses up, an incorrect chosen option dips.
              const settleClass =
                isLocked && isCorrect
                  ? " ps-answer-pulse"
                  : isLocked && chosen
                    ? " ps-answer-dip"
                    : "";
              return (
                <button
                  key={oi}
                  type="button"
                  ref={(el: HTMLButtonElement | null) => {
                    optionRefs.current[oi] = el;
                  }}
                  class={`ps-press-opt${settleClass} flex min-h-[44px] w-full items-center gap-3 rounded-md border px-4 py-3 text-left text-sm`}
                  style={{
                    background: bg,
                    borderColor: border,
                    color: fg,
                    cursor: isLocked ? "default" : "pointer",
                  }}
                  /* aria-disabled (not `disabled`) keeps locked options focusable
                     so a screen-reader user can review every choice + its marked
                     correctness after answering; select() still ignores re-answers. */
                  aria-disabled={isLocked}
                  aria-pressed={chosen}
                  tabIndex={oi === focusIndex ? 0 : -1}
                  onClick={() => select(oi)}
                >
                  <span
                    class="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs font-bold tabular-nums"
                    style={
                      isLocked && isCorrect
                        ? "background: var(--color-correct); color: var(--color-primary-contrast); border-color: var(--color-correct);"
                        : isLocked && chosen
                          ? "background: var(--color-incorrect); color: var(--color-primary-contrast); border-color: var(--color-incorrect);"
                          : "background: var(--color-surface-2); color: var(--color-text-muted); border-color: var(--color-border); box-shadow: 0 1px 0 color-mix(in srgb, var(--color-border) 70%, transparent);"
                    }
                    aria-hidden="true"
                  >
                    {oi + 1}
                  </span>
                  <span class="flex-1">{opt}</span>
                  {/* Correctness conveyed by name, not color alone (WCAG 1.4.1). */}
                  {isLocked && isCorrect && <span class="sr-only"> (correct answer)</span>}
                  {isLocked && chosen && !isCorrect && (
                    <span class="sr-only"> (your answer — incorrect)</span>
                  )}
                  {isLocked && isCorrect && (
                    <span
                      class="ps-mark-in ml-auto text-base font-bold"
                      style="color: var(--color-correct);"
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                  )}
                  {isLocked && chosen && !isCorrect && (
                    <span
                      class="ps-mark-in ml-auto text-base font-bold"
                      style="color: var(--color-incorrect);"
                      aria-hidden="true"
                    >
                      ✗
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Feedback (announced) */}
          <div aria-live="polite" class="mt-4">
            {isLocked && (
              <div class="ps-feedback-in">
                <p
                  class="text-sm font-semibold"
                  style={`color: ${
                    activeSelection === activeQ.correctIndex
                      ? "var(--color-correct)"
                      : "var(--color-incorrect)"
                  };`}
                >
                  {activeSelection === activeQ.correctIndex
                    ? "Correct"
                    : `Incorrect — the correct answer is ${activeQ.correctIndex + 1}. ${activeQ.options[activeQ.correctIndex]}`}
                </p>
                {(() => {
                  // Slim pools carry no explanation; look it up in the lazily
                  // loaded map (fall back to an inline field if present).
                  const explanation =
                    explanations?.[activeQ.q.id] ?? activeQ.q.explanation;
                  if (explanation) {
                    return (
                      <p
                        class="mt-2 text-sm"
                        style="color: var(--color-text-muted); white-space: pre-wrap;"
                      >
                        {explanation.trim()}
                      </p>
                    );
                  }
                  if (explanations === null) {
                    return (
                      <p
                        class="mt-2 text-sm italic"
                        style="color: var(--color-text-muted);"
                      >
                        Loading explanation…
                      </p>
                    );
                  }
                  return null;
                })()}
                {href && (
                  <a
                    href={href}
                    class="mt-2 inline-block text-sm font-medium"
                    style="color: var(--color-primary);"
                  >
                    Learn more →
                  </a>
                )}
              </div>
            )}
          </div>

          {isLocked && (
            <div class="mt-5 flex justify-end">
              <button
                type="button"
                ref={nextBtnRef}
                class="ps-press-btn min-h-[44px] rounded-md px-5 py-2.5 font-semibold no-underline shadow-1"
                style="background: var(--color-primary); color: var(--color-primary-contrast);"
                onClick={goNext}
              >
                {current < total - 1 ? "Next" : "See results"}
                <span
                  aria-hidden="true"
                  class="ml-2 inline-flex items-center rounded border px-1.5 text-xs font-normal"
                  style="border-color: color-mix(in srgb, var(--color-primary-contrast) 45%, transparent); color: var(--color-primary-contrast); opacity: 0.85;"
                >
                  ↵
                </span>
              </button>
            </div>
          )}

          {!isLocked && (
            <p class="mt-4 text-xs" style="color: var(--color-text-muted);">
              Tip: press{" "}
              <kbd style="border: 1px solid var(--color-border); color: var(--color-text-muted); border-radius: var(--radius-sm); padding: 0 0.25rem;">1</kbd>–<kbd style="border: 1px solid var(--color-border); color: var(--color-text-muted); border-radius: var(--radius-sm); padding: 0 0.25rem;">{String(activeQ.options.length)}</kbd>{" "}
              or use arrow keys + Enter to answer.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
