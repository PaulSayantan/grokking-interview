# Clarity standard — worked examples and before/after pairs

> **This file is ILLUSTRATIVE, not normative.** Every rule, threshold, numeric bound and
> pass/fail check lives in `../SKILL.md`, stated there exactly once. Nothing here creates,
> modifies or relaxes a requirement, and the figures quoted below are observations about real
> files rather than limits. If a sentence here could be quoted to settle a dispute about what
> an author has to do, it belongs in `../SKILL.md` instead.

Open this file when you want to see what a rule looks like in practice. You do not need it to
know what the rules are.

---

## C1 — deepest-beat parity

Weak, from `java-jvm/synchronized-volatile-jmm/concepts.md` (the old `**Advanced.**` tier):

> "The JMM is also careful to forbid *out-of-thin-air* values via a causality model, so that
> data races (while unspecified in ordering) still cannot fabricate arbitrary values for
> references (which would break memory safety)."

Three abstract nouns are never shown, the spec is the actor, and the same file's opening tier
is plain and analogised — so the writing was worst exactly where the material was hardest.

Rewritten:

> "A race can hand you a stale value, but never an invented one. The JMM forbids
> **out-of-thin-air values**: a racy read may return any value some thread actually wrote, and
> nothing else. That matters most for references — if a race could fabricate one, a `String`
> field could come back pointing at arbitrary memory and Java would not be memory-safe."

The rewrite carries one bold, sitting on the term's teaching site. The thesis sentence carries
its weight by coming first rather than by being bold.

---

## C2 — thing before name

Weak, `messaging-databases/database-scaling-replication-pooling/concepts.md:3`: a 97-word
single-sentence table of contents with 12 undefined terms and zero instances.

Rewritten:

> "Your one database is at 90% CPU at 3pm every day, and the graph is still going up. You have
> exactly three moves. Buy a bigger machine. Keep a full copy of the same data on more
> machines, so reads can go anywhere. Or split *different* data across machines, so writes can
> go anywhere too. The second move is called **replication**: every node holds the same rows."

A related failure: `PETPP` at `spring-core/bean-definition-stereotype-annotations` is used 17
lines before the line that coins it.

---

## C3 — one gloss per sentence

Weak, `system-design/interview-method-scenario-playbooks/concepts.md:632`:

> "the **outbox pattern** (write the event into an `outbox` table *in the same DB transaction*
> as the state change, then a relay publishes from that table) + **CDC** (Change Data Capture
> — tail the DB's write-ahead log …) for reliable event publishing without a **dual-write**
> (…)"

Four nested definitions, and then the sentence abandons syntax and collapses into bare
keywords.

Rewritten:

> "Write the event into an `outbox` table in the same database transaction as the state change,
> then let a relay read that table and publish. Otherwise you are doing a **dual-write** — one
> write to the database, one to the broker, no transaction across them — and either can fail
> and leave the two disagreeing."

---

## C4 — a concrete instance early

Weak, `java-jvm/oop-principles-polymorphism` §Encapsulation. It opened on the definition
("bundling data (fields) and the methods that operate on that data into a single unit") while
the ideal instance — a `BankAccount` that can guarantee `balance >= 0` only if nobody can write
`balance = -100` — already sat two paragraphs down. That is a reordering defect rather than a
writing defect, and it is the common case: the instance is usually already somewhere in the
file.

Rewritten:

> "Give any caller direct access to a `BankAccount`'s `balance` field and someone will
> eventually write `balance = -100`. The account is now in a state your business rules say
> cannot exist… Bundling the data with the methods that operate on it, and letting nothing
> outside touch the data directly, is called **encapsulation**."

---

## C5 — old information opens, new payload closes

Weak, `spring-boot/core-annotations-stereotypes/concepts.md:79`, opening on the API surface:

> "the default `AnnotationTypeFilter(Component.class)` used by scanning is created with
> `considerMetaAnnotations=true` but `considerInterfaces=false` and does **not** traverse
> superclasses. So a concrete subclass that merely *extends* an `@Component`-annotated base is
> **not** auto-registered…"

Rewritten:

> "Put `@Service` on a base class, extend it, and the subclass never becomes a bean. Nothing is
> registered, nothing is logged, and injection fails at startup with a missing-bean error that
> names the interface rather than the cause. The reason is that component scanning looks for
> the stereotype on the class itself. It does follow meta-annotations, which is why `@Service`
> works at all — but it does not walk up the superclass chain, because the filter scanning
> installs by default is built with `considerInterfaces=false` and no superclass traversal."

Every fact survives the move, including both constructor flags. That is the point of the pair:
the reordering costs no information.

---

## C6 — one payload per syntactic closure

Weak, `system-design/ccp-management-elasticity-resiliency/concepts.md:340`, the corpus's
longest sentence at 116 words:

> "The mechanics that stop thrashing are worth naming in an interview: (1) a **deadband /
> hysteresis** … (2) **cooldown windows** … (3) **asymmetric policy** …"

Rewritten:

> "Three things stop an autoscaler flapping. First, hold steady inside a band around the target
> — say 45% to 55% CPU — so a metric hovering near it does not ping-pong. That band is a
> **deadband**… Second, after you act, ignore the metric for a fixed window…"

---

## C7 — turn catalogues into claims

Weak, `reliability-ops/cascading-failures-and-antipatterns/concepts.md:743`: twelve stability
patterns, six inline glosses, 88 words, one sentence. The reader gets twelve unrelated names
and keeps four.

Rewritten:

> "Nygard's twelve stability patterns are twelve answers to one question: where do you put the
> wall that stops a failure spreading? There are only three places to put it."

Then three grouped sub-lists — *in time*, *in capacity*, *in the process itself* — with one
gloss per line. The framing question is not bolded: a colon plus a question mark already gives
it two closures, and bolding it would spend the paragraph's bold on something that is not a
term.

---

## C9 — metaconcepts out, the actual condition in

Weak:

> "Reads from replicas are relatively fast, and in most cases a caching strategy at the
> application level is sufficient; in a multi-tenant context the isolation model may need to be
> revisited depending on the workload."

Rewritten:

> "Reads served from a local replica return in under 1 ms; a cross-region read costs 60–100 ms.
> Cache-aside with a 60-second TTL covers it until your write rate passes the single leader's
> disk throughput — above that, the cache hides a database that is already falling behind."

The de-hedge worked here because the conditions were sourceable. Where they are not, see
`fact-safety-cases.md`: three of the four fact regressions on the calibration run were C9
de-hedges that invented a condition the source does not state.

---

## C10 — kill the slot label, write the transition

Weak, `system-design/dp-concurrency/concepts.md:314`: seven labelled slots fused into one
110-word block (*Pros / Cons / Use when / Avoid when / vs L-F / vs Reactor / Real-world*), with
the shape repeated for each of about 30 patterns in the file.

Rewritten:

> "You pay one queue hop per message — a context switch, usually a data copy, plus the memory
> the queue holds — and in exchange every worker gets to be written as ordinary blocking code.
> That is the whole deal, and it is a good one whenever the people writing handlers outnumber
> the people who understand the event loop. Take it unless microseconds matter."

Note the two things the replacement paragraph does that the labels could not: it prices the
cost against the benefit, and it names the condition that flips the decision.

---

## C11 — explain the mechanism, not the interviewer

Weak, `networking/tls-ssl-https/concepts.md:21`:

> "**Why it matters.** Interviewers want to know that TLS is a distinct layer that sits
> **between the reliable transport (TCP) and the application (HTTP)**."

The reason TLS is a distinct layer is never given.

Rewritten:

> "TLS sits between TCP and HTTP, and that position is the whole design. It needs TCP
> underneath because it assumes bytes arrive in order and none are lost — a handshake message
> that arrives second breaks the key schedule… That is why HTTP/1.1, HTTP/2, IMAP and SMTP all
> get TLS for free, and why the same protocol had to be redesigned as DTLS the moment anyone
> wanted it over UDP."

---

## S1 — seam vocabulary, as a prefix

Real seams from the calibration run and the shapes they take:

- `### Where it breaks: losing the thread`
- `### What it costs: the fences HotSpot emits`
- `### Tuning it: the two knobs that interact`
- `### The version-specific truth: what changed in 21`
- `### Why the simple version is wrong: three machines reorder, not one`

Each is a prefix plus content, which is what keeps two "where it breaks" seams in one file from
colliding on the same slug. `### Where this goes next: the 64-bit case` is a legal seam shape
even though the H2 spelling of those words is banned — see the S8 discussion in
`rationale.md`.

---

## The REGISTER SWAP, failing and then passing

From the calibration run, which scored PARTIAL: vocabulary passed decisively, clause depth did
not. `## volatile` opened with sentence lengths `[8, 8]` and its deep beat closed `[33, 11,
24]` on a four-clause transitivity walk.

The writer's own self-report claimed the deep tier's longest sentence was 26 words. It was 38.
A writer measuring its own register swap understates it — which is the reason the loop hands
this measurement to a separate verifier.

The repair split four sentences, moved no content, and landed at `[8, 8]` against `[13, 13]`.
That reads as a pass.

A cheap tell before measuring anything: read the deep paragraph aloud. Running out of breath
before the verb is the same signal.

---

## The full worked section — before and after

`topics/java-jvm/synchronized-volatile-jmm/concepts.md`, `## Visibility, reordering, and
atomicity`. This is the section the whole standard was calibrated on: it went through the
entire loop — write, adversarial verify, web fact-check, repair.

### Before (verbatim from the repo)

> **Beginner.** Three distinct concerns are often conflated:
>
> - **Visibility** — whether a write by one thread is observable by another.
> - **Ordering / reordering** — whether operations appear to execute in program order.
> - **Atomicity** — whether a compound operation executes as one indivisible step.
>
> They are independent. `volatile` gives visibility and ordering but *not* atomicity of
> compound actions. `synchronized` and atomics give all three (within their scope).
>
> **Intermediate — the classic infinite loop.** A missing visibility guarantee: […code…]
> The JIT is allowed to hoist the non-volatile read out of the loop because, in the absence of
> a happens-before edge, it can prove nothing forces a re-read.
>
> **Advanced — reordering sources.** Reordering can come from (1) the compiler / JIT, (2) the
> processor's out-of-order execution, and (3) the memory hierarchy (store buffers, invalidate
> queues). x86 is a relatively strong TSO model (only store-load reordering is visible);
> ARM/POWER are weakly ordered and expose far more.

The defects a reviewer named in it: three audience-tier labels (C10, S1); a naked definition
list standing in for the explanation, with the instance 12 lines below the abstraction (C4,
C7); "(1)…(2)…(3)" as an inline enumeration of a three-stage pipeline, which is a textbook S4
positive test with no diagram; `invalidate queues` with no gloss (C2); and quality decaying
monotonically down the tiers (C1), with the `**Beginner.**` list plainer than the
`**Advanced.**` paragraph that carried the harder material.

### After (the shipped rewrite)

> Three different things can go wrong with a shared field, and each one needs a different fix.
> The smallest case is one `boolean`: […the same code fence, moved up…]
>
> Main sets `stop = true` and exits. Thread T spins on, pinning a core. No exception, no log
> line, and the flag was set long ago. The write was not slow. The JIT is allowed to read
> `stop` once before the loop and reuse that copy, because with no happens-before edge nothing
> in the program obliges T to look again. Declare `stop` volatile and the edge exists, so T
> has to re-read. This is a legal compiler optimisation, not a cache that failed to flush.
>
> That loop is a **visibility** failure: a write by one thread never becomes observable to
> another. Two more failures can happen to the same field, and neither one is visibility.
>
> **Ordering** is whether operations appear to run in the order the program wrote them. Write
> `data = 42` and then `ready = true`, both of them plain fields, and another thread can see
> `ready` set while `data` is still 0. […]
>
> **Atomicity** is whether a compound operation runs as one indivisible step. `stop = true`
> is a single write, so it has nothing to divide; `count++` is a read, an add and a write. […]
>
> […the "three are independent, each tool covers a different subset" paragraph, keeping every
> fact from the BEFORE list; then the 64-bit tearing paragraph; then the one `[!WARNING]`…]
>
> ### Why the simple version is wrong: three machines reorder, not one
>
> Between the order you wrote and the order another core observes, an access passes three
> stages, and each one may move it.
>
> ```mermaid
> flowchart LR
>     P["program order<br/>you wrote"] --> J["compiler / JIT<br/>reorders while generating code"]
>     J --> C["processor<br/>out-of-order execution"]
>     C --> M["memory hierarchy<br/>store buffers, invalidate queues"]
>     M --> O["order another core observes"]
> ```
>
> The hoist in the loop above happened at the first stage, in generated code, which is why no
> amount of cache-flushing would have fixed it. At the last stage a write can be delayed after it
> has already executed: a store waits in the core's store buffer, and on many designs an
> invalidate queue also delays the moment another core learns its copy of the line has gone stale.
>
> Which moves another core can observe depends on the chip, and the compiler targets that chip
> too. x86 behaves as **total store order (TSO)**: for ordinary field accesses, store-load is
> the only reordering it exposes to another core. […]
>
> `volatile` fixes visibility, ordering and the tearing case with one keyword. It cannot fix
> `count++`. That keyword is the next section.

### What to notice in the pair

- The definition list became three named failures, each with an instance, in the order they
  bite, and the code fence that used to sit 12 lines below the abstraction now opens the
  section (C4, C7). The `(1)(2)(3)` enumeration is deleted rather than kept above the diagram
  (S4). The deep beat sits behind a content-named seam. The exit sentence names the next
  section in 20 flat words (S7).
- Every fact survived, including JLS 17.7, the JSR-133 attribution, both tearing halves, and
  `invalidate queues` — now glossed and hedged rather than named and dropped.
- Two H2s went 1,089 → 2,046 words, +87.9%. That was reported, not gated. The bloat check then
  cut about 50 words of narration ("You do not have to track any of that", "Here is the first,
  as small as it gets") — which is the line between growing because it teaches and growing
  because it chats.
- Three fact regressions and one marker-free added claim were caught after a clean self-audit,
  by the verifier and the web pass. That is the normal outcome of the loop rather than the
  exception, so budget for it.
- In the last quoted paragraph, "Which moves another core can observe depends on the chip" is
  the *repaired* wording. The draft said "Which moves are legal at the last stage depends on
  the chip" — a marker-free stage attribution the original never made. That single sentence is
  the most load-bearing item in this standard's evidence base; `fact-safety-cases.md` takes it
  apart.
