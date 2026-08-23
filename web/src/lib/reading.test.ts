/**
 * Reading-detection unit tests.
 *
 * The behaviours here are the ones that fail SILENTLY in a browser: a wrong dwell
 * clamp just makes sections arm too early (which reads as "the site is guessing"),
 * a missing veto makes a phone fling-scroll credit a whole topic, and a leak into
 * `progress.ts` would corrupt the mastery signal with passive scrolling — none of
 * which throws, logs, or shows up in a screenshot.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  READ_KEY,
  REVEAL_KEY,
  MAX_TRACKED_TOPICS,
  DWELL_MIN_MS,
  DWELL_MAX_MS,
  IDLE_MS,
  SETTLE_MS,
  READ_BAND_MARGIN,
  dwellTargetMs,
  coverageMet,
  isFling,
  dwellAllowed,
  sectionRead,
  normalizeStore,
  pruneStore,
  emptyStore,
  readStore,
  writeStore,
  addSections,
  sectionsFor,
  markTaught,
  wasTaught,
  type SectionSignals,
} from "./reading";

// --- a minimal localStorage for the node environment ----------------------

class MemStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  clear() {
    this.map.clear();
  }
}

beforeEach(() => {
  const store = new MemStorage();
  // reading.ts guards on `window.localStorage`, so both must exist.
  (globalThis as unknown as { window: unknown }).window = { localStorage: store };
  (globalThis as unknown as { localStorage: unknown }).localStorage = store;
});

// --- dwell -----------------------------------------------------------------

describe("dwellTargetMs", () => {
  it("floors at 3s so a 40-line section still needs a real pause", () => {
    expect(dwellTargetMs(0)).toBe(DWELL_MIN_MS);
    expect(dwellTargetMs(10)).toBe(DWELL_MIN_MS); // 600ms raw
    expect(dwellTargetMs(49)).toBe(DWELL_MIN_MS); // 2,940ms raw
  });

  it("scales linearly between the floor and the ceiling", () => {
    expect(dwellTargetMs(100)).toBe(6_000);
    expect(dwellTargetMs(200)).toBe(12_000);
  });

  it("caps at 20s so a 400-line section is not unreachable", () => {
    expect(dwellTargetMs(334)).toBe(DWELL_MAX_MS);
    // A genuinely huge section (the corpus p99) must not need 3 minutes.
    expect(dwellTargetMs(4_000)).toBe(DWELL_MAX_MS);
  });

  it("survives a missing / non-numeric data-pd-words", () => {
    expect(dwellTargetMs(Number.NaN)).toBe(DWELL_MIN_MS);
    expect(dwellTargetMs(-5)).toBe(DWELL_MIN_MS);
  });
});

// --- coverage --------------------------------------------------------------

describe("coverageMet", () => {
  it("needs 80% of blocks to have exited upward", () => {
    expect(coverageMet(4, 5)).toBe(true);
    expect(coverageMet(3, 5)).toBe(false);
    expect(coverageMet(8, 10)).toBe(true);
    expect(coverageMet(7, 10)).toBe(false);
  });

  it("is false for a section with no blocks (nothing was read)", () => {
    expect(coverageMet(0, 0)).toBe(false);
  });

  it("treats a single-block section as all-or-nothing", () => {
    expect(coverageMet(0, 1)).toBe(false);
    expect(coverageMet(1, 1)).toBe(true);
  });
});

// --- vetoes ----------------------------------------------------------------

describe("isFling", () => {
  it("trips above ~0.9 viewport-heights per tick", () => {
    expect(isFling(900, 1000)).toBe(false); // exactly 0.9 — not a fling
    expect(isFling(901, 1000)).toBe(true);
    expect(isFling(-2_000, 1000)).toBe(true); // direction-agnostic
  });
  it("never trips on a zero-height viewport (SSR / hidden tab)", () => {
    expect(isFling(5_000, 0)).toBe(false);
  });
});

describe("dwellAllowed — the four vetoes", () => {
  const base = {
    hidden: false,
    scrollDeltaPx: 30,
    viewportH: 900,
    suspendedUntil: 0,
    lastActivity: 10_000,
    now: 10_100,
  };

  it("accrues on an ordinary reading tick", () => {
    expect(dwellAllowed(base)).toBe(true);
  });
  it("veto 1: document hidden", () => {
    expect(dwellAllowed({ ...base, hidden: true })).toBe(false);
  });
  it("veto 2: fling scrolling accrues ~zero", () => {
    expect(dwellAllowed({ ...base, scrollDeltaPx: 1_200 })).toBe(false);
  });
  it("veto 3: an anchor-jump suspension", () => {
    expect(dwellAllowed({ ...base, suspendedUntil: base.now + 200 })).toBe(false);
    expect(dwellAllowed({ ...base, suspendedUntil: base.now })).toBe(true);
  });
  it("veto 4: 60s idle", () => {
    expect(dwellAllowed({ ...base, lastActivity: base.now - IDLE_MS - 1 })).toBe(false);
    expect(dwellAllowed({ ...base, lastActivity: base.now - IDLE_MS })).toBe(true);
  });
});

// --- the composite -------------------------------------------------------

describe("sectionRead", () => {
  const full: SectionSignals = {
    words: 100,
    blocks: 5,
    exitedUp: 5,
    dwellMs: 6_000,
    departed: true,
  };
  const loaded = 1_000;
  const now = loaded + SETTLE_MS + 1;

  it("is true when all three signals hold and the page has settled", () => {
    expect(sectionRead(full, now, loaded)).toBe(true);
  });

  it("never fires inside the 1,500ms settle window", () => {
    expect(sectionRead(full, loaded + SETTLE_MS - 1, loaded)).toBe(false);
  });

  it("requires departure — a section still in view is not finished", () => {
    expect(sectionRead({ ...full, departed: false }, now, loaded)).toBe(false);
  });

  it("requires coverage — a TOC jump past a section credits nothing", () => {
    // The jumped-over blocks never crossed the band, so exitedUp stays 0 even
    // though the next H2 has 'departed' and the clock has run.
    expect(sectionRead({ ...full, exitedUp: 0 }, now, loaded)).toBe(false);
  });

  it("requires dwell — scrolling through fast is not reading", () => {
    expect(sectionRead({ ...full, dwellMs: 5_999 }, now, loaded)).toBe(false);
  });

  it("a 40-line section: 3s floor, not the word-scaled value", () => {
    const short: SectionSignals = { words: 30, blocks: 2, exitedUp: 2, dwellMs: 2_500, departed: true };
    expect(sectionRead(short, now, loaded)).toBe(false);
    expect(sectionRead({ ...short, dwellMs: 3_000 }, now, loaded)).toBe(true);
  });

  it("a 400-line section: capped at 20s, and reachable", () => {
    const long: SectionSignals = { words: 2_400, blocks: 40, exitedUp: 32, dwellMs: 20_000, departed: true };
    expect(sectionRead(long, now, loaded)).toBe(true);
    expect(sectionRead({ ...long, dwellMs: 19_999 }, now, loaded)).toBe(false);
  });
});

// --- the reading band ------------------------------------------------------

describe("READ_BAND_MARGIN", () => {
  it("clears the sticky header and excludes the bottom of the viewport", () => {
    // A band that reached the viewport bottom would count a block as 'read' the
    // moment it appeared; a band that started at 0 would sit under the header.
    expect(READ_BAND_MARGIN).toBe("-88px 0px -25% 0px");
  });
});

// --- storage ---------------------------------------------------------------

describe("store shape + pruning", () => {
  it("uses ip:-namespaced versioned keys, per progress.ts convention", () => {
    expect(READ_KEY).toBe("ip:read:v1");
    expect(REVEAL_KEY).toBe("ip:reveal:v1");
  });

  it("normalizes anything hostile in localStorage into a valid store", () => {
    expect(normalizeStore(null)).toEqual(emptyStore());
    expect(normalizeStore("nope")).toEqual(emptyStore());
    expect(normalizeStore({ t: { "a/b": { s: "not-an-array" } } })).toEqual({
      v: 1,
      t: { "a/b": { ts: 0, s: [] } },
    });
    expect(normalizeStore({ t: { "a/b": { ts: 5, s: ["x", "x", 7] } } })).toEqual({
      v: 1,
      t: { "a/b": { ts: 5, s: ["x"] } },
    });
  });

  it("prunes to the 200 most-recently-touched topics", () => {
    const store = emptyStore();
    for (let i = 0; i < 260; i++) store.t[`d/t${i}`] = { ts: i, s: ["s1"] };
    const pruned = pruneStore(store);
    expect(Object.keys(pruned.t)).toHaveLength(MAX_TRACKED_TOPICS);
    // Newest kept, oldest dropped.
    expect(pruned.t["d/t259"]).toBeDefined();
    expect(pruned.t["d/t0"]).toBeUndefined();
    expect(pruned.t["d/t60"]).toBeDefined();
    expect(pruned.t["d/t59"]).toBeUndefined();
  });

  it("leaves a small store untouched", () => {
    const store = emptyStore();
    store.t["d/t"] = { ts: 1, s: [] };
    expect(pruneStore(store)).toBe(store);
  });

  it("round-trips sections and refreshes ts so the prune is LRU-correct", () => {
    addSections(READ_KEY, "java-jvm/x", ["a"], 100);
    addSections(READ_KEY, "java-jvm/x", ["b", "a"], 200);
    const store = readStore(READ_KEY);
    expect(sectionsFor(store, "java-jvm/x")).toEqual(["a", "b"]);
    expect(store.t["java-jvm/x"].ts).toBe(200);
  });

  it("writes through the prune, so localStorage can never exceed the cap", () => {
    const store = emptyStore();
    for (let i = 0; i < 240; i++) store.t[`d/t${i}`] = { ts: i, s: [] };
    writeStore(READ_KEY, store);
    expect(Object.keys(readStore(READ_KEY).t)).toHaveLength(MAX_TRACKED_TOPICS);
  });

  it("records the live-region hint exactly once", () => {
    expect(wasTaught()).toBe(false);
    markTaught();
    expect(wasTaught()).toBe(true);
    markTaught();
    expect(readStore(REVEAL_KEY).taught).toBe(1);
  });

  it("is SSR-safe: no window means fallbacks, not a throw", () => {
    delete (globalThis as unknown as Record<string, unknown>).window;
    delete (globalThis as unknown as Record<string, unknown>).localStorage;
    expect(readStore(READ_KEY)).toEqual(emptyStore());
    expect(() => writeStore(READ_KEY, emptyStore())).not.toThrow();
    expect(wasTaught()).toBe(false);
  });
});

// --- the isolation invariant ---------------------------------------------

describe("reading coverage never reaches the retrieval signals", () => {
  const src = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("progress.ts knows nothing about the reading keys", () => {
    // If reading coverage ever fed computeMastery / the SRS schedule / the streak,
    // passive scrolling would inflate the one number the learner actually trusts —
    // and it would look completely normal on screen.
    const progress = src("./progress.ts");
    expect(progress).not.toMatch(/ip:read:v1|ip:reveal:v1/);
    expect(progress).not.toMatch(/from ["']\.\/reading["']/);
  });

  it("reading.ts does not import progress.ts", () => {
    expect(src("./reading.ts")).not.toMatch(/from ["']\.\/progress["']/);
  });

  it("the study page never imports the retrieval module", () => {
    // Comments in that file legitimately NAME computeMastery() to explain why it is
    // off limits, so the assertion is on the import, which is the real gate.
    const page = src("../pages/study/[domain]/[slug].astro");
    expect(page).not.toMatch(/from ["']@lib\/progress["']/);
    const code = page.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(
      /(recordAnswers|registerPractice|computeMastery|nextSchedule)\s*\(/,
    );
  });
});
