# Docker clarity pilot — the live run plan

**This file is the plan of record.** It is on disk on purpose: an 8-hour autonomous run will
very likely cross a context compaction, and a plan held only in conversation would not survive
that. Update the status table after **every** topic, and log every deviation. If you are a fresh
context reading this: this file plus `docs/continuity/docker.yaml` (`position` + `topics[]`) is
everything you need to resume.

- **Branch: `clarity-pilot-docker`. Never `main`.** The user's standing instruction for this run
  is *do not commit anything to main.* Per-topic commits on the pilot branch are expected and are
  the durable completion markers. **Run `git branch --show-current` before every commit.**
- Standard: `.claude/skills/clarity-standard/SKILL.md`. Loop: `clarity-pilot-topic.mjs`.
- Rate to date: topic 1 ~62 min, topic 2 ~71 min. Plan on **70 min/topic** including landing.

## Status

| # | Slug | Workflow | Landed | Δ words | punt | Notes |
|---|---|---|---|---|---|---|
| 1 | images-vs-containers | ✅ | ✅ `?` | +60.8% | 0 | pre-C12 |
| 2 | container-lifecycle | ✅ | ✅ `0580baf` | +98.8% | 0 | pre-C12 |
| 3 | dockerfile-layers-build-cache | ✅ | ✅ `57c43d7` | +134% | 0 | first under C12 — rule validated; 3 blockers + 2 highs + 6 fact fixes caught; 89 min |
| 4 | entrypoint-vs-cmd | — | — | — | — | payoff anchor has a DOUBLE hyphen (see ledger note) |
| 5 | multi-stage-builds-image-optimization | — | — | — | — | ledger compaction due after this one |
| 6 | volumes-and-storage | — | — | — | — | |
| 7 | docker-networking | — | — | — | — | |
| 8 | docker-compose | — | — | — | — | |
| 9 | registries-and-distribution | — | — | — | — | |
| 10–16 | … | — | — | — | — | beyond this run's horizon |

**Target: topics 3–9 (7). Realistic base: 3–7 (5).** Under-promise; the gates are not negotiable
and the topic count is what flexes.

## The per-topic cycle

1. **Run** `Workflow({scriptPath: ".claude/workflows/scripts/clarity-pilot-topic.mjs",
   args: {slug, position: N, out: "/tmp/pilot/NN-slug"}})` — ~45–55 min.
2. **Land it** (~15 min). Agents never touch `topics/`; the orchestrator owns what lands:
   - stage `final-concepts.md` → `topics/docker/<slug>/concepts.md`, `final-prompts.yaml` → `prompts.yaml`
   - `python3 scripts/validate_content.py` and `--check-lock` (**additions only**)
   - `python3 scripts/rewrite_audit.py --base HEAD --file topics/docker/<slug>/concepts.md`
   - any HARD finding → sign off in `docs/verified-facts.yaml` `loss_allowlist` **with a written
     reason**, or send it back. Never silence it.
   - merge `final-ledger-append.yaml` into `docs/continuity/docker.yaml` — **exact key names, no
     `_append`/`_close` suffixes** (topic 2 invented them and only `position` merged)
   - `python3 scripts/continuity_check.py`
   - `python3 scripts/clarity_report.py --file <path>` → record Δ words, reading minutes,
     `c12_punt_hits`
   - `cd web && npm run check && npm test && npm run build`
   - commit content + ledger **together**, machinery separately
3. **Record**: update the table above, then the next topic.

## Checkpoints

- **After topic 3 — the C12 validation checkpoint. Do not skip.** C12 is brand new and topic 3 is
  its first live use. Read the rewrite myself, not just the agents' reports, and answer: did the
  closure ladder find real gaps or produce theatre? Did growth stay proportionate to closed gaps?
  Did the verifier's independent ladder disagree with the writer's? **If C12 is wrong, fix
  `SKILL.md` before topic 4** — propagating a bad rule across 7 topics is the expensive failure.
- **After topic 5** — rolling ledger compaction (the multiple-of-5 rule): compress topics 1–5's
  claims into ≤5 domain-level claims.
- **Every 2 topics** — update memory `clarity-effort.md`.
- **End of run** — `ROADMAP.md` session entry, memory, and a reviewer-facing summary at
  `.claude/workflows/REVIEW-docker-pilot.md` so the user can review efficiently.

## Pre-committed decision rules (so no decision waits on the user)

| If | Then |
|---|---|
| Workflow dies on network / watchdog | Verify connectivity, confirm `brief.md` is complete, retry **once** with `args.skipBrief: true`. Two deaths in the same phase is a signal — diagnose before a third attempt. |
| A gate fails | Fix the cause. **Never** edit `.anchors.lock`, never loosen a validator, never `--no-verify`. |
| `rewrite_audit` HARD finding | Read it. Allowlist only with a written reason I actually believe. Cannot justify it → back to a repair agent. |
| An H2 would need renaming | Refuse. Add an H3 instead. This is build-breaking and 28,064 MCQ refs depend on it. |
| Verifier blocker I cannot resolve in one repair round | Re-run the repair agent with **that blocker as its only task, up to 2 more rounds.** Still unresolved → restore the hedge, log it in the ledger's `owed`, flag it in the review doc, keep moving. Nothing false ships and the run does not stall on one disputed sentence. |
| Running behind | **Cut topics, never steps.** A half-gated topic is worse than a missing one. |
| Context nears 89% | Finish the current landing, update this file + memory + ROADMAP, then stop cleanly. |
| Tempted to merge to main | No. Not this run, and not partially — topic N's cliffhanger promises topic N+1. |

## Answered by the user before the run (2026-08-25) — binding

1. **Growth: no ceiling, report only.** The locked decision stands unchanged. Δ words and reading
   minutes are reported per topic and never gated, even at +150%. The bloat check still deletes
   sentences that teach nothing — but **a closed ladder step is never a bloat candidate.**
2. **Blockers: extra repair rounds, then land hedged.** Up to 2 further single-purpose repair
   rounds; then hedge, log to `owed`, flag, continue.
3. **Commits: one per landed topic on `clarity-pilot-docker`** (content + ledger together).
   Main is never touched, merged or pushed. These commits are the resume markers.
4. **Visual check: yes, once after topic 4 or 5.** ~20 min with the dev server — reveal states,
   the Open questions panel, the cliffhanger block, across several rewritten topics at once. The
   UI was verified with 1–2 topics live, never with 5.

## Deviations log

Append every departure from this plan, with the reason. An empty log after 8 hours is suspicious.

- **Topic 3, +134% growth** (20→47 min) vs the wave's ~80%. Not a deviation — growth is
  uncapped by decision — but logged because it is the number to challenge. Attributable to 16 new
  H3 seams; bloat pass ran 4× and cut ~34 items; `c12_punt_hits` 0, FLAGS none.
- **Topic 3 took 89 min of workflow time, not 70**, plus ~25 min of landing. One agent stalled
  once and self-retried (verify, 262s, retry 1/5). **Revised estimate: ~100 min/topic**, so the
  realistic horizon for this run is topics 3–7, not 3–9.
- **Two standard defects found by running it**, both fixed in SKILL.md before topic 4:
  `approximations_open` had no id-keyed update rule (topic 3 reused a live id for a different
  fact; a documented replace would have deleted a live debt), and `owed` had no rule that a
  closure report is not a debt (3 phantom debts avoided). `running_example` gained a merge row.
- **Topic 1's `adversarial_signoff` is still `pending`** in the ledger — stale, since topic 1 did
  go through the verifier. Left alone deliberately: I no longer hold its verdict text and will not
  assert a signoff I cannot substantiate. Flagged for the review doc.
