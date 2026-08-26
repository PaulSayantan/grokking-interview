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
| 4 | entrypoint-vs-cmd | ✅ (resumed) | ✅ `2e1c91b` | +176% | 0 | central `sh -c` mechanism was WRONG in base AND draft; fixed from dash/ash/kernel source. Opened an MCQ-drift defect (4 questions) |
| 5 | multi-stage-builds-image-optimization | ✅ | ✅ `3cc2484` | +105% | 0 | cleanest run yet (register swap passed first read); closed a 2-topic arithmetic contradiction; **compaction done 28→6 claims** |
| 6 | volumes-and-storage | ✅ | ✅ `3f62cf6` | +179% | 0 | 47-item closure set, 0 unclosed; 2 blockers (`$DATA_DIR`, `EROFS` vs `EACCES`); 2 new fact guards |
| 7 | docker-networking | ✅ | ✅ `18bca7c` | +192% | 0 | Engine 28 iptables section CONFIRMED clean; blocker was a broken callout invisible to every gate; append omitted `topics[]` |
| 8 | docker-compose | ✅ | ✅ `4994dd4` | +57% | 0 | **first clean sign-off, 0 blockers/highs**; smallest growth (base already near floor); re-pointed APPROX-10 |
| 9 | registries-and-distribution | 🏃 `wf_f6aa5540-314` | — | — | — | inherits the `pointer` loop (tags are mutable) |
| 10 | production-healthchecks-logging | ✅ | ✅ `a4ff43d` | +30% | 0 | settled 502 loop; blocker=renamed LOCKED H3 (restored); base-carried dual-logging FALSE fixed; **compaction 39→11 claims** |
| 11 | debugging-troubleshooting | ✅ | ✅ `0d626f5` | +55% | 0 | **C12 punt removed**; blocker=`sh -c` exec-optimization backwards AGAIN (topic-4 landmine, fixed); owns 137/143 |
| 12 | docker-security | ✅ | ✅ `74acd8e` | +77% | 0 | clean sign-off; caps counts web-verified; fixed a corpus-wide exemption-path bug (4 inert exemptions) |
| 13 | image-scanning-supply-chain | ✅ | ✅ `4ef5ab2` | +63% | 0 | clean sign-off; closed APPROX-8 (distroless static-binary scan); openers were the density risk here |
| 14 | buildkit-advanced-builds | ✅ | ✅ `f45b494` | +65% | 0 | clean sign-off; QEMU/in-toto/solver gaps closed; 2 topic-3 C9 gaps are permanent docs-silent source-gaps (kept) |
| 15 | image-internals-storage-drivers | ✅ | ✅ `3e3f21e` | +34% | 0 | **compaction 33→16 claims**; APPROX-2/4/6 CLOSED, APPROX-5/9 need a daemon pass (honest residual); Engine-29.0 default fact guard |
| 16 | runtimes-oci-standards | 🏃 launching | — | — | — | **LAST**: closes the arc (no forward cliffhanger); owns runc/OCI bundle (topic 15 payoff); backstop owner of APPROX-10 |

## After topic 16 — the close-out sequence

1. Reviewer summary at `.claude/workflows/REVIEW-docker-pilot.md`; user reviews the domain.
2. **Merge to main only on explicit sign-off.** Never partial.
3. **Debt pass, one commit each:** the ~9 drifted MCQs, then the domain-wide `node:20` retag
   starting at its establishing site (topic 3), carrying the measurement already in `owed`.
4. Delete `clarity-preview-observability`.

**Run 1 (done): topics 3–6 landed + 7 in flight.** Hit the base case, not the stretch — ~100
min/topic, plus an auth dropout that cost topic 4 three agents.

**Run 2 (current): finish topics 7–16.** 9 topics after 7 lands, ~15 h. Then the domain is
mergeable and the debt pass follows. The gates are not negotiable; the topic count is what flexes.

## Decisions confirmed 2026-08-25 (second round) — binding

1. **Growth stays uncapped.** Mean under C12 is **+148%**, not the +80% originally accepted, and the
   user re-confirmed with the number in front of them: *a 45-min topic that needs no other source
   beats a 20-min one that sends students to Google.* Docker will land near 12 h of reading for 16
   topics (was 5.2 h). Report per topic, never gate. **Do not raise this again.**
2. **Finish topics 7–16 before clearing debt.** Continuity stays hot (each cliffhanger promises the
   next topic) and the domain reaches a mergeable state. The ~9 drifted MCQs and the domain-wide
   `node:20` retag are cleared in ONE pass afterwards, not interleaved.

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
- **Topic 4: environment auth dropout.** `API Error: Could not load credentials from any providers`
  killed verify + factcheck + repair after brief and writer had succeeded. Recovered with
  `resumeFromRunId` — brief and writer replayed from cache, only the 3 dead agents re-ran (40 min).
  **The draft was NOT landed while unverified**, which was the right call: the verifier and
  fact-checker then found 2 blockers and 4 wrong facts in it, including the topic's central mechanism.
- **Topic 4 opened a real MCQ defect**, recorded in `owed`, needs a later MCQ pass: 4 questions now
  disagree with corrected prose (nginx SIGQUIT called "fast"; `--entrypoint` "typically resets CMD";
  two keying "/bin/sh is PID 1" for a single simple command). Prose was NOT softened to protect a key.
- **I mis-called two `rewrite_audit` findings as information loss before checking** (`chown` and
  `CMD ["bash"]`). Both were present in better form — the `chown` case as the problem it solves, and
  privilege-dropping expanded into a whole H3. Corrected before allowlisting. Lesson: read the file
  before believing the detector, in both directions.
- **Visual check done after topic 4** (the one the user approved). Everything the reveal UI
  promises holds with 4 topics live: rows locked with an empty panel, "Unlock all" 0 -> 12 visible,
  row height 45px in BOTH locked and armed (zero CLS), no-JS ships all 7 bodies + 7 panel items
  open with the dead controls hidden, console clean. **It also found a real bug no gate could see**
  (`2052f23`): cliffhanger teasers were interpolated as text, so code spans rendered as literal
  backticks under a hook where they rendered as chips. Fixed with a shared inline renderer, a
  rescoped CSS rule, and an 11-assertion guard. Worth the 20 minutes.
- **Two false alarms of my own during that check**, both from measuring the wrong element: a row
  contains three `.pd-line` variants and I measured the hidden one (reported 0 height); and 12
  prompts against 11 rows is correct, because rows are keyed per H2 SECTION and two prompts share
  `base-images-from-scratch-tags-and-digests`. Neither was a defect.
- **Topic 5 exposed a bug in MY OWN rule from topic 3.** I had written "never append an `owed` entry
  whose `file` is the topic you just finished" — keyed on the wrong thing. Topic 5 filed two genuine
  standing content gaps against its own file (glibc NSS order with no `/etc/nsswitch.conf`; which musl
  versions differ on locale) and my rule would have silently discarded both. Rewritten to test
  *whether work remains*, not which file is named.
- **The ledger itself had a wrong entry, caught by continuity_check flagging two ALREADY-REWRITTEN
  topics.** Topic 5 declared `build step` a banned variant of `stage`. It is not one — a build step is
  one Dockerfile instruction (one `docker history` row) and a stage contains many. Enforcing it would
  have made topic 3's history explanation false. Variant removed, reason recorded on the term. This is
  the K2 "do not over-enforce a real distinction" case, arriving for real.
- **Rejected a fact-check WRONG with a stated reason** (topic 5): `node:20` is deprecated, but it is the
  domain running example pinned in the ledger across 8 topics, 4 already rewritten. Bumping one file
  splits the example; bumping only the distroless half pairs a Node 20 builder with a Node 22 runtime.
  Re-opened as a domain-wide sweep carrying the measurement a future pass needs.
- **Two more silent-loss hazards caught at the topic-6 merge**, both now handled in the merge I run:
  (a) `canonical_terms` collides on a topic's OWN teaching-site terms because Pass 0 pre-declares them,
  and a blind replace deleted the live `bind mount` entry's `note`. Merge field-wise. (b) Six `owed`
  entries named the finished file itself — kept, correctly, under the rule I fixed after topic 5. Had I
  not fixed it, six real hedges would have vanished.
- **K2 exemption instead of a chase** (topic 6): the only `container layer` hit is the FROZEN H2, which
  is an MCQ anchor and cannot be renamed. Recorded as an exemption with a note that two un-rewritten
  topics carry the same wording.
- **Writer self-audit miss rate is now 6/6.** Not improving with practice. The separate verifier and the
  web fact-check are load-bearing, not belt-and-braces.
- **Topic 7's append omitted `topics[]`** — the durable completion marker that `continuity_check`
  counts. A tolerant merge would have left the domain reporting 6/16 after 7 landed, forever, with every
  gate green. Now guarded mechanically: `continuity_check` errors when `position` outruns the recorded
  rows. Proved both directions — passes on the real ledger, exits 1 on a simulated missing row.
- **Topic 7's blocker was a broken markdown callout**: a stray `>` plus two lines missing their
  blockquote prefix in the host-mode SECURITY warning. CommonMark lazy continuation kept the file valid,
  so `validate_content` passed and `clarity_report` said FLAGS: none while the callout rendered a literal
  ">". Swept all 16 docker topics for the same shape — clean elsewhere.
- **I wrote an allowlist reason I did not actually believe** and caught it on re-read: I explained
  `container:CONTAINER` as the `--network container:` mode. It is not — it is the other half of the
  `host:HOST` port-mapping notation. Corrected. A reason I cannot defend is worth less than no entry.
- **Topic 8 workflow was interrupted** by a process exit between the writer and verify phases (also
  a brief MCP disconnect, unrelated). No unverified work landed — tree clean, ledger still at position
  8, topic 8 NOT committed. Resumed with `resumeFromRunId`: brief + writer replay from cache, only
  verify/factcheck/repair run live. Same recovery as topic 4's auth dropout; the cache makes an
  interruption cost only the unfinished phases.
- **Topic 1's `adversarial_signoff` is still `pending`** in the ledger — stale, since topic 1 did
  go through the verifier. Left alone deliberately: I no longer hold its verdict text and will not
  assert a signoff I cannot substantiate. Flagged for the review doc.
