# Continuity ledgers — the clarity wave's carry-forward state

One YAML file per domain (or per group shard) records what a clarity rewrite has already
established, so **topic N can be written from the ledger plus its own `concepts.md`, without
re-reading topics 1…N-1.** It is also the durable completion marker: a session that dies
mid-domain resumes from here and never rewrites a finished topic.

- **Authoritative rules:** `.claude/skills/clarity-standard/SKILL.md` — the "Continuity"
  section (rules K1–K7) and its worked ledger example.
- **Checker:** `python3 scripts/continuity_check.py` (and `--resume`, below).
- **Why `docs/` and not `topics/`:** rule S3 is *removing* author-facing scaffolding from the
  reader's tree. A ledger under `topics/` would add a new instance of exactly that.

These files are **committed**, and they are appended to in the *same commit* as the
`concepts.md` + `prompts.yaml` they describe.

## File naming

| Shape | When |
|---|---|
| `<domain>.yaml` | the normal case, e.g. `docker.yaml` |
| `<domain>.<group>.yaml` | a domain over ~25 topics, sharded by the catalog **group key** — e.g. `system-design.cdp.yaml` covers exactly the `aws-cdp-*` topics. The file must then also carry `group: cdp` |

The group keys are the site's own (`core`, `advanced`, `patterns`, `architecture`, `ccp`,
`aws`, `cdp`), assigned by slug prefix in `web/scripts/sync-content.mjs` and mirrored by
`sd_group_key()` in `scripts/validate_content.py`.

## Field set

Required: `domain`, `schema`, `pass`, `reading_order_source`, `position`, `plan`.
Everything else starts empty and grows. See the standard for the semantics of each list;
the shape the checker enforces is:

```yaml
domain: docker
schema: 1
pass: clarity-v1
reading_order_source: "topics/docker/README.md"   # re-derived every run, never hand-sorted
position: 4          # 1-based index into plan[] of the NEXT topic (3 done)

plan:                # PASS 0, written before topic 1, then never edited
  - { slug: dockerfile-layers-build-cache, covers: "Instruction->layer mapping; cache key …" }

canonical_terms:     # append-only, ~6 terms per topic, no truncation
  layer:
    canonical: "layer"
    defined_in: dockerfile-layers-build-cache
    gloss: "a filesystem changeset plus metadata, content-addressed by digest"
    banned_variants: ["diff", "slice"]

running_example:     { name: …, established_in: …, state: … }   # at most 2 per domain
claims_established:  ["…"]        # rolling compaction every 5 topics, cap ~25 live
approximations_open: [{ id: APPROX-1, from: …, text: "…", correction_owed_by: … }]
known_defects:       [{ file: …, note: "…" }]   # PRE-EXISTING, not yours
owed:                [{ file: …, from: …, kind: …, note: "…" }]  # debts THIS pass created
exemptions:          [{ file: …, rule: C9, terms: [ … ], reason: "…" }]

open_cliffhanger:    # EXACTLY one, overwritten every topic
  from: dockerfile-layers-build-cache
  to_position: 4
  pattern: A
  key_noun_for_K1_grep: "PID 1"
  gap: "…"
  payoff_anchor: "concepts.md#the-pid-1-sigterm-problem-with-shell-form"
  verified_present: true

topics:              # one line per rewritten topic; the completion marker
  - { position: 3, slug: dockerfile-layers-build-cache, commit: abc1234,
      one_liner: "…", reading_minutes: { before: 20, after: 27 },
      factlines: { emitted: 3, verified: 3 }, adversarial_signoff: true }
```

`file:` inside `owed` / `known_defects` / `exemptions` names **who must act on it** — that is
how a debt reaches the person who can close it, via `--resume`.

## Checking

```bash
python3 scripts/continuity_check.py                    # every ledger
python3 scripts/continuity_check.py --domain docker    # one domain or shard
python3 scripts/continuity_check.py --domain docker --resume
```

Exit code is 1 only on **errors**: a ledger that does not parse, a missing or mistyped
required field, a `domain` that disagrees with the filename, a `plan[]` entry naming a topic
that does not exist or naming one twice, a `position` out of range.

Everything else is a **warning that never fails the build**, and that is deliberate:

- **README drift.** `plan[]` is frozen at Pass 0, so a README edited later legitimately
  disagrees with it — commit `62afa14` inserted 7 topics into the middle of a 94-topic
  domain. Drift findings name `topics/<domain>/README.md` and the remediation instead
  (rule K7).
- **Prose greps.** The K2 banned-variant scan and the K1 "did N+1 actually pay off the loop"
  check read English. `replica` vs `node`, `latency` vs `response time` are sometimes real
  distinctions, and the standard says erasing them is also a failure — so these report, and
  a per-file `exemptions:` entry with `rule: K2` silences a legitimate one.

With no ledger present the checker prints one line and exits 0, so it is safe to wire into
CI before the pilot writes the first ledger.

## Resuming a domain in a fresh session

`--resume` prints exactly the four slices the standard says to load — and nothing else, which
is the point: a 16-topic ledger's brief is a screenful, and it replaces tens of thousands of
words of prior topics.

1. `position`, and the next topic's `plan[]` row (plus the rows either side of it).
2. The full `canonical_terms` key list, `running_example`, and every `owed` /
   `known_defects` / `exemptions` entry whose `file` is the next topic.
3. The last three `topics[]` entries and the live-claim count.
4. The one `open_cliffhanger` to settle, with the noun the K1 grep will look for.

It closes by naming the two files to read: the next topic's `concepts.md` in full, and an
**H2-list-only** read of the topic after it (that is where the new payoff anchor comes from).

No real ledger is committed yet. The pilot domain writes the first one at Pass 0.
