/**
 * Guards CONTRACT.md against the code it describes — the drift a unit test cannot
 * see, because every other test in this suite reads the SOURCE and agrees with
 * itself.
 *
 * Four holes this file exists to close (CONTRACT.md §13.6):
 *
 *  1. WIRING. `plates.test.ts` imports the plate transform and exercises it
 *     directly. Deleting the one line in `astro.config.mjs` that registers
 *     `rehypePlates` takes 4,868 plates off the corpus and leaves all 338 other
 *     tests green. Same for its POSITION: it must run last, after Shiki, or the
 *     caption loses its language word with no error.
 *  2. THE NUMBERS THIS DOCUMENT QUOTES. §13 quotes `--atl-locator-h`,
 *     `--st-header-h`, the `--prose-body` clamp, two type steps, two contrast
 *     tokens and the reading contract's own figures. A doc that quotes a stale
 *     number is worse than one that quotes none, because the next agent trusts it.
 *  3. THE GRAFT 3 WITHDRAWAL. Each surface test checks its OWN page; only a
 *     cross-surface check can prove that §13.1 still records WHY the bare-letter
 *     accelerators were removed and that no surface has quietly re-added one.
 *  4. THE GUARD ITSELF. `check:marketing` is the gate that keeps global.css
 *     byte-frozen. Nothing asserted that the script still contains that half.
 *
 * It also fails when a new `src/lib` module or a new pipeline plugin lands
 * undocumented, which is how §1, §2 and §5 fell behind in the first place.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const contractRaw = read("../../CONTRACT.md");
/**
 * Whitespace-collapsed. The document is hard-wrapped at ~96 columns, so any
 * quoted value longer than a few characters spans a newline in the prose while
 * being one line in the source; comparing raw text would fail on the wrap, not
 * on the fact.
 */
const doc = contractRaw.replace(/\s+/g, " ");

const config = read("../../astro.config.mjs");
const pkg = JSON.parse(read("../../package.json"));
const foundation = read("../components/AtlasFoundation.astro");
const baseLayout = read("../layouts/BaseLayout.astro");

const pages: Record<"study" | "topic" | "domain", string> = {
  study: read("../pages/study/[domain]/[slug].astro"),
  topic: read("../pages/topic/[domain]/[slug].astro"),
  domain: read("../pages/domain/[domain].astro"),
};

// --- 1. the markdown pipeline is WIRED, not merely written ----------------

describe("the markdown pipeline matches §1", () => {
  /** The `rehypePlugins: [ … ]` array, brace-matched rather than regexed. */
  const rehypeArray = (() => {
    const at = config.indexOf("rehypePlugins:");
    expect(at, "astro.config.mjs must configure rehypePlugins").toBeGreaterThan(-1);
    const open = config.indexOf("[", at);
    let depth = 0;
    for (let i = open; i < config.length; i++) {
      if (config[i] === "[") depth++;
      else if (config[i] === "]" && --depth === 0) return config.slice(open + 1, i);
    }
    throw new Error("unterminated rehypePlugins array");
  })();

  it("registers the GRAFT 2 plate pass at all", () => {
    expect(config).toMatch(/import\s+rehypePlates\s+from\s+"\.\/plugins\/rehype-plates\.mjs"/);
    expect(rehypeArray).toContain("rehypePlates");
  });

  it("keeps it LAST, so it reads the language Shiki emitted", () => {
    // Shiki runs before every user rehype plugin, and the pass numbers the final
    // tree. Anything registered after it would renumber or re-wrap.
    const entries = rehypeArray
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter((l) => /^[A-Za-z[]/.test(l));
    expect(entries[entries.length - 1].replace(/,$/, "")).toBe("rehypePlates");
  });

  it("documents every plugin file it loads, and loads every file in plugins/", () => {
    const imported = [...config.matchAll(/from\s+"\.\/plugins\/([\w-]+\.mjs)"/g)].map(
      (m) => m[1],
    );
    const onDisk = readdirSync(fileURLToPath(new URL("../../plugins", import.meta.url)))
      .filter((f) => f.endsWith(".mjs"))
      .sort();
    expect(imported.sort()).toEqual(onDisk);
    for (const file of onDisk) {
      expect(doc, `${file} is registered but undocumented in CONTRACT.md`).toContain(file);
    }
  });
});

// --- 2. every number this document quotes ---------------------------------

describe("the values §13 quotes are the values the code ships", () => {
  /** A `--token: value;` declaration, first occurrence, from a source file. */
  function decl(source: string, token: string): string {
    const m = source.match(new RegExp(`${token}:\\s*([^;]+);`));
    if (!m) throw new Error(`no declaration for ${token}`);
    return m[1].trim().replace(/\s+/g, " ");
  }
  /** The `A → B` range in the trailing comment of a token's declaration line. */
  function range(source: string, token: string): string {
    const line = source.split("\n").find((l) => l.includes(`${token}:`));
    const m = line?.match(/([\d.]+)\s*→\s*([\d.]+)/);
    if (!m) throw new Error(`no "A → B" comment beside ${token}`);
    return `${m[1]} → ${m[2]}`;
  }

  it("the locator's 46px cost is one token, and the doc quotes that token", () => {
    const h = decl(foundation, "--atl-locator-h");
    expect(h).toBe("46px");
    expect(doc, "§13.5 quotes the locator's height").toContain(`${h} sticky`);
    expect(doc).toContain(`${h} is the permanent cost`);
  });

  it("the study page's header offset is the number §13.5 prints", () => {
    expect(doc).toContain(`--st-header-h: ${decl(pages.study, "--st-header-h")}`);
  });

  it("GRAFT 1's raised body clamp is quoted verbatim", () => {
    const clamp = decl(foundation, "--atl-prose-body");
    expect(clamp).toMatch(/^clamp\(/);
    expect(doc, "§13.1 quotes the raised --prose-body clamp").toContain(clamp);
    // …and it still reaches global.css's `.prose` through the fallback hook,
    // rather than through a `font-size` rule of atlas's own.
    expect(foundation).toContain("--prose-body: var(--atl-prose-body)");
    expect(doc).toContain(range(foundation, "--atl-prose-body"));
  });

  it("the two prose type steps are quoted with their real px range", () => {
    for (const token of ["--atl-t-ph2", "--atl-t-ph3"]) {
      const r = range(foundation, token);
      expect(doc, `${token} range drifted`).toContain(`${token}\` ${r}px`);
    }
  });

  it("the 3:1 state token's two hexes are quoted, both themes", () => {
    const hexes = [...foundation.matchAll(/--atl-node-ring:\s*(#[0-9a-f]{6})/gi)].map(
      (m) => m[1],
    );
    expect(hexes.length, "one value per theme").toBe(2);
    for (const h of hexes) expect(doc, `${h} not in §13 rule 10`).toContain(h);
  });

  it("the frozen reading contract's figures appear in BOTH doc and source", () => {
    const frozen = [
      // 79ch, not 104ch — the measure was deliberately CAPPED so the line stops
      // growing with the monitor. It is still asserted here because the number
      // must never drift silently between the doc and the source, whatever it is.
      "--measure: 79ch",
      "line-height: 1.68",
      "margin-right: calc(1rem - (100vw - 100%) / 2)",
    ];
    for (const value of frozen) {
      expect(pages.study, `${value} left the study page`).toContain(value);
      // The doc may quote it without the property name (e.g. "104ch"), so match
      // on the value half, which is the part that can silently drift.
      const half = value.split(": ")[1];
      expect(doc, `${half} is no longer named in CONTRACT.md`).toContain(half);
    }
    expect(pages.study).toContain("1.35em");
    expect(doc).toContain("1.35em");
  });

  it("the frozen bleed list still has exactly TWO selectors, doc and CSS agreeing", () => {
    const list = ".prose > pre, .prose > table";
    // global.css writes the two selectors on two lines; `study-css.test.ts`
    // collapses whitespace before its exact-string lookup, so this does too —
    // matching that test's notion of "verbatim", not a stricter one.
    const globalCss = read("../styles/global.css").replace(/\s+/g, " ");
    expect(globalCss).toContain(list);
    expect(doc, "§13.1 must keep quoting the frozen list verbatim").toContain(list);
    expect(list.split(",").length).toBe(2);
    // The figure wrapper is a SEPARATE rule; the doc names it as such.
    expect(foundation).toContain(".atl .prose > figure.atl-plate");
    expect(doc).toContain(".atl .prose > figure.atl-plate");
  });
});

// --- 3. GRAFT 3 is withdrawn, in the doc AND in all three pages ----------

/**
 * §13.1 used to carry a binding table and this section used to compare it against
 * the three `ROUTES` objects. GRAFT 3 was WITHDRAWN, so the doc/source agreement
 * that matters now runs the other way: the document must record the withdrawal and
 * its reason, and no page may have quietly kept a bare-letter accelerator. A
 * half-done withdrawal — code stripped, doc still promising `R`/`P`/`D`, or the
 * reverse — fails here.
 */
describe("GRAFT 3's withdrawal in §13.1 is the withdrawal the pages ship", () => {
  it("§13.1 records the withdrawal and cites WCAG 2.1.4 by number and name", () => {
    expect(doc).toMatch(/GRAFT 3 — keyboard routes[^.]*WITHDRAWN/i);
    expect(doc).toContain("2.1.4");
    expect(doc).toContain("Character Key Shortcuts");
    // The three permitted mitigations, so the next reader knows the bar.
    expect(doc).toMatch(/turn (it |the shortcut )?off/i);
    expect(doc).toMatch(/remap/i);
    expect(doc).toMatch(/only while[^.]*focus|focus[^.]*component/i);
  });

  it("§13.1 records the destructive consequence, not just the rule number", () => {
    expect(doc).toMatch(/navigat/i);
    expect(doc).toMatch(/speech/i);
    expect(doc).toMatch(/no undo|without undo/i);
  });

  it("§13.1 records both rejected alternatives, so neither is re-proposed", () => {
    // Shift+letter is still a single character, so it does not escape 2.1.4…
    expect(doc).toMatch(/Shift/);
    // …and Alt+D collides with Chrome-on-Windows' address bar.
    expect(doc).toMatch(/Alt\+D/);
  });

  it("no §13.1 binding table survives, and no doc row promises a key", () => {
    const rows = [...contractRaw.matchAll(/^\| `\/(study|topic|domain)\/\*` \|/gm)];
    expect(rows.length, "the withdrawn binding table is still in the doc").toBe(0);
    expect(doc).not.toContain("__atlDomainKeys");
    expect(doc).not.toContain("__atlTopicKeys");
    expect(doc).not.toContain("__atlStudyKeys");
  });

  it("no surface declares a ROUTES map or a route-key handler", () => {
    for (const surface of ["domain", "topic", "study"] as const) {
      const src = pages[surface];
      expect(src, `${surface} re-declared ROUTES`).not.toMatch(/const ROUTES/);
      expect(src, `${surface} re-added the handler`).not.toMatch(
        /\bonRouteKey\b|\bannounceRouteKeys\b/,
      );
      expect(src, `${surface} re-added the once-only flag`).not.toMatch(/__atl\w*Keys/);
      expect(src, `${surface} binds a document-level keydown`).not.toMatch(
        /document\.addEventListener\(\s*["']keydown["']/,
      );
      expect(src, `${surface} claims a keyboard shortcut`).not.toContain("aria-keyshortcuts");
      expect(src, `${surface} still prints a keycap`).not.toMatch(/<kbd\b/);
    }
  });

  it("BaseLayout's own search bindings are untouched by the withdrawal", () => {
    // The withdrawal removed the three page handlers and NOTHING else: `/` is
    // still the search accelerator, scoped in BaseLayout as it always was.
    const reserved = [
      ...baseLayout.matchAll(/e\.key === "([^"]+)" && !e\.metaKey/g),
    ].map((m) => m[1]);
    expect(reserved, "BaseLayout still owns `/`").toContain("/");
  });

  it("/study still never imports the retrieval module — the §13.5 bright line", () => {
    // This outlived GRAFT 3: it is why /study had no `D` route to begin with, and
    // it is still the reason /study ships no drill route at all.
    expect(pages.study).not.toMatch(/from\s+"@lib\/progress"/);
  });
});

// --- 4. the guard that keeps global.css frozen -----------------------------

describe("the gates themselves (§13.6)", () => {
  const marketing: string = pkg.scripts["check:marketing"];

  it("check:marketing still asserts global.css has not moved", () => {
    expect(marketing).toContain("git diff --quiet HEAD -- src/styles/global.css");
  });

  it("still bans every token §12 says it bans, in both marketing pages", () => {
    const sentence = doc.slice(doc.indexOf("if any of"), doc.indexOf("reappears in either"));
    const banned = [...sentence.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(banned.length, "§12's guard paragraph must list the tokens").toBeGreaterThan(5);
    const unescaped = marketing.replace(/\\/g, "");
    for (const token of banned) expect(unescaped, `${token} no longer banned`).toContain(token);
    for (const page of ["src/pages/index.astro", "src/pages/catalog.astro"]) {
      expect(marketing).toContain(page);
    }
  });

  it("npm test is the vitest gate the doc names", () => {
    expect(pkg.scripts.test).toBe("vitest run");
    expect(doc).toContain("`vitest run`");
  });
});

// --- 5. nothing lands undocumented ---------------------------------------

describe("CONTRACT.md keeps up with the code", () => {
  it("documents every src/lib module", () => {
    const mods = readdirSync(fileURLToPath(new URL(".", import.meta.url)))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => f.replace(/\.ts$/, ""));
    for (const mod of mods) {
      const named = doc.includes(`\`${mod}.ts\``) || doc.includes(`@lib/${mod}`);
      expect(named, `src/lib/${mod}.ts is undocumented (see §5)`).toBe(true);
    }
  });

  it("§13 still carries its four rules and all six subsections", () => {
    for (const n of [7, 8, 9, 10]) {
      expect(contractRaw, `§13 rule ${n} is missing`).toMatch(
        new RegExp(`^${n}\\. \\*\\*`, "m"),
      );
    }
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(contractRaw, `§13.${n} is missing`).toContain(`### 13.${n}`);
    }
  });

  it("names all three grafts, and the direction they came from", () => {
    for (const n of [1, 2, 3]) expect(doc).toContain(`GRAFT ${n} —`);
    expect(doc).toContain("reading-room"); // grafts 1 and 2
    expect(doc).toContain("workbench"); // graft 3, and the rejected rails
  });

  it("still records what §13.2 refuses to build", () => {
    for (const rejected of [
      "left rail and right inspector gutter are rejected",
      "serif face is rejected",
      "no per-section read/mastered state may be invented",
    ]) {
      expect(doc, `§13.2 no longer states: ${rejected}`).toContain(rejected);
    }
  });
});
