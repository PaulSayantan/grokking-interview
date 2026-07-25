import { describe, it, expect, beforeEach } from "vitest";
import {
  SRS_INTERVALS,
  nextSchedule,
  srsOf,
  masteryLevel,
  MASTERY_MIN_SEEN,
  daysBetween,
  localDay,
  type AnswerRecord,
} from "@lib/progress";

describe("nextSchedule (spaced repetition)", () => {
  const fresh = { interval: 0, reps: 0, lapses: 0 };

  it("a fresh correct answer starts at the first interval (1 day)", () => {
    const s = nextSchedule(fresh, true, 0);
    expect(s.interval).toBe(SRS_INTERVALS[0]);
    expect(s.reps).toBe(1);
    expect(s.lapses).toBe(0);
    expect(s.due).toBe(SRS_INTERVALS[0] * 86_400_000);
  });

  it("consecutive correct answers advance 1 -> 3 -> 7 -> 14 -> 30 and cap at 30", () => {
    let s = fresh;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      s = nextSchedule(s, true, 0);
      seen.push(s.interval);
    }
    expect(seen).toEqual([1, 3, 7, 14, 30, 30]);
  });

  it("a wrong answer resets the interval to 1 day and increments lapses", () => {
    const learned = { interval: 14, reps: 3, lapses: 0 };
    const s = nextSchedule(learned, false, 0);
    expect(s.interval).toBe(1);
    expect(s.reps).toBe(0);
    expect(s.lapses).toBe(1);
    expect(s.due).toBe(86_400_000);
  });

  it("due time is now + interval days", () => {
    const now = 1_000_000_000_000;
    const s = nextSchedule({ interval: 3, reps: 1, lapses: 0 }, true, now);
    // 3 -> next step is 7 days
    expect(s.interval).toBe(7);
    expect(s.due).toBe(now + 7 * 86_400_000);
  });
});

describe("srsOf (back-compat defaults)", () => {
  it("defaults a pre-SRS record (no schedule fields) to due-now", () => {
    const legacy: AnswerRecord = {
      correct: true,
      domain: "docker",
      topic_slug: "images-vs-containers",
      ts: 12345,
    };
    const s = srsOf(legacy);
    expect(s.interval).toBe(0);
    expect(s.due).toBe(12345); // falls back to ts -> treated as due
    expect(s.reps).toBe(0);
    expect(s.lapses).toBe(0);
  });

  it("reads explicit schedule fields when present", () => {
    const r: AnswerRecord = {
      correct: true,
      domain: "d",
      topic_slug: "t",
      ts: 1,
      interval: 7,
      due: 999,
      reps: 2,
      lapses: 1,
    };
    expect(srsOf(r)).toEqual({ interval: 7, due: 999, reps: 2, lapses: 1 });
  });
});

describe("masteryLevel (evidence-gated)", () => {
  it("returns none when nothing seen", () => {
    expect(masteryLevel(0, 0)).toBe("none");
  });

  it("does NOT award 'mastered' on a single lucky 100% (below evidence floor)", () => {
    expect(masteryLevel(100, 1)).toBe("familiar");
    expect(MASTERY_MIN_SEEN).toBeGreaterThan(1);
  });

  it("awards 'mastered' only with high accuracy AND enough evidence", () => {
    expect(masteryLevel(80, MASTERY_MIN_SEEN)).toBe("mastered");
    expect(masteryLevel(100, MASTERY_MIN_SEEN + 3)).toBe("mastered");
  });

  it("classifies familiar (50-79) and attempted (<50)", () => {
    expect(masteryLevel(65, 10)).toBe("familiar");
    expect(masteryLevel(40, 10)).toBe("attempted");
    // high pct but too little evidence -> familiar, not mastered
    expect(masteryLevel(90, MASTERY_MIN_SEEN - 1)).toBe("familiar");
  });
});

describe("date helpers", () => {
  it("daysBetween counts whole calendar days", () => {
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
    expect(daysBetween("2026-01-01", "2026-01-02")).toBe(1);
    expect(daysBetween("2026-01-01", "2026-02-01")).toBe(31);
    expect(daysBetween("2026-01-02", "2026-01-01")).toBe(-1);
  });

  it("localDay formats YYYY-MM-DD", () => {
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDay(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});
