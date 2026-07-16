/** @jsxImportSource preact */
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
// Motion is used ONLY here (the sole Preact island). `motion/react` resolves
// against Preact via the react -> preact/compat alias (@astrojs/preact
// { compat: true }). `MotionConfig reducedMotion="user"` makes every animation
// below automatically collapse to a no-op when the OS requests reduced motion.
import { motion, AnimatePresence, MotionConfig } from "motion/react";
import type { Question } from "@lib/types";
import { DEFAULT_SAMPLE_SIZE, pickN, seededShuffle } from "@lib/sample";

/**
 * PracticeSession — the interactive MCQ quiz. The ONLY Preact island on the site.
 *
 * Fetches a flat question pool from `poolUrl` (a static /questions/... JSON file),
 * samples up to 25 questions, shuffles both question order and the options within
 * each question (remapping the correct-answer index), then runs an immediate
 * per-question-feedback flow. Score + best are persisted to localStorage keyed by
 * the resolved pool URL.
 *
 * For system-design domain practice, an optional `groups` list lets the component
 * pick a `_group-<key>.json` pool client-side from a `?group=` query param and adapt
 * the scope heading accordingly (per CONTRACT.md §10).
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

/** Build the /study Learn-more link from a question's optional ref. */
function learnMoreHref(q: Question): string | null {
  if (!q.ref) return null;
  const hash = q.ref.replace(/^concepts\.md#/, "");
  return `/study/${q.domain}/${q.topic_slug}#${hash}`;
}

/** Sample + shuffle a pool into prepared questions (options shuffled, answer remapped). */
function prepare(pool: Question[]): PreparedQuestion[] {
  const sampled = pickN(pool, DEFAULT_SAMPLE_SIZE);
  return sampled.map((q) => {
    const order = seededShuffle(q.options.map((_, i) => i));
    const options = order.map((i) => q.options[i]);
    const correctIndex = order.indexOf(q.answer);
    return { q, options, correctIndex };
  });
}

const OPTION_LETTERS = ["A", "B", "C", "D", "E"];

export default function PracticeSession({ poolUrl, backHref, title, groups }: Props) {
  // Resolve the active pool + scope from an optional ?group= query param.
  const resolved = useMemo(() => {
    if (groups && groups.length && typeof window !== "undefined") {
      const key = new URLSearchParams(window.location.search).get("group");
      const match = key ? groups.find((g) => g.key === key) : undefined;
      if (match) return { url: match.url, scope: match.label };
    }
    return { url: poolUrl, scope: title };
  }, [poolUrl, title, groups]);

  const [status, setStatus] = useState<"loading" | "error" | "empty" | "ready">(
    "loading",
  );
  const [prepared, setPrepared] = useState<PreparedQuestion[]>([]);
  const [current, setCurrent] = useState(0);
  // selections[i] = chosen option index for question i (undefined = unanswered)
  const [selections, setSelections] = useState<(number | undefined)[]>([]);
  const [finished, setFinished] = useState(false);
  const [stats, setStats] = useState<StoredStats | null>(null);
  // roving focus target within the current option list
  const [focusIndex, setFocusIndex] = useState(0);

  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const savedRef = useRef(false); // guards double-persist of a finished session
  const nextBtnRef = useRef<HTMLButtonElement | null>(null);

  const loadPool = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(resolved.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const pool = (await res.json()) as Question[];
      if (!Array.isArray(pool) || pool.length === 0) {
        setStatus("empty");
        return;
      }
      const q = prepare(pool);
      setPrepared(q);
      setSelections(new Array(q.length).fill(undefined));
      setCurrent(0);
      setFinished(false);
      setFocusIndex(0);
      savedRef.current = false;
      setStatus("ready");
    } catch {
      setStatus("error");
    }
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

  // Persist once when a session finishes.
  useEffect(() => {
    if (finished && !savedRef.current && total > 0) {
      savedRef.current = true;
      setStats(writeStats(resolved.url, score, total));
    }
  }, [finished, total, score, resolved.url]);

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
          There are no practice questions available for this selection yet.
        </p>
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

  const pct = total > 0 ? Math.round((score / total) * 100) : 0;

  // ---- Results summary -----------------------------------------------------
  if (finished) {
    const passed = pct >= 60;
    const newBest = stats != null && pct >= stats.bestPct && pct > 0;
    return (
      <MotionConfig reducedMotion="user">
      <div>
        <motion.div
          class="card surface-brand overflow-hidden p-6 text-center"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
        >
          <p
            class="text-sm font-semibold uppercase tracking-wide"
            style="color: var(--color-text-muted);"
          >
            {resolved.scope}
          </p>
          <motion.p
            class="mt-2 text-5xl font-bold"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 18, delay: 0.12 }}
          >
            <span class="text-gradient">
              {score} / {total}
            </span>
          </motion.p>
          <p class="mt-1 text-lg" style="color: var(--color-text-muted);">
            {pct}% correct
          </p>
          {newBest && (
            <motion.p
              class="mt-2 text-sm font-semibold"
              style={{ color: "var(--color-accent)" }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            >
              {passed ? "New best score!" : "New best!"}
            </motion.p>
          )}
          {stats && (
            <p class="mt-3 text-sm" style="color: var(--color-text-muted);">
              Best: {stats.bestPct}% · Attempts: {stats.attempts}
            </p>
          )}
          <div class="mt-6 flex flex-wrap justify-center gap-3">
            <motion.button
              type="button"
              class="min-h-[44px] rounded-md px-5 py-2.5 font-semibold no-underline shadow-1"
              style={{
                background: "var(--color-primary)",
                color: "var(--color-primary-contrast)",
              }}
              onClick={() => void loadPool()}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              Retry (new {Math.min(DEFAULT_SAMPLE_SIZE, total)})
            </motion.button>
            <a
              href={backHref}
              class="inline-flex min-h-[44px] items-center rounded-md border px-5 py-2.5 font-medium no-underline"
              style="border-color: var(--color-border); color: var(--color-text);"
            >
              Back to topic
            </a>
          </div>
        </motion.div>

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
      </MotionConfig>
    );
  }

  // ---- Active question -----------------------------------------------------
  const href = activeQ ? learnMoreHref(activeQ.q) : null;

  return (
    <MotionConfig reducedMotion="user">
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
    <div onKeyDown={onKeyDown as unknown as (e: Event) => void}>
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
        <p class="text-sm font-medium" style="color: var(--color-text-muted);">
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
        <motion.div
          class="h-full w-full rounded-full"
          style={{ background: "var(--gradient-brand)", transformOrigin: "left center" }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: total ? (current + 1) / total : 0 }}
          transition={{ type: "spring", stiffness: 140, damping: 22 }}
        />
      </div>

      {activeQ && (
        <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={current}
          class="card p-5 sm:p-6"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 class="text-lg font-semibold" style="white-space: pre-wrap;">
            {activeQ.q.question.trim()}
          </h2>

          <div class="mt-4 flex flex-col gap-2" role="group" aria-label="Answer choices">
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
              return (
                <motion.button
                  key={oi}
                  type="button"
                  ref={(el: HTMLButtonElement | null) => {
                    optionRefs.current[oi] = el;
                  }}
                  class="flex min-h-[44px] w-full items-center gap-3 rounded-md border px-4 py-3 text-left text-sm transition-colors"
                  style={{
                    background: bg,
                    borderColor: border,
                    color: fg,
                    cursor: isLocked ? "default" : "pointer",
                  }}
                  disabled={isLocked}
                  aria-pressed={chosen}
                  tabIndex={oi === focusIndex ? 0 : -1}
                  onClick={() => select(oi)}
                  whileHover={isLocked ? undefined : { scale: 1.01 }}
                  whileTap={isLocked ? undefined : { scale: 0.985 }}
                  animate={
                    isLocked && (isCorrect || chosen)
                      ? { scale: [1, isCorrect ? 1.02 : 0.99, 1] }
                      : { scale: 1 }
                  }
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                >
                  <span
                    class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold"
                    style={
                      isLocked && isCorrect
                        ? "background: var(--color-correct); color: var(--color-primary-contrast);"
                        : isLocked && chosen
                          ? "background: var(--color-incorrect); color: var(--color-primary-contrast);"
                          : "background: var(--color-surface-2); color: var(--color-text-muted);"
                    }
                    aria-hidden="true"
                  >
                    {OPTION_LETTERS[oi]}
                  </span>
                  <span class="flex-1">{opt}</span>
                  {isLocked && isCorrect && (
                    <motion.span
                      class="ml-auto text-base font-bold"
                      style={{ color: "var(--color-correct)" }}
                      aria-hidden="true"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 600, damping: 22, delay: 0.05 }}
                    >
                      ✓
                    </motion.span>
                  )}
                  {isLocked && chosen && !isCorrect && (
                    <motion.span
                      class="ml-auto text-base font-bold"
                      style={{ color: "var(--color-incorrect)" }}
                      aria-hidden="true"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 600, damping: 22, delay: 0.05 }}
                    >
                      ✗
                    </motion.span>
                  )}
                </motion.button>
              );
            })}
          </div>

          {/* Feedback (announced) */}
          <div aria-live="polite" class="mt-4">
            {isLocked && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              >
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
                    : `Incorrect — the correct answer is ${OPTION_LETTERS[activeQ.correctIndex]}.`}
                </p>
                {activeQ.q.explanation && (
                  <p
                    class="mt-2 text-sm"
                    style="color: var(--color-text-muted); white-space: pre-wrap;"
                  >
                    {activeQ.q.explanation.trim()}
                  </p>
                )}
                {href && (
                  <a
                    href={href}
                    class="mt-2 inline-block text-sm font-medium"
                    style="color: var(--color-primary);"
                  >
                    Learn more →
                  </a>
                )}
              </motion.div>
            )}
          </div>

          {isLocked && (
            <div class="mt-5 flex justify-end">
              <motion.button
                type="button"
                ref={nextBtnRef}
                class="min-h-[44px] rounded-md px-5 py-2.5 font-semibold no-underline shadow-1"
                style={{
                  background: "var(--color-primary)",
                  color: "var(--color-primary-contrast)",
                }}
                onClick={goNext}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              >
                {current < total - 1 ? "Next" : "See results"}
              </motion.button>
            </div>
          )}

          {!isLocked && (
            <p class="mt-4 text-xs" style="color: var(--color-text-muted);">
              Tip: press <kbd>1</kbd>–<kbd>{String(activeQ.options.length)}</kbd> or
              use arrow keys + Enter to answer.
            </p>
          )}
        </motion.div>
        </AnimatePresence>
      )}
    </div>
    </MotionConfig>
  );
}
