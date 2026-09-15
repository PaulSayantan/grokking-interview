export const meta = {
  name: 'interview-craft-authoring',
  description: 'Author interview-grade concepts.md + a 40-60 MCQ questions.yaml for all 16 Interview Craft (behavioral/communication/seniority) topics, then verify each for accuracy, judgment-quality, and schema compliance',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact/judgment-check + schema-check each topic, fix in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/interview-craft`

const SCOPE_NOTE = `
DOMAIN SCOPE — "Interview Craft" is the NON-TECHNICAL craft that decides senior/staff backend
interview outcomes: behavioral storytelling, seniority signals, engineering communication, and how
product/startup loops differ from FAANG. Audience: backend + senior/staff engineers at product-based
and startup companies. Actionable and concrete — teach HOW to structure answers, WHAT signals
interviewers look for, and give real example phrasings/frameworks (not vague pep talk).

BOUNDARY (cross-reference, don't duplicate):
- system-design/interview-method-scenario-playbooks owns the TECHNICAL system-design interview
  method (how to drive a whiteboard design). THIS domain owns everything ELSE: behavioral, career,
  communication, negotiation. Point to it for the technical-round method; do not re-teach it.
- The reliability/incident PROCESS mechanics live in devops-cicd/observability. Here, incident
  leadership is the BEHAVIORAL/story angle (how to tell an incident story that shows ownership).
- dsa-coding / lld-and-ood (upcoming) own the coding-round SKILLS. Here, 'take-home/pairing/code-
  review rounds' is about how to APPROACH & communicate in those rounds, not the algorithms.

Ground claims in credible, current sources: the STAR method (and SAR/CARL variants), Amazon
Leadership Principles + the Bar Raiser process, the engineering-ladder rubrics (Dropbox/CircleCI/
Rent-the-Runway/Gitlab published ladders, StaffEng.com / Will Larson's "Staff Engineer" & "An
Elegant Puzzle", the Staff Engineer archetypes: Tech Lead / Architect / Solver / Right Hand),
levels.fyi leveling, "Cracking the PM/Coding Interview" behavioral sections, Google's Project
Oxygen/gCareer, common 2024/2025 senior+ interview guides. Estimation: the "latency numbers every
engineer should know" (Jeff Dean/Peter Norvig) + powers-of-two/back-of-envelope. Verify specifics
(e.g. current Amazon LP count/wording, ladder scope definitions) via web research.
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (MCQ anchor targets — keep stable).
   - Layered, ACTIONABLE prose: what it is / why it matters -> how to do it well (frameworks,
     structure, example phrasings) -> the senior/staff bar & common failure modes interviewers penalize.
   - Concrete: sample STAR answers, a "weak vs strong answer" contrast, scope-signal rubrics,
     estimation worked examples (latency/throughput numbers), reverse-question lists, comparison tables.
   - If a diagram helps (e.g. STAR structure, ladder scope, a decision/story flow), use a
     \`\`\`mermaid fenced block (flowchart/timeline/stateDiagram-v2). NO ASCII-art. CRITICAL: no
     semicolons in sequenceDiagram message text (breaks the parser — use commas/"then").
   - End with "## Common follow-up questions" and "## References".
   - Accuracy matters (LP wording, ladder definitions, latency numbers) — but this domain is also
     about JUDGMENT: the "correct" MCQ answer is the one that best demonstrates the target signal.

2) questions.yaml — top-level keys:
     topic: "<Topic Name>"
     domain: interview-craft
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001    # unique, zero-padded 3-digit seq; prefix == slug
         difficulty: beginner     # beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options: ["<0>","<1>","<2>","<3>"]
         answer: 2                # 0-BASED index
         explanation: |
           <why the correct answer is right; teach the signal/framework>
         ref: "concepts.md#<anchor>"  # resolves to a real "## " heading (GitHub slug rules)

   RULES: 40-60 questions (min 40); cover EVERY subtopic; 3-5 options, exactly one correct, 0-based
   answer; VARY the correct index (no clustering, no trivially-guessable repeating cycle); mixed
   difficulty; because this is behavioral/judgment content, LEAN HEAVILY on SCENARIO & "which
   response best demonstrates X / which is the strongest answer / what signal does this send"
   questions with plausible distractors (each distractor a realistic-but-weaker answer wrong for a
   real reason — e.g. takes individual credit instead of team, solves the symptom not the cause,
   too junior in scope). AVOID purely-subjective questions with no defensible best answer; anchor
   each to a named framework/signal so the key is defensible. No all/none-of-the-above; every 'ref'
   resolves to a real "## " heading; id prefix == slug.

Use the Write tool. Do your own web research. Return: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'behavioral-star-method', name: 'Behavioral Interviews & the STAR Method', hints: "why behavioral rounds exist (past behavior predicts future; signal not trivia); STAR (Situation/Task/Action/Result) & variants (SAR, CARL, STARL with Learnings); the #1 mistakes — no measurable RESULT, 'we' instead of 'I' (can't tell YOUR contribution), rambling Situation, no conflict/stakes; quantify impact (numbers/metrics/business outcome); the story bank (prepare 6-10 flexible stories mapped to competencies); tailoring one story to multiple questions; recent + relevant + you-were-central; honesty (don't fabricate — follow-up probes expose it); concise Situation, long Action; present-tense trap; the interviewer is taking notes on signals." },
  { slug: 'behavioral-competency-bank', name: 'The Competency Bank: Conflict, Failure, Ambiguity & More', hints: "the recurring competencies interviewers probe & a strong story for each: CONFLICT/disagreement (disagree-and-commit, data over ego, resolved professionally — not 'I was right'), FAILURE/mistake (real failure + ownership + what you learned + how you changed — not a humblebrag or blaming others), dealing with a difficult teammate/manager, tight DEADLINE/pressure, AMBIGUITY (drove clarity), influencing without authority, going above-and-beyond, prioritization trade-off, receiving hard feedback, a project that failed; mapping stories to competencies; the 'tell me about a time you were wrong' trap; showing growth; picking stories with real stakes; avoiding red-flag answers (throwing others under the bus, no self-reflection, no conflict ever)." },
  { slug: 'company-values-and-leadership-principles', name: 'Company Values & Leadership Principles (Amazon LPs et al.)', hints: "why values-based interviewing (culture fit + consistent bar); Amazon's 16 Leadership Principles (Customer Obsession, Ownership, Invent & Simplify, Are Right A Lot, Learn & Be Curious, Hire & Develop the Best, Insist on Highest Standards, Think Big, Bias for Action, Frugality, Earn Trust, Dive Deep, Have Backbone Disagree & Commit, Deliver Results, Strive to be Earth's Best Employer, Success & Scale Bring Broad Responsibility) & the BAR RAISER role; mapping your stories to specific LPs (interviewers assign LPs); the LP-per-question structure; other companies' values (Google, Netflix 'freedom & responsibility', Meta, startups); reading a company's values before the loop; giving an answer that hits the intended value without being robotic; Dive Deep & Ownership as the most-probed; Disagree-and-Commit nuance." },
  { slug: 'hiring-manager-and-project-deep-dive', name: 'Hiring-Manager Round & Project Deep-Dive', hints: "the hiring-manager round's purpose (fit, motivation, seniority calibration, red flags, 'will I want this person on my team'); the PROJECT DEEP-DIVE (pick a project you can go deep on — your role, the hard technical decisions, trade-offs, what you'd do differently, the impact) & why interviewers drill for depth to detect exaggeration; owning your scope honestly (I vs we); why-this-company/why-this-role motivation; handling 'walk me through your resume'; discussing a past architecture end-to-end; showing curiosity & self-awareness; salary/level early signals; questions the HM is really asking; matching seniority to the depth/breadth of your examples." },
  { slug: 'seniority-ladder-and-scope-signals', name: 'The Seniority Ladder & Scope Signals', hints: "engineering ladders (junior -> mid -> senior -> staff -> principal) & what changes at each level — the axis is SCOPE & AUTONOMY & IMPACT, not just years/coding skill; senior = owns a system/project end-to-end, mentors, needs little direction; staff = org-level impact, influences beyond own team, technical strategy; the scope signals interviewers listen for (did you drive it or execute it; team-level vs org-level vs company-level; ambiguity handled; multiplier effect); published ladders (Dropbox, CircleCI, Rent-the-Runway, Gitlab); leveling = matching your STORIES' scope to the target level (under-leveling = stories too small; over-reaching = claiming scope you didn't own); the 'senior IC in a mid interview' calibration; scope > tenure." },
  { slug: 'staff-archetypes-and-impact', name: 'Staff+ Archetypes & Demonstrating Impact', hints: "Will Larson's four Staff Engineer ARCHETYPES — Tech Lead (guides a team's execution), Architect (owns technical direction of a critical area), Solver (dives on the hardest problems), Right Hand (extends a senior leader's capacity); each shows up differently in interviews; demonstrating staff-level IMPACT (multiplier not just individual output; leverage: mentoring, setting technical direction, unblocking others, org-wide standards; 'glue work'); business impact framing (tie tech to $ / users / risk); leading without authority; sponsoring vs mentoring; the staff-project (a big ambiguous cross-team effort you drove); measuring & narrating impact; why staff interviews weigh judgment/influence over coding; StaffEng.com stories." },
  { slug: 'tradeoff-articulation-and-judgment', name: 'Trade-off Articulation & Technical Judgment', hints: "the #1 senior+ signal: showing JUDGMENT by articulating trade-offs, not reciting one right answer; the 'it depends — on X, Y, Z' structure done well (name the axes: cost/latency/complexity/time-to-market/operability/risk, then decide for a stated context) vs the cop-out 'it depends' with no follow-through; making assumptions explicit & stating them; reasoning about non-functional requirements; choosing the boring/simple solution & justifying it (maturity signal); acknowledging what you'd give up; changing your answer when given new constraints (adaptability, not flip-flopping); quantifying where possible; 'what would you do differently' reflection; avoiding over-engineering & résumé-driven design; the 1-way vs 2-way door framing." },
  { slug: 'estimation-and-napkin-math', name: 'Estimation & Napkin Math (Numbers to Know)', hints: "back-of-the-envelope estimation for system-design & 'how many X' questions; the numbers to memorize — LATENCY numbers every engineer should know (L1 ~1ns, L2 ~4ns, RAM ~100ns, SSD read ~16us-150us, network within DC ~0.5ms, disk seek ~1-10ms, CA->NL round trip ~150ms), throughput ballparks; powers of two & data sizes (KB/MB/GB/TB; 2^10 etc.); QPS from DAU (DAU x actions/day / 86400, x peak factor); storage sizing (rows x bytes x retention); bandwidth; the estimation method (state assumptions, round to easy numbers, sanity-check the order of magnitude, show the work); Little's Law (L = λW) for capacity; reads-vs-writes ratio; why interviewers want the METHOD & sanity, not a precise number; common ratios (cache hit rates, read:write)." },
  { slug: 'handling-ambiguity', name: 'Handling Ambiguity & Driving Clarity', hints: "a top senior/staff signal: thriving in under-specified problems; the technique — clarify the goal & constraints FIRST (ask questions, state assumptions, define success) before diving in; scoping an ambiguous problem (break it down, identify unknowns, propose a plan, de-risk the riskiest part first); in interviews: DON'T jump to a solution on a vague prompt — restate, clarify requirements, state assumptions out loud; driving clarity for a team (turning a fuzzy mandate into a concrete plan/doc); making progress under uncertainty (reversible decisions fast, iterate); the behavioral story of a time you were handed something vague and created structure; comfort with 'I don't know yet, here's how I'd find out'; over-clarifying vs under-clarifying balance." },
  { slug: 'mentorship-and-cross-team-influence', name: 'Mentorship, Multiplier Impact & Cross-Team Influence', hints: "the MULTIPLIER effect (senior+ is measured by how much better they make others/the org, not just personal output); mentorship vs SPONSORSHIP (sponsoring = spending your capital to advance someone; mentoring = advice); growing engineers, onboarding, code review as teaching, tech talks, docs; INFLUENCE WITHOUT AUTHORITY (getting other teams/leaders to adopt your approach via data, trust, relationships, writing — not mandate); driving org-wide standards/adoption; navigating disagreement across teams (disagree & commit); glue work & its recognition problem; the behavioral stories that show leverage; building alignment; 'how do you handle a junior making a mistake'; measuring mentorship impact; the difference between a great senior IC and a force-multiplier staff." },
  { slug: 'incident-leadership-behavioral', name: 'Incident Leadership & Blameless Postmortems (Behavioral)', hints: "the BEHAVIORAL/story angle on incidents (the mechanics live in devops/observability — here it's how to TELL it & the leadership signal): a strong incident story = you took ownership, coordinated calmly under pressure, mitigated first then diagnosed, communicated to stakeholders, then drove the blameless postmortem & follow-through; BLAMELESS culture (focus on systems/process not people — the signal of a mature senior); owning YOUR mistake in a postmortem story (accountability without self-flagellation); the incident-commander behavior; what interviewers listen for (calm, ownership, systems-thinking, learning, prevention, communication); the anti-pattern story (blamed someone, panicked, hid it); tying it to Ownership/Dive Deep LPs; 'tell me about a production outage you handled'." },
  { slug: 'design-docs-rfcs-and-adrs', name: 'Design Docs, RFCs & Architecture Decision Records', hints: "engineering WRITING as a senior/staff skill (writing scales your influence); the DESIGN DOC / RFC (problem statement, goals & non-goals, proposed design, alternatives considered + why rejected, trade-offs, risks, rollout, open questions) & why 'alternatives considered' is the section that shows judgment; the review process (async comments, building consensus, disagree-and-commit); ADRs (Architecture Decision Records — lightweight, immutable, one decision each: context/decision/consequences/status, Michael Nygard format) & why record decisions (future-you, onboarding, avoid re-litigating); doc vs ADR vs RFC differences; writing for the audience/skimmability; in interviews: being asked to write or critique a design doc; the 'strong opinions loosely held' + written-argument culture (Amazon 6-pager/narrative, no-slides); clarity as a seniority signal." },
  { slug: 'engineering-strategy-and-prioritization', name: 'Engineering Strategy & Prioritization', hints: "strategy as a staff+ signal (Will Larson: strategy = a document that helps make decisions under uncertainty; diagnosis -> guiding policy -> coherent actions, Rumelt); prioritization frameworks (RICE, ICE, weighted-shortest-job-first, Eisenhower, cost of delay, MoSCoW) & when each; saying NO / managing the backlog / tech-debt-vs-features balance & articulating it; connecting technical work to business outcomes/OKRs; sequencing (de-risk first, thin vertical slices, reversible-first); the behavioral story of driving a strategy or a hard prioritization call; roadmapping; opportunity cost; 'how do you decide what to work on'; balancing short-term delivery vs long-term health; making a build-vs-buy call; quantifying priorities." },
  { slug: 'product-sense-startup-vs-faang', name: 'Product Sense & Startup vs FAANG Interviews', hints: "how PRODUCT/STARTUP loops differ from FAANG: startups value scrappiness, full-stack breadth, ownership/autonomy, product sense, shipping fast, wearing many hats, culture/mission fit, and 'can you build the thing' > algorithmic gymnastics; FAANG = structured loops, heavy DSA + system design + strict LP/behavioral, leveling rigor; PRODUCT SENSE for backend engineers (understanding the user/business, why a feature matters, proposing product-aware technical trade-offs, MVP thinking, metrics/experimentation basics); the take-home/practical bias at startups; smaller-company signals (impact visible, less specialization, comfort with ambiguity & limited resources); tailoring your prep & stories to the company type; equity/comp differences (brief, cross-link negotiation); why 'why our startup' matters more; founder/early-team interviews." },
  { slug: 'take-home-pairing-and-code-review-rounds', name: 'Take-Home Projects, Pairing & Code-Review Rounds', hints: "the APPROACH & communication for non-whiteboard rounds (the algorithms/design live in dsa/lld domains — here it's how to shine): TAKE-HOME — scope to the time-box, prioritize working+tested+readable over feature-complete, write a clear README (assumptions, trade-offs, what you'd do with more time), don't over-engineer, production-minded (tests, error handling, structure); PAIRING/live-coding — think out loud, communicate intent, ask clarifying questions, test incrementally, take hints gracefully, collaborate with the interviewer as a teammate, manage nerves; CODE-REVIEW round (review a PR / spot bugs & smells / give constructive feedback) — what senior reviewers catch (correctness, edge cases, readability, security, tests) & how to give kind+specific feedback; being reviewed graciously; the signals each round tests (pragmatism, communication, craftsmanship)." },
  { slug: 'leveling-negotiation-and-reverse-questions', name: 'Leveling, Negotiation & Reverse Questions', hints: "LEVELING (getting placed at the right level: down-leveling risk, how leveling is decided, aligning your demonstrated scope to target level, asking about level early); OFFER NEGOTIATION basics (comp = base + bonus + equity + sign-on; total-comp thinking; levels.fyi benchmarks; competing offers as leverage; negotiate respectfully & with data; never accept on the spot; the 'what are your expectations' trap — deflect/anchor high; get it in writing; equity nuances RSUs vs options, vesting, refreshers; startups: equity % + dilution + strike price); REVERSE QUESTIONS (the 'any questions for me?' at the end is evaluated — ask thoughtful ones about the team/tech/challenges/growth/how success is measured; questions that signal seniority; red-flag-detecting questions about on-call/tech-debt/attrition; NOT asking is a negative signal); researching the company/interviewer." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a staff-level engineer, hiring manager, and interview coach authoring interview-grade study material for the Interview-Craft topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / frequently-asked subtopics to cover for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . This is Pass 1 — aim for 40-60 solid MCQs, heavy on scenario/judgment questions.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer (staff engineer + experienced interviewer) verifying interview content for the Interview-Craft topic "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `The files are at ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml . Read BOTH.\n\n` +
    `Check and FIX IN PLACE (using Edit/Write) any of:\n` +
    `1) FACTUAL ERRORS — web-research anything checkable (Amazon's 16 LP names/wording + Bar Raiser, STAR/variants, the four Staff archetypes (Tech Lead/Architect/Solver/Right Hand — Larson), ladder scope definitions, the latency numbers, prioritization frameworks RICE/Rumelt, ADR/Nygard format, negotiation/equity facts). A wrong LP name, wrong latency number, or wrong framework detail is a real defect.\n` +
    `2) JUDGMENT QUALITY (critical for this domain): each MCQ's 'correct' answer must be genuinely the STRONGEST/best-signal answer, defensible against a named framework — NOT arbitrary. Distractors must be realistic-but-weaker (junior scope, takes solo credit, blames others, solves symptom, over-engineers) — wrong for a real reason. FIX any question where the 'correct' answer is arbitrary/subjective or a distractor is actually just as good. No purely-opinion questions.\n` +
    `3) SCOPE: keep it behavioral/communication/career craft. If it re-teaches the technical system-design method (system-design/interview-method-scenario-playbooks), coding-round algorithms (dsa/lld), or incident PROCESS mechanics (devops/observability), TRIM to a cross-reference pointer.\n` +
    `4) SCHEMA: valid YAML; top-level keys topic/domain(interview-craft)/topic_slug(${t.slug})/version/questions; ids (prefix '${t.slug}-', unique, 3-digit seq); difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based 'answer' in range; explanation; correct-option position VARIED (rebalance if any index >40% OR a trivially-guessable repeating cycle). Quote any YAML option string with a colon+space or leading brace.\n` +
    `5) Every 'ref: concepts.md#anchor' resolves to a real '## ' heading (GitHub slug rules). Any Mermaid blocks valid — no semicolons in sequenceDiagram message text.\n` +
    `6) COVERAGE: >=40 questions, every subtopic represented, mixed difficulty, HEAVY on scenario/judgment questions. Add if thin.\n\n` +
    `After fixing, return a one-line verdict: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
