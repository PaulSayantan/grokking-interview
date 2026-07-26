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

### Callout blocks

Use GitHub-alert-style blockquotes for emphasis. EXACTLY four case-sensitive
types are recognized; the marker must be the blockquote's first line:

| Marker | Rendered as |
|---|---|
| `> [!TIP]` | Tip (teal) |
| `> [!WARNING]` | Warning (amber) |
| `> [!INTERVIEW]` | Interview (violet) |
| `> [!KEY-TAKEAWAY]` | Key takeaway (blue) |

Example:

```md
> [!WARNING]
> `synchronized` pins virtual threads on JDK 21.
```

Any other/absent marker renders as a plain blockquote. Body supports normal
markdown.

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
| `type` | no | `single` (default) or `multi`. Omit for ordinary single-answer questions. See **Question types** below. |
| `tags` | no | Lowercase kebab tokens; used for cross-topic filtering. |
| `question` | yes | The prompt. Multi-line ok (use `|`). |
| `options` | yes | 3–5 options. For `single`: exactly one correct. For `multi`: ≥1 correct **and** ≥1 incorrect (never all-correct). |
| `answer` | yes (single only) | 0-based index of the correct option. Present on `single` questions only. |
| `answers` | yes (multi only) | List of 0-based indices of the correct options (≥1, and fewer than the option count). Present on `multi` questions only; replaces `answer`. |
| `explanation` | yes | Why the answer is correct; teach, don't just assert. |
| `ref` | no | `concepts.md#anchor` deep-link for "Learn more". |

### Question types (`single` vs `multi`)

- **`single`** (default, and the shape of ~all existing questions) — exactly one correct
  option, addressed by `answer`. If `type` is omitted the question is `single`. Do **not**
  add an `answers` field to a single question.
- **`multi`** — "select all that apply" (SATA). Uses `answers: [i, j, …]` instead of
  `answer`. **Scoring is all-or-nothing**: the learner is correct only if they select
  *every* correct option and *no* incorrect one — so a `multi` question stays a binary
  right/wrong for streaks, mastery, and spaced-repetition (no partial credit). Constraints:
  at least one correct option **and** at least one distractor (a SATA question where every
  option is correct teaches nothing and is rejected by the validator).

```yaml
  - id: aws-saas-isolation-patterns-071
    difficulty: advanced
    type: multi
    tags: [isolation, trade-offs]
    question: |
      Which of the following are TRUE of the account-per-tenant (silo) isolation model
      on AWS? Select all that apply.
    options:
      - "It gives each tenant the smallest possible blast radius"        # correct
      - "It forfeits cross-tenant volume discounts and raises per-tenant cost"  # correct
      - "It is the cheapest model to operate at thousands of tenants"    # wrong
      - "Per-tenant billing falls out naturally from the account boundary"  # correct
    answers: [0, 1, 3]
    explanation: |
      Silo maximizes isolation (blast radius = one tenant) and yields native per-account
      billing, but you lose pooling economies and pay for a full stack per tenant — so it
      is the *most* expensive, not the cheapest, at high tenant counts.
    ref: "concepts.md#account-per-tenant-the-full-silo"
```

### Authoring rules of thumb

- **One clearly correct answer** for `single` questions; for `multi`, each correct option
  must be independently, defensibly true and each distractor independently false.
  Distractors should be plausible but wrong for a reason you could explain.
- **No "all of the above" / "none of the above"** style options — they don't teach well,
  and a `multi` question exists precisely so you don't need them.
- Randomize which position the correct answer sits in across a file (don't always
  make it option B).
- Keep each question self-contained; don't rely on the previous question's context.
- Aim for **8–15 questions per topic** initially; grow over time.

## Validation

`scripts/validate_content.py` checks every `questions.yaml` against this schema
(unique ids, valid answer index, options count, ref anchors resolve). Run it before
committing new content. The web app's content sync refuses to build a file that fails validation.
