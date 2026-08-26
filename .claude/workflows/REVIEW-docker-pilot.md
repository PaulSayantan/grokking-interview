# Docker clarity pilot — reviewer summary

**Status: 16/16 topics landed on `clarity-pilot-docker` (42 commits ahead of `main`).** `main`
untouched, working tree clean, all gates green. This document is the map — read it first so you
can assess the pilot without reading 16 diffs cold, then dip into whatever you want to see live.

If you approve, the next step is `git merge --ff-only clarity-pilot-docker` on `main` (nothing has
been pushed anywhere), followed by the debt pass listed at the bottom of this doc.

## The numbers

| # | Topic | Reading | Growth | Commit |
|---|---|---|---|---|
| 1 | images-vs-containers | 22 → 35 min | +59% | pre-C12 |
| 2 | container-lifecycle | 21 → 42 min | +100% | pre-C12 |
| 3 | dockerfile-layers-build-cache | 20 → 48 min | +140% | first under C12 |
| 4 | entrypoint-vs-cmd | 16 → 40 min | +150% | `sh -c` PID-1 mechanism corrected from source |
| 5 | multi-stage-builds-image-optimization | 21 → 43 min | +105% | closed a 2-topic arithmetic contradiction |
| 6 | volumes-and-storage | 18 → 45 min | +150% | 47-item closure set, 2 blockers caught |
| 7 | docker-networking | 18 → 53 min | +194% | Engine 28 iptables verified; VXLAN 50-byte arithmetic |
| 8 | docker-compose | 19 → 30 min | +58% | first fully-clean sign-off |
| 9 | registries-and-distribution | 14 → 24 min | +71% | spec-SHOULD vs client-enforced |
| 10 | production-healthchecks-logging | 23 → 29 min | +26% | dual-logging FALSE claim fixed; compaction 39→11 |
| 11 | debugging-troubleshooting | 18 → 28 min | +56% | **the corpus's one C12 punt removed** |
| 12 | docker-security | 19 → 34 min | +79% | capabilities counts web-verified; fixed a corpus-wide exemption bug |
| 13 | image-scanning-supply-chain | 20 → 33 min | +65% | APPROX-8 closed (distroless static-C invisible) |
| 14 | buildkit-advanced-builds | 16 → 26 min | +62% | QEMU emulation mechanism + magnitude |
| 15 | image-internals-storage-drivers | 24 → 31 min | +29% | APPROX-2/4/6 closed; compaction 33→16 |
| 16 | runtimes-oci-standards | 20 → 29 min | +45% | APPROX-1 closed (the arc close) |

**Domain: 309 → 570 minutes (+84% overall).** Right at the ~+80% growth you accepted after topic 2.
The dispersion is what matters: the topics whose base was already near the clarity floor barely
moved (10 at +26%, 15 at +29%, 8/16 at +45–58%); the topics that had dense unreadable prose in
deep passages grew the most (7 at +194%, 4/6 at +150%). Growth tracks how far the base fell
short, not a fixed inflation.

## What "C12" actually added — the one thing worth reading a topic for

C12 is the standard's self-sufficiency rule: **a topic must be understandable from the file
alone. Prompts, References and the cliffhanger may send a reader beyond the file; none may fill a
gap the file left.** It was written into the standard after topic 2, and it earned its place —
here are the ten most consequential things it caught, in order of stakes.

1. **Topic 4 — `sh -c` PID 1 mechanism.** The base asserted flatly that shell form leaves `/bin/sh`
   at PID 1. False for a *single* command: dash, busybox ash and bash 5+ exec-replace it, so `sleep`
   becomes PID 1. Only pipelines, traps and multi-command strings keep the shell. The fact-checker
   settled it by reading `dash/src/eval.c` and `busybox/shell/ash.c` — not docs — and both are now
   cited in References. This corrects a claim that would have interviewer-shaped an entire cohort
   the wrong way.
2. **Topic 6 — `EROFS` vs `EACCES`.** A read-only mount that a write hits returns **`EROFS`** ("read-only
   file system"), not a permission error. The base said the latter. That distinction is the
   difference between reading the message and spending an hour chasing UIDs.
3. **Topic 10 — `docker logs` and remote drivers.** The base said `docker logs` returns nothing when
   using `awslogs`/`fluentd`/etc. Since Engine 20.10, **dual logging is on by default**, so it
   *does* replay recent lines through a local cache unless disabled. Corrected.
4. **Topic 10 — `docker volume prune` default.** The base stated the modern behaviour ("removes
   unused volumes") with **no version condition**. That default changed in Engine 23.0 to
   anonymous-only, so a reader on an older Engine who trusts the sentence **loses named volumes**.
   Pinned to Engine 23.0 in a permanent fact guard.
5. **Topic 15 — `overlay2` is not "the default".** The base said overlay2 is Docker's default
   storage driver, flatly. In **Engine 29.0** the fresh-install default is the containerd image
   store; overlay2 is the default only *within* the classic graph-driver store. Rescoped, and this
   is what "closed APPROX-4" means in the ledger.
6. **Topic 7 — Engine 28 iptables rework verified clean.** The brief flagged this as the top
   fact risk (7 MCQs sit on it). The rewrite states the raw-table PREROUTING rule that Engine 28
   uses to block direct routed access to container IPs — a rule a `DOCKER-USER` rule cannot
   re-permit. Web-verified verbatim against docs.docker.com.
7. **Topic 7 — VXLAN 50-byte arithmetic** (the overlay MTU). Broken down into `20 outer IP + 8 UDP +
   8 VXLAN + 14 inner Ethernet = 50`, producing 1464 bytes of inner frame on a 1500-byte path. RFC
   7348 pinned as a fact guard.
8. **Topic 11 — the corpus's one real C12 punt is gone.** The base ended its opener with
   *"commands but pods are out of scope here"* — a sentence about the document, not the subject.
   That is the exact shape the whole clarity effort exists to eliminate. Removed. `c12_punt_hits`
   for the docker domain is now 0.
9. **Topic 12 — capability counts web-verified.** ~14 default, ~44 of ~300 syscalls blocked by the
   default seccomp profile, `CAP_LAST_CAP` growing with kernel releases. Numbers pinned against
   primary sources.
10. **Topic 13 — distroless scan visibility.** In a distroless/scratch image with no package DB, a
    Go binary is still visible to scanners (Go embeds build info Syft/Trivy parse) while a static
    C binary leaves no record and goes uninventoried. This closed APPROX-8, the debt topic 5 left
    behind.

## The recurring signal to trust

**The separate adversarial verifier caught a real defect the writer's own audit missed on 9 of 16
topics.** Every single one had at least the `c12_punt_hits` check and the register-swap check
pass, and every single one still had a real defect. Twice the *exact same* landmine came up (the
`sh -c` PID-1 exec-optimization error, at topic 4 and again at topic 11). The two-pass loop is
load-bearing, not belt-and-braces.

Two failure modes surfaced that no automated gate can see and only a verifier or a human eye
catches:
- **Silent fact regressions.** Numbers/versions unchanged, tone plainer, but a fact went from true
  to false or vaguely-right to precisely-wrong. Topic 4's Node handler ("Node installs a handler
  and is fine" → wrong, Node's default is `SA_RESETHAND` + re-raise), topic 10's dual-logging,
  topic 15's overlay2 default — all in this class.
- **Locked H3 renames.** Topic 10's writer renamed a locked H3; the lock freezes H3s too, so
  `--check-lock` would have failed the build. Caught only because the verifier reads the diff.

## What I fixed in the machinery along the way

Committed separately from content, per repo convention:

- **`5a3ac72` — Website reading width + TOC flush-right + a table-vs-TOC overlap fix.** Awaiting your
  visual sign-off. Reversible; live on the dev server when you spin it up.
- **`2052f23` — Cliffhanger teasers rendering bug.** No gate could see it (markup valid, tests
  passing, build green), only a screenshot. Code spans rendered as literal backticks under a hook
  where the same spans rendered as chips. Fixed with a shared inline renderer and an 11-assertion
  guard so it can't come back.
- **`30cfd51` — `rewrite_audit.py` COUNT_DROPPED made allowlistable.** Its own message said
  "restore or *move* the content", but the code had no way to record a move. Now keyed on the
  specific `what` label so a "code fences" waiver can't clear a "table rows" drop.
- **`a749589` — `continuity_check.py` guards `topics[]` completion markers.** Topic 7's append
  omitted `topics[]`; a tolerant merge would have left the domain reporting "6/16" forever with
  every other gate green. Now a hard error.
- **`d030427` — `owed` rule corrected.** My own rule from topic 3 keyed on "file is the finished
  topic → drop it as phantom", which would have discarded topic 5's two genuine standing content
  gaps. Rewritten to test whether work remains.
- **Topic 12 — 4 latent inert exemptions fixed.** Writers' ledger-appends had been storing
  exemption `file:` as the full path (`topics/docker/<slug>/concepts.md`) while `continuity_check`
  matches on the slug — so those exemptions were silently ignored, and real K2 violations could
  have slipped through. Normalized all to slugs.
- **`ba480fe` — Three ledger-append rules added:** `approximations_open` is id-keyed (topic 3
  reused a live id for a different fact, which would have silently deleted a debt);
  `running_example` gained a merge row; and the mandatory-key emphasis after topic 7's `topics[]`
  omission.

## Debts recorded, deferred by decision

Nothing here was papered over; every item is in the ledger's `owed` with its cause. Per your
"finish domain first, clear debt after" decision, these are the follow-ups:

1. **MCQ drift, ~9–12 questions across topics 4/6/10/13** — the prose corrected facts the questions
   still assume. Every key remains identifiable from its distractors, so the bank stays answerable,
   but the explanations disagree with the prose. Fix in one MCQ pass; do **not** soften the prose
   to protect any key.
2. **Domain-wide `node:20` stale-tag sweep.** `node:20` and `gcr.io/distroless/nodejs20-debian12`
   are deprecated but pinned as the domain running example in 8 topics — bumping any one file
   splits the example. Needs a single atomic pass starting at the establishing site (topic 3).
   Measurement banked: `node:22 = 408 MB compressed vs node:20 = 398 MB`, so "around a gigabyte
   unpacked" survives the bump.
3. **Daemon-verification pass, 3 approximations.** APPROX-5 (live nginx:1.27 sizing), APPROX-9
   (steady-state writable-layer-vs-volume write magnitude), APPROX-10 (live-engine overlay MTU) —
   all need a running daemon, which a text-only clarity pass structurally cannot produce. Prose
   states the shape in each case.
4. **BuildKit's two C9 source-gaps (topic 3 → topic 14 → recorded).** The Docker docs never
   enumerate which COPY/ADD file-metadata attributes enter the cache checksum, nor state whether
   declaring an ARG is enough to bust cache vs must be consumed. Neither topic 3 nor topic 14 can
   close them; they are permanent docs-silent gaps. The prose states the operating rule
   self-sufficiently. If the docs improve, close them.
5. **`clarity-preview-observability` branch.** Review-only artifacts. Delete, don't merge.

## Ledger snapshot at close

- **`claims_established`:** 20 (6 domain claims from topics 1–5 + 5 from topics 6–10 + 5 from topics
  11–15 + 4 for topic 16, plus the standalone RESOURCE LIMITS entry).
- **`canonical_terms`:** 48 (every one has a `defined_in` teaching site).
- **`approximations_open`:** 10 total, of which **7 CLOSED** and 3 OPEN (all three are daemon-pass
  residuals).
- **`owed`:** 43 (the debts above, plus per-file C9 hedges).
- **`exemptions`:** 15 (all K2 or C9, each with a reason).
- **`verified-facts`:** 22 permanent fact guards, 60 `loss_allowlist` entries with written reasons.

## How to review efficiently

- **Quickest way to feel the change:** open http://localhost:4321/study/docker/entrypoint-vs-cmd/
  (topic 4) after `cd web && npm run dev`. That's the topic where the base's central mechanism
  was flatly wrong and the rewrite fixes it from source. Or /study/docker/docker-networking/ for
  the Engine 28 depth, or /study/docker/debugging-troubleshooting/ to see a punt-free deep-technical
  topic.
- **If you want mechanical evidence:** every commit message names the specific defect the verifier
  caught and how it was fixed. `git log --oneline main..HEAD` is 42 lines; the content commits are
  `content(docker): clarity rewrite N/16` and their bodies read as changelogs.
- **If you want to see the standard itself:** `.claude/skills/clarity-standard/SKILL.md`. C12 is
  the rule the pilot proves out.
- **If a topic bothers you, don't merge it as-is.** Point at the sentence and I'll fix it before
  the merge, not after. The branch is reversible until the merge lands.
