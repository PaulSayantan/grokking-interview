# Clarity standard — the real fact regressions this standard exists to catch

> **This file is ILLUSTRATIVE, not normative.** Every rule, threshold, numeric bound and
> pass/fail check lives in `../SKILL.md`, stated there exactly once — including the whole
> fact-safety procedure. Nothing here creates, modifies or relaxes a requirement; these are
> case notes on edits that actually shipped and were actually wrong. If a sentence here could
> be quoted to settle a dispute about what an author has to do, it belongs in `../SKILL.md`
> instead.

Read this before your first topic, once, so you know what the shapes look like. Then work the
procedure in `../SKILL.md`.

---

## The precedent: a clean pass that silently broke facts

Commit `268a063` ran a no-web pedagogy pass over 59 files and downgraded verified AWS facts
without anyone noticing:

- SCPs per entity went 10 → 5. Five is the RCP limit — a confusion the rewriter itself
  introduced.
- The NLB idle timeout was rewritten as "fixed at 350s / not tunable" when it is configurable
  in the 60–6000s range.

Every gate stayed green. It was caught only by a second, web-enabled pass that read the **diff**
rather than the file. That is where the standard's central observation comes from: the unit of
verification is the diff, and a fact-shaped line is immutable unless it is explicitly
re-verified.

---

## Why a marker grep cannot be the gate

The originally planned gate greped added sentences for the logical-connective markers listed in
`../SKILL.md`. On the calibration run, the highest-severity finding carried no marker word at
all:

> "Which moves are legal at the last stage depends on the chip."

Everything about that sentence reads like paraphrase. What it actually does:

- It localises all x86-versus-ARM difference to one stage of a three-stage pipeline.
- The original made no stage attribution at all.
- It contradicted the same file's own tier-C prompt, which asks the reader about chip dependence
  at a different stage.

The writer's own 36-item added-claims audit missed it entirely, because the grep it relied on was
blind to it. The repaired sentence reads "Which moves another core can observe depends on the
chip, and the compiler targets that chip too."

The lesson the procedure encodes: the marker grep is a net that runs *after* the claim population
has been built by sentence alignment, to catch rows the alignment missed. A marker-grep hit that
is not already in the table is a signal that the alignment was sloppy.

---

## The three other regressions from the same run, all marker-free

Each row is a shape to hunt, not an anecdote.

| Shape | Original | Rewrite | Why it is wrong |
|---|---|---|---|
| **De-hedge invents a condition** | "on some JVMs" | "on a 32-bit JVM" | JLS 17.7 conditions 64-bit splitting on the *implementation*, not on word size — and the rewrite implies 64-bit JVMs are safe by spec, which the spec does not say |
| **Mechanism substituted for observable property** | `incrementAndGet()` "is a CAS loop" (parenthetical) | "it **calls** `compareAndSet(expected, expected + 1)`" | It routes through `Unsafe.getAndAddInt`, whose loop uses `weakCompareAndSetInt`, and on x86 it may compile to one atomic add with no retry at all |
| **Qualifier deleted, absolute added** | "x86 is a *relatively strong* TSO model (only store-load reordering is visible)" | "x86 gives you TSO … **nothing else can**" | The guarantee holds for ordinary write-back accesses, not unconditionally |

A fourth of the same family: "HotSpot on a 64-bit platform writes a `long` in **one
instruction**" replaced the base's "writes them **atomically**" — a codegen mechanism swapped in
for an observable property, in the same pass where the writer had explicitly *rejected* a
different codegen claim for being unsourceable.

What all four have in common with the SCP regression: no number changed, no version changed, no
citation changed. Nothing mechanical could see them. That is the entire reason the procedure
aligns sentences and tests subject, verb and object rather than scanning for suspicious tokens.

---

## What the calibration run got right, and what it still missed

Worth holding both halves in mind, because the run was the honest case rather than the careless
one.

Right: it refused to source a claim it could not source, five separate times. It declined to
invent a cycle count and it reverted a spec claim it had not opened. Where it kept a hedge it
routed the gap to a tier-C prompt instead of quietly dropping it.

Still missed: its own highest-severity added claim, the stage attribution above. It produced the
most careful self-audit in the whole effort and still could not see its own blind spot — which is
the evidentiary basis for a separate verifier working from a fresh context on the diff alone.

And the verifier is not infallible either. On the real run one of its suggested fixes did not
compile. Findings from a verifier are input to a judgement, not instructions.

---

## What the web pass actually looks like in practice

On the real run the web pass reached nine primary sources and three refused the connection.
Recording those three explicitly as residual risk was part of the deliverable — an unreachable
source is a known unknown, while a silently skipped one is indistinguishable from a verified
fact.

Where a precise value could not be confirmed, the run softened to a correct range and named the
mechanism instead of asserting a wrong precise number. The NLB timeout in the `268a063`
precedent is the cautionary twin: an asserted precise value that was simply wrong did more damage
than a range would have.
