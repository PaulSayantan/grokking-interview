#!/usr/bin/env node
/**
 * sync-content.mjs — reads the read-only content source at ../topics and generates
 * all build-time data the Astro site renders from. Idempotent: it cleans its own
 * output dirs first, so re-running always reflects the current source exactly.
 *
 * Outputs (all under web/):
 *   src/content/concepts/<domain>/<slug>.md         concepts w/ prepended frontmatter
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

// --- Domain configuration -------------------------------------------------

/** Authored domains render as browsable cards; order here drives display order. */
const AUTHORED_DOMAINS = ["system-design", "spring-boot", "spring-core", "java-jvm"];

/** Not-yet-authored domains -> "Coming soon" cards. Titles from topics/<d>/README.md. */
const COMING_SOON_DOMAINS = [
  "docker",
  "kubernetes",
  "devops-cicd",
  "hibernate-jpa",
  "apache-tomcat",
  "messaging-databases",
];

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
 * incomplete. Returns a Map<slug, orderIndex> (0-based).
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

/** Slim question payload for the practice island's initial fetch.
 *  Drops explanation + tags (heavy / unused during the quiz); KEEPS difficulty
 *  so the client-side difficulty filter can work without the full pool. */
function slimQuestion(q) {
  const { explanation, tags, ...rest } = q;
  return rest;
}

/**
 * Write a question pool as both `<baseName>.json` (full) and `<baseName>.slim.json`
 * (no explanation/tags/difficulty — explanations ship separately per domain).
 */
async function writePoolFiles(dir, baseName, questions) {
  await writeFile(
    path.join(dir, `${baseName}.json`),
    JSON.stringify(questions),
    "utf8",
  );
  await writeFile(
    path.join(dir, `${baseName}.slim.json`),
    JSON.stringify(questions.map(slimQuestion)),
    "utf8",
  );
}

/** Group key for a system-design subtopic slug. */
function sdGroupKey(slug) {
  if (slug.startsWith("aws-")) return "aws";
  if (SD_ADVANCED.has(slug)) return "advanced";
  return "core";
}

const SD_GROUP_LABELS = {
  core: "Core Topics",
  advanced: "Advanced & Expert Deep-Dives",
  aws: "AWS System Design",
};
// Display order for system-design groups.
const SD_GROUP_ORDER = ["core", "advanced", "aws"];

// --- Main ------------------------------------------------------------------

async function clean() {
  await rm(CONCEPTS_OUT, { recursive: true, force: true });
  await rm(QUESTIONS_OUT, { recursive: true, force: true });
  await rm(CATALOG_OUT, { force: true });
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
    const outQuestions = questions.map((q) => ({
      id: q.id,
      difficulty: q.difficulty,
      tags: q.tags ?? [],
      question: q.question,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation,
      ...(q.ref ? { ref: q.ref } : {}),
      domain: domainSlug,
      topic_slug: slug,
    }));

    // --- Write per-subtopic questions JSON (full + slim) ---
    const domQDir = path.join(QUESTIONS_OUT, domainSlug);
    await mkdir(domQDir, { recursive: true });
    await writePoolFiles(domQDir, slug, outQuestions);

    // --- Accumulate for domain + group pools ---
    domainQuestions.push(...outQuestions);
    if (!groupQuestions.has(groupKey)) groupQuestions.set(groupKey, []);
    groupQuestions.get(groupKey).push(...outQuestions);

    // --- Write concept collection entry (frontmatter + body sans leading H1) ---
    if (existsSync(conceptsPath)) {
      const body = await readFile(conceptsPath, "utf8");
      const strippedBody = stripLeadingH1(body);
      const mins = readingMinutes(strippedBody);
      const fm = [
        "---",
        `title: ${yamlStr(subtopicTitle)}`,
        `domain: ${yamlStr(domainSlug)}`,
        `slug: ${yamlStr(slug)}`,
        `group: ${yamlStr(groupKey)}`,
        `readingMinutes: ${mins}`,
        "---",
        "",
      ].join("\n");
      const outConceptsDir = path.join(CONCEPTS_OUT, domainSlug);
      await mkdir(outConceptsDir, { recursive: true });
      await writeFile(
        path.join(outConceptsDir, `${slug}.md`),
        fm + strippedBody,
        "utf8",
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

  const subtopicCount = groups.reduce((n, g) => n + g.subtopics.length, 0);
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

  const authored = domains.filter((d) => d.authored);
  const totalSub = authored.reduce((n, d) => n + d.subtopicCount, 0);
  const totalQ = authored.reduce((n, d) => n + d.questionCount, 0);
  console.log(
    `[sync] ${domains.length} domains (${authored.length} authored, ` +
      `${COMING_SOON_DOMAINS.length} coming-soon), ${totalSub} subtopics, ` +
      `${totalQ} questions in ${Date.now() - started}ms`,
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
