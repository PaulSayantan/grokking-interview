export const meta = {
  name: 'refine-wave3-polish',
  description: 'WAVE 3 (final polish tier) of corpus refinement: fix the remaining medium+ severity JARGON (undefined load-bearing terms / named-but-untaught mechanisms), VISUAL (missing diagram where a concept is inherently spatial/sequential), and STRUCTURE / REDUNDANCY / ORDERING issues flagged by the audit — the systemic themes not covered by the correctness (Wave 0) or worked-examples (Wave 1/2) passes. Cache-backed and idempotent: each file writes a done-marker after self-verification and is skipped on re-runs. One agent per file (distinct files -> safe parallel in-place edits) applies SURGICAL, additive polish per its own audit findings; a second agent verifies each added definition/diagram is correct and no heading/anchor broke. EDITS concepts.md; never renames existing headings or touches questions.yaml.',
  phases: [
    { title: 'Refine', detail: 'one agent per file defines flagged jargon, adds a diagram where flagged, fixes structure/redundancy; writes a done-marker' },
    { title: 'Verify', detail: 'one agent per file confirms definitions are correct, any new mermaid is valid, and no heading/anchor/contradiction regressed' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const AUDIT_CACHE = '/tmp/interview-prep-cache/audit-cache'
const REFINE_CACHE = '/tmp/interview-prep-cache/refine-cache/wave3'

let KEYS = null
if (Array.isArray(args)) KEYS = args
else if (typeof args === 'string' && args.trim()) {
  try { const p = JSON.parse(args); if (Array.isArray(p)) KEYS = p } catch (e) {}
  if (!KEYS) KEYS = args.split(/[\s,]+/).filter(Boolean)
}
if (!KEYS || KEYS.length === 0) throw new Error('args must be a non-empty array of "domain/slug" keys')

const WORK = KEYS.map((k) => { const i = k.indexOf('/'); return { key: k, dom: k.slice(0, i), slug: k.slice(i + 1) } })
log(`Wave 3 polish: ${WORK.length} files; done-markers in ${REFINE_CACHE}`)

const REFINE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['key', 'status', 'jargon_defined', 'diagrams_added', 'structure_fixes', 'summary'],
  properties: {
    key: { type: 'string' },
    status: { type: 'string', enum: ['refined', 'already-cached', 'no-change-needed', 'blocked'] },
    jargon_defined: { type: 'array', items: { type: 'string' }, description: 'terms/acronyms now defined at first use (empty if none)' },
    diagrams_added: { type: 'array', items: { type: 'string' }, description: 'mermaid diagrams added and what each shows (empty if none)' },
    structure_fixes: { type: 'array', items: { type: 'string' }, description: 'redundancy/ordering/structure fixes made (empty if none)' },
    summary: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['key', 'verdict', 'wrong_definitions', 'regressions', 'notes'],
  properties: {
    key: { type: 'string' },
    verdict: { type: 'string', enum: ['clean', 'needs-rework'] },
    wrong_definitions: { type: 'array', items: { type: 'string' }, description: 'newly-added definitions that are factually wrong/misleading (empty if none)' },
    regressions: { type: 'array', items: { type: 'string' }, description: 'renamed/removed "## " heading, broken concepts.md#anchor, invalid mermaid syntax, or new contradiction (empty if none)' },
    notes: { type: 'string' },
  },
}

const REFINE_PROTOCOL = (w) => {
  const auditPath = `${AUDIT_CACHE}/${w.dom}__${w.slug}.json`
  const conceptsPath = `${REPO}/topics/${w.dom}/${w.slug}/concepts.md`
  const marker = `${REFINE_CACHE}/${w.dom}__${w.slug}.json`
  return (
`You are a Senior Principal Engineer and gifted teacher applying the FINAL POLISH pass to ONE interview-study file, ` +
`per the repo refining-content standard. Focus ONLY on this wave's issue types (correctness and worked examples were ` +
`handled in earlier waves): \n` +
` • JARGON — define every load-bearing term-of-art at first use; expand acronyms; if a hard mechanism is named but ` +
`never taught, add a one/two-sentence explanation or an explicit cross-reference to the section that teaches it.\n` +
` • VISUAL — where the audit flags a concept that is inherently spatial/sequential (filter chain, state machine, ` +
`request lifecycle, topology, saga/flow) and has no diagram, add a small mermaid diagram (the repo renders mermaid). ` +
`Keep it focused; do not diagram things that read fine as prose.\n` +
` • STRUCTURE / REDUNDANCY / ORDERING — consolidate repeated points, add a forward-reference or orientation line ` +
`where sections are split awkwardly, reconcile numbers/labels stated inconsistently.\n\n` +
`RULES: additive and SURGICAL; preserve the author's voice. Do NOT rename or delete any "## " heading (MCQs anchor ` +
`to them); you may ADD sections. Callouts only > [!TIP]/[!WARNING]/[!INTERVIEW]/[!KEY-TAKEAWAY], 1-3 per file. Any ` +
`definition you add MUST be factually correct — if unsure of a precise fact, describe the mechanism rather than ` +
`assert a shaky specific. Do NOT web-search (facts were verified in Wave 0); only add well-known definitional facts.\n\n` +
`IDEMPOTENCY: Read the done-marker ${marker}. If it EXISTS with status "refined"/"no-change-needed", return it ` +
`verbatim with status "already-cached"; edit nothing. Else do the work, Write the result JSON to ${marker}, return it.\n\n` +
`STEP 1: Read ${auditPath}; act on issues[] of type jargon / visual / structure / redundancy / ordering (severity ` +
`high or medium). Each has where/detail/fix.\n` +
`STEP 2: Read ${conceptsPath} in full.\n` +
`STEP 3: Apply the polish with the Edit tool.\n` +
`STEP 4: self-verify — every added definition is correct; any mermaid you added is syntactically valid and matches ` +
`the prose; every "## " heading is intact; no new contradiction. Fix anything that fails, THEN write the marker.\n\n` +
`If the flagged issues are not actually present, set status "no-change-needed". Return the object (key MUST be "${w.key}").`
  )
}

const results = await pipeline(
  WORK,
  (w) => agent(REFINE_PROTOCOL(w), { label: `refine:${w.key}`, phase: 'Refine', effort: 'high', schema: REFINE_SCHEMA }),
  (refineResult, w) => {
    const conceptsPath = `${REPO}/topics/${w.dom}/${w.slug}/concepts.md`
    const auditPath = `${AUDIT_CACHE}/${w.dom}__${w.slug}.json`
    return agent(
      `You are an adversarial reviewer. A polish pass just added jargon definitions / a diagram / structure fixes to ONE ` +
      `interview-study file. Verify:\n` +
      `1. Read the audit findings ${auditPath} (jargon/visual/structure/redundancy/ordering issues) and the CURRENT file ${conceptsPath}.\n` +
      `2. Are the newly-added DEFINITIONS factually correct and genuinely clarifying (not hand-wavy or wrong)? List any that are wrong/misleading.\n` +
      `3. REGRESSIONS: did the edit rename/remove any "## " heading, break a concepts.md#anchor reference, add INVALID mermaid ` +
      `syntax, or introduce a contradiction? List them.\n` +
      `The refine reported: ${JSON.stringify({ status: refineResult?.status, jargon: refineResult?.jargon_defined, diagrams: refineResult?.diagrams_added, structure: refineResult?.structure_fixes })}. ` +
      `Do NOT edit the file. Return the structured verdict (key MUST be "${w.key}").`,
      { label: `verify:${w.key}`, phase: 'Verify', effort: 'medium', schema: VERIFY_SCHEMA }
    ).then((v) => ({ refine: refineResult, verify: v, key: w.key }))
  }
)

const ok = results.filter(Boolean)
const clean = ok.filter((r) => r.verify?.verdict === 'clean')
const rework = ok.filter((r) => r.verify?.verdict === 'needs-rework')
const noChange = ok.filter((r) => r.refine?.status === 'no-change-needed')
const totalJargon = ok.reduce((s, r) => s + (r.refine?.jargon_defined?.length || 0), 0)
const totalDiagrams = ok.reduce((s, r) => s + (r.refine?.diagrams_added?.length || 0), 0)
log(`Wave 3 done: ${clean.length} clean, ${rework.length} need-rework, ${noChange.length} no-change; ${totalJargon} terms defined, ${totalDiagrams} diagrams added`)

return {
  total: WORK.length, processed: ok.length, clean: clean.length,
  terms_defined: totalJargon, diagrams_added: totalDiagrams,
  needs_rework: rework.map((r) => ({ key: r.key, wrong_definitions: r.verify?.wrong_definitions, regressions: r.verify?.regressions })),
  no_change_needed: noChange.map((r) => r.key),
}
