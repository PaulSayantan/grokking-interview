#!/usr/bin/env node
/**
 * sync-content.mjs — reads the read-only content source at ../topics and generates
 * all build-time data the Astro site renders from. Idempotent: it cleans its own
 * output dirs first, so re-running always reflects the current source exactly.
 *
 * Outputs (all under web/):
 *   src/content/concepts/<domain>/<slug>.md         concepts w/ prepended frontmatter
 *                                                   (incl. the optional `prompts` object —
 *                                                    see readPrompts/buildPrompts below and
 *                                                    docs/content-schema.md for the shape)
 *   public/questions/<domain>/<slug>.json           per-subtopic question array
 *   public/questions/<domain>/_all.json             all questions in a domain
 *   public/questions/system-design/_group-<key>.json  per-group pools (core/advanced/aws)
 *   public/questions/<domain>/*.slim.json            slim twin of every pool above
 *                                                    (no explanation/tags/difficulty)
 *   public/questions/<domain>/_explanations.json     { question_id -> explanation }
 *   src/data/catalog.json                            catalog manifest for the pages
 *
 * DESIGN NOTE (frontmatter body): we KEEP the original leading "# H1" line in the
 * concept body is REMOVED — the study page renders the title from frontmatter in its
 * own header, so we strip the first "# ..." line to avoid a duplicate H1. Documented
 * in CONTRACT.md.
 */
import { readFile, writeFile, mkdir, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");
const TOPICS_DIR = path.join(REPO_ROOT, "topics");

// Output locations
const CONCEPTS_OUT = path.join(WEB_ROOT, "src/content/concepts");
const QUESTIONS_OUT = path.join(WEB_ROOT, "public/questions");
const CATALOG_OUT = path.join(WEB_ROOT, "src/data/catalog.json");
/**
 * Per-subtopic `ref:` tallies — `{ "<domain>/<slug>": { "concepts.md#<anchor>": n } }`.
 *
 * WHY IT LIVES IN `src/data/` AND NOT READ BACK OUT OF `public/`. /topic's section
 * manifest needs to know how many questions were authored against each `## H2`, and
 * every question already carries the `ref:` that answers it. Reading the pools back
 * from `public/questions/` in a page's frontmatter LOOKS equivalent and is not: Vite
 * inlines a lib into the page chunk, so `import.meta.url` becomes
 * `dist/pages/topic/_domain_/_slug_.astro.mjs` and every relative path breaks — a
 * silent, whole-column failure that still builds and still renders (observed, not
 * theorised). As a module under `src/data/` it is imported exactly the way
 * `catalog.json` is, so it cannot miss.
 *
 * THE ANCHOR IS NOT RESOLVED HERE. Mapping an anchor onto its owning heading needs
 * rehype-slug's own slugs, which exist only after the markdown is rendered, so this
 * file stays a faithful projection of what was authored and `@lib/manifest` does the
 * mapping against `render(entry).headings`. Re-implementing github-slugger here to
 * pre-resolve them is exactly how the manifest and the study page's anchors would
 * drift apart.
 */
const REFS_OUT = path.join(WEB_ROOT, "src/data/question-refs.json");
// Astro's content-layer cache. We fully regenerate CONCEPTS_OUT every run, so a
// stale data store makes the glob loader re-add ids it already cached and emit
// "[glob-loader] Duplicate id" warnings. Invalidate it whenever we re-sync.
//
// BOTH PATHS, and this matters far more than the duplicate-id warning: the data
// store caches each entry's RENDERED HTML, not just its frontmatter. Astro writes
// it to node_modules/.astro during `astro build` and to .astro during `astro dev`,
// and only the latter was being cleared — so a build replayed cached HTML and the
// markdown pipeline never re-ran. That hid a change to a rehype plugin across five
// consecutive full builds (including after `rm -rf dist`), and it would have hidden
// a rewritten concepts.md just as effectively. Note also that a rehype plugin that
// THROWS does not fail the build; Astro swallows it per-entry. So a silently stale
// render is the failure mode to design against here.
const ASTRO_DATA_STORES = [
  path.join(WEB_ROOT, ".astro/data-store.json"),
  path.join(WEB_ROOT, "node_modules/.astro/data-store.json"),
];

// --- Domain configuration -------------------------------------------------

/** Authored domains render as browsable cards; order here drives display order. */
const AUTHORED_DOMAINS = ["system-design", "spring-boot", "spring-core", "java-jvm", "rest-api-design", "networking", "security", "messaging-databases", "testing", "observability", "devops-cicd", "docker", "kubernetes", "interview-craft", "dsa-coding", "lld-and-ood", "reliability-ops", "hibernate-jpa", "grpc", "system-design-case-studies"];

/** Not-yet-authored domains -> "Coming soon" cards. Titles from topics/<d>/README.md. */
const COMING_SOON_DOMAINS = [];

/** The 8 advanced/expert system-design deep-dive slugs. */
const SD_ADVANCED = new Set([
  "interview-method-scenario-playbooks",
  "consensus-clocks-and-time",
  "distributed-transactions-advanced",
  "capacity-modeling-and-tail-latency",
  "failure-theory-advanced",
  "data-internals-storage-engines",
  "probabilistic-data-structures",
  "microservices-ddd-and-boundaries",
]);

// --- Small utilities -------------------------------------------------------

async function readFirstH1(mdPath) {
  if (!existsSync(mdPath)) return null;
  const text = await readFile(mdPath, "utf8");
  const m = text.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

async function readReadmeTitle(domainDir, fallback) {
  const title = await readFirstH1(path.join(domainDir, "README.md"));
  return title || fallback;
}

/**
 * Parse the intended learning order from a domain README's topic tables.
 *
 * Each domain README lists its topics in a deliberate pedagogical sequence
 * (Fundamentals → Scalability → … ) with the slug in a backticked cell, e.g.
 * `| ... | `fundamentals-and-framework` | ... |`. We scan every table row for
 * the FIRST backticked token that looks like a slug and record its order of
 * first appearance. Slugs not found in the README fall back to the end (sorted
 * by title), so the site never drops a subtopic just because the README is
 * incomplete — processAuthoredDomain console.warn()s for each such slug so an
 * incomplete README can't silently scramble the learning order.
 * Returns a Map<slug, orderIndex> (0-based).
 */
async function readReadmeOrder(domainDir) {
  const readmePath = path.join(domainDir, "README.md");
  const order = new Map();
  if (!existsSync(readmePath)) return order;
  const text = await readFile(readmePath, "utf8");
  let next = 0;
  for (const line of text.split(/\r?\n/)) {
    // Only consider table rows (start with "|") to avoid prose backticks.
    if (!line.trimStart().startsWith("|")) continue;
    const m = line.match(/`([a-z0-9][a-z0-9-]*)`/);
    if (m && !order.has(m[1])) order.set(m[1], next++);
  }
  return order;
}

/** List immediate subdirectories of a dir. */
async function listSubdirs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

/** YAML frontmatter value escaping for double-quoted scalars. */
function yamlStr(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Strip the first leading "# H1" line from a concepts.md body. */
function stripLeadingH1(body) {
  return body.replace(/^﻿?#\s+.+?\r?\n/, "");
}

/** Reading-time baseline (technical prose). */
const WORDS_PER_MINUTE = 200;

/** Approximate reading minutes for a concepts body (>=1). Count the SAME text
 *  that renders (post H1-strip) so the number matches the visible article. */
function readingMinutes(body) {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

// --- prompts.yaml (the optional clarity sidecar) ---------------------------
//
// A topic MAY carry a third file, topics/<domain>/<slug>/prompts.yaml: think-prompts keyed
// by anchor, plus one cliffhanger. It is OPTIONAL and stays optional — the clarity rollout
// runs one domain at a time, so migrated and un-migrated topics coexist indefinitely.
//
// We inline it into the concept entry's frontmatter rather than emitting a separate JSON.
// Two reasons: the study page already has the entry, so it needs no second import and no
// fetch (the prompts must render in the static HTML); and src/content/concepts/ is already
// gitignored as generated, so no new ignore rule can be forgotten. The value is emitted as
// one line of JSON — YAML is a JSON superset, so JSON.stringify handles every quote,
// backtick and newline in a prompt body with no hand-rolled escaping.
//
// THE SHAPE IS A CONTRACT (docs/content-schema.md, "Generated shape"). Authored fields keep
// their YAML names verbatim (snake_case: `answer_in`, `success_criterion`, `teaser_questions`);
// everything sync computes is camelCase (`refHref`, `answerHref`, `nextTopic`, `payoffHref`).
// The one rename is the list: `prompts:` in YAML becomes `items` here, so the frontmatter key
// `prompts` holds the whole sidecar rather than nesting `prompts.prompts`.
//
// `scripts/validate_content.py` is the GATE for these files (dangling refs, kinds, tiers,
// caps). Sync is deliberately not a second gate: a malformed sidecar must not block a build,
// so we warn and drop it. Run the validator in CI, not this script, to catch it.

/** Read a topic's prompts.yaml, or null when there is none / it is unusable. */
async function readPrompts(subDir, domainSlug, slug) {
  const p = path.join(subDir, "prompts.yaml");
  if (!existsSync(p)) return null;
  try {
    const parsed = YAML.parse(await readFile(p, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("not a mapping");
    return parsed;
  } catch (err) {
    console.warn(
      `[sync-content] WARNING: ${domainSlug}/${slug}/prompts.yaml did not parse ` +
        `(${err.message}) — the topic renders WITHOUT its think-prompts. ` +
        `Fix: python3 scripts/validate_content.py`,
    );
    return null;
  }
}

/** `/study/<domain>/<slug>#<anchor>` — the one link shape the site uses. */
function studyHref(domain, slug, anchor) {
  return `/study/${domain}/${slug}${anchor ? `#${anchor}` : ""}`;
}

/**
 * Resolve an authored pointer to a site href. Legal forms (mirrors resolve_pointer() in
 * scripts/validate_content.py): "concepts.md#a" (this topic), "<domain>/<slug>#a" or
 * "/study/<domain>/<slug>#a" (another topic — the deliberate cross-topic exception),
 * and the literal "external" (a tier-C hunt, which has no href). null when unresolvable;
 * the validator is what reports that, so we stay quiet here.
 */
function pointerHref(value, domain, slug) {
  const text = String(value ?? "").trim();
  if (!text || text === "external") return null;
  const own = text.match(/^concepts\.md#(.+)$/);
  if (own) return studyHref(domain, slug, own[1]);
  const other = text.match(/^\/?(?:study\/)?([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)#(.+)$/);
  if (other) return studyHref(other[1], other[2], other[3]);
  return null;
}

/**
 * Build the frontmatter `prompts` object for one topic.
 *
 * `next` is the following topic in the domain's learning order ({slug, title} or null),
 * computed HERE from README row order — never authored into the YAML. That is the whole
 * point of the design: the cliffhanger and the study pager read the same sequence, so they
 * cannot drift, and a README reorder needs no content edit. The last topic in a domain gets
 * `nextTopic: null`, and its payoff href comes from an explicit `<domain>/<slug>#anchor`.
 */
function buildPrompts(raw, domain, slug, next) {
  if (!raw) return null;
  const authored = Array.isArray(raw.prompts) ? raw.prompts : [];
  const items = authored
    .filter((p) => p && typeof p === "object")
    .map((p) => {
      const out = {
        id: p.id,
        ref: p.ref,
        kind: p.kind,
        tier: p.tier,
        prompt: String(p.prompt ?? "").trim(),
        refHref: pointerHref(p.ref, domain, slug),
      };
      if (p.hint) out.hint = String(p.hint).trim();
      if (p.answer_in) {
        out.answer_in = String(p.answer_in).trim();
        out.answerHref = pointerHref(p.answer_in, domain, slug);
      }
      if (p.success_criterion) out.success_criterion = String(p.success_criterion).trim();
      if (p.answer_shape) out.answer_shape = String(p.answer_shape).trim();
      if (p.search_hint) out.search_hint = String(p.search_hint).trim();
      return out;
    });

  const payload = { schema: raw.schema ?? 1, items };
  if (raw.pass) payload.pass = String(raw.pass);
  // Where THIS topic settles the PREVIOUS topic's open loop (continuity rule K1).
  if (raw.resolves && raw.resolves.anchor) {
    payload.resolves = {
      anchor: String(raw.resolves.anchor).trim(),
      href: pointerHref(raw.resolves.anchor, domain, slug),
    };
  }

  const c = raw.cliffhanger;
  if (c && typeof c === "object" && c.hook) {
    const anchor = String(c.payoff?.anchor ?? "").trim();
    // A relative payoff ("concepts.md#a") is relative to the NEXT topic, not to this one.
    const payoffHref = anchor.startsWith("concepts.md#")
      ? next
        ? studyHref(domain, next.slug, anchor.slice("concepts.md#".length))
        : null
      : pointerHref(anchor, domain, slug);
    payload.cliffhanger = {
      hook: String(c.hook).trim(),
      teaser_questions: (Array.isArray(c.teaser_questions) ? c.teaser_questions : []).map((q) =>
        String(q).trim(),
      ),
      payoff: { anchor, claim: String(c.payoff?.claim ?? "").trim() },
      nextTopic: next ? { domain, slug: next.slug, title: next.title, href: studyHref(domain, next.slug) } : null,
      payoffHref,
    };
  }
  return payload;
}

/** Slim question payload for the practice island's initial fetch.
 *  Drops explanation + tags (heavy / unused during the quiz); KEEPS difficulty
 *  so the client-side difficulty filter can work without the full pool. */
function slimQuestion(q) {
  const { explanation, tags, ...rest } = q;
  return rest;
}

/**
 * Write a question pool as `<baseName>.slim.json` only (the light payload the
 * practice island actually fetches: no explanation/tags — explanations ship
 * separately per domain via `_explanations.json`).
 *
 * SECURITY / surface reduction: we deliberately do NOT emit the full
 * `<baseName>.json` twin any more. Nothing at runtime fetches it — the island
 * always derives `<pool>.slim.json` from `poolUrl` — so the full pools were pure
 * dead weight AND the most convenient bulk-scrape target (a single `_all.json`
 * request returned an entire domain's questions with tags + explanations +
 * answer keys). Emitting slim-only halves the served `/questions` payload and
 * removes that one-request annotated-bank download. (The site is static, so the
 * per-question `answer` index in the slim pool is still reachable — client-side
 * grading requires it; this is a floor we can't cross without a backend.)
 */
async function writePoolFiles(dir, baseName, questions) {
  await writeFile(
    path.join(dir, `${baseName}.slim.json`),
    JSON.stringify(questions.map(slimQuestion)),
    "utf8",
  );
}

/** Group key for a system-design subtopic slug. */
function sdGroupKey(slug) {
  if (slug.startsWith("ccp-")) return "ccp"; // before aws- etc. (distinct prefix, ordered for clarity)
  if (slug.startsWith("aws-cdp-")) return "cdp"; // MUST precede aws- (aws-cdp- is an aws- prefix)
  if (slug.startsWith("aws-")) return "aws";
  if (slug.startsWith("dp-")) return "patterns";
  if (slug.startsWith("arch-")) return "architecture";
  if (SD_ADVANCED.has(slug)) return "advanced";
  return "core";
}

const SD_GROUP_LABELS = {
  core: "Core Topics",
  advanced: "Advanced & Expert Deep-Dives",
  patterns: "Design Patterns",
  architecture: "Architectural Patterns",
  ccp: "Cloud Computing Patterns",
  aws: "AWS System Design",
  cdp: "AWS Cloud Design Patterns",
};
// Display order for system-design groups.
const SD_GROUP_ORDER = ["core", "advanced", "patterns", "architecture", "ccp", "aws", "cdp"];

/**
 * `"<domain>/<slug>" -> { "<ref>": count }`, filled as each subtopic is processed and
 * written once at the end. Plain object, not a Map, because it is serialised as-is.
 */
const questionRefCounts = {};

// --- Main ------------------------------------------------------------------

async function clean() {
  await rm(CONCEPTS_OUT, { recursive: true, force: true });
  await rm(QUESTIONS_OUT, { recursive: true, force: true });
  await rm(CATALOG_OUT, { force: true });
  await rm(REFS_OUT, { force: true });
  // Drop the stale content-layer cache so regenerated entries aren't seen as
  // duplicates of previously-cached ids. Astro rebuilds it on the next load.
  for (const store of ASTRO_DATA_STORES) await rm(store, { force: true });
}

async function processAuthoredDomain(domainSlug) {
  const domainDir = path.join(TOPICS_DIR, domainSlug);
  const title = await readReadmeTitle(domainDir, domainSlug);
  // Intended learning sequence from the README topic tables (see readReadmeOrder).
  const readmeOrder = await readReadmeOrder(domainDir);
  const subdirs = (await listSubdirs(domainDir)).filter(
    (name) => name !== "README.md",
  );

  const domainQuestions = [];
  /** Phase-1 collection: one entry per subtopic that has a concepts.md (see phase 2). */
  const records = [];
  /** groupKey -> { key, label, subtopics: [] } */
  const groupMap = new Map();
  /** groupKey -> question[] (system-design only, but harmless generally) */
  const groupQuestions = new Map();

  const isSystemDesign = domainSlug === "system-design";

  for (const slug of subdirs) {
    const subDir = path.join(domainDir, slug);
    const yamlPath = path.join(subDir, "questions.yaml");
    const conceptsPath = path.join(subDir, "concepts.md");
    if (!existsSync(yamlPath)) {
      // Not a real subtopic (no questions) — skip.
      continue;
    }

    const raw = await readFile(yamlPath, "utf8");
    const parsed = YAML.parse(raw) || {};
    const h1 = await readFirstH1(conceptsPath);
    const subtopicTitle = parsed.topic || h1 || slug;
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];

    const groupKey = isSystemDesign ? sdGroupKey(slug) : "all";
    const groupLabel = isSystemDesign ? SD_GROUP_LABELS[groupKey] : "";

    // --- Inject domain + topic_slug into each question, normalize fields ---
    // `type` defaults to "single"; multi (select-all) questions carry `answers: []`
    // instead of `answer`. Both the type and the correct-answer key must survive into
    // the slim pool (the quiz needs them), so they're set here and kept by slimQuestion.
    const outQuestions = questions.map((q) => {
      const isMulti = q.type === "multi";
      return {
        id: q.id,
        difficulty: q.difficulty,
        tags: q.tags ?? [],
        type: isMulti ? "multi" : "single",
        question: q.question,
        options: q.options,
        ...(isMulti ? { answers: q.answers } : { answer: q.answer }),
        explanation: q.explanation,
        ...(q.ref ? { ref: q.ref } : {}),
        domain: domainSlug,
        topic_slug: slug,
      };
    });

    // --- Tally each question's `ref:` for /topic's section manifest ---
    // Counted from `outQuestions`, i.e. after normalisation, so the tally can never
    // disagree with the pool that ships. A question with no ref is counted nowhere.
    const refCounts = {};
    for (const q of outQuestions) {
      if (typeof q.ref !== "string" || q.ref.length === 0) continue;
      refCounts[q.ref] = (refCounts[q.ref] ?? 0) + 1;
    }
    questionRefCounts[`${domainSlug}/${slug}`] = refCounts;

    // --- Write per-subtopic questions JSON (full + slim) ---
    const domQDir = path.join(QUESTIONS_OUT, domainSlug);
    await mkdir(domQDir, { recursive: true });
    await writePoolFiles(domQDir, slug, outQuestions);

    // --- Accumulate for domain + group pools ---
    domainQuestions.push(...outQuestions);
    if (!groupQuestions.has(groupKey)) groupQuestions.set(groupKey, []);
    groupQuestions.get(groupKey).push(...outQuestions);

    // --- Defer the concept collection entry to phase 2 -------------------
    // A cliffhanger's destination is the NEXT topic in the domain's learning order, and
    // that order is only known once every group is sorted (below). So collect what the
    // entry needs now and write all of them afterwards, walking the finished sequence.
    if (existsSync(conceptsPath)) {
      records.push({
        slug,
        groupKey,
        title: subtopicTitle,
        conceptsPath,
        prompts: await readPrompts(subDir, domainSlug, slug),
      });
    }

    // --- Warn loudly when the README doesn't place this subtopic ---
    // The README table IS the learning order (see readReadmeOrder). A subtopic
    // missing from it sinks to the end of its group in an arbitrary, title-sorted
    // position, which silently breaks the intended reading sequence. Warn (don't
    // throw) so a half-authored topic can't block the build.
    if (!readmeOrder.has(slug)) {
      console.warn(
        `[sync-content] WARNING: "${slug}" (domain "${domainSlug}") has no row in ` +
          `topics/${domainSlug}/README.md, so its learning-order position is undefined ` +
          `(it will be dumped at the end of its group, sorted by title). ` +
          `Fix: add a table row for \`${slug}\` to topics/${domainSlug}/README.md ` +
          `at the position it should be studied.`,
      );
    }

    // --- Register subtopic in its group ---
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, { key: groupKey, label: groupLabel, subtopics: [] });
    }
    groupMap.get(groupKey).subtopics.push({
      slug,
      title: subtopicTitle,
      questionCount: outQuestions.length,
    });
  }

  // --- Write domain _all.json (full + slim) ---
  const domQDir = path.join(QUESTIONS_OUT, domainSlug);
  await mkdir(domQDir, { recursive: true });
  await writePoolFiles(domQDir, "_all", domainQuestions);

  // --- Write per-group pools for system-design (full + slim) ---
  if (isSystemDesign) {
    for (const key of SD_GROUP_ORDER) {
      const pool = groupQuestions.get(key) || [];
      await writePoolFiles(domQDir, `_group-${key}`, pool);
    }
  }

  // --- Write per-domain explanations map (id -> explanation) ---
  const explanations = {};
  for (const q of domainQuestions) explanations[q.id] = q.explanation;
  await writeFile(
    path.join(domQDir, "_explanations.json"),
    JSON.stringify(explanations),
    "utf8",
  );

  // --- Build ordered groups for the catalog ---
  // Order subtopics by their README learning sequence; slugs absent from the
  // README sink to the end, tie-broken by title. Then stamp a 1-based `position`
  // per group so the UI can number cards and signal "start here".
  const byReadmeOrder = (a, b) => {
    const ai = readmeOrder.has(a.slug) ? readmeOrder.get(a.slug) : Infinity;
    const bi = readmeOrder.has(b.slug) ? readmeOrder.get(b.slug) : Infinity;
    if (ai !== bi) return ai - bi;
    return a.title.localeCompare(b.title);
  };
  const numberGroup = (g) => {
    g.subtopics.sort(byReadmeOrder);
    g.subtopics.forEach((s, i) => {
      s.position = i + 1;
    });
    return g;
  };

  let groups;
  if (isSystemDesign) {
    groups = SD_GROUP_ORDER.filter((k) => groupMap.has(k)).map((k) =>
      numberGroup(groupMap.get(k)),
    );
  } else {
    const g = groupMap.get("all") || { key: "all", label: "", subtopics: [] };
    groups = [numberGroup(g)];
  }

  // --- Phase 2: write the concept collection entries, in learning order ------
  // The flat sequence is groups in display order, subtopics by `position` — byte-identical
  // to getDomainSequence() in src/lib/catalog.ts, which is what the study pager uses. So
  // "the next topic" means the same thing to the pager, to the cliffhanger, and to
  // reading_order() in scripts/validate_content.py (which validates the payoff anchor).
  const byRecord = new Map(records.map((r) => [r.slug, r]));
  const sequence = groups.flatMap((g) => g.subtopics.map((s) => s.slug));
  const outConceptsDir = path.join(CONCEPTS_OUT, domainSlug);
  await mkdir(outConceptsDir, { recursive: true });
  let promptedTopics = 0;
  for (let i = 0; i < sequence.length; i++) {
    const rec = byRecord.get(sequence[i]);
    if (!rec) continue; // subtopic with questions but no concepts.md
    const nextRec = byRecord.get(sequence[i + 1]);
    const next = nextRec ? { slug: nextRec.slug, title: nextRec.title } : null;
    const prompts = buildPrompts(rec.prompts, domainSlug, rec.slug, next);
    if (prompts) promptedTopics++;

    const strippedBody = stripLeadingH1(await readFile(rec.conceptsPath, "utf8"));
    const fm = [
      "---",
      `title: ${yamlStr(rec.title)}`,
      `domain: ${yamlStr(domainSlug)}`,
      `slug: ${yamlStr(rec.slug)}`,
      `group: ${yamlStr(rec.groupKey)}`,
      `readingMinutes: ${readingMinutes(strippedBody)}`,
      // One line of JSON (valid YAML). Omitted entirely for a topic with no sidecar, which
      // is why the Zod field is `.optional()` and un-migrated topics validate forever.
      ...(prompts ? [`prompts: ${JSON.stringify(prompts)}`] : []),
      "---",
      "",
    ].join("\n");
    await writeFile(path.join(outConceptsDir, `${rec.slug}.md`), fm + strippedBody, "utf8");
  }

  const subtopicCount = groups.reduce((n, g) => n + g.subtopics.length, 0);
  if (promptedTopics) {
    console.log(
      `[sync-content] ${domainSlug}: ${promptedTopics}/${records.length} topic(s) ship a ` +
        `prompts.yaml sidecar`,
    );
  }
  return {
    slug: domainSlug,
    title,
    authored: true,
    subtopicCount,
    questionCount: domainQuestions.length,
    groups,
  };
}

async function processComingSoonDomain(domainSlug) {
  const domainDir = path.join(TOPICS_DIR, domainSlug);
  const title = await readReadmeTitle(domainDir, domainSlug);
  return {
    slug: domainSlug,
    title,
    authored: false,
    subtopicCount: 0,
    questionCount: 0,
    groups: [],
  };
}

async function main() {
  const started = Date.now();
  if (!existsSync(TOPICS_DIR)) {
    throw new Error(`topics dir not found at ${TOPICS_DIR}`);
  }
  await clean();
  await mkdir(path.dirname(CATALOG_OUT), { recursive: true });
  await mkdir(QUESTIONS_OUT, { recursive: true });
  await mkdir(CONCEPTS_OUT, { recursive: true });

  const domains = [];
  for (const d of AUTHORED_DOMAINS) domains.push(await processAuthoredDomain(d));
  for (const d of COMING_SOON_DOMAINS)
    domains.push(await processComingSoonDomain(d));

  const catalog = { domains };
  await writeFile(CATALOG_OUT, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  // Unindented: ~6k keys that nothing reads by eye, and the pretty form is 3x the
  // bytes for a file every /topic page imports at build time.
  await writeFile(REFS_OUT, JSON.stringify(questionRefCounts) + "\n", "utf8");

  const authored = domains.filter((d) => d.authored);
  const totalSub = authored.reduce((n, d) => n + d.subtopicCount, 0);
  const totalQ = authored.reduce((n, d) => n + d.questionCount, 0);
  // The ref total is printed BESIDE the question total on purpose: /topic's section
  // manifest is only as complete as this number, so the gap between the two is the
  // one figure that says "some questions are not attributed to a section".
  const totalRefs = Object.values(questionRefCounts).reduce(
    (n, counts) => n + Object.values(counts).reduce((m, c) => m + c, 0),
    0,
  );
  console.log(
    `[sync] ${domains.length} domains (${authored.length} authored, ` +
      `${COMING_SOON_DOMAINS.length} coming-soon), ${totalSub} subtopics, ` +
      `${totalQ} questions (${totalRefs} with a section ref) ` +
      `in ${Date.now() - started}ms`,
  );
  for (const d of authored) {
    console.log(
      `  - ${d.slug}: ${d.subtopicCount} subtopics, ${d.questionCount} questions, ` +
        `${d.groups.length} group(s)`,
    );
  }
}

main().catch((err) => {
  console.error("[sync] FAILED:", err);
  process.exit(1);
});
