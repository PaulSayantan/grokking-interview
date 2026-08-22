---
name: refining-content
description: Refine an EXISTING topic's concepts.md to a great-teacher, senior-interview bar — add intuition-first openers, worked examples, reasoned trade-offs, gotchas/follow-ups, define jargon, fix self-contradictions, and verify drifting facts. Use when the user wants to improve, deepen, de-jargon, add examples to, or fix errors in study material for a topic that already exists (as opposed to authoring a brand-new topic — use authoring-content for that).
---

# Refining interview study content

Use this to **improve an existing** `concepts.md` so a motivated student finishes it with
**zero doubt** and an interviewer would judge the answer senior-grade. This is the
companion to `authoring-content` (which creates new topics). The authoritative data
contract is still `docs/content-schema.md`.

> [!WARNING]
> **Not the right skill for a clarity wave.** If the task is to make a topic *easier to read*
> — plainer sentences, an accessible on-ramp into expert depth, think-prompts, a cliffhanger
> — stop and use **`clarity-standard`** instead. That skill rewrites prose top to bottom at
> zero information loss and owns the `prompts.yaml` sidecar; this one deliberately does not.
> Running both on the same file produces opposite edits.
>
> Use `refining-content` for what it is good at: a one-off fix to a topic that is *not* in a
> clarity wave — a wrong fact, a missing worked example, an undefined term, a stale version.

> [!KEY-TAKEAWAY]
> Refinement is **additive and surgical**, not a rewrite. Preserve the author's voice,
> structure, and stable `## H2` anchors. Add what's missing; fix what's wrong; don't churn
> what already works.
>
> Scope note: "most of this corpus is already strong" was measured on correctness, depth, and
> examples — not on how plainly it reads. See the superseding note in
> `topics/CONTENT-AUDIT-MASTER.md`.

## The refinement standard (the bar every refined file must hit)

A file is "done" when all seven hold. They are ordered by weight — 1–4 are the priorities.

1. **Intuition-first opener.** Every hard concept LEADS with a plain-language mental model,
   analogy, or "why does this exist / what breaks without it" — *before* any formalism,
   definition, notation, or code. If a section opens with a definition, add a
   one-paragraph intuition above it.

2. **A worked example per hard concept.** For each genuinely hard idea, show a concrete
   **numbers-in → numbers-out** (or bytes-in→bytes-out, or step-by-step interleaving)
   trace: plug in real inputs, show intermediate state, produce the output. A code
   *template* or a restatement in prose does **not** count — the reader must be able to
   follow the actual computation. This is the single highest-leverage fix corpus-wide.
   Examples: trace `base62(125)` digit by digit; walk a HashMap resize (hash → index →
   rehash) with real keys; interleave two threads to show the race; compute an error
   budget from real request counts; trace n=4 N-Queens with the prune firing.

3. **Reasoned trade-offs.** State the alternatives and *why* you'd pick one, with the
   condition that flips the decision — "you gain X, you give up Y, pick it when Z." Never
   a bare feature list. If trade-offs are listed as bullets, add the reasoning.

4. **A follow-ups / gotchas layer.** Add the senior "what if it goes sideways" turn: edge
   cases, failure modes, and the follow-up questions an interviewer asks when they probe
   deeper. Prefer a short `## Common follow-ups` or `## Gotchas` section, or `> [!INTERVIEW]`
   callouts inline.

5. **Defined jargon.** Every load-bearing term-of-art is defined at first use; every named
   mechanism is either taught or explicitly linked to the section that teaches it. No
   "named-but-never-taught" (e.g. CAS, happens-before, consistent hashing, LSM-tree, saga/
   outbox, keepalive, varint) — expand acronyms on first use.

6. **Self-consistent structure.** Code skeletons must not contradict their own prose (a
   skeleton must not demonstrate the exact bug the text warns against); diagrams, API
   signatures, and data models must agree with each other and with the narrative; numbers
   stated in multiple places must match. Add a mermaid diagram where a concept is
   inherently spatial/sequential (filter chains, state machines, request lifecycles,
   topologies, saga flows) — the repo has a working mermaid render pipeline.

7. **Verified facts.** Version numbers, service limits, pricing, defaults, and spec
   citations must be current and correct. Anything version/limit/pricing/spec-shaped is
   **web-verifiable** — see below.

## Two kinds of correctness bug (handle differently)

- **Pure-logic / self-consistency bug** — wrong arithmetic, illegal code, a skeleton that
  contradicts its prose, mismatched numbers across sections, an off-by-one. **Fixable from
  the content alone — no web needed.** Reason it out and correct it; if a code sample is
  wrong, fix the code AND the surrounding claim so they agree.
- **Fact-drift bug** — a version/limit/pricing/spec/statistic asserted from memory that may
  be stale or fabricated (e.g. a made-up RFC number, a forward-dated GA version, a changed
  service quota). **Verify on the web before changing the number.** If you cannot confirm a
  precise value, soften to a correct range and note the mechanism, rather than asserting a
  wrong precise number.

## Web verification (do it in a batch, cite it)

When a topic has fact-drift flags, verify with `WebSearch`/`WebFetch` against authoritative
sources (official docs, RFCs/IETF, release notes, the vendor's own pricing/limits pages —
NOT SEO blogs). Prefer primary sources. Batch the checks for a topic together rather than
one search per claim. When you correct or confirm a fact, add/refresh a source in the
topic's `## References` (or an inline link) so the claim is traceable. Do not invent
citations — if the standard is still a draft, say "IETF draft", not a fake RFC number.

## Steps

1. **Read the audit finding** for this subtopic if one exists: the per-subtopic JSON in the
   audit cache (`~/.claude/projects/.../audit-cache/<domain>__<slug>.json`) lists concrete
   `issues[]` with `where`/`detail`/`fix` and a `needs_web_verification` flag. If no audit
   exists, self-audit against the seven-point standard above.
2. **Read the whole `concepts.md`.** Understand the author's structure and voice first.
3. **Fix correctness first** (both kinds) — a wrong statement costs more credibility than a
   missing example. Web-verify fact-drift items; reason out pure-logic ones.
4. **Fill the weighted gaps** in priority order: missing intuition openers → worked examples
   → trade-off reasoning → gotchas/follow-ups → jargon definitions → structural
   self-consistency + diagrams.
5. **Preserve anchors.** Do NOT rename or delete a `## H2` that MCQs may reference. You may
   add new `## H2`/`### H3` sections. If you add a subtopic worth testing, consider adding
   an MCQ (see `authoring-content`) — but never break an existing `ref: concepts.md#anchor`.
6. **Callouts, sparingly.** Use the 4 recognized markers only — `> [!TIP]`, `> [!WARNING]`,
   `> [!INTERVIEW]`, `> [!KEY-TAKEAWAY]` (marker alone on the blockquote's first line). 1–3
   per file; don't over-decorate.
7. **Validate:** run `python scripts/validate_content.py` — must pass (it checks the sibling
   `questions.yaml` and that every `ref` anchor still resolves; a renamed/removed heading
   will fail here).
8. **Self-verify the edit** before declaring done — re-read your changes adversarially:
   Did I introduce a NEW wrong claim? Does my worked example actually compute to the answer
   I wrote? Do my edits contradict another section? Is every new term defined?
9. **Update progress:** note the refinement in `ROADMAP.md` and Claude memory per the repo
   `CLAUDE.md` end-of-session rule.

## Quality bar (self-check)

- A student with no prior exposure could read the section and *explain it back*, not just
  recognize the words.
- Every worked example's output is correct — verify the arithmetic yourself.
- Every trade-off says *when* to choose each side, not just what each is.
- No new jargon left undefined; no new fact left unverified.
- The file is internally consistent: code ↔ prose ↔ diagram ↔ numbers all agree.

## Scaling with a workflow (optional, user opt-in only)

For refining many topics at once, a `Workflow` can pipeline over subtopics: one agent
refines a `concepts.md` (reading its audit-cache finding), a second adversarially verifies
the edit (no new bugs, examples compute, facts hold, anchors intact) and runs the validator.
Use a **durable per-file cache/marker** so an API/network outage mid-run is recoverable and
retries are additive. One agent edits exactly one file, so parallel in-place edits are safe
(distinct files — no worktree isolation needed). Only orchestrate if the user opts in.
