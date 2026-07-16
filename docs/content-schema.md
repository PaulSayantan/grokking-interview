# Content Schema & Authoring Spec

This document is the **contract** between the Markdown study library, the MCQ files,
and the web application. Anyone (human or AI) authoring content MUST follow it so the
site can reliably parse questions and link to study material.

## Directory convention

Every topic lives at:

```
topics/<domain-slug>/<topic-slug>/
    concepts.md       # the study/answer content
    questions.yaml    # the MCQs for this topic
```

- `domain-slug` and `topic-slug` are **kebab-case**, matching the slugs in `TOPICS.md`.
- Slugs are stable identifiers. Do **not** rename a slug once questions reference it.

## `concepts.md` — study content

- Starts with an `# H1` title = the topic name.
- Uses `## H2` per subtopic. Each `## H2` is an **anchor target** for MCQs.
- Keep headings stable; the `ref` field in questions points at these anchors.
- Anchor format (GitHub style): lowercase, spaces → `-`, punctuation stripped.
  e.g. `## Copy-on-Write layers` → `concepts.md#copy-on-write-layers`.
- Write real, interview-grade answers: definitions, why it matters, trade-offs,
  common follow-ups, and gotchas. Prefer clarity over length.

## `questions.yaml` — MCQs

Top-level keys:

```yaml
topic: "Docker Images & Layers"        # human-readable, matches concepts.md H1
domain: docker                          # domain slug
topic_slug: images-and-layers           # topic slug (folder name)
version: 1                              # bump on structural changes
questions:
  - id: docker-images-001              # globally unique, <topic>-<seq>
    difficulty: intermediate            # beginner | intermediate | advanced
    tags: [images, layers, build-cache] # freeform, for filtering
    question: |
      What is the primary benefit of ordering Dockerfile instructions
      from least- to most-frequently changing?
    options:
      - "Smaller final image size"
      - "Better build-cache reuse across rebuilds"      # correct
      - "Faster container startup time"
      - "Automatic multi-arch builds"
    answer: 1                           # 0-based index into options
    explanation: |
      Docker caches each layer. Instructions that change rarely (installing
      dependencies) should come before ones that change often (copying source),
      so the cache is reused and only later layers rebuild.
    ref: "concepts.md#build-cache"      # optional deep-link into study content
```

### Field rules

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique **within its domain**. Format `<topic-slug>-<3-digit-seq>`. (Two different domains may reuse a topic-slug — e.g. `spring-boot` and `spring-core` both have `configuration-profiles-properties` — so ids collide across domains but not within one; the domain folder disambiguates.) |
| `difficulty` | yes | One of `beginner`, `intermediate`, `advanced`, `expert`. `expert` = deep internals, tricky edge cases, and senior/staff-level scenario questions. |
| `tags` | no | Lowercase kebab tokens; used for cross-topic filtering. |
| `question` | yes | The prompt. Multi-line ok (use `|`). |
| `options` | yes | 3–5 options. Exactly one correct (single-answer MCQ v1). |
| `answer` | yes | 0-based index of the correct option. |
| `explanation` | yes | Why the answer is correct; teach, don't just assert. |
| `ref` | no | `concepts.md#anchor` deep-link for "Learn more". |

### Authoring rules of thumb

- **One clearly correct answer.** Distractors should be plausible but wrong for a
  reason you could explain.
- **No "all of the above"** style options — they don't teach well.
- Randomize which position the correct answer sits in across a file (don't always
  make it option B).
- Keep each question self-contained; don't rely on the previous question's context.
- Aim for **8–15 questions per topic** initially; grow over time.

## Validation

`scripts/validate_content.py` checks every `questions.yaml` against this schema
(unique ids, valid answer index, options count, ref anchors resolve). Run it before
committing new content. The web app's content sync refuses to build a file that fails validation.
