# Clarity standard — a filled-in continuity ledger

> **This file is ILLUSTRATIVE, not normative.** The ledger's required field set and every rule
> about how each field is maintained — what is append-only, what is overwritten, what is capped
> and when compaction runs — live in `../SKILL.md`, stated there exactly once. Nothing here
> creates, modifies or relaxes a requirement; the YAML below is one domain's ledger part-way
> through a wave, shown so you can see the shapes. If a sentence here could be quoted to settle
> a dispute about what an author has to do, it belongs in `../SKILL.md` instead.

---

## `docs/continuity/docker.yaml`, mid-wave

```yaml
domain: docker
schema: 1
pass: clarity-v1
reading_order_source: "topics/docker/README.md"   # the domain README, re-derived each run
position: 4                                       # 3 done; next is entrypoint-vs-cmd

# Written in Pass 0 from every un-rewritten file's headings and opening prose.
# This is what makes a forward cliffhanger possible.
plan:
  - { slug: dockerfile-layers-build-cache, covers: "Instruction->layer mapping; cache key +
      invalidation; ordering; build context; layer additivity and size." }
  - { slug: entrypoint-vs-cmd, covers: "CMD vs ENTRYPOINT; exec vs shell form; PID 1 and
      SIGTERM; entrypoint scripts; STOPSIGNAL/tini." }

# One entry per term the domain has committed to. The gloss and banned_variants fields are
# what K2's check reads, so an archival rule that stripped them would break the check.
canonical_terms:
  layer: { canonical: "layer", defined_in: dockerfile-layers-build-cache,
           gloss: "a filesystem changeset plus metadata, content-addressed by digest",
           banned_variants: ["diff", "slice"] }

running_example:
  name: "the 1.2 GB Node API"
  established_in: images-vs-containers
  state: "Express API, npm ci, COPY . . above the install, 1.2 GB image, 4-minute rebuilds.
          Shrunk to 90 MB in multi-stage-builds (topic 5).
          Numbers may be EXTENDED, never silently changed."

claims_established:
  - "Only RUN, COPY and ADD create filesystem layers; everything else is metadata."
  - "A cache miss on one instruction busts that instruction and every one after it."

approximations_open:
  - { id: APPROX-1, from: images-vs-containers, text: "\"a container is just a process\"",
      correction_owed_by: runtimes-oci-standards }

known_defects:            # pre-existing defects this pass did not create and did not fix
  - { file: images-vs-containers,
      note: "opener's byte figures disagree with the layer table; table is canon (an MCQ cites it)" }

owed:                     # debts this pass created and could not close
                          # `file` names who has to close it — that is how it reaches them
  - { file: dockerfile-layers-build-cache, from: images-vs-containers,
      kind: c8-bold-collision, token: "layer",
      note: "also bolded at line 219, outside the rewritten scope; ours is the teaching site" }
  - { file: dockerfile-layers-build-cache, from: dockerfile-layers-build-cache,
      kind: c9-unsourced-condition,
      note: "kept 'on some drivers'; the condition is not in the docs. Routed to prompt p004 (tier C)" }

exemptions:               # per-file rule exemptions, with the reason. Mostly C9.
  - { file: build-context-and-dockerignore, rule: C9,
      terms: ["context"], reason: "the topic is about build context; density is the subject" }

open_cliffhanger:
  from: dockerfile-layers-build-cache
  to_position: 4
  pattern: A
  key_noun_for_K1_grep: "PID 1"
  gap: "A correct image can still hang for ten seconds on docker stop, because the last
        line made a shell PID 1."
  payoff_anchor: "concepts.md#the-pid-1-sigterm-problem-with-shell-form"
  verified_present: true                          # checked against the UN-rewritten topic 4

topics:
  - { position: 3, slug: dockerfile-layers-build-cache, commit: abc1234,
      one_liner: "established layer/build-cache/build-context/cache-key; owns the 1.2 GB Node API",
      reading_minutes: { before: 20, after: 27 }, factlines: { emitted: 3, verified: 3 },
      adversarial_signoff: true }
```

---

## What the shapes are doing

`plan[]` is the only forward-looking part, and it is written before topic 1 from headings and
openers alone. That is why a cliffhanger authored at topic 3 can name a gap topic 4 genuinely
closes without anyone having read topic 4's prose.

`owed[]` is keyed by the file that has to close the debt rather than the file that created it.
That inversion is the delivery mechanism: a writer loading the slices for topic N receives every
debt anyone else left for topic N, without reading anything else.

`known_defects[]` and `owed[]` are different objects on purpose. The first records something that
was already broken and was left alone; the second records something this pass caused. Filing a
created debt as a known defect is how a regression becomes invisible — the C8 bold collision on
`visibility` in the calibration run is exactly the case, and recording it under `owed` is what
made it a tracked debt rather than a silent one.

`running_example.state` reads as prose because it is carried forward verbatim into the next
topic's reasoning. Extending it ("shrunk to 90 MB in topic 5") keeps the arithmetic honest;
quietly changing 1.2 GB to 1.4 GB two topics later is the failure it guards against.

`topics[]` doubles as the durable per-file completion marker, which is why an interrupted wave
resumes additively: read `position`, read the last entries, and a finished topic is never
rewritten twice.
