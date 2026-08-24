export const meta = {
  name: 'clarity-pilot-docker-topic',
  description: 'One docker pilot topic through the full loop: brief -> writer -> adversarial verifier + web fact-check -> repair',
  phases: [
    { title: 'Brief', detail: 'absorb ledger/MCQs/next-topic into a compact brief' },
    { title: 'Write', detail: 'whole-file clarity rewrite + prompts.yaml, written incrementally' },
    { title: 'Verify', detail: 'adversarial verifier + web fact-checker in parallel' },
    { title: 'Repair', detail: 'apply confirmed findings, write the final files' },
  ],
}

const ROOT = '/path/to/interview-prep'
const DIR = ROOT + '/.claude/skills/clarity-standard'
const SKILL = DIR + '/SKILL.md'
const LEDGER = ROOT + '/docs/continuity/docker.yaml'

const A = args || {}
const SLUG = A.slug
const POS = A.position
const OUT = A.out
const TDIR = ROOT + '/topics/docker/' + SLUG
const FILE = TDIR + '/concepts.md'

// ---------------------------------------------------------------- shared framing (SHORT on purpose)

const WHY = [
  '# Why this work exists',
  '',
  'Repo ' + ROOT + ', branch clarity-pilot-docker. Students reported the study content is **informative but hard to understand and exhausting to read**. The user instruction:',
  '',
  '> "the concepts can be an expert level ideas and knowledge, but the explanation of the same shouldn\'t be complex. Re-think on how these can be explained clearly. Emphasis on Clarity."',
  '',
  '**Two axes, never conflated.** Difficulty of the IDEA stays exactly where it is — senior/staff grade; simplifying, softening or dropping an edge case is FAILURE. Complexity of the EXPLANATION comes down everywhere, including the deepest passages — explaining a hard concept in hard language is also failure.',
  '',
  'Root diagnosis: **writing quality degrades monotonically down the depth stack.** A Beginner tier gets an analogy; an Advanced tier gets dense unreadable prose. The prose is worst exactly where the material is hardest, which is where readers quit.',
  '',
  'docker is the pilot domain, and its prose is ALREADY GOOD (audit: 4.94 clarity). That is the test: does the standard improve good writing, or just bloat it?',
].join('\n')

const CONSTRAINTS = [
  '# HARD repo constraints (violating one is a build failure)',
  '',
  '- **`## H2` text is an MCQ anchor target.** 28,064 questions carry a ref of the form concepts.md#anchor; 100% resolve. **Never rename, merge, split or delete an H2** — reproduce every one byte-identically. Adding `### H3` is safe and expected. `topics/.anchors.lock` enforces it: additions pass, modifications and removals FAIL.',
  '- Four callout types only, case-sensitive, first line of the blockquote: TIP, WARNING, INTERVIEW, KEY-TAKEAWAY. One H1 per file. Diagrams are **mermaid only**, never ASCII.',
  '- Check anchors with the repo own code:',
  '    import sys, pathlib; sys.path.insert(0, "scripts")',
  '    from validate_content import read_headings   # pathlib.Path in; objects have .level .text .line .slug',
  '- **No reading-time ceiling** — the user chose "let files grow". Reading minutes are reported, not gated. Padding is still a defect.',
  '- Never run git add / commit / checkout / stash / branch. Reading history is fine.',
].join('\n')

const FACTS = [
  '# Fact safety — the failure you are most likely to reproduce',
  '',
  'Commit 268a063 ran a no-web pedagogy pass over 59 files and **silently downgraded verified facts while every gate stayed green**. It was caught only by a later web-enabled pass reading the DIFF. It then happened again four times on this effort own proof rewrites — and **not one of those changed a number, a version or a citation**, which is why nothing mechanical saw them:',
  '',
  '- "Go passes context.Context explicitly as the first argument" became "so a missing one is a compile error" (false — context.Background() compiles and orphans spans).',
  '- "on some JVMs" became "on a 32-bit JVM" (JLS 17.7 conditions it on the implementation, not word size).',
  '- incrementAndGet "calls compareAndSet" (since JDK 8 it calls Unsafe.getAndAddInt).',
  '- x86 TSO lost its qualifier and gained "nothing else can".',
  '',
  '> **The unit of verification is the DIFF, not the file. Any sentence whose subject, verb or object differs from the original is a NEW CLAIM — marker word or not.**',
  '',
  'The marker grep is a net, not a gate. Every claim you ADD is guilty until sourced or hedged. **If you cannot source a condition, KEEP the hedge and record a content gap** — never invent the condition.',
].join('\n')

const ANTISTALL = [
  '# CRITICAL — how not to get killed by the watchdog',
  '',
  'A previous attempt at this exact task **failed five consecutive times.** Every attempt died during ORIENTATION: it made only Read and Bash calls, never a single Write, because it was ingesting a 14,720-word standard plus a 75 KB questions.yaml plus a 512-line target file and then going quiet to think. A 180-second gap with no tool call is read as a hang and the agent is killed.',
  '',
  '**Therefore:**',
  '1. **Read ONLY what your task lists.** Do not go exploring. In particular do not read a whole questions.yaml — the brief already carries what you need from it.',
  '2. **Produce a file within your first few tool calls**, even a rough one, then refine it with Edit. Never plan silently for minutes.',
  '3. **Build long files across MANY small Write/Edit calls** — one section at a time. Each call is a heartbeat.',
  '4. **Keep your structured output SHORT.** Paths, counts, brief findings. Never paste a file into it.',
].join('\n')

// ---------------------------------------------------------------- 1. brief
//
// args.skipBrief lets the orchestrator reuse an existing OUT/brief.md after a crash
// (a network drop killed a run mid-flight once, leaving a complete brief behind but
// losing its structured summary). Only pass it after checking the file is complete.

phase('Brief')

const brief = A.skipBrief
  ? { brief_path: OUT + '/brief.md', reused: true }
  : await agent(
  [
    WHY,
    '',
    '# YOUR TASK: build the writer brief for docker topic ' + POS + ' of 16 — `' + SLUG + '`',
    '',
    'You are the orientation pass. A writer agent will rewrite this topic, and it must NOT have to read the heavy sources itself — that is what killed five previous attempts. Absorb them and hand over something compact.',
    '',
    '**Read:**',
    '- ' + LEDGER + ' — the continuity ledger. Find this topic `plan[]` row, its `depends_on`, its `seam_to_next` block (pattern + seam + seam_strength), any `known_defects` entries naming this file, `canonical_terms` where this topic is the `defined_in` teaching site, `running_example` and its current state, `claims_established`, `approximations_open`, and anything under `owed`.',
    '- ' + TDIR + '/questions.yaml — **do not summarise every question.** Extract only: the distinct `ref` anchors, and for each anchor a one-line note on what its questions actually test. That is what the prose must keep supporting, and it is the concrete meaning of "no information loss".',
    '- ' + ROOT + '/topics/docker/README.md — confirm row order and the next topic slug.',
    '- The NEXT topic concepts.md — its H2 list and enough prose to confirm the seam payoff genuinely exists there.',
    '',
    '**Write ' + OUT + '/brief.md** (aim for under 1,200 words) containing, in this order:',
    '1. This topic in one line: what it teaches and where it sits.',
    '2. **Anchors table**: each `## H2` verbatim, its slug, MCQ count, and one line on what those MCQs test.',
    '3. **Terms**: which canonical terms this topic is the teaching site for (with the ledger gloss), and which terms it must merely REFERENCE because an earlier topic owns them. Include the banned variants.',
    '4. **Running example**: its state as of this topic, and whether this topic establishes or reuses it.',
    '5. **Known defects to fix**, quoted from the ledger, with the line numbers in the current file.',
    '6. **The cliffhanger seam**: the pattern, the exact seam, the next topic slug and title, the payoff anchor, and the verbatim sentence(s) from the next topic that prove the payoff is really there.',
    '7. **Inherited loop**: what the previous topic cliffhanger left open that this topic must settle (for topic 1, state that there is none).',
    '8. **Facts to watch**: every number, version, size and citation in the current file, listed, flagged for whether it needs web verification. Docker image sizes drift with base-image releases, so any stated size needs a pinned tag or a hedge.',
    '',
    'Write the file early and refine it. Keep the structured output short.',
  ].join('\n'),
  {
    label: 'brief:' + SLUG,
    phase: 'Brief',
    effort: 'high',
    schema: {
      type: 'object',
      properties: {
        brief_path: { type: 'string' },
        brief_words: { type: 'integer' },
        h2_count: { type: 'integer' },
        anchors_with_mcqs: { type: 'integer' },
        teaching_site_terms: { type: 'array', items: { type: 'string' } },
        known_defects: { type: 'array', items: { type: 'string' } },
        seam: { type: 'string', description: 'pattern + seam + payoff anchor + proof it exists in the next topic' },
        facts_needing_web: { type: 'integer' },
        concerns: { type: 'array', items: { type: 'string' } },
      },
      required: ['brief_path', 'brief_words', 'h2_count', 'seam', 'facts_needing_web'],
    },
  }
    )

log('Brief ' + (A.skipBrief ? 'REUSED from disk' : 'done') + ' for ' + SLUG + (brief ? ' (' + brief.brief_words + ' words)' : ' FAILED'))

// ---------------------------------------------------------------- 2. write

phase('Write')

const written = await agent(
  [
    WHY, '', CONSTRAINTS, '', FACTS, '', ANTISTALL,
    '',
    '# YOUR TASK: rewrite docker topic ' + POS + ' of 16 — `' + SLUG + '`',
    '',
    '**Read exactly these three things, in this order, and nothing else:**',
    '1. ' + SKILL + ' — the authoritative standard. Read it fully. Open a file under ' + DIR + '/references/ ONLY when you want a concrete example of a rule; the rules themselves are all in SKILL.md.',
    '2. ' + OUT + '/brief.md — your brief. It already carries the ledger, the MCQ anchors, the terms, the defects and the cliffhanger seam. **Trust it. Do not re-read the ledger or questions.yaml.**',
    '3. ' + FILE + ' — the file you are rewriting.',
    '',
    'This is a WHOLE-FILE rewrite. Every `## H2` stays byte-identical; everything between them is yours.',
    '',
    '## Write these files, in this order',
    '',
    '1. **' + OUT + '/concepts.md** — start it with the H1 and the first section, then add ONE SECTION PER Write/Edit CALL. Do not compose the whole file in your head first.',
    '2. **' + OUT + '/prompts.yaml** — the sidecar. Field spec is in SKILL.md and ' + ROOT + '/docs/content-schema.md: five allowed kinds, four closure tiers, at most one prompt per anchor, the per-topic cap, tier C needs success_criterion, tier D needs answer_shape, plus the `cliffhanger` block using the pattern your brief specifies.',
    '3. **' + OUT + '/audit.md** — every fact, number, version, citation, identifier, caveat and code example in the original and where each survives. Then **ADDED CLAIMS**: every claim you added, quoted, each marked SOURCED (with source) / HEDGED / UNVERIFIED. Be self-incriminating; a verifier will find what you omit.',
    '4. **' + OUT + '/ledger-append.yaml** — your proposed `topics[]` entry: terms defined, claims established, the loop you opened, approximations left open, anything owed onward.',
    '',
    '## Requirements',
    '',
    '- **Zero information loss.** Every anchor in the brief must still support the MCQs listed against it.',
    '- **Zero dumbing down.** Every expert claim, edge case and number stays.',
    '- **The REGISTER SWAP is the binding gate.** Read each section first paragraph and its last back to back; if a reader could tell which is which from vocabulary and clause depth alone, the deep tier failed. Apply it to yourself before finishing.',
    '- Give each term you are the teaching site for its plain-words definition and its single bold, here.',
    '- Fix the known defects listed in your brief.',
    '- **Verify, and report real output:** H2 text unchanged (read_headings); prompts.yaml parses; every prompt ref and in-file answer_in resolves; the cliffhanger payoff anchor resolves in the next topic.',
    '- **Do NOT stage anything into topics/.** The orchestrator runs the gates and owns what lands. Leave your work in ' + OUT + '.',
  ].join('\n'),
  {
    label: 'write:' + SLUG,
    phase: 'Write',
    effort: 'xhigh',
    schema: {
      type: 'object',
      properties: {
        files_written: { type: 'array', items: { type: 'string' } },
        h2_verification: { type: 'string' },
        word_delta: { type: 'string' },
        register_swap: { type: 'string', description: 'Deepest paragraph and its section opener, quoted briefly, plus your honest verdict' },
        added_claims_count: { type: 'integer' },
        unsourced_or_hedged: { type: 'array', items: { type: 'string' } },
        known_defects_fixed: { type: 'array', items: { type: 'string' } },
        cliffhanger: { type: 'string' },
        prompts_summary: { type: 'string' },
        standard_gaps: { type: 'array', items: { type: 'string' } },
      },
      required: ['files_written', 'h2_verification', 'word_delta', 'register_swap', 'added_claims_count', 'cliffhanger', 'prompts_summary'],
    },
  }
)

log('Writer done for ' + SLUG)

// ---------------------------------------------------------------- 3. verify

phase('Verify')

const SUM = JSON.stringify(written, null, 1)

const [verify, factcheck] = await parallel([
  () =>
    agent(
      [
        WHY, '', CONSTRAINTS, '', FACTS, '', ANTISTALL,
        '',
        '# YOUR TASK: adversarially verify this rewrite. You did not write it.',
        '',
        'Session 44 proved one pass is insufficient, and this effort own proof rewrite proved a writer cannot audit itself — its 36-item self-audit missed a false claim it had introduced.',
        '',
        '**Read:** ' + OUT + '/concepts.md, prompts.yaml, audit.md, ledger-append.yaml, brief.md. **Original:** `git show HEAD:topics/docker/' + SLUG + '/concepts.md`. Open it — do not trust audit.md.',
        '',
        'Checks, hardest first:',
        '1. **REGISTER SWAP (binding).** Per section, first paragraph against last. Can you tell which is which from vocabulary and clause depth alone? Judge the DEEPEST passages hardest — the predictable failure is a lovely opener above an expert passage that reads exactly like the unimproved original. Quote sentences.',
        '2. **Anti-dumbing-down.** Hard claims softened, edge cases dropped, numbers vagued, nuance hedged away. Any instance is a blocker.',
        '3. **MCQ survivability.** Read ' + TDIR + '/questions.yaml. **Can every question still be answered from the rewritten prose?** This is the concrete test of no-information-loss and the reason the anchors are frozen. Name any question that lost its support.',
        '4. **UNDISCLOSED ADDED CLAIMS.** Align sentences old-to-new yourself. Find claims missing from audit.md — especially ones with NO marker word, the class that defeated the grep four times. Say whether each is true, false or unverifiable, and how you know.',
        '5. **Information inventory.** Independently diff numbers with units, versions, citations, inline-code identifiers, table rows, code fences, mermaid blocks, callouts.',
        '6. **H2 integrity.** Verify byte-identical H2 text with read_headings; confirm every questions.yaml ref still resolves.',
        '7. **prompts.yaml.** Parse it. Kinds/tiers/caps, one prompt per anchor, every ref and answer_in resolves, payoff resolves in the genuine next topic and that topic really contains it. Cliffhanger form limits, with measured figures.',
        '8. **Continuity.** Canonical terms honoured? Running example reused rather than duplicated? Does ledger-append accurately describe the file?',
        '9. **Bloat.** Growth carrying information, or just chattier? Quote any padding.',
        '',
        'Scratch to ' + OUT + '/verify-notes.md. Structured output compact.',
        '',
        '## WRITER SUMMARY', SUM,
      ].join('\n'),
      {
        label: 'verify:' + SLUG,
        phase: 'Verify',
        effort: 'max',
        schema: {
          type: 'object',
          properties: {
            verdict: { type: 'string' },
            register_swap_result: { type: 'string', enum: ['PASS', 'FAIL', 'PARTIAL'] },
            register_swap_evidence: { type: 'string' },
            dumbing_down: { type: 'string' },
            mcq_survivability: { type: 'string' },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
                  category: { type: 'string' },
                  problem: { type: 'string' },
                  evidence: { type: 'string' },
                  fix: { type: 'string' },
                },
                required: ['severity', 'category', 'problem', 'evidence', 'fix'],
              },
            },
            undisclosed_added_claims: { type: 'array', items: { type: 'string' } },
            survives: { type: 'array', items: { type: 'string' } },
          },
          required: ['verdict', 'register_swap_result', 'register_swap_evidence', 'dumbing_down', 'mcq_survivability', 'findings', 'undisclosed_added_claims', 'survives'],
        },
      }
    ),
  () =>
    agent(
      [
        WHY, '', FACTS, '', ANTISTALL,
        '',
        '# YOUR TASK: web fact-check every fact-shaped line in this rewrite',
        '',
        'You have web access. **Use it.** This is the gate that would have caught Session 44, and it only works if you actually open primary sources.',
        '',
        '**Read:** ' + OUT + '/concepts.md, ' + OUT + '/audit.md, and the "Facts to watch" section of ' + OUT + '/brief.md. **Original:** `git show HEAD:topics/docker/' + SLUG + '/concepts.md`.',
        '',
        'Primary sources only: **official Docker docs**, the **OCI image-spec and runtime-spec**, containerd/runc docs and release notes, and Linux kernel docs for namespaces/cgroups/overlayfs. Never a blog, never StackOverflow, never recollection.',
        '',
        'Check: every number with a unit or bound (image sizes, layer counts, timeouts, defaults) — and whether it changed from the original; every version claim, including that the behaviour is attributed to the right version; every spec citation, quoting the line; every entry in audit.md ADDED CLAIMS plus any added causal claim missing from it; and anything marked UNVERIFIED or hedged.',
        '',
        'Docker-specific traps to press on: a container described as "just a process" without qualification; copy-on-write conflated with the writable layer; whether an image digest is of the manifest or the index; docker stop grace timing; and whether a stated base-image size is compressed or on-disk.',
        '',
        '**Never fabricate a citation** — no primary source means UNVERIFIABLE plus a recommended hedge. Prefer softening to a correct range over asserting a different precise number. Re-derive arithmetic. Scratch to ' + OUT + '/factcheck-notes.md.',
      ].join('\n'),
      {
        label: 'factcheck:' + SLUG,
        phase: 'Verify',
        effort: 'high',
        schema: {
          type: 'object',
          properties: {
            checks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  claim: { type: 'string' },
                  verdict: { type: 'string', enum: ['CONFIRMED', 'WRONG', 'IMPRECISE', 'UNVERIFIABLE'] },
                  source: { type: 'string' },
                  correction: { type: 'string' },
                },
                required: ['claim', 'verdict'],
              },
            },
            regressions_vs_original: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
          required: ['checks', 'regressions_vs_original', 'summary'],
        },
      }
    ),
])

// ---------------------------------------------------------------- 4. repair

phase('Repair')

const repair = await agent(
  [
    WHY, '', CONSTRAINTS, '', FACTS, '', ANTISTALL,
    '',
    '# YOUR TASK: apply the verified findings and write the final files',
    '',
    'A writer produced the rewrite; an adversarial verifier and a web fact-checker attacked it. Apply what is real, reject what is not, leave nothing silent.',
    '',
    '**Read:** ' + OUT + '/concepts.md, prompts.yaml, audit.md, ledger-append.yaml, brief.md, and the original via `git show HEAD:topics/docker/' + SLUG + '/concepts.md`. You are the last chance to catch information loss.',
    '',
    '**Write:** ' + OUT + '/final-concepts.md, ' + OUT + '/final-prompts.yaml, ' + OUT + '/final-ledger-append.yaml, ' + OUT + '/repair-log.md.',
    '',
    'Rules:',
    '- **Every blocker and high finding must be fixed or explicitly rejected with a stated reason.**',
    '- **Every WRONG or IMPRECISE fact-check verdict must be applied** using the correction given. For UNVERIFIABLE, keep or restore the hedge.',
    '- A fix must not undo the clarity gain. If it makes a passage dense again, find a third phrasing that is both true and plain.',
    '- Re-verify after editing: H2 byte-identical, prompts.yaml parses, every anchor resolves, payoff resolves in the next topic.',
    '- **Do NOT stage into topics/.** The orchestrator runs gates and commits.',
    '',
    '## ADVERSARIAL VERIFIER', JSON.stringify(verify, null, 1),
    '',
    '## WEB FACT-CHECKER', JSON.stringify(factcheck, null, 1),
  ].join('\n'),
  {
    label: 'repair:' + SLUG,
    phase: 'Repair',
    effort: 'xhigh',
    schema: {
      type: 'object',
      properties: {
        files_written: { type: 'array', items: { type: 'string' } },
        findings_applied: { type: 'array', items: { type: 'string' } },
        findings_rejected: { type: 'array', items: { type: 'string' } },
        facts_corrected: { type: 'array', items: { type: 'string' } },
        final_deltas: { type: 'string' },
        residual_risks: { type: 'array', items: { type: 'string' } },
        verdict: { type: 'string' },
      },
      required: ['files_written', 'findings_applied', 'findings_rejected', 'facts_corrected', 'final_deltas', 'residual_risks', 'verdict'],
    },
  }
)

return { slug: SLUG, position: POS, brief, written, verify, factcheck, repair }
