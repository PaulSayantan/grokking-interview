/**
 * Guards the section manifest (CONTRACT.md §13.4).
 *
 * The failure this file exists to catch is not a crash — it is a manifest that
 * renders happily while printing "2 q" against a section that has nine, or nothing
 * at all against every section because the tally moved. A wrong count on a page
 * whose whole purpose is "see what you are agreeing to" is worse than no count.
 *
 * ONE OF THESE TESTS EXISTS BECAUSE THE FIRST IMPLEMENTATION FAILED EXACTLY THAT
 * WAY. It read the tally out of `public/questions/` with `node:fs` relative to
 * `import.meta.url`, which is correct under vitest and correct under `astro dev`
 * and WRONG under `astro build`: Vite inlines the lib into the page chunk, so the
 * base became `dist/pages/topic/_domain_/_slug_.astro.mjs`, every read threw ENOENT,
 * the column silently vanished from all 460 pages and the build still exited 0. The
 * fix was to make the tally a module under `src/data/`; "the tally is a module
 * import, not a path" is therefore asserted below rather than left to memory.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  REF_PREFIX,
  sectionManifest,
  tallyStops,
  topicRefCounts,
  type ManifestHeading,
} from "./manifest";
import {
  getAllSubtopicRefs,
  getAuthoredDomains,
  getDomain,
  getDomainSequence,
} from "./catalog";

const h = (depth: number, slug: string, text = slug): ManifestHeading => ({
  depth,
  slug,
  text,
});
const ref = (anchor: string) => REF_PREFIX + anchor;

describe("tallyStops — which heading owns a ref", () => {
  it("stops are the H2s, in document order, with their text verbatim", () => {
    const { stops } = tallyStops(
      [h(1, "the-title"), h(2, "alpha", "Alpha & Beta"), h(3, "sub"), h(2, "gamma")],
      {},
    );
    expect(stops.map((s) => s.slug)).toEqual(["alpha", "gamma"]);
    expect(stops[0].text).toBe("Alpha & Beta");
  });

  it("counts refs that name an H2 directly", () => {
    const { stops, counted } = tallyStops([h(2, "alpha"), h(2, "gamma")], {
      [ref("alpha")]: 2,
      [ref("gamma")]: 1,
    });
    expect(stops.map((s) => s.questionCount)).toEqual([2, 1]);
    expect(counted).toBe(3);
  });

  it("attributes an H3 ref to the H2 above it — 6 real questions depend on this", () => {
    const { stops, counted } = tallyStops(
      [h(2, "alpha"), h(3, "alpha-detail"), h(4, "deeper"), h(2, "gamma")],
      { [ref("alpha-detail")]: 1, [ref("deeper")]: 1, [ref("gamma")]: 1 },
    );
    expect(stops.map((s) => s.questionCount)).toEqual([2, 1]);
    expect(counted).toBe(3);
  });

  it("counts an unresolvable or foreign ref NOWHERE, rather than guessing", () => {
    const { stops, counted } = tallyStops([h(2, "alpha")], {
      [ref("does-not-exist")]: 4,
      "other.md#alpha": 4,
      alpha: 4,
      [ref("alpha")]: 1,
    });
    expect(stops[0].questionCount).toBe(1);
    expect(counted).toBe(1);
  });

  it("an H3 before any H2 owns nothing and cannot crash the walk", () => {
    const { stops, counted } = tallyStops([h(1, "title"), h(3, "orphan"), h(2, "alpha")], {
      [ref("orphan")]: 2,
      [ref("title")]: 2,
      [ref("alpha")]: 1,
    });
    expect(stops).toHaveLength(1);
    expect(counted).toBe(1);
  });

  it("a topic with no H2 yields no stops and counts nothing", () => {
    expect(tallyStops([h(1, "title")], { [ref("title")]: 9 })).toEqual({
      stops: [],
      counted: 0,
      unattributed: 9,
      exact: false,
    });
  });
});

/**
 * THE FALSE ZERO — the failure the per-topic gate could not see.
 *
 * `counted > 0` is a per-TOPIC test and "does this section's count mean anything"
 * is a per-SECTION question. A topic whose refs MOSTLY resolve passed the old gate
 * with its column switched on, and the one section whose anchor had gone stale
 * rendered a confident "0 q" beside a heading that really had nine. `exact` is the
 * per-stop-safe gate: false the moment any authored question fails to land.
 */
describe("no false zero can reach the page", () => {
  it("a stale anchor makes the manifest INEXACT, so the column cannot print", () => {
    const m = tallyStops([h(2, "alpha"), h(2, "gamma")], {
      [ref("alpha")]: 3,
      // Authored against gamma, but the heading was re-slugged: resolves nowhere.
      [ref("gamma-the-old-anchor")]: 9,
    });
    // The section that really has nine reads zero …
    expect(m.stops[1].slug).toBe("gamma");
    expect(m.stops[1].questionCount).toBe(0);
    // … so the manifest must refuse to publish the column at all.
    expect(m.unattributed).toBe(9);
    expect(m.exact, "a section with questions would print 0 q").toBe(false);
  });

  it("a ref that does not name this topic's concepts.md counts as unattributed too", () => {
    const m = tallyStops([h(2, "alpha")], { "other.md#alpha": 4, [ref("alpha")]: 1 });
    expect(m.counted).toBe(1);
    expect(m.unattributed).toBe(4);
    expect(m.exact).toBe(false);
  });

  it("exact is TRUE only when every authored question landed on a stop", () => {
    const m = tallyStops([h(2, "alpha"), h(3, "alpha-detail"), h(2, "gamma")], {
      [ref("alpha")]: 2,
      [ref("alpha-detail")]: 1,
      [ref("gamma")]: 4,
    });
    expect(m.stops.map((s) => s.questionCount)).toEqual([3, 4]);
    expect(m.unattributed).toBe(0);
    expect(m.exact).toBe(true);
  });

  it("a genuine zero is still a zero — a stop nobody wrote questions for", () => {
    // Legal to print: the distribution is complete, so this zero is a fact.
    const m = tallyStops([h(2, "alpha"), h(2, "appendix")], { [ref("alpha")]: 5 });
    expect(m.stops[1].questionCount).toBe(0);
    expect(m.exact).toBe(true);
  });

  it("an empty tally is never exact, so a topic with no pool prints no column", () => {
    const m = tallyStops([h(2, "alpha")], {});
    expect(m.counted).toBe(0);
    expect(m.exact).toBe(false);
  });
});

describe("a topic with no tally degrades — the caller drops the column", () => {
  it("topicRefCounts returns null rather than an empty object", () => {
    expect(topicRefCounts("no-such-domain", "no-such-slug")).toBeNull();
  });

  it("sectionManifest then reports counted: 0, never a zero per stop to print", () => {
    const m = sectionManifest("no-such-domain", "no-such-slug", [h(2, "alpha")]);
    expect(m.counted).toBe(0);
    expect(m.exact, "the caller's gate must be off").toBe(false);
    expect(m.stops).toHaveLength(1);
    expect(m.stops[0].questionCount).toBe(0);
  });
});

describe("the tally is a MODULE import, not a path resolved at run time", () => {
  const src = readFileSync(fileURLToPath(new URL("./manifest.ts", import.meta.url)), "utf8");

  it("imports src/data/question-refs.json the way catalog.json is imported", () => {
    expect(src).toMatch(/^import refsJson from "\.\.\/data\/question-refs\.json";$/m);
  });

  it("reaches for no filesystem and no import.meta.url", () => {
    // Both are correct under vitest and wrong under `astro build`; see the header.
    expect(src).not.toContain("node:fs");
    expect(src).not.toContain("import.meta.url");
  });

  it("sync emits it, and clears it, alongside catalog.json", () => {
    const sync = readFileSync(
      fileURLToPath(new URL("../../scripts/sync-content.mjs", import.meta.url)),
      "utf8",
    );
    expect(sync).toContain('src/data/question-refs.json');
    expect(sync).toMatch(/writeFile\(\s*REFS_OUT/);
    expect(sync).toMatch(/rm\(REFS_OUT/);
  });

  it("the generated file is gitignored, like every other sync artifact", () => {
    const ignore = readFileSync(
      fileURLToPath(new URL("../../.gitignore", import.meta.url)),
      "utf8",
    );
    expect(ignore).toContain("src/data/question-refs.json");
  });
});

describe("against the real corpus", () => {
  it("every authored subtopic has a tally, and every ref in it is well-formed", () => {
    const all = getAllSubtopicRefs();
    expect(all.length).toBeGreaterThan(400);

    let missing = 0;
    let empty = 0;
    let malformed = 0;
    let total = 0;
    for (const { domain, slug } of all) {
      const counts = topicRefCounts(domain, slug);
      if (counts === null) {
        missing++;
        continue;
      }
      const keys = Object.keys(counts);
      if (keys.length === 0) empty++;
      for (const k of keys) {
        if (!k.startsWith(REF_PREFIX)) malformed++;
        total += counts[k];
      }
    }
    expect(missing).toBe(0);
    expect(empty).toBe(0);
    expect(malformed).toBe(0);
    expect(total).toBeGreaterThan(20_000);
  });

  /**
   * The end-to-end number, and the one that would have caught the ENOENT bug: the
   * tally must account for EVERY question the catalog claims, per domain. If sync's
   * projection and the catalog's own count ever diverge, the manifest is quietly
   * under-reporting and this fails.
   */
  it("the tally accounts for every question in every domain's catalog count", () => {
    const perDomain = new Map<string, number>();
    for (const { domain, slug } of getAllSubtopicRefs()) {
      const counts = topicRefCounts(domain, slug) ?? {};
      const n = Object.values(counts).reduce((a, b) => a + b, 0);
      perDomain.set(domain, (perDomain.get(domain) ?? 0) + n);
    }
    for (const [domain, tallied] of perDomain) {
      expect(tallied, `${domain} tally != catalog questionCount`).toBe(
        getDomain(domain)!.questionCount,
      );
    }
  });

  /**
   * PER TOPIC, because that is what the page now gates on: `/topic` prints the
   * column only when the manifest is `exact` AND the tally accounts for every
   * question the catalog claims for THAT subtopic. A per-domain sum can hide two
   * topics that are wrong in opposite directions, and either one would silently
   * lose its column. What no unit test can check is the other half of `exact` —
   * whether each ref's anchor matches a real heading — because that needs the
   * markdown rendered; the page computes it per build, per topic.
   */
  it("the tally agrees with the catalog PER TOPIC, which is what /topic gates on", () => {
    for (const d of getAuthoredDomains()) {
      for (const { subtopic } of getDomainSequence(d.slug)) {
        const counts = topicRefCounts(d.slug, subtopic.slug) ?? {};
        const tallied = Object.values(counts).reduce((a, b) => a + b, 0);
        expect(tallied, `${d.slug}/${subtopic.slug} tally != its questionCount`).toBe(
          subtopic.questionCount,
        );
      }
    }
  });
});
