---
name: authoring-content
description: Author interview study content (concepts.md) and MCQs (questions.yaml) for a topic in this learner's-library repo. Use when the user wants to add, expand, or fix study material or practice questions for any domain/topic listed in TOPICS.md.
---

# Authoring interview content

Use this to add or expand a topic's study material and practice questions. The
authoritative contract is `docs/content-schema.md` — read it first if unsure.

## Before you start
1. Read `ROADMAP.md` "Content progress" to pick a topic that isn't done, or use the
   topic the user named. Confirm its `domain-slug` / `topic-slug` from `TOPICS.md`.
2. Read `TOPICS.md` for that topic's subtopics and sample questions — they seed both
   files.

## Steps
1. **Create the folder:** `topics/<domain-slug>/<topic-slug>/`.
2. **Write `concepts.md`:** start from `content-templates/concepts.template.md`.
   - `# H1` = topic name (matches TOPICS.md).
   - One `## H2` per subtopic (these become MCQ anchor targets — keep them stable).
   - Interview-grade answers: definition, why it matters, trade-offs, gotchas,
     common follow-ups. Accuracy matters — verify claims; use WebSearch for anything
     uncertain, especially version-specific behavior.
   - Optionally emphasize with callout blocks using GitHub-alert syntax — exactly
     4 types: `> [!TIP]`, `> [!WARNING]`, `> [!INTERVIEW]`, `> [!KEY-TAKEAWAY]`
     (marker on its own first line, body on following `>` lines). Rendered as
     colored boxes on the study page. Don't overuse — 1–3 per topic. See
     `content-templates/concepts.template.md` and `docs/content-schema.md`.
3. **Write `questions.yaml`:** start from `content-templates/questions.template.yaml`.
   - 8–15 MCQs, `id` = `<topic-slug>-NNN`, `answer` is a **0-based** index.
   - Vary the correct option's position; write plausible distractors.
   - Set `ref: concepts.md#<anchor>` to deep-link the study section.
   - Mix difficulties (beginner → advanced).
4. **Validate:** `python scripts/validate_content.py` — fix all errors.
5. **Update progress:** tick the topic in `ROADMAP.md` "Content progress" and add a
   session-log entry. Update Claude memory (see repo `CLAUDE.md`).

## Quality bar
- Every question teaches something; the `explanation` justifies the answer.
- No trick questions, no "all/none of the above".
- Content is factually correct and current — cite sources in concepts.md References.

## Scaling with a workflow (optional)
For authoring many topics at once, a `Workflow` can pipeline over topics: one agent
drafts concepts.md + questions.yaml per topic, a second verifies factual accuracy and
schema compliance. Only do this if the user opts into multi-agent orchestration.
