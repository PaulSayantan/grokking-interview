export const meta = {
  name: 'messaging-databases-sql-enrich',
  description: 'Targeted enrichment of the SQL topics in messaging-databases: additively fill specific gaps found vs the Devinterview SQL interview reference (DDL/DML/DCL/TCL taxonomy, LATERAL JOIN, GENERATED/UUIDv7 keys, JSONB, SARGable) + a few MCQs, then verify',
  phases: [
    { title: 'Enrich', detail: 'fill named gaps in concepts + append MCQs' },
    { title: 'Verify', detail: 'fact-check + schema-check in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/messaging-databases`

const SCOPE = `
DOMAIN SCOPE — "Messaging & Databases", PRACTITIONER/MECHANISM level, language/vendor-agnostic
(real SQL, not an ORM). This is an ADDITIVE enrichment: do NOT remove or rewrite existing
content, do NOT rename any existing "## " heading (they are MCQ anchor targets). Only ADD.
Reference being reconciled against: the Devinterview SQL interview question set
(https://github.com/Devinterview-io/sql-interview-questions).
`

// Per-topic: existing max question seq (new ids start here) + the SPECIFIC gaps to fill.
const TOPICS = [
  {
    slug: 'sql-query-language-advanced-queries', name: 'SQL Query Language & Advanced Queries', start: 57,
    gaps: `
- SQL COMMAND TAXONOMY (currently absent): add a "## SQL command categories (DDL, DML, DCL, TCL, DQL)"
  section — DDL (CREATE/ALTER/DROP/TRUNCATE/COMMENT, auto-commit/implicit commit), DML
  (INSERT/UPDATE/DELETE/MERGE), DCL (GRANT/REVOKE), TCL (COMMIT/ROLLBACK/SAVEPOINT), DQL (SELECT).
  This is a very common "types of SQL commands" interview question.
- LATERAL JOIN (currently only mentioned once): deepen — add or expand coverage of LATERAL /
  CROSS APPLY (correlated subquery in FROM, top-N-per-group pattern, why it differs from a normal join).
- JSONB / semi-structured data in a relational DB (currently absent): add coverage — JSON vs JSONB,
  querying (-> / ->> / @> containment), GIN-indexing JSONB, when to use it vs normalized columns.`,
  },
  {
    slug: 'relational-modeling-normalization', name: 'Relational Modeling & Normalization', start: 49,
    gaps: `
- KEY GENERATION (currently thin — GENERATED ALWAYS AS IDENTITY appears once, UUIDv7/UUIDv4 absent):
  deepen the keys section (or add a focused subsection) on auto-generated PKs — GENERATED ALWAYS AS
  IDENTITY vs SERIAL vs AUTO_INCREMENT, and UUID as a PK: UUIDv4 (random -> index fragmentation/page
  splits, poor B-tree locality) vs UUIDv7 (time-ordered -> better index locality), and the trade-off
  vs bigint identity. Common senior interview probe.`,
  },
  {
    slug: 'sql-indexing-query-optimization', name: 'SQL Indexing & Query Optimization', start: 49,
    gaps: `
- SARGable as a NAMED concept (currently the idea is in "When an index is not used" but the TERM is
  absent): introduce "SARGable / SARGability" explicitly — define it, give sargable-vs-non-sargable
  rewrites (e.g. WHERE col = x vs WHERE func(col) = x; date ranges vs YEAR(col)=; leading-wildcard
  LIKE; implicit casts), and tie it to the existing "when an index is not used" material. You MAY add
  a "## SARGable predicates" subsection.`,
  },
]

const RULES = (t) => `
${SCOPE}

STEP 1 — READ both files first:
  ${DIR}/${t.slug}/concepts.md   (note existing "## " headings — keep them ALL, unchanged)
  ${DIR}/${t.slug}/questions.yaml

STEP 2 — ENRICH concepts.md ADDITIVELY to fill ONLY these specific gaps (do your own web research
to get versions/syntax right; keep it mechanism-level, vendor-neutral but note PG vs MySQL where
they differ). You MAY add new "## " subsections; keep them before the "## Common follow-up
questions" / "## References" sections. GAPS FOR THIS TOPIC:
${t.gaps}
Do NOT duplicate content already present. Do NOT touch unrelated sections.

STEP 3 — APPEND new questions to questions.yaml (do NOT modify existing questions). Add 6-10 new
questions covering the newly added material. New ids "${t.slug}-NNN" starting at
${String(t.start).padStart(3, '0')}, incrementing, zero-padded 3-digit, unique. Mixed difficulty
(mostly intermediate, some advanced). Some scenario-style ("which rewrite is SARGable?", "which
command is DDL?", "UUIDv4 vs UUIDv7 for a high-insert PK — which and why?"). Distractors plausible
but wrong for a real reason. No "all/none of the above".

SCHEMA (every new question): id, difficulty (beginner|intermediate|advanced|expert), tags[],
question, options[3-5], answer (0-BASED, in range), explanation, ref ("concepts.md#anchor" resolving
to a real "## " heading via GitHub slug rules). VARY the correct-option index across the new
questions. Keep top-level topic/domain(messaging-databases)/topic_slug(${t.slug})/version intact.

Use Edit/Write. Return one line: "${t.slug}: +<n> questions (now <total>), added: <short list of gaps filled>".
`

phase('Enrich')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior database engineer additively enriching the interview-prep SQL topic "${t.name}" (slug: ${t.slug}) to reconcile it against a well-known SQL interview reference.\n\n${RULES(t)}`,
    { label: `enrich:${t.slug}`, phase: 'Enrich', effort: 'high' }
  ),
  (enrichSummary, t) => agent(
    `Verify the enriched SQL topic "${t.name}" (slug: ${t.slug}). Read ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and FIX IN PLACE:\n` +
    `1) FACTUAL errors in the NEWLY added concepts/MCQs — web-research anything uncertain (DDL/DML/DCL/TCL command membership & implicit-commit behavior; LATERAL/CROSS APPLY semantics; GENERATED ALWAYS AS IDENTITY vs SERIAL vs AUTO_INCREMENT; UUIDv4 random vs UUIDv7 time-ordered index locality; JSON vs JSONB + GIN + containment operators; SARGability rewrites). A wrong 'answer' index is the worst defect.\n` +
    `2) NO REGRESSIONS: confirm no existing "## " heading was renamed/removed and no existing question was altered (only additions). If something was changed, restore it.\n` +
    `3) SCHEMA: valid YAML; all ids unique with prefix '${t.slug}-' 3-digit seq; difficulty valid; 3-5 options; 0-based in-range 'answer'; every 'ref' resolves to a real '## ' heading; new correct-option positions varied. Fix violations.\n` +
    `Return one line: "${t.slug}: <total> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
