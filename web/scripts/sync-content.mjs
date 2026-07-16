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

    // --- Write per-subtopic questions JSON ---
    const domQDir = path.join(QUESTIONS_OUT, domainSlug);
    await mkdir(domQDir, { recursive: true });
    await writeFile(
      path.join(domQDir, `${slug}.json`),
      JSON.stringify(outQuestions),
      "utf8",
    );

    // --- Accumulate for domain + group pools ---
    domainQuestions.push(...outQuestions);
    if (!groupQuestions.has(groupKey)) groupQuestions.set(groupKey, []);
    groupQuestions.get(groupKey).push(...outQuestions);

    // --- Write concept collection entry (frontmatter + body sans leading H1) ---
    if (existsSync(conceptsPath)) {
      const body = await readFile(conceptsPath, "utf8");
      const fm = [
        "---",
        `title: ${yamlStr(subtopicTitle)}`,
        `domain: ${yamlStr(domainSlug)}`,
        `slug: ${yamlStr(slug)}`,
        `group: ${yamlStr(groupKey)}`,
        "---",
        "",
      ].join("\n");
      const outConceptsDir = path.join(CONCEPTS_OUT, domainSlug);
      await mkdir(outConceptsDir, { recursive: true });
      await writeFile(
        path.join(outConceptsDir, `${slug}.md`),
        fm + stripLeadingH1(body),
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

  // --- Write domain _all.json ---
  const domQDir = path.join(QUESTIONS_OUT, domainSlug);
  await mkdir(domQDir, { recursive: true });
  await writeFile(
    path.join(domQDir, "_all.json"),
    JSON.stringify(domainQuestions),
    "utf8",
  );

  // --- Write per-group pools for system-design ---
  if (isSystemDesign) {
    for (const key of SD_GROUP_ORDER) {
      const pool = groupQuestions.get(key) || [];
      await writeFile(
        path.join(domQDir, `_group-${key}.json`),
        JSON.stringify(pool),
        "utf8",
      );
    }
  }

  // --- Build ordered groups for the catalog ---
  let groups;
  if (isSystemDesign) {
    groups = SD_GROUP_ORDER.filter((k) => groupMap.has(k)).map((k) => {
      const g = groupMap.get(k);
      g.subtopics.sort((a, b) => a.title.localeCompare(b.title));
      return g;
    });
  } else {
    const g = groupMap.get("all") || { key: "all", label: "", subtopics: [] };
    g.subtopics.sort((a, b) => a.title.localeCompare(b.title));
    groups = [g];
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
