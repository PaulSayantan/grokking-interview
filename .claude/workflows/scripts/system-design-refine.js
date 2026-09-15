export const meta = {
  name: 'system-design-refine',
  description: 'Full pedagogy-pass refinement of the 59 medium-priority system-design subtopics: one agent refines each concepts.md in place against the 7-point refining-content standard (intuition-first openers, worked numbers-in->numbers-out examples, reasoned trade-offs, gotchas/follow-ups, defined jargon, self-consistency, fix logic errors), guided by that file\'s specific audit findings; a second agent adversarially verifies the edit (no new bugs, examples compute, anchors intact). No web search this run — soften uncertain facts, do not fabricate.',
  phases: [
    { title: 'Refine', detail: 'one agent per subtopic edits concepts.md in place from its audit findings' },
    { title: 'Verify', detail: 'adversarial re-read: examples compute, no new errors, MCQ anchors still resolve' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`
// Per-slug audit findings live here (JSON map slug -> {clarity,example,depth,priority,verdict,issues}).
const FINDINGS_FILE = `${REPO}/.refine-tmp/sd-findings.json`

// args = array of slugs, or JSON string of same.
function toSlugs(a) {
  if (Array.isArray(a)) return a
  if (typeof a === 'string' && a.trim()) {
    try { const p = JSON.parse(a); if (Array.isArray(p)) return p } catch (e) {}
    return a.split(/[\s,]+/).filter(Boolean)
  }
  return []
}
const SLUGS = toSlugs(args)
if (SLUGS.length === 0) throw new Error('no slugs passed in args')

const STANDARD = `
THE REFINEMENT STANDARD (a file is "done" only when all seven hold; 1-4 are the priorities):
1. INTUITION-FIRST OPENER — every hard concept LEADS with a plain-language mental model / analogy /
   "why does this exist, what breaks without it" BEFORE any definition, notation, or code. If a
   section opens on a definition, add a one-paragraph intuition above it.
2. A WORKED EXAMPLE PER HARD CONCEPT — the single highest-leverage fix corpus-wide. For each genuinely
   hard idea, show a concrete NUMBERS-IN -> NUMBERS-OUT (or bytes-in->bytes-out, or step-by-step
   interleaving) trace: plug in real inputs, show intermediate state, produce the output. A code
   TEMPLATE or a prose restatement does NOT count — the reader must be able to follow the actual
   computation. (e.g. trace base62(125) digit by digit; plug W=2,R=2,N=3 into a quorum and show the
   overlap; compute a serverless-vs-provisioned break-even to a specific RPS in dollars; interleave two
   threads to show the race; trace a saga with each step's state and the compensation firing.)
3. REASONED TRADE-OFFS — "you gain X, you give up Y, pick it when Z", with the condition that flips the
   decision. Never a bare Pros/Cons feature list. If trade-offs are bullets, add the reasoning.
4. FOLLOW-UPS / GOTCHAS LAYER — the senior "what if it goes sideways" turn: edge cases, failure modes,
   the exact follow-ups an interviewer probes. A short "## Common follow-ups" / "## Gotchas" section or
   > [!INTERVIEW] callouts. (Common misses flagged in this domain: dual-write / transactional-outbox,
   poison-message/DLQ max-receive loops, request hedging, ambient/sidecar-less service mesh, the
   shared-responsibility model by name, sticky-session anti-pattern, anemic-domain-model trap.)
5. DEFINED JARGON — every load-bearing term-of-art defined at first use; every named mechanism either
   taught or explicitly linked to where it's taught. No "named-but-never-taught" (Bloom filter, SimHash,
   LSH, saga, 2PC, CAS, consistent hashing, DHT, quorum). Expand acronyms on first use.
6. SELF-CONSISTENT STRUCTURE — code must not contradict its own prose; diagrams/signatures/data-models/
   numbers must agree across sections. Add a mermaid diagram where a concept is inherently
   spatial/sequential (request lifecycles, state machines, saga flows, topologies) — the repo renders
   mermaid; end sequenceDiagram lines with semicolons.
7. VERIFIED FACTS — see the correctness rules below.

CORRECTNESS (two kinds, handled differently — NO WEB SEARCH THIS RUN):
 - PURE-LOGIC / SELF-CONSISTENCY bug (wrong arithmetic, illegal code, a skeleton that contradicts its
   prose, mismatched numbers across sections, an internal contradiction, an off-by-one) — FIX IT
   CONFIDENTLY from the content by reasoning it out. Fix the code AND the surrounding claim so they
   agree. These are the audit's "confirmed" errors and your top priority.
 - FACT-DRIFT bug (a specific version / service limit / price / quota / spec number that may be stale) —
   do NOT web-search in this pass and do NOT assert a precise number you are not sure of. Instead state
   the MECHANISM and a conservative correct RANGE (e.g. "up to several secondary Regions" rather than a
   hard "10"), or hedge with "as of writing, verify current docs". NEVER fabricate a number, RFC, or
   citation. Leaving a fact slightly less precise is better than leaving it precisely wrong.

HARD CONSTRAINTS:
 - ADDITIVE AND SURGICAL, not a rewrite. Preserve the author's voice and structure.
 - DO NOT rename, delete, or reorder existing "## H2" headings — MCQs reference them as anchors
   (ref: concepts.md#slug). You MAY ADD new "## H2"/"### H3" sections. Breaking an anchor fails the build.
 - Heading text must not contain '/' or '&' (breaks anchor slugs) — use commas / "and".
 - Callouts: only the 4 markers > [!TIP] > [!WARNING] > [!INTERVIEW] > [!KEY-TAKEAWAY], 1-3 per file.
 - Do NOT touch questions.yaml. Edit ONLY this topic's concepts.md.
`

phase('Refine')
const results = await pipeline(
  SLUGS,
  (slug) => {
    return agent(
      `You are a Senior Principal Engineer at a top product company and a gifted, enthusiastic teacher, ` +
      `refining ONE existing interview-study document so a motivated student finishes it with ZERO doubt ` +
      `and an interviewer would judge the answer senior-grade.\n\n` +
      `FILE TO EDIT (in place): ${DIR}/${slug}/concepts.md  (subtopic slug: "${slug}")\n\n` +
      `This file was already audited. FIRST, read the JSON file ${FINDINGS_FILE} and look up the key ` +
      `"${slug}" — that object has this file's {clarity,example,depth} scores, one_line verdict, and an ` +
      `"issues" array. Address EVERY issue: each has a "type", "severity", "where" (the ## heading it ` +
      `refers to), "detail" (what makes a student struggle), and "fix" (the concrete change to make).\n\n` +
      `${STANDARD}\n\n` +
      `STEPS: (1) Read the WHOLE concepts.md and understand the author's structure/voice. (2) Fix ` +
      `pure-logic/self-consistency errors first. (3) Fill the weighted gaps in priority order, driven by ` +
      `the findings above — especially ADD THE MISSING WORKED EXAMPLES (numbers-in->numbers-out) for the ` +
      `hardest concepts; that is why this file was flagged. (4) Preserve all existing ## anchors. ` +
      `(5) Self-verify: re-read adversarially — does every worked example actually compute to the answer ` +
      `you wrote? Did you introduce any new contradiction? Is every new term defined?\n\n` +
      `Use the Edit/Write tools to modify the file in place. Return one line: ` +
      `"${slug}: <n> examples added, <c> corrections, <g> gotchas/jargon; anchors preserved".`,
      { label: `refine:${slug}`, phase: 'Refine', effort: 'high' }
    )
  },
  (refineSummary, slug) => agent(
    `You are a staff engineer + meticulous teacher adversarially VERIFYING a just-refined study document: ` +
    `${DIR}/${slug}/concepts.md (slug "${slug}"). The refiner reported: "${refineSummary}".\n\n` +
    `Read the file and FIX IN PLACE any problem you find:\n` +
    `1) WORKED EXAMPLES ACTUALLY COMPUTE — re-derive every numeric/traced example the refiner added. If ` +
    `an example's stated output does not follow from its inputs, correct the arithmetic (and the claim). ` +
    `This is the most important check.\n` +
    `2) NO NEW ERRORS — no new contradiction between code and prose, no numbers that disagree across ` +
    `sections, no illegal code. If a fact-shaped claim (version/limit/price) looks like a precise number ` +
    `asserted from memory, soften it to a mechanism + range (do NOT web-search this run; do NOT fabricate).\n` +
    `3) ANCHORS INTACT — verify NO existing "## H2" heading was renamed/removed/reordered. Read this ` +
    `topic's sibling questions.yaml, collect every 'ref: concepts.md#anchor', and confirm each anchor ` +
    `still resolves to a real "## " heading (GitHub slug rules: lowercase, spaces->'-', punctuation ` +
    `stripped). If the refiner broke an anchor, RESTORE the heading text so the ref resolves.\n` +
    `4) STANDARD MET — the flagged hard concepts now have real worked examples (not prose restatements), ` +
    `intuition-first openers, reasoned trade-offs, and defined jargon. If a flagged gap is still thin, ` +
    `fill it.\n` +
    `5) Heading text has no '/' or '&'; callouts use only the 4 valid markers; mermaid sequenceDiagram ` +
    `lines end with ';'.\n\n` +
    `Return one line: "${slug}: <verified|fixed N>, anchors ok, examples compute, notes: ...".`,
    { label: `verify:${slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
