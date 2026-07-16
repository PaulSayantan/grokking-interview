/** @jsxImportSource preact */
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
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
    return (
      <div>
        <div class="card p-6 text-center">
          <p
            class="text-sm font-semibold uppercase tracking-wide"
            style="color: var(--color-text-muted);"
          >
            {resolved.scope}
          </p>
          <p class="mt-2 text-4xl font-bold">
            {score} / {total}
          </p>
          <p class="mt-1 text-lg" style="color: var(--color-text-muted);">
            {pct}% correct
          </p>
          {stats && (
            <p class="mt-3 text-sm" style="color: var(--color-text-muted);">
              Best: {stats.bestPct}% · Attempts: {stats.attempts}
            </p>
          )}
          <div class="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              class="rounded-md px-5 py-2.5 font-semibold no-underline"
              style="background: var(--color-primary); color: var(--color-primary-contrast);"
              onClick={() => void loadPool()}
            >
              Retry (new {Math.min(DEFAULT_SAMPLE_SIZE, total)})
            </button>
            <a
              href={backHref}
              class="rounded-md border px-5 py-2.5 font-medium no-underline"
              style="border-color: var(--color-border); color: var(--color-text);"
            >
              Back to topic
            </a>
          </div>
        </div>

        <h2 class="mb-3 mt-8 text-lg font-bold">Review</h2>
        <ol class="flex flex-col gap-3">
          {prepared.map((pq, i) => {
            const chosen = selections[i];
            const correct = chosen === pq.correctIndex;
            const href = learnMoreHref(pq.q);
            return (
              <li class="card p-4" key={pq.q.id}>
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
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
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

      {/* Progress bar */}
      <div
        class="mb-6 h-1.5 w-full overflow-hidden rounded-full"
        style="background: var(--color-surface-2);"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={current + 1}
        aria-label="Quiz progress"
      >
        <div
          class="h-full rounded-full transition-all"
          style={`width: ${total ? ((current + 1) / total) * 100 : 0}%; background: var(--color-primary);`}
        />
      </div>

      {activeQ && (
        <div class="card p-5 sm:p-6">
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
                <button
                  key={oi}
                  type="button"
                  ref={(el) => {
                    optionRefs.current[oi] = el;
                  }}
                  class="flex w-full items-start gap-3 rounded-md border px-4 py-3 text-left text-sm transition-colors"
                  style={`background: ${bg}; border-color: ${border}; color: ${fg}; cursor: ${
                    isLocked ? "default" : "pointer"
                  };`}
                  disabled={isLocked}
                  aria-pressed={chosen}
                  tabIndex={oi === focusIndex ? 0 : -1}
                  onClick={() => select(oi)}
                >
                  <span
                    class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-bold"
                    style="background: var(--color-surface-2); color: var(--color-text-muted);"
                    aria-hidden="true"
                  >
                    {OPTION_LETTERS[oi]}
                  </span>
                  <span>{opt}</span>
                  {isLocked && isCorrect && (
                    <span class="ml-auto" aria-hidden="true">
                      ✓
                    </span>
                  )}
                  {isLocked && chosen && !isCorrect && (
                    <span class="ml-auto" aria-hidden="true">
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
              <div>
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
              </div>
            )}
          </div>

          {isLocked && (
            <div class="mt-5 flex justify-end">
              <button
                type="button"
                ref={nextBtnRef}
                class="rounded-md px-5 py-2.5 font-semibold no-underline"
                style="background: var(--color-primary); color: var(--color-primary-contrast);"
                onClick={goNext}
              >
                {current < total - 1 ? "Next" : "See results"}
              </button>
            </div>
          )}

          {!isLocked && (
            <p class="mt-4 text-xs" style="color: var(--color-text-muted);">
              Tip: press <kbd>1</kbd>–<kbd>{String(activeQ.options.length)}</kbd> or
              use arrow keys + Enter to answer.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
