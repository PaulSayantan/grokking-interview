# Clarity standard — prompts.yaml and cliffhangers, illustrated

> **This file is ILLUSTRATIVE, not normative.** Every rule, threshold, numeric bound and
> pass/fail check — the field set, the word limits, the kinds, the tiers, the density caps —
> lives in `../SKILL.md`, stated there exactly once. Nothing here creates, modifies or relaxes
> a requirement; the YAML below is a transcript of one shipped topic. If a sentence here could
> be quoted to settle a dispute about what an author has to do, it belongs in `../SKILL.md`
> instead.

Open this when you want to see a full sidecar and a full hook. The field spec you write against
is in `../SKILL.md`.

---

## A shipped `prompts.yaml`, abridged to three prompts

From the calibration run on `java-jvm/synchronized-volatile-jmm`. Comments here describe what
the example does; they are not the field spec.

```yaml
topic: "synchronized, volatile & the Java Memory Model"
domain: java-jvm
topic_slug: synchronized-volatile-jmm
schema: 1
pass: clarity-v1

prompts:
  - id: synchronized-volatile-jmm-p001
    ref: "concepts.md#visibility-reordering-and-atomicity"
    kind: predict-failure          # one of the five kinds
    tier: A                        # A in-file | B other topic | C source | D open
    prompt: |
      Your teammate declares `stop` volatile, the loop exits, so they apply the same fix
      to a `hits` counter that eight threads increment. Name what still breaks.
    hint: "Count the memory accesses in one `hits++`."
    answer_in: "concepts.md#volatile"

  - id: synchronized-volatile-jmm-p002
    ref: "concepts.md#why-the-simple-version-is-wrong-three-machines-reorder-not-one"
    kind: draw-the-boundary
    tier: C
    prompt: |
      Your racy cache passes 10,000 runs on an x86 laptop and fails within a minute on an
      ARM build server. Which reordering did the ARM core permit?
    success_criterion: |           # the tier-C field; it bounds an unbounded hunt
      You have it when you can name one reordering an ARM core may perform that an x86 core
      may not, and say which barrier a JVM therefore has to emit on ARM and not on x86.
      This file states only that ARM and POWER permit reorderings x86 forbids; it does not
      say which, and that gap is the point of the hunt.
    answer_in: external
    search_hint: |
      Doug Lea, 'The JSR-133 Cookbook for Compiler Writers' — the barriers-required table.
      The page self-labels its processor rows as historical, so confirm anything you take
      from it against your target chip's own manual.

  - id: synchronized-volatile-jmm-p005
    ref: "concepts.md#what-it-costs-the-fences-hotspot-emits"
    kind: notice-in-wild
    tier: D
    prompt: |
      Next time a profiler shows a hot method with a `volatile` write in it, count the
      writes per call. One write per call usually means one full fence per call.
    answer_shape: |                # the tier-D field; the dimensions a credible answer prices
      A good answer prices three things: how many StoreLoad fences one call executes, what
      each fence has to drain before the next load may proceed, and whether the write could
      happen once outside the hot path instead of once inside it.
```

Things to notice in the three: p001 forces a pre-commitment, so a later miss stays legible
instead of dissolving into "yes, I knew that". p002's `success_criterion` names what the file
deliberately does *not* say, which is what makes an external hunt finishable. p005 has nothing
to get wrong, and its `answer_shape` still gives the reader a way to grade themselves.

### The failure mode every existing file has

All 460 files inline the answer today. The canonical instance:

> *"Is `R + W > N` the same as linearizability? Why not? (No — sloppy quorums, concurrent
> writes and read-repair races still allow anomalies.)"*

There is no interval in which the reader could have generated anything, so the prompt does no
work at all. Removing the parenthetical and routing it to `answer_in` is the whole fix.

---

## A shipped cliffhanger

Same run, and it was verified to pay off in the genuine next topic.

```yaml
cliffhanger:
  hook: |
    You can now make any shared field correct. Pick the edge, pick the tool, and the race
    is gone. Here is a loop with no shared field in it:

        while (true) {
            Socket s = server.accept();
            new Thread(() -> handle(s)).start();
        }

    It passes every load test you have. At the first real burst it dies with
    `OutOfMemoryError: unable to create native thread`. Nothing you just learned is wrong,
    and none of it helps. Happens-before governs which values a read may return. It never
    says how many threads you may create, or what happens when you run out.
  teaser_questions:
    - "Who decides how many threads your program is allowed to create?"
    - "Where does a task wait when no thread is free to run it?"
  payoff:
    anchor: "concepts.md#executors-factory-methods-and-their-pitfalls"
    claim: >-
      The next topic must show a factory pool whose maximumPoolSize is Integer.MAX_VALUE
      (newCachedThreadPool over a SynchronousQueue) creating a thread per burst task until
      `OutOfMemoryError: unable to create native thread`. Verified present in the
      un-rewritten destination.
```

### How this hook measures

It runs 85 prose words with a longest prose sentence of 16 words. Include the code artifact and a
naive splitter reports 97 words and a spurious 17-word fusion, because the artifact carries no
sentence terminators. The lower word bound in `../SKILL.md` was chosen from this real, compliant
hook's measured prose count, which is why measuring prose-only is not a cosmetic detail.

Read aloud, it sounds like a colleague saying "oh — one thing". If a draft sounds like a trailer
instead, that is the tell.

---

## The six patterns, illustrated

The selection table and its constraints are in `../SKILL.md`. What each pattern feels like when
it works:

**A — broken invariant** (the default). The topic taught a rule; the next topic exists because
the rule has a boundary. The example above is pattern A: happens-before is correct and complete
for shared fields, and says nothing about thread supply.

**B — unpaid bill.** The previous topic handed over a capability that looked free. A good B hook
gives the bill's existence and its units — "ten seconds, every deploy" — and leaves the structure
of the bill for the destination. Giving the structure spends the payoff.

**C — scale threshold.** The hook *is* the arithmetic, with constants taken from the topic's own
numbers, so the reader can do the multiplication and watch the design break. Pattern C hooks are
artifact-free by construction: the arithmetic is the artifact.

**D — named unknown.** For survey topics, where the honest hook is three routed questions rather
than one broken invariant. The routing is the value; a fourth question turns it into a list.

**E — pivot.** For non-contiguous adjacency, where the two topics share a mechanism rather than a
dependency. The temptation is to fake a dependency; naming the genuinely shared mechanism and
posing a question on that seam is the honest version.

**F — finale**, for a domain's last topic. It closes the arc, hands off to real `domain/slug`
targets, and leaves one genuinely unsolved question. Congratulation is the failure mode here:
celebration closes the loop, which is the opposite of what the device is for.

---

## Verifying a payoff, as it actually went

The calibration run read the destination's H2 list with `read_headings`, picked an anchor that
resolved in the un-rewritten file, then opened lines 89–90 at that anchor and confirmed the exact
error string the hook uses. `payoff.claim` above is the record of what it saw.

Choosing a short exact string that also appears in the destination is what makes the continuity
grep work later, once the destination is itself rewritten. Lengthening the claim for completeness
makes that grep brittle for no gain.
