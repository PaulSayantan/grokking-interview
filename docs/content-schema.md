# Content Schema & Authoring Spec

This document is the **contract** between the Markdown study library, the MCQ files,
and the web application. Anyone (human or AI) authoring content MUST follow it so the
site can reliably parse questions and link to study material.

## Directory convention

Every topic lives at:

```
topics/<domain-slug>/<topic-slug>/
    concepts.md       # the study/answer content            (REQUIRED)
    questions.yaml    # the MCQs for this topic             (REQUIRED)
    prompts.yaml      # think-prompts + one cliffhanger     (OPTIONAL — see below)
```

- `domain-slug` and `topic-slug` are **kebab-case**, matching the slugs in `TOPICS.md`.
- Slugs are stable identifiers. Do **not** rename a slug once questions reference it.
- **`prompts.yaml` is optional, permanently.** It arrives with a topic's clarity rewrite, and
  that rollout runs one domain at a time, so migrated and un-migrated topics coexist for the
  whole wave. A topic with no `prompts.yaml` is valid — today and after the last domain lands.
  Nothing may be written that requires it to exist.
- No fourth file. Anything else in a topic directory is undocumented and unread.

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
- **Volume: 40–60 questions per topic.** (That was 8–15 when the first four domains were
  authored; the bar rose in 2026-07 and the corpus has long since passed it — the measured
  mean is **61 per topic**, 28,064 across 460 topics. See `docs/corpus-stats.md`, which is
  authoritative for every corpus count. Do not author a new topic to the old figure.)

## `prompts.yaml` — think-prompts and the cliffhanger (OPTIONAL)

The third file in a topic directory. It carries the structured items a clarity rewrite adds
around the prose: **think-prompts** keyed by anchor, and **one cliffhanger** that hands the
reader to the next topic. The prose stays in `concepts.md` — that keeps a rewrite's diff pure
prose, gives every prompt a stable id for reveal state, and needs no fifth callout type.

Authoring rules (how many, what register, how to pick a cliffhanger pattern) live in
`.claude/skills/clarity-standard/SKILL.md`. **This section is the data contract**: field
names, types, whether a field is required, and the exact permitted forms of every pointer.

```yaml
topic: "synchronized, volatile & the Java Memory Model"   # matches concepts.md's H1
domain: java-jvm                                          # == parent-parent folder
topic_slug: synchronized-volatile-jmm                     # == folder name
schema: 1
pass: clarity-v1

# OPTIONAL. Where THIS topic settles the loop the PREVIOUS topic left open (rule K1).
resolves:
  anchor: "concepts.md#cross-process-propagation-via-headers"

prompts:
  - id: synchronized-volatile-jmm-p001      # unique within the DOMAIN
    ref: "concepts.md#visibility-reordering-and-atomicity"
    kind: predict-failure
    tier: A
    prompt: |
      Your teammate declares `stop` volatile, the loop exits, so they apply the same fix
      to a `hits` counter that eight threads increment. Name what still breaks.
    hint: "Count the memory accesses in one `hits++`."
    answer_in: "concepts.md#volatile"

cliffhanger:
  hook: |
    …80–140 words of prose, carrying one concrete artifact…
  teaser_questions:
    - "Who decides how many threads your program is allowed to create?"
  payoff:
    anchor: "concepts.md#executors-factory-methods-and-their-pitfalls"   # in the NEXT topic
    claim: >-
      What was actually read at that anchor, in the un-rewritten destination.
```

### Top-level fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `topic` | yes | string | Human-readable title; matches `concepts.md`'s `# H1`. |
| `domain` | yes | string | Must equal the domain folder name. |
| `topic_slug` | yes | string | Must equal the topic folder name. |
| `schema` | yes | int | `1`. Bump only for a breaking shape change. |
| `pass` | yes | string | Which pass produced this, e.g. `clarity-v1`. |
| `resolves` | no | mapping | `{ anchor: <in-file pointer> }` — the section that pays off the previous topic's loop. |
| `prompts` | no | list | Think-prompts, ≤ **14**. Non-empty when present. |
| `cliffhanger` | no | mapping | Exactly one. Omitted by a partial pass, which produces none. |

Unknown top-level keys are ignored by the renderer and reported as a warning.

### `prompts[]` fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | string | Unique **within its domain** (same convention as question ids, and a separate namespace from them). Format `<topic-slug>-p<3-digit-seq>`. It is the reveal-state key, so it must never be reused or renumbered. |
| `ref` | yes | string | `concepts.md#<anchor>`, resolving in **this** topic. The prompt renders after that section. **At most one prompt per anchor.** |
| `kind` | yes | enum | One of the five below. No others. |
| `tier` | yes | enum | `A`, `B`, `C`, `D` — the closure tier, below. |
| `prompt` | yes | string | The question. **≤ 35 words**, one interrogative. |
| `hint` | no | string | One line, revealed on demand. |
| `answer_in` | see tiers | string | A pointer (forms below), or the literal `external`. |
| `success_criterion` | **tier C only** | string | Mandatory for tier C: what "you have it" looks like. Exempt from the 35-word cap. |
| `answer_shape` | **tier D only** | string | Mandatory for tier D: the two or three dimensions any credible answer must price. Exempt from the cap. |
| `search_hint` | tier C | string | Where to hunt. Expected on tier C; a missing one is a warning. |

**The five kinds** — `predict-failure`, `name-the-price`, `draw-the-boundary`, `refute`,
`notice-in-wild`. Closed set; anything else is an error. (`kind: think` / `kind: research`
appear in one pre-standard sidecar written before this contract existed — those are the old
`prompt_spec` names and must be migrated to a kind + a tier.)

**The four closure tiers**

| Tier | Means | `answer_in` |
|---|---|---|
| `A` | answered later in this same file | required, an **in-file** pointer |
| `B` | answered in another topic | required, a **cross-topic** pointer |
| `C` | answered in a primary source | `external`, plus `search_hint` and a mandatory `success_criterion` |
| `D` | genuinely open | omitted; mandatory `answer_shape` |

A tier whose `answer_in` disagrees with the table still resolves, so it is a warning, not an
error — but fix it: the tier is what the page uses to label the reveal.

### Pointer forms — and the deliberate cross-topic exception

MCQ `ref` fields may only ever point into their **own** folder's `concepts.md`. Prompts are
different on purpose: a think-prompt's answer is often in the topic that comes next, or in the
topic that established the term. So `answer_in`, `resolves.anchor` and `cliffhanger.payoff.anchor`
accept these forms, **and only these**:

| Form | Means | Used by |
|---|---|---|
| `concepts.md#<anchor>` | this topic's own `concepts.md` | `ref` (only form), `resolves.anchor`, tier-A `answer_in` |
| `<domain>/<slug>#<anchor>` | another topic's `concepts.md` — any domain | tier-B `answer_in`, a finale payoff |
| `/study/<domain>/<slug>#<anchor>` | the same thing, spelled as the site URL | accepted, equivalent |
| `external` | no anchor at all; a primary-source hunt | tier-C `answer_in` |

Every form is resolved and **every dangling anchor is a hard error**, including cross-topic
ones (the real example points at
`observability/structured-logging-and-log-levels#correlation--trace-ids-in-logs-mdc`). Anchors
are slugified exactly as concepts.md anchors are, fence-aware.

`cliffhanger.payoff.anchor` has one extra rule: **the relative form is relative to the NEXT
topic, never to this one.** The next topic is computed from the domain README's row order (see
"Learning order" below), never authored. On the **last topic of a domain** there is no next
topic, so a relative anchor is an error there and a finale must name its destination in the
`<domain>/<slug>#<anchor>` form.

### `cliffhanger` fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `hook` | yes | string | 80–140 words of **prose**, excluding any code artifact; no prose sentence over 25 words; ≤1 em-dash; no exclamation marks; no trailer language. Must not name the next topic's title or link to it. |
| `teaser_questions` | no | list of strings | 1–3. More is a warning. |
| `payoff.anchor` | yes | string | Where the loop is paid off (forms above). |
| `payoff.claim` | yes | string | What you actually read at that anchor in the destination — the evidence the payoff is real. |

The hook's form limits are **warnings**; the payoff resolving is an **error**. One broken
payoff teaches readers to skip all 459 others.

### Learning order — one definition, three consumers

A topic's position in its domain comes from the **domain README's table rows** (the first
backticked slug in each row). `system-design` is additionally grouped by slug prefix, so its
order is group-major (`core`, `advanced`, `patterns`, `architecture`, `ccp`, `aws`, `cdp`),
README-minor. That single sequence is implemented three times and the three MUST agree:

- `readReadmeOrder` + `sdGroupKey` in `web/scripts/sync-content.mjs` (build),
- `getDomainSequence` in `web/src/lib/catalog.ts` (the study pager),
- `reading_order()` in `scripts/validate_content.py` (the payoff check, and
  `scripts/continuity_check.py` imports it).

Change one and change all three. It is why a cliffhanger never spells its destination: the
pager and the cliffhanger read the same list, so a README reorder needs no content edit.

### Generated shape — what the study page reads

`sync-content.mjs` inlines the sidecar into the generated concept entry's **frontmatter**,
under the key `prompts`, as one line of JSON (YAML is a JSON superset, so no escaping is
hand-rolled). It is typed by `promptsSidecar` in `web/src/content.config.ts` and reached as
`entry.data.prompts`. There is no separate JSON file and nothing to fetch: prompts render in
the static HTML.

**Naming rule:** authored fields keep their YAML names verbatim (`answer_in`,
`success_criterion`, `teaser_questions`); every field sync *computes* is camelCase. The one
rename is the list — YAML's `prompts:` becomes `items`, so the frontmatter key `prompts`
holds the whole sidecar rather than nesting `prompts.prompts`.

```jsonc
{
  "schema": 1,
  "pass": "clarity-v1",
  "resolves": { "anchor": "concepts.md#…", "href": "/study/<d>/<s>#…" },   // optional
  "items": [
    {
      "id": "synchronized-volatile-jmm-p001",
      "ref": "concepts.md#visibility-reordering-and-atomicity",
      "kind": "predict-failure",
      "tier": "A",
      "prompt": "Your teammate declares `stop` volatile, …",
      "hint": "Count the memory accesses in one `hits++`.",   // optional
      "answer_in": "concepts.md#volatile",                    // optional, verbatim
      "refHref": "/study/java-jvm/synchronized-volatile-jmm#visibility-reordering-and-atomicity",
      "answerHref": "/study/java-jvm/synchronized-volatile-jmm#volatile"  // null when external
      // success_criterion / answer_shape / search_hint appear verbatim when authored
    }
  ],
  "cliffhanger": {                                            // optional
    "hook": "…",
    "teaser_questions": ["…"],
    "payoff": { "anchor": "concepts.md#executors-factory-methods-and-their-pitfalls", "claim": "…" },
    "nextTopic": {                                            // null on a domain's LAST topic
      "domain": "java-jvm",
      "slug": "executor-framework-concurrency-utils",
      "title": "Executor Framework and java.util.concurrent",
      "href": "/study/java-jvm/executor-framework-concurrency-utils"
    },
    "payoffHref": "/study/java-jvm/executor-framework-concurrency-utils#executors-factory-methods-and-their-pitfalls"
  }
}
```

Notes for anyone rendering it:

- **`prompts` is absent** on every un-migrated topic. Branch on it; never assume it.
- `nextTopic` and `payoffHref` are **null on the last topic of a domain** — a finale
  cliffhanger with an explicit destination still gets a `payoffHref`, but `nextTopic` stays
  null. Handle both.
- `refHref` / `answerHref` are `null` when a pointer does not resolve. That state is a hard
  validator error, so it cannot reach `main`; the nullability exists so a bad local edit
  degrades to a missing link instead of a build crash.
- The frontmatter, the question JSON and `catalog.json` are all **generated and gitignored**.
  Never hand-edit them, and never commit them.

## Validation

`python3 scripts/validate_content.py` is the **gate**. It checks every `questions.yaml`
against this schema (unique ids, valid answer index, option count, ref anchors resolve), the
structure of every `concepts.md` (one `# H1`, no empty heading text, no two headings that
slugify to the same anchor), and every `prompts.yaml` that exists. It exits non-zero on any
error and CI runs it. Warnings (prose-shaped budgets, and any check that could not run) are
printed and never change the exit code.

`python3 scripts/validate_content.py --check-lock` additionally verifies `topics/.anchors.lock`:
new headings pass, but a **renamed, re-levelled or deleted** heading fails, because ~28k MCQ
`ref` fields deep-link them and editing refs in lockstep would hide the breakage.

For the prompts sidecar specifically, the split is:

| Hard error | Warning |
|---|---|
| YAML does not parse; missing required field; `domain`/`topic_slug` disagree with the folder | Unknown key; `id` not matching `<topic-slug>-pNNN` |
| Duplicate prompt `id` in the domain; missing `id` | Prompt body over 35 words |
| `kind` or `tier` outside its set; tier C with no `success_criterion`; tier D with no `answer_shape` | Tier C with no `search_hint`; a tier whose `answer_in` form disagrees with the tier but still resolves |
| More than 14 prompts; two prompts on one anchor | Cliffhanger word/sentence/em-dash/hype-string limits; >3 teaser questions; missing `payoff.claim` |
| Any dangling pointer (`ref`, `answer_in`, `resolves.anchor`, `payoff.anchor`) | A payoff that resolves in a real topic but is **no longer the next one** — a README reordered mid-wave must not fail two untouched files |

`scripts/continuity_check.py` checks the per-domain ledgers in `docs/continuity/` (see the
README there). It is the same shape of gate: mechanical shape errors fail, prose greps warn.

**`web/scripts/sync-content.mjs` is NOT a gate.** It reads whatever is in `topics/` and never
refuses a build: a malformed `prompts.yaml` is warned about and dropped (so the topic renders
without prompts), and a subtopic missing from its README is warned about and sorted to the end.
Run the validator — the sync step will not catch it for you.
