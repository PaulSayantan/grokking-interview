# CAP Theorem and Consistency Models

Distributed systems force you to reason about what happens when the network
breaks, when replicas disagree, and when a client wants to read what it just
wrote. The CAP theorem is the famous headline, but in real interviews the
strong signal is showing that you understand the *spectrum* of consistency,
the *cost* of each guarantee (latency, availability, throughput, complexity),
and *when* to pick which. This document goes intuition → mechanics → real
systems → trade-offs for each subtopic, and closes with a dedicated trade-off
decision guide.

A one-line mental model to carry throughout: **consistency, availability, and
latency are things you buy with coordination. More coordination (more round
trips, more nodes that must agree) buys stronger guarantees and costs latency
and availability. Less coordination is fast and available but lets replicas
diverge.**

---

## CAP theorem fundamentals

**Intuition.** CAP says that a distributed data store can provide at most two
of three properties *at the same time*:

- **C — Consistency (linearizability):** every read sees the most recent
  successful write (or an error). All nodes agree on a single, current value.
- **A — Availability:** every request to a non-failing node gets a
  non-error response (though not necessarily the latest data).
- **P — Partition tolerance:** the system keeps operating even when the
  network drops or delays messages between nodes.

**How it actually works.** The popular "pick 2 of 3" framing is misleading.
In any real distributed system spanning more than one machine, **network
partitions will happen** — packets drop, links fail, GC pauses look like
partitions. So P is not optional; you must tolerate partitions. The real
theorem, as Eric Brewer clarified, is: **when a partition occurs, you must
choose between C and A.** When there is no partition, you can have both.

So the meaningful classification is:

- **CP system:** during a partition, sacrifice availability. A node that
  can't confirm it has the latest data refuses the request (returns error or
  blocks) rather than serve stale/inconsistent data. Examples: ZooKeeper,
  etcd, HBase, MongoDB (with majority writes), Google Spanner.
- **AP system:** during a partition, sacrifice consistency. Every node keeps
  answering with whatever it has; replicas may diverge and reconcile later.
  Examples: Cassandra, DynamoDB (default), Riak, CouchDB.

```
        Normal operation (no partition)
        both C and A are available
                 |
      +----------+-----------+
      |     PARTITION!        |
      |  nodes can't talk     |
      +----------+-----------+
                 |
         must choose ONE:
      /                      \
   CP: refuse writes/reads    AP: keep serving,
   to preserve consistency    accept divergence
   (lose Availability)        (lose Consistency)
```

**Real-world usage.** A leader-based SQL replica set that requires majority
acknowledgment is CP: if the leader is isolated from the majority, it steps
down and writes fail. A Dynamo-style ring with sloppy quorums is AP: any
reachable replica accepts the write via hinted handoff.

**Trade-offs.**
- **Choose CP when correctness beats uptime for that data:** account
  balances, inventory decrements, distributed locks, config/service discovery
  (a stale leader election is catastrophic). You gain: no split-brain, no lost
  updates. You give up: writes/reads fail during partitions (reduced
  availability), and you pay coordination latency even in the happy path.
- **Choose AP when uptime beats freshness:** shopping carts, social feeds,
  view counts, product catalogs, telemetry. You gain: always-on writes, low
  latency, survives datacenter isolation. You give up: reads can be stale,
  concurrent writes conflict and need reconciliation.
- **Common mistake to avoid in interviews:** saying "we'll pick CA." CA is
  only meaningful for a single node or a system that assumes no partitions —
  not a realistic distributed design. Don't claim CA for a multi-node store.

---

## PACELC theorem

**Intuition.** CAP only talks about the partition case, which is rare. PACELC
(Abadi, 2012) extends it to describe behavior the *other 99.9%* of the time:

> **If** there is a **P**artition, choose between **A**vailability and
> **C**onsistency; **E**lse (normal operation), choose between **L**atency and
> **C**onsistency.

**How it works.** Even with a healthy network, giving strong consistency
requires coordination (quorum reads/writes, consensus round trips, waiting for
replicas). That coordination costs latency. So systems make a *second* choice:
in normal operation, do you pay latency for consistency, or do you answer fast
and looser?

**Classification of real systems (PACELC):**

| System | Partition (P) | Else (E) | Class |
|---|---|---|---|
| DynamoDB / Cassandra (default) | choose A | choose L | **PA/EL** |
| MongoDB | choose C (majority) | choose C | **PC/EC**\* |
| Google Spanner | choose C | choose C | **PC/EC** |
| PostgreSQL sync replication | choose C | choose C | **PC/EC** |
| PNUTS (Yahoo) | choose C | choose L | **PC/EL** |

\* MongoDB's tunables shift it; defaults lean CP/EC.

**Trade-offs.** PACELC is the more interview-useful framing because it forces
you to name the *everyday* cost. Saying "Spanner is CP" is incomplete; saying
"Spanner is PC/EC — it pays commit-wait latency (a few ms of TrueTime
uncertainty) on every write to guarantee external consistency, which is why
you accept higher write latency for global correctness" shows depth.
- **PA/EL (Cassandra, Dynamo):** fastest, most available; you accept
  staleness and conflict resolution work. Pick for high-scale, latency-
  sensitive, tolerant workloads.
- **PC/EC (Spanner, sync SQL):** correct always; you pay latency every write.
  Pick when a single wrong read is expensive.

**Precise reading of the mnemonic.** The formal statement quantifies over two
independent events. Write it as two conditionals: `IF partition THEN (A or C)`
**AND** `ELSE (during normal operation) (L or C)`. The two "C"s mean the same
thing (roughly linearizability), and the choices are largely *independent* — a
system's partition behavior does not dictate its normal-operation behavior. In
practice, though, the correlated corners dominate: **PA/EL** (Dynamo/Cassandra:
available + fast, sacrifice consistency in both branches) and **PC/EC**
(Spanner/sync-SQL: consistent in both, pay availability and latency). The
off-diagonal corners are the interesting ones:

- **PC/EL (rare):** consistent under partition but latency-favoring normally.
  **PNUTS/Yahoo Sherpa** is the canonical example — its normal-case reads may
  return a slightly stale but *consistent* per-record version to save latency,
  yet it refuses to violate its per-record timeline during a partition.
- **PA/EC (rare):** would give up consistency only during partitions but pay
  for it in normal operation — an unusual posture, since if you already pay for
  consistency normally you usually want it under partition too.

**A subtlety interviewers probe:** PACELC's "C" is not truly binary — a system
can be `EL` for some operations and `EC` for others (tunable consistency), so
the classification describes a *default*, not an absolute. Saying "Cassandra is
PA/EL by default, but a `QUORUM/QUORUM` path is effectively EC for that query"
is the precise answer.

---

## Strong versus eventual consistency spectrum

**Intuition.** Consistency is not binary. It is a spectrum from "every read
reflects all prior writes instantly, globally" (strong) down to "if writes
stop, replicas will *eventually* converge to the same value" (eventual), with
many useful stops in between.

```
STRONG  <-------------------------------------------------->  WEAK
Linearizable | Sequential | Causal | Read-your-writes /       | Eventual
             |            |        | Monotonic (session)       |
more coordination, higher latency  <---->  less coordination, lower latency
less availability under partition          higher availability
```

- **Strong consistency (linearizable):** the system behaves as if there is one
  copy of the data and all operations happen in a single real-time order.
- **Eventual consistency:** replicas may return different values temporarily;
  absent new writes, they converge. No ordering or recency guarantee in the
  interim.
- **Intermediate/"tunable":** causal consistency, session guarantees, and
  quorum-tuned reads land between the extremes.

**How it works.** Strong consistency needs a coordination point — a leader, a
consensus quorum, or synchronous replication — so all readers funnel through
an agreed order. Eventual consistency lets any replica accept writes and
propagate asynchronously (gossip, replication log), so there is no blocking.

**Real-world usage.** DNS is famously eventual (TTL-based propagation). S3
offered eventual consistency for years, then moved to **strong read-after-
write consistency for all operations in Dec 2020** — a great interview example
that "eventual" is a choice, not a limitation, and can be tightened when the
business needs it. Bank ledgers use strong consistency; Amazon shopping carts
use eventual with merge-on-read.

**Trade-offs.**
- **Strong:** gain simple application logic (no stale reads, no conflict
  code), lose latency and availability, and add a scaling bottleneck (the
  coordination point). Pick when incorrect reads cause real harm.
- **Eventual:** gain low latency, high availability, easy multi-region and
  horizontal scale; lose the guarantee that a read is current — the
  application must tolerate or resolve staleness/conflicts. Pick for
  high-volume, human-tolerant data.
- The key interview move: **don't apply one consistency level to the whole
  system.** Different data classes in the same product want different points
  on the spectrum (e.g., a bank keeps the ledger strong but the "recent
  transactions" feed eventual).

---

## Session and client-centric consistency guarantees

These are practical guarantees defined from a single client's perspective.
They're cheaper than global strong consistency but eliminate the most
jarring anomalies users notice.

**Read-your-writes (read-after-write).** After you write a value, your own
subsequent reads reflect it. Without it, a user updates their profile, reloads,
and sees the old value — a classic bug when reads go to async replicas.
*How:* route a user's reads to the primary (or to a replica known to have
their write) for a window; or track the write's version/LSN in a cookie and
require replicas to be at least that up to date.

**Monotonic reads.** A client never sees time go backwards: once you've read a
value, you won't later read an older one. Violated when successive reads hit
different lagging replicas. *How:* pin a session to one replica (sticky
routing) or carry a minimum-version token.

**Monotonic writes.** Writes from one client are applied in the order issued.
*How:* route a session's writes through one primary / order by session
sequence.

**Writes-follow-reads (causal within a session).** If you read a value and then
write, your write is ordered after the write you read.

**Trade-offs.**
- These "session guarantees" are the **sweet spot for user-facing apps on
  eventually-consistent stores**: you get rid of the confusing anomalies
  (seeing your own edit disappear) without paying for global linearizability.
- Cost: **sticky routing** reduces load-balancing freedom and hurts you when
  the pinned replica dies (you must fail over and may briefly break the
  guarantee). Version-token approaches add metadata to every request and can
  force a read to wait for a replica to catch up (latency spike) or fall back
  to the primary (load on primary).
- Pick session guarantees when: you're already AP/eventual for scale but the
  UX demands "my own actions are consistent." This is the default for most
  social/product apps.

---

## Causal consistency

**Intuition.** Preserve cause-and-effect ordering: if operation A "happened
before" B (B could have been influenced by A), everyone sees A before B.
Operations that are concurrent (neither influenced the other) may be seen in
different orders by different replicas — and that's allowed.

Classic example: a comment thread. "Question" then "Answer" is causally
ordered; everyone must see the question before its answer. Two unrelated
questions posted concurrently can appear in either order to different viewers
without harm.

**How it works.** Track causal dependencies with **logical clocks** — Lamport
timestamps or vector clocks — attached to each write. A replica delays making a
write visible until all writes it *depends on* have been applied locally.
There is no global total order and no consensus, so it doesn't require a leader
or blocking quorum.

**Real-world usage.** COPS and Bayou were research systems that popularized it;
MongoDB's causal-consistency sessions provide read-your-writes + monotonic
guarantees via cluster time; many collaborative and messaging apps enforce
causal ordering of messages.

**Trade-offs.**
- Causal is the **strongest consistency you can have while remaining fully
  available under partition** (a well-known result: causal+ is the ceiling for
  AP systems). You gain intuitive ordering (no "answer before question")
  *and* availability.
- Cost: you must **track and ship dependency metadata** (vector clocks grow
  with the number of writers; dependency checking adds overhead), and it does
  **not** order concurrent writes — you still need conflict resolution for
  those. It also doesn't give you linearizability (no real-time recency across
  clients).
- Pick causal when ordering matters for correctness/UX but global agreement is
  too expensive: messaging, comments, collaborative editing, social graphs.

---

## Sequential consistency and the model hierarchy

**Intuition.** Between linearizability (strongest single-object model) and
causal consistency sits **sequential consistency** (Lamport, 1979). It requires
that all operations appear in **some single total order**, and that this order
respects **each individual process's program order** — but it does **not** have
to respect real (wall-clock) time across processes. So everyone agrees on one
interleaving, but that interleaving may reorder operations from different
clients relative to when they actually happened.

**The precise ladder (strongest to weakest for single-object reads/writes):**

| Model | Single global order? | Respects real-time across clients? | Respects per-client program order? | Available under partition? |
|---|---|---|---|---|
| Linearizable | yes | **yes** | yes | no |
| Sequential | yes | no | yes | no |
| Causal (causal+) | no (only causal order) | no | yes | **yes** |
| Eventual | no | no | no | yes |

**The one-line distinctions (memorize these):**
- **Linearizable = sequential + real-time.** If op A finishes (in wall-clock)
  before op B starts, linearizability forces A before B in the order; sequential
  does not.
- **Sequential = causal + a single total order.** Sequential makes *concurrent*
  operations agree on one order everywhere; causal lets different replicas order
  concurrent (independent) operations differently.
- **Causal = eventual + happens-before.** Causal adds the guarantee that
  cause precedes effect everywhere; eventual guarantees only convergence.

**The canonical sequential-but-not-linearizable example.** Two clients each
post to their own timeline; a third reads. Under sequential consistency all
readers see the *same* interleaving of the two posts — but that interleaving
can put a post that happened *later* in wall-clock time *before* one that
happened earlier, as long as it is consistent with each poster's own order.
Linearizability forbids this; sequential allows it. This is exactly why
sequential consistency is composable within a process but "feels" laggy across
processes.

**Why it is rarely a design target.** Sequential consistency is (a) still not
available under partition — it needs a global total order, so it is a CP-class
model — yet (b) does not give the real-time recency that makes linearizability
useful for locks/leader-election. So it offers most of the *cost* of
linearizability with less of the *benefit*; real systems usually pick
linearizable (for the critical core) or causal+/eventual (for the available
surface) and skip the middle. It shows up mainly in shared-memory/CPU cache
coherence discussions and as an interview probe to see if you know the ladder.

---

## Testing and violating consistency models

A senior signal is knowing **how each guarantee is empirically checked** — this
is what tools like **Jepsen** (Kyle Kingsbury) do: generate concurrent
histories, then ask "does a valid ordering exist that explains this history
under model X?"

- **Linearizability — checked against real time.** Record each op's
  invocation and response wall-clock. The **Wing-Gong / Knossos linearizability
  checker** searches for a single total order where each op takes effect at a
  point inside its [invoke, response] interval and reads return the last write.
  *Violation signature:* a read returns a value that was already overwritten by
  a write that **completed before the read began** ("stale read"), or a
  successful write is later invisible ("lost update"). This search is NP-hard in
  general, so checkers bound history length.
- **Sequential — checked ignoring real time.** Same as linearizable but the
  found total order need only respect each process's program order, not the
  wall-clock intervals. *Violation signature:* no single interleaving exists
  that is consistent with every client's own operation order.
- **Causal — checked against the happens-before graph.** Build the
  happens-before (dependency) DAG from operation metadata; a history is causal
  if each read observes a value whose writes include all causal predecessors.
  *Violation signature:* a client sees an effect (the "answer") without the
  cause (the "question") it depended on — a causality violation.
- **Read-your-writes / monotonic reads — per-client checks.** RYW is violated
  if a client's read misses its own prior write; monotonic reads is violated if
  a client reads value v then later reads an *older* value than v.
- **Eventual — a liveness (not safety) property.** You cannot violate it in a
  finite prefix; you can only observe non-convergence *after quiescence* (stop
  writing, wait, and check whether replicas still disagree). This is why
  "eventual" is untestable in bounded time and why Jepsen focuses on the
  stronger safety models.

**Interview gotcha:** linearizability and serializability failures look
different. A linearizability bug is a *stale/reordered single-object read*; a
serializability bug is an *anomaly across objects* (write skew, lost update,
phantom). Naming which class of anomaly you would look for tells the
interviewer you understand the model, not just its name.

---

## Linearizability versus serializability

These two words get conflated constantly; distinguishing them cleanly is a
strong senior signal.

**Linearizability** is a **recency/ordering guarantee about single objects**
(a register). It says: every operation appears to take effect atomically at
some instant between its invocation and response, consistent with **real
time**. If write W completes before read R begins (wall-clock), R must see W or
later. It's a *concurrency* property — the "C" in CAP.

**Serializability** is an **isolation guarantee about transactions** (groups of
operations over multiple objects). It says: the result of executing concurrent
transactions is equal to *some* serial (one-at-a-time) execution. It says
nothing about real time — that serial order need not match wall-clock order.

**Strict serializability** = serializability **+** linearizability: transactions
appear to execute one at a time, *and* that order respects real time. This is
what Spanner ("external consistency") and FaunaDB provide, and it's the gold
standard (and most expensive).

| Property | Scope | Guarantees real-time order? | Multi-object txns? |
|---|---|---|---|
| Linearizability | single object | yes | no |
| Serializability | multi-object txns | no | yes |
| Strict serializability | multi-object txns | yes | yes |

**How it works.** Linearizability comes from consensus/quorum on a single
register. Serializability comes from concurrency control: two-phase locking
(2PL), serializable snapshot isolation (SSI, as in PostgreSQL), or
deterministic ordering (Calvin/FaunaDB). Strict serializability layers a
real-time clock/consensus order (Spanner TrueTime) on top.

**Trade-offs.**
- **Serializable isolation** prevents all anomalies (write skew, phantoms) but
  costs throughput: 2PL causes lock contention and deadlocks; SSI aborts and
  retries under contention. Pick when correctness of multi-row invariants
  matters (e.g., "two doctors can't both go off-call").
- **Snapshot isolation (SI)** is a common weaker default (many "serializable"
  claims are actually SI): fast, no read locks, but allows **write skew**.
  Interview trap: MVCC "repeatable read" in Postgres/MySQL is SI, not truly
  serializable.
- **Linearizability without serializability** (e.g., a linearizable key-value
  store) gives fresh single-key reads but no cross-key transactional
  invariants — fine for a config store, insufficient for a bank transfer.
- Rule of thumb: **banking transfers want strict serializability**;
  a distributed lock or leader election wants **linearizability**; an
  analytics query wants only a **consistent snapshot**.

---

## Quorums, N, R, W and R plus W greater than N

**Intuition.** Instead of one leader, replicate data to **N** nodes and require
a **quorum** to agree. Reads contact **R** replicas; writes must be acknowledged
by **W** replicas. If **R + W > N**, the read set and write set must overlap by
at least one node, so a read is guaranteed to see the most recent write — a
**strict quorum**.

```
N = 3 replicas
W = 2 (write waits for 2 acks)
R = 2 (read queries 2, picks newest by version)
R + W = 4 > N = 3  -> overlap guaranteed -> strong-ish read
```

**How it works.** Each write carries a version (timestamp/vector clock). A read
gathers R responses and returns the newest; **read repair** updates the stale
replicas it saw. Tuning the numbers moves you along the consistency/latency
curve:

- **W=N, R=1:** fast reads, slow/fragile writes (any node down blocks writes).
- **W=1, R=N:** fast writes, slow reads; write is durable on only one node
  (risk of loss).
- **W=R=quorum (⌊N/2⌋+1):** balanced; tolerates minority failures.

**Real-world usage.** DynamoDB, Cassandra, Riak, and Voldemort expose N/R/W.
Cassandra uses consistency levels (ONE, QUORUM, LOCAL_QUORUM, EACH_QUORUM, ALL)
which are exactly quorum choices. `LOCAL_QUORUM` keeps quorum within one
datacenter to avoid cross-region latency.

**Trade-offs.**
- **R + W > N** gives you *quorum consistency* — but note it is **not full
  linearizability**: concurrent writes, sloppy quorums, and read-repair races
  can still expose anomalies. Interview nuance: strict quorum ≈ "strong-ish,"
  not a substitute for consensus.
- Larger W: more durable, more consistent, **higher write latency and lower
  write availability** (more nodes must be up). Larger R: fresher reads,
  higher read latency. You are literally dialing the CAP/PACELC knob per
  operation.
- **Sloppy quorum + hinted handoff (Dynamo/Cassandra):** to preserve
  availability during partitions, writes go to the first N *reachable* nodes
  (not the "home" nodes), storing hints to hand off later. This boosts
  availability (AP) but **breaks the R+W>N overlap guarantee** — you can read
  stale data even with quorum settings. Know this gotcha.
- Pick quorum tuning when you want **per-request** control: e.g., write with
  QUORUM but read with ONE for a low-latency, mostly-consistent feed; use
  QUORUM/QUORUM for the rare read that must be fresh.

---

## Anti-entropy: read repair, hinted handoff, Merkle trees

Quorum overlap only fixes staleness for replicas you *happen to touch* on a
read. Eventually-consistent stores need background mechanisms to converge the
replicas you don't touch. There are three complementary repair pathways, and
knowing when each fires is a strong Dynamo-lineage signal.

**1. Read repair (foreground, opportunistic).** On a read, the coordinator
gathers R responses, detects that some replicas returned an older version, and
pushes the newest version back to the stale ones — *synchronously* before
replying (blocking read repair) or *asynchronously* after replying. Cassandra
also does **probabilistic/background read repair** (`read_repair_chance`,
`dclocal_read_repair_chance` historically) to repair replicas not in the read
set. *Limitation:* only repairs keys that are actually read — cold data never
gets repaired this way.

**2. Hinted handoff (write-time, availability).** When a target replica is down
during a write, the coordinator stores a **hint** (the write plus its intended
recipient) locally and replays it when the replica recovers. This is what makes
**sloppy quorums** possible: the write is durable on N reachable nodes even if
they aren't the "home" nodes. *Gotcha:* hints have a TTL
(`max_hint_window_ms`, default 3 h in Cassandra); if a node is down longer, its
hints are dropped and you **must** rely on anti-entropy repair to converge, or
data stays divergent. Hinted handoff also does not by itself restore the
overlap guarantee — a read during the outage can still miss the hinted write.

**3. Anti-entropy repair (background, comprehensive) with Merkle trees.** To
reconcile *entire datasets* between two replicas without shipping all the data,
Dynamo/Cassandra/Riak build a **Merkle tree** (hash tree) over each replica's
key range: leaves hash individual keys/rows (or small partitions of them), and
each parent hashes its children. Two replicas exchange trees **top-down**: if
root hashes match, the ranges are identical and nothing is sent; if they
differ, they recurse only into the subtrees whose hashes differ, transferring
**only the divergent leaves**.

```
        Merkle tree diff (log N comparison)
        replica A root  ==  replica B root ?  -> equal: DONE, 0 data shipped
                 |  differ
          +------+------+
        h(L)           h(R)      compare children
       equal?         differ?  -> recurse only into R
                        |
                  ship only the mismatched leaf ranges
```

- **Cost/benefit:** comparison is **O(log N)** hash exchanges to *locate*
  differences instead of O(N) full-dataset transfer; you ship only what
  actually diverged. Cassandra's `nodetool repair` builds these trees; Dynamo
  and Riak use them for replica synchronization.
- **Gotchas:** building the tree requires reading the data (I/O heavy — repair
  is a scheduled, expensive operation); tree granularity trades precision for
  memory (too-coarse leaves over-transfer, too-fine leaves cost RAM); and a
  single differing key high in the range still forces recursing that subtree.
  Merkle repair is also how you close the gap left by dropped hints and
  unread cold data.

**Putting it together:** read repair handles hot data cheaply and immediately;
hinted handoff preserves availability and durability during short outages;
Merkle-tree anti-entropy is the backstop that guarantees *eventual* convergence
for everything else. Together they are the machinery behind the word
"eventual" in "eventual consistency."

---

## Conflict resolution: LWW, vector clocks, CRDTs

When multiple replicas accept writes (AP / multi-leader), concurrent updates
to the same key conflict. How you resolve them is a core design decision.

**Last-Write-Wins (LWW).** Attach a timestamp; on conflict, keep the highest
timestamp, discard the rest. *How:* wall-clock or logical timestamp per write.
- **Trade-off:** dead simple, no metadata growth, O(1) — but **silently loses
  data** (the discarded write vanishes) and depends on **clock synchronization**
  (skew → wrong winner). Cassandra uses LWW by default. Fine for
  last-writer-intent data (a user setting), dangerous for additive data (a
  cart, a counter). Interview red flag: using LWW for anything where lost
  writes matter.

**Vector clocks.** Each replica keeps a per-node counter vector; comparing two
vectors tells you if one write *happened-before* the other or if they are
**concurrent**. *How:* on write, increment your node's entry; on read, if
vectors are concurrent, surface **siblings** to the application (or a merge
function) to reconcile.
- **Trade-off:** correctly *detects* conflicts (no silent loss) and preserves
  causality — but doesn't *resolve* them (pushes work to the app), and the
  **vector grows with the number of writers** (mitigated by pruning, dotted
  version vectors). Riak and Dynamo use them. Pick when you can't afford to
  lose concurrent writes and can write merge logic.

**CRDTs (Conflict-free Replicated Data Types).** Data structures whose merge
operation is commutative, associative, and idempotent, so replicas
**automatically converge** regardless of order or duplication — no coordination,
no central resolver. Types: counters (G-Counter, PN-Counter), sets (G-Set,
OR-Set), registers (LWW/MV), sequences (RGA/Logoot for text).
- **Trade-off:** gives **strong eventual consistency** with zero coordination
  and no lost updates — ideal for offline-first and collaborative apps. Cost:
  **metadata/tombstone overhead**, limited to operations expressible as CRDTs,
  and the merged result must be *semantically* acceptable (an OR-Set add-wins
  bias may resurrect a deleted item). Used by Redis (Active-Active/CRDB),
  Riak, Automerge/Yjs (Google Docs-style collaboration), Figma, and Amazon's
  internal carts historically used merge semantics.

| Strategy | Detects conflicts? | Loses data? | Metadata | App effort | Use when |
|---|---|---|---|---|---|
| LWW | no | yes (silently) | tiny (timestamp) | none | last-intent wins; clocks trusted |
| Vector clocks | yes | no | grows w/ writers | high (merge) | must not lose concurrent writes |
| CRDTs | n/a (auto-merge) | no | moderate | low (once modeled) | collaborative / offline / counters |

---

## CRDT types in depth: counters, sets, registers

The previous section named CRDTs; here is the internal machinery an interviewer
will push on, because each type has a *specific* convergence trick and a
*specific* failure mode.

**State-based (CvRDT) vs operation-based (CmRDT).** Two families:
- **State-based (convergent):** replicas periodically ship their **whole
  state**; merge is a **join** on a semilattice (a function that is
  commutative, associative, idempotent). Robust to duplicate/reordered/lost
  messages (idempotent merge tolerates re-delivery) but heavier on bandwidth.
- **Operation-based (commutative):** replicas ship **operations**, which must
  be **commutative** and delivered **exactly once in causal order** (needs a
  reliable causal-broadcast layer). Lighter payloads, stronger delivery
  assumptions. Both converge to the same result (**strong eventual
  consistency**): replicas that have received the same set of updates are in the
  same state, with no consensus.

**G-Counter (grow-only counter).** State = a vector of per-replica counts;
increment bumps *your own* entry; **merge = element-wise max**; **value = sum**
of the vector. Element-wise max is idempotent and commutative, so it converges
and never loses an increment. *Limit:* increments only — cannot decrement.

**PN-Counter (positive-negative counter).** Two G-Counters, `P` (increments)
and `N` (decrements); **value = sum(P) − sum(N)**. Supports both directions.
This is the correct structure for a distributed **like/view counter that must
never lose a tick** and needs no coordination. *Gotcha:* the state grows with
the number of replicas (one entry each), and a naive decrement below zero is
representable — you must guard semantics (e.g., non-negative inventory can't be
a plain PN-Counter, because concurrent decrements can drive it negative; that
needs a **bounded/escrow counter** or coordination).

**G-Set / 2P-Set.** G-Set is add-only (union merge). **2P-Set** adds a
"tombstone" set for removals — but once removed, an element can **never be
re-added** (the tombstone wins forever), which is usually the wrong semantics.

**OR-Set (Observed-Remove Set).** The practical set CRDT. Each *add* attaches a
unique tag (e.g., (element, unique-id)); a *remove* removes only the tags it has
**observed**. Concurrent add-and-remove of the same element resolves
**add-wins**: an add with a tag the remove never saw survives. This is why a
concurrently-deleted item can "**resurrect**" — the classic CRDT gotcha (Amazon
Dynamo's shopping-cart merge had the analogous "deleted item comes back"
behavior). *Cost:* tombstone/tag metadata accumulates and must be garbage
collected.

**LWW-Register vs MV-Register.** For a single value:
- **LWW-Register:** keep the value with the highest timestamp; simple but
  **loses the concurrent write** (and is clock-skew sensitive) — same trade-off
  as LWW conflict resolution.
- **MV-Register (multi-value):** keeps **all concurrent values as siblings**
  (like vector-clock siblings) and surfaces them for application merge — no
  silent loss, but pushes resolution to the app.

**Sequence/list CRDTs (RGA, Logoot, LSEQ, Treedoc).** For collaborative text
editing: assign dense, totally-ordered position identifiers between existing
elements so concurrent inserts interleave deterministically. Power
Automerge/Yjs, and underlie Google-Docs / Figma-style collaboration.

| CRDT | Merge rule | Guarantee | Main gotcha |
|---|---|---|---|
| G-Counter | element-wise max, value=sum | no lost increment | increment-only |
| PN-Counter | two G-Counters, P−N | no lost inc/dec | can go negative; per-replica growth |
| OR-Set | add-wins with unique tags | no lost add | deleted item can resurrect; tombstone GC |
| 2P-Set | union + tombstones | removals stick | element can never be re-added |
| LWW-Register | highest timestamp | converges | loses concurrent write; clock-sensitive |
| MV-Register | keep concurrent siblings | no lost write | app must merge siblings |
| RGA/Logoot | dense position ids | converges, ordered | id/metadata growth |

**The unifying property to state in an interview:** CRDTs give **strong
eventual consistency** — a *safety* property that any two replicas which have
delivered the same updates hold the same state, achieved purely through
algebraic merge (semilattice join) with **zero coordination**. What they cannot
do is enforce a **global invariant** that requires seeing all replicas at once
(e.g., "total inventory ≥ 0", "unique username") — those still need consensus
or single-writer ownership.

---

## Consensus: Paxos and Raft intuition

**Intuition.** Consensus is how a set of nodes **agree on a single value / an
ordered log of operations** despite failures — the foundation of CP systems,
leader election, and replicated state machines. If you can agree on an ordered
log, you can build a linearizable database on top (apply the log
deterministically on every replica).

**Paxos.** The original (Lamport). A *proposer* runs a two-phase protocol
(prepare/promise, then accept/accepted) with a majority of *acceptors*; a value
is chosen once a majority accepts it. Correct but notoriously hard to
understand and implement; **Multi-Paxos** amortizes the prepare phase by
electing a stable leader. Used inside Google Chubby and Spanner.

**Raft.** Designed for *understandability* (Ongaro & Ousterhout, 2014).
Decomposes consensus into: **leader election** (nodes are follower/candidate/
leader; a candidate with an up-to-date log wins a majority vote for a term),
**log replication** (leader appends entries, replicates to followers, commits
once a majority stores them), and **safety** (election restrictions guarantee a
new leader has all committed entries). Used by etcd, Consul, CockroachDB,
TiKV, RabbitMQ quorum queues, Kafka's KRaft.

```
        Raft happy path (N=5, majority=3)
Client -> Leader: write X
Leader appends to log, sends AppendEntries to 4 followers
>=2 followers ack  ->  entry committed (leader + 2 = 3)
Leader applies to state machine, replies to client
```

**Key properties.** Both need a **majority quorum** (⌊N/2⌋+1), so they tolerate
**⌊(N-1)/2⌋ failures** (2 of 5, 1 of 3). They provide **linearizable** writes
through the leader. They are **not Byzantine-tolerant** (assume nodes fail by
crashing, not lying — that needs PBFT/blockchain protocols).

**Trade-offs.**
- Consensus gives you correctness (single agreed order, no split-brain) at the
  cost of **latency (≥1 round trip to a majority per commit)** and **write
  throughput bounded by the leader** (all writes funnel through it). It also
  needs an **odd cluster size** and a majority alive — a 2-of-4 partition
  halts progress.
- **Why odd numbers:** 5 nodes tolerate 2 failures, 6 nodes also tolerate only
  2 (majority = 4) but cost more and are slower — so 3 or 5 is standard.
- Raft vs Multi-Paxos: comparable performance; Raft wins on
  understandability/operability, which is why modern systems pick it. Mention
  this if asked "why not Paxos."
- **When to use consensus:** metadata/config (etcd, ZooKeeper), leader
  election, distributed locks, and the control plane of databases — small,
  critical, low-write-rate state. **When not to:** the high-throughput data
  plane; funneling millions of ops/sec through one Raft leader is a
  bottleneck — shard it (per-partition Raft groups, as CockroachDB/TiKV do) or
  use an AP store.

---

## Tunable consistency: Dynamo and Cassandra style

**Intuition.** Rather than baking one consistency level into the system, expose
it as a **per-operation knob** so the application chooses freshness vs
latency/availability for each request.

**How it works.** In Cassandra you set a **consistency level (CL)** per query:
`ONE`, `TWO`, `QUORUM`, `LOCAL_QUORUM`, `EACH_QUORUM`, `ALL`, plus `LOCAL_ONE`.
Combined with replication factor N, `R + W > N` (e.g., write QUORUM + read
QUORUM) yields strong-ish reads; `write ONE + read ONE` is fastest/most
eventual. DynamoDB exposes a simpler switch: **eventually consistent reads**
(default, cheaper, ~half the cost and lower latency) vs **strongly consistent
reads** (routed to reflect all prior writes, cannot be served from all AZs, no
global-table cross-region strong reads). Dynamo also adds `ConsistentRead`,
transactions (TransactWriteItems), and global tables (multi-region, LWW,
eventual across regions).

**Real-world usage.** A single Cassandra keyspace can serve a low-latency
"recent activity" read at `LOCAL_ONE` and a "did this payment already post?"
check at `LOCAL_QUORUM`, from the same data — the application decides. Discord
famously runs Cassandra/ScyllaDB for trillions of messages with tuned CLs.

**Trade-offs.**
- **Gain:** one storage system serves many workloads; you pay for consistency
  only where you need it, per request. This is the most flexible point in the
  design space.
- **Give up:** the burden moves to *developers* — every query is a correctness
  decision, and a wrong CL is a subtle bug (e.g., reading `ONE` after writing
  `ONE` can miss your own write). Reasoning becomes non-local. Tunable
  consistency is still **not linearizable** in general (sloppy quorums,
  read-repair races); Cassandra added **LWT (lightweight transactions)** using
  Paxos for the rare compare-and-set that truly needs linearizability — at
  much higher latency (4 round trips).
- **LOCAL_QUORUM vs QUORUM vs EACH_QUORUM:** LOCAL keeps latency low by staying
  in-region but a whole-region outage can lose recent writes; EACH_QUORUM
  requires a quorum in *every* DC (strong cross-region, high latency, low
  availability). Choosing among these is a classic multi-region trade-off
  question.

---

## Why CP versus AP is an oversimplification

Kleppmann's "Please stop calling databases CP or AP" is a favorite senior
talking point. The label is misleading for several concrete reasons:

- **The choice only exists *during a partition*.** CAP says nothing about the
  99.9% of the time there is no partition. A "CP" database is not perpetually
  sacrificing availability; it only refuses service on the minority side *while
  a partition is active*. This is why PACELC (which describes normal operation)
  is the more honest framing.
- **A system is not one point — it depends on configuration and even on the
  operation.** MongoDB with `w:1` and reads from secondaries behaves AP-ish;
  the same MongoDB with `w:majority` + `readConcern:linearizable` behaves CP.
  Cassandra is AP by default but a `QUORUM/QUORUM` path or an LWT is CP-ish for
  that request. The label describes a *default*, not an invariant.
- **CAP's "C" is only linearizability and "A" is a very strict total
  availability.** Many real systems provide useful guarantees (causal, session,
  serializable-but-not-linearizable) that CAP's binary vocabulary cannot even
  name. A store can be unavailable under CAP's strict definition yet perfectly
  useful, or "available" yet returning data too stale to use.
- **The proof's model is narrow.** Gilbert & Lynch proved the impossibility for
  a specific formal model (asynchronous network, total availability,
  single-object linearizability). Real partitions are messy (asymmetric,
  partial, transient, one-way), GC pauses and slow disks *look* like partitions,
  and "availability" is a spectrum (99.9 vs 99.999), not a bit.
- **Latency is the omitted variable.** In practice you rarely hit a clean
  partition; you hit *slowness*. The everyday engineering trade is consistency
  vs latency (PACELC's else-branch), and a node that is merely slow is
  indistinguishable from a partitioned one within a timeout — so a "CP" system
  under load can *look* unavailable and an "AP" system can *look* consistent
  when replication happens to keep up.

**The senior framing:** don't classify the database; classify the *operation on
a data class under a specific failure mode*. "For the balance-decrement path we
require linearizable writes, so under a partition that path is unavailable on
the minority side; for the catalog read path we accept staleness, so it stays
available" — that sentence says more than any CP/AP label.

---

## Consistency of real systems

Concrete, correct guarantees for the systems interviewers name — get these
exact, because vague claims here are a common senior-level miss.

**Amazon Dynamo (2007 paper) vs DynamoDB (the AWS service).** The *paper* is the
archetypal AP, leaderless, sloppy-quorum, vector-clock store with
client/merge-side conflict resolution — it deliberately chose availability and
made the app reconcile siblings. **DynamoDB the service is different and often
misdescribed:** it is a **single-leader-per-partition, replicated across 3 AZs**
design. It offers **eventually consistent reads by default** and
**strongly consistent (read-after-write) reads** on request (from the leader
replica, same-region only). It provides **ACID transactions**
(`TransactWriteItems`/`TransactGetItems`) and **conditional writes** for
compare-and-set. **Global Tables** are multi-region **active-active with
last-writer-wins** and are **eventually consistent across regions** (no strong
cross-region reads). So DynamoDB is closer to PA/EL by default but tunable to
EC per-request within a region.

**Apache Cassandra / ScyllaDB.** Leaderless, tunable per-query consistency
level over replication factor N. Default posture PA/EL; `R+W>N` (e.g.,
`QUORUM/QUORUM` or `LOCAL_QUORUM/LOCAL_QUORUM`) gives strong-*ish* reads but
**not linearizability**. For true linearizable compare-and-set it offers
**LWT (lightweight transactions)** via **Paxos**, at ~4 round trips.
Conflict resolution is **LWW by cell timestamp** (so clock skew and lost
concurrent writes are real risks). `LOCAL_QUORUM` stays in-region;
`EACH_QUORUM` requires a quorum in every DC.

**Google Spanner.** Sharded, each shard a **Paxos group**; provides **strict
serializability** globally, marketed as **external consistency**. The trick is
**TrueTime**: GPS + atomic-clock-backed API that returns a bounded time interval
`[earliest, latest]` with uncertainty ε (a few ms). On commit, Spanner does
**commit-wait** — it waits out the uncertainty ε so that no later transaction
can be assigned an earlier timestamp — which is why writes pay a few ms of extra
latency for globally correct real-time ordering. PC/EC. Read-only transactions
at a timestamp are lock-free.

**CockroachDB.** Open-source Spanner-inspired: **per-range Raft groups**,
**serializable isolation** by default (SSI). Without atomic clocks it uses NTP
plus a configured **max clock offset** and a technique (uncertainty intervals +
read restarts) to provide serializability; it does **not** guarantee full
linearizability/strict-serializability across all keys the way TrueTime does
(it targets serializable + "single-key linearizable"), and it will **crash a
node whose clock drifts beyond max offset** to preserve safety. PC/EC-ish.

**MongoDB.** Single primary per replica set; tunable **write concern**
(`w:1` … `w:majority`) and **read concern** (`local`, `majority`,
`linearizable`, `snapshot`) plus **causal-consistency sessions** (cluster time
gives RYW + monotonic reads). With `w:majority` + `readConcern:majority` it is
CP-leaning (PC/EC); relaxed concerns move it toward availability/latency.
Multi-document ACID transactions exist since 4.0.

**ZooKeeper / etcd / Consul.** Consensus-backed (ZAB / Raft), **linearizable
writes**. Nuance: **ZooKeeper reads are *not* linearizable by default** — a
follower can serve a slightly stale read; you must issue a `sync` before the
read (or use etcd's linearizable-read option, which routes through the leader /
uses ReadIndex) to get a linearizable read. Small, critical, CP control-plane
state.

**Riak.** Closest production heir to the Dynamo paper: leaderless, N/R/W,
**vector clocks (dotted version vectors) surfacing siblings**, and native
**CRDT data types** (counters, sets, maps, registers, flags) for automatic
convergence. AP by default.

| System | Default posture | Strongest available | Conflict handling | Notable mechanism |
|---|---|---|---|---|
| DynamoDB (service) | PA/EL | EC read + ACID txn (in-region) | LWW (global tables) / conditional writes | leader-per-partition, 3-AZ |
| Cassandra/Scylla | PA/EL | LWT (Paxos, linearizable CAS) | LWW by cell timestamp | tunable CL, `R+W>N` |
| Spanner | PC/EC | strict serializability | 2PC + Paxos, single-writer | TrueTime + commit-wait |
| CockroachDB | PC/EC-ish | serializable (SSI) | Raft per range, MVCC | max-clock-offset, read restarts |
| MongoDB | tunable (PC/EC w/ majority) | linearizable read / ACID txn | single primary | write/read concerns |
| etcd/ZooKeeper | PC/EC | linearizable | consensus (no conflicts) | Raft / ZAB; ZK stale reads sans `sync` |
| Riak | PA/EL | causal (CRDTs) | vector clocks / CRDTs | dotted version vectors |

---

## Choosing consistency: banking, feed, cache, and more

This is the payoff section — mapping data classes to consistency choices with
explicit reasoning. In interviews, **decompose the system by data type** and
justify each.

**Banking / payments / ledgers → strong (strict serializability, CP).**
Double-spending, lost debits, or negative balances are unacceptable. Use
consensus-backed or synchronously-replicated storage; require majority writes;
prefer serializable transactions for transfers. You accept higher latency and
that writes fail during partitions — correctness dominates. Modern pattern:
**event-sourced ledger** (append-only immutable events) + **idempotency keys**
to make retries safe, often with the actual money movement behind a
strongly-consistent core (Spanner/CockroachDB) while *derived* views are
eventual. Stripe/ledger systems use idempotency keys precisely for this.

**Social feed / timeline / likes / view counts → eventual (AP).**
A like count off by 3 for two seconds harms no one; availability and latency
dominate at massive scale. Use eventual replication, CRDT counters for
likes/views, and **read-your-writes for the author** (you must see your own
post immediately) via sticky routing or "write to your own cache." Fan-out and
feed generation are async. Twitter/Meta timelines are eventual.

**Cache → eventual by design (with a freshness policy).**
Caches are intentionally stale; the design question is the invalidation/expiry
strategy (TTL, write-through, write-back, cache-aside) and tolerating the
inconsistency window. For read-your-writes, invalidate or update the cache on
write. Never treat a cache as a source of truth for strong data.

**Inventory / seat booking / limited stock → strong-ish, often CP for the
decrement.** Overselling is a real cost. Pattern: strong consistency (or a
consensus/conditional-write, e.g., DynamoDB conditional `UpdateItem`) on the
critical decrement; eventual for the browse/catalog view. Some systems
deliberately allow slight oversell and reconcile (AP + compensation) when the
business tolerates it — a trade-off worth naming.

**Messaging / chat → causal + per-conversation ordering.** Messages within a
conversation must be causally ordered; different conversations are independent.
Read-your-writes so the sender sees their message. Discord/WhatsApp scale this
with sharded ordered logs.

**Config / service discovery / leader election / locks → linearizable, CP.**
A stale config or two leaders is catastrophic. Use etcd/ZooKeeper/Consul
(Raft/Paxos). Small data, low write rate, correctness paramount — the textbook
consensus use case.

**Modern patterns that shape consistency choices:**
- **CQRS** (Command Query Responsibility Segregation): separate the write
  model (can be strongly consistent) from read models (materialized,
  eventually consistent projections). You explicitly accept read-side
  staleness for read scalability.
- **Event sourcing + CDC (Change Data Capture):** the log of events is the
  source of truth; downstream stores/search indexes/caches are eventually
  consistent derived views updated via CDC (Debezium/Kafka). Great for audit
  and rebuild, but every consumer must handle lag and out-of-order/at-least-
  once delivery (idempotency).
- **Outbox pattern:** to avoid dual-write inconsistency between DB and message
  bus, write the event to an outbox table in the *same transaction*, then a
  relay publishes it — trading a bit of latency for consistency between state
  and events.
- **Cell-based architecture:** partition the whole stack into isolated cells
  to bound blast radius; consistency is kept strong *within* a cell and
  eventual *across* cells, limiting the scope where you need coordination.
- **Edge / CDN / vector-DB (RAG) reads:** globally replicated read caches and
  embeddings are inherently eventual; freshness (index/embedding lag) is the
  trade-off you manage for low-latency global reads.

**Trade-offs summary heuristic.** Ask three questions per data class:
1. *What's the cost of a stale or lost read/write?* High → strong/CP. Low →
   eventual/AP.
2. *What's the latency/availability budget?* Tight/global → push toward
   eventual, session guarantees, LOCAL_QUORUM. Loose → afford consensus.
3. *Can conflicts be auto-merged?* Yes (counts, sets) → CRDT. No (money) →
   serializable transactions or single-writer.

---

## Trade-offs and when to use what

A consolidated decision guide you can recite.

| Requirement | Pick | Why / cost |
|---|---|---|
| Never wrong balance, transfers | Strict serializability (Spanner, CockroachDB, sync SQL) | Correct; pay commit latency + partition-time write failures |
| Config, locks, leader election | Linearizable via consensus (etcd, ZooKeeper) | Small critical state; majority must be alive |
| Global low-latency writes, tolerant data | AP eventual (Cassandra, DynamoDB) | Always-on, fast; stale reads + conflict handling |
| Per-request control | Tunable CL (Cassandra, Dynamo) | Flexible; dev must choose correctly each query |
| Concurrent adds/removes must not lose | Vector clocks or CRDT | No lost writes; metadata + merge complexity |
| Counters, collaborative editing, offline | CRDT | Auto-converge; metadata overhead, must fit CRDT model |
| "See my own edit" on eventual store | Session guarantees (RYW/monotonic) | Cheap UX fix; sticky routing / version tokens |
| Ordered comments/messages, still available | Causal consistency | Best AP can do; dependency tracking, no total order |
| Read-heavy scale, tolerate lag | CQRS + eventual read models / CDC | Read scalability; staleness + idempotency work |

**Universal trade-off axes (name these in the interview):**
- **Consistency ↔ Latency** (PACELC "else" branch): stronger reads/writes cost
  round trips.
- **Consistency ↔ Availability** (CAP "partition" branch): during a partition
  you can't have both.
- **Coordination ↔ Throughput/Scalability:** leaders and quorums bottleneck;
  leaderless/eventual scales flatter.
- **Simplicity ↔ Flexibility:** one global consistency level is simple to
  reason about; tunable/per-data-class is flexible but easy to get wrong.
- **Metadata/complexity ↔ Correctness of merges:** LWW is cheap but lossy;
  vector clocks/CRDTs are correct but heavier.

The senior answer is almost never "the whole system is CP" or "the whole
system is AP." It's: *"Decompose by data class, keep the small critical core
strongly consistent (CP/consensus), make the large tolerant surface
eventually consistent (AP) with session guarantees for UX, resolve conflicts
with CRDTs where they auto-merge and transactions where they can't, and name
the latency/availability price of each."*

---

## Common interview follow-up questions

1. "You said this store is CP. What exactly happens to a client on the
   minority side of a partition?" (It gets errors/timeouts; writes are
   rejected to avoid split-brain.)
2. "Is `R + W > N` the same as linearizability? Why not?" (No — sloppy
   quorums, concurrent writes, and read-repair races still allow anomalies.)
3. "Why is CA not a real option?" (Partitions are unavoidable; CA only holds
   for single-node or no-partition assumptions.)
4. "Difference between linearizability and serializability? Which does a bank
   transfer need?" (Single-object recency vs multi-object isolation; a
   transfer needs strict serializability.)
5. "Cassandra QUORUM read after QUORUM write — is that strong consistency?"
   (Strong-ish/quorum consistency, not full linearizability; LWT/Paxos needed
   for true CAS.)
6. "Your users report seeing their profile edit disappear on refresh. Fix?"
   (Read-your-writes: route to primary or use version tokens / sticky replica.)
7. "How do you resolve two concurrent writes to a shopping cart without losing
   items?" (Not LWW — use a merge/CRDT set or vector-clock siblings.)
8. "How many node failures does a 5-node Raft cluster tolerate, and why odd?"
   (2 failures; even sizes don't improve fault tolerance but cost latency.)
9. "Design a globally-available like button that never loses a like." (CRDT
   PN-counter, eventual, per-region aggregation.)
10. "When would you deliberately choose eventual consistency for money-adjacent
    data?" (Derived views/reporting; keep the ledger strong, projections
    eventual with reconciliation.)
11. "What does Spanner buy with TrueTime and what does it cost?" (External /
    strict-serializable consistency globally; costs commit-wait latency.)
12. "How does the outbox pattern prevent dual-write inconsistency?" (Event and
    state written in one transaction; relay publishes asynchronously.)

## References

- Eric Brewer, "CAP Twelve Years Later: How the 'Rules' Have Changed," IEEE
  Computer, 2012.
- Seth Gilbert & Nancy Lynch, "Brewer's Conjecture and the Feasibility of
  Consistent, Available, Partition-Tolerant Web Services," 2002 (the CAP
  proof).
- Daniel Abadi, "Consistency Tradeoffs in Modern Distributed Database System
  Design" (PACELC), IEEE Computer, 2012; and his blog "Problems with CAP."
- Martin Kleppmann, *Designing Data-Intensive Applications* (DDIA), O'Reilly —
  Ch. 5 (Replication), 7 (Transactions/Isolation), 9 (Consistency &
  Consensus). Also his "Please stop calling databases CP or AP" post.
- Werner Vogels et al., "Dynamo: Amazon's Highly Available Key-value Store,"
  SOSP 2007.
- Diego Ongaro & John Ousterhout, "In Search of an Understandable Consensus
  Algorithm (Raft)," USENIX ATC 2014; raft.github.io visualization.
- Leslie Lamport, "Paxos Made Simple," 2001; "Time, Clocks, and the Ordering
  of Events" (logical clocks), 1978.
- Corbett et al., "Spanner: Google's Globally-Distributed Database," OSDI 2012
  (TrueTime, external consistency).
- Shapiro et al., "Conflict-free Replicated Data Types (CRDTs)," 2011.
- Alex Xu, *System Design Interview* Vol. 1 & 2, and ByteByteGo blog/newsletter
  (CAP, consistency, Dynamo-style stores, consensus).
- donnemartin/system-design-primer (GitHub) — Consistency patterns,
  Availability patterns sections.
- AWS: "Amazon S3 now delivers strong read-after-write consistency" (Dec 2020);
  DynamoDB Developer Guide (read consistency, transactions, global tables);
  Amazon Builders' Library ("Challenges with distributed systems").
- Apache Cassandra docs — consistency levels & lightweight transactions;
  ScyllaDB docs.
- Jepsen.io (Kyle Kingsbury) — consistency-model analyses and the
  "Consistency Models" map (jepsen.io/consistency).
- YouTube: ByteByteGo "CAP Theorem" and "Data Consistency" explainers; Gaurav
  Sen "CAP Theorem"; Hussein Nasser database/consistency videos; Martin
  Kleppmann's distributed systems lecture series; "Jordan has no life" DDIA
  walkthroughs.
