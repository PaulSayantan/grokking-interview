# Consensus, Logical Clocks and Time in Distributed Systems

Consensus, ordering, and time are the deep foundations under every replicated
database, lock service, config store, and leader-elected system. This note is
senior/staff level: for each mechanism we go intuition → precise theory →
real systems → **trade-offs and what breaks first**.

The recurring theme: in an asynchronous network you cannot tell a *slow* node
from a *dead* one, and you have no shared clock. Every technique here is a way
of coping with those two facts. Consensus buys you a total order at the cost of
latency and availability; logical clocks buy you *causal* order cheaply but not
a total real-time order; physical-time tricks (TrueTime, HLC) trade hardware or
uncertainty windows for external consistency.

---

## The consensus problem and FLP impossibility

**Consensus** = a set of processes agree on a single value, satisfying:
- **Agreement / Uniform agreement**: no two correct nodes decide differently.
- **Validity (integrity)**: the decided value was proposed by some node.
- **Termination**: every correct node eventually decides (liveness).

State-machine replication (SMR) reduces to consensus: if every replica applies
the *same commands in the same order*, deterministic replicas stay identical.
So "agree on the next log entry" repeated forever = a replicated log = a
consistent database. This is why Raft/Paxos/Zab are all fundamentally
"agree on an ordered log."

**FLP (Fischer, Lynch, Paterson, 1985):** in a purely *asynchronous* system
(no clock bounds, messages arbitrarily delayed) with even **one** crash-faulty
process, there is **no deterministic protocol that guarantees both safety and
termination**. Intuition: there always exists a "bivalent" execution where the
system is one message away from either decision, and the adversary/scheduler can
perpetually delay the deciding message, keeping the system undecided forever.

What FLP does **not** say: consensus is impossible in practice. It says you
cannot have *guaranteed* termination in *pure asynchrony* with a deterministic
algorithm. Real systems escape FLP by weakening a premise:
- **Partial synchrony** (Dwork-Lynch-Stockmeyer): after some unknown "global
  stabilization time" (GST) message/processing delays are bounded → **timeouts**
  work as failure detectors. This is what Raft/Paxos/Zab rely on. They keep
  **safety always** (agreement never violated even in full asynchrony) and only
  sacrifice **liveness** during pathological asynchrony.
- **Randomization** (Ben-Or): coin flips give termination with probability 1.
- **Failure detectors** (Chandra-Toueg): the *weakest* failure detector for
  consensus is `◇W` (eventually weak) — you need to *eventually* detect crashes.

| Escape hatch | What it assumes | Real system |
|---|---|---|
| Partial synchrony + timeouts | Eventually bounded delays | Raft, Multi-Paxos, Zab |
| Randomization | Fair coin | HoneyBadgerBFT, some BFT |
| Failure detectors | ◇W detector exists | Chandra-Toueg theory |

**Key takeaway for interviews:** Raft/Paxos are "safe under asynchrony, live
under partial synchrony." A partition or GC pause can stall progress (no new
commits) but will **never** cause two different values to be committed.

---

## Paxos, single-decree and Multi-Paxos

**Single-decree Paxos** decides *one* value. Roles: **proposers**, **acceptors**
(the voting quorum), **learners**. Two phases:

- **Phase 1 (Prepare/Promise):** proposer picks a monotonically increasing,
  globally unique ballot number `n`, sends `Prepare(n)` to acceptors. An acceptor
  promises not to accept anything `< n`, and returns the highest-numbered proposal
  it already accepted (if any).
- **Phase 2 (Accept/Accepted):** if the proposer hears from a **majority**, it
  sends `Accept(n, v)`. Crucially `v` must be the value of the **highest-ballot
  already-accepted proposal** reported in Phase 1 (if any); only if none was
  reported may it use its own value. Acceptors accept unless they've promised a
  higher `n`. A value is **chosen** once a majority has accepted it.

The "adopt the highest previously-accepted value" rule is the entire safety
argument: any two majorities intersect, so a later proposer *learns* an
already-chosen value and cannot override it. Chosen is forever.

**Multi-Paxos:** running full 2-phase Paxos per log slot is wasteful. Optimization:
elect a **stable leader** that runs Phase 1 *once* for a range of future slots;
thereafter it only needs **Phase 2** (one round trip) per command — same cost as
Raft's steady state. The leader is "distinguished proposer."

**Why Paxos is famously hard to implement:**
- The papers describe *single-decree* consensus; turning it into a working
  replicated log (Multi-Paxos) is "left as an exercise" and underspecified —
  leader election, log holes, membership changes, snapshotting, catch-up are all
  ambiguous. Google's Chubby team wrote a paper ("Paxos Made Live") about how
  much real engineering the gap required.
- It decouples roles and allows out-of-order/gapped log slots, which is powerful
  but hard to reason about.
- No canonical "understandable" reference implementation → every vendor reinvents
  the details differently. This *unclarity* is precisely what motivated Raft.

**Trade-off vs Raft:** Multi-Paxos can allow more concurrency (multiple slots
in flight, out-of-order acceptance) and doesn't strictly require a strong leader,
so some argue it can be more available under certain leader-churn patterns. But
Raft's strong-leader + contiguous-log constraints make it far easier to build
correctly. In practice most new systems choose Raft for engineering reasons.

---

## Raft, leader election and terms

Raft decomposes consensus into **leader election**, **log replication**, and
**safety**, deliberately optimizing for *understandability*.

**Terms** are logical clocks acting as a monotonically increasing epoch counter.
Each term has **at most one leader**. Every RPC carries a term; a node that sees
a higher term immediately reverts to **follower** and adopts it. A node seeing a
*lower* term rejects the RPC. Terms are how Raft detects and discards stale
leaders after partitions.

**States:** follower → candidate → leader. Followers are passive (respond to RPCs).

**Election:**
1. A follower that hears no heartbeat within its **election timeout**
   (randomized, e.g. 150–300 ms) increments its term and becomes a **candidate**,
   votes for itself, and sends `RequestVote` RPCs.
2. A node grants its vote iff (a) it hasn't voted this term, and (b) the
   candidate's log is **at least as up-to-date** as its own (the "election
   restriction" — see safety).
3. A candidate winning a **majority** becomes leader and starts sending
   heartbeats (empty `AppendEntries`).

**Randomized timeouts** are the key to avoiding split votes: if timeouts were
identical, everyone would become candidate simultaneously, split the vote, and
loop. Randomization makes one node usually time out first. Even so, a split vote
just triggers another randomized round — safety holds; only liveness is delayed
by a few timeouts.

**Trade-offs / tuning:** election timeout must satisfy
`broadcastTime << electionTimeout << MTBF`. Too short → spurious elections under
transient slowness (leader flapping, availability loss). Too long → slow failover
(higher unavailability window on real crashes). Typical: heartbeat ~50 ms,
election timeout 150–300 ms → ~sub-second failover.

---

## Raft, log replication and commit index

The leader is the sole entry point for writes. Flow:
1. Client command → leader appends to its log as a new entry `(term, index, cmd)`.
2. Leader sends `AppendEntries` to followers (includes `prevLogIndex`/`prevLogTerm`
   for the **consistency check**).
3. A follower accepts only if its log matches at `prevLogIndex/prevLogTerm`,
   else rejects → leader **decrements nextIndex** and retries, walking backward
   until logs converge, then overwrites the follower's divergent suffix.
4. Once an entry is replicated on a **majority**, the leader advances its
   **commit index**, applies to its state machine, and returns to the client;
   `commitIndex` is piggybacked so followers apply too.

**Log Matching Property:** if two logs contain an entry with the same index and
term, then (a) they store the same command, and (b) all preceding entries are
identical. This lets the consistency check work by only comparing the last
matching entry.

**The subtle commit rule (Raft §5.4.2, a classic interview trap):** a leader may
**only directly commit entries from its *current* term** by counting replicas.
It must **never** conclude that an entry from a *previous* term is committed just
because it's stored on a majority — such an entry can still be overwritten by a
future leader (the "Figure 8" scenario). Instead, once the leader commits an
entry from its current term, all prior entries are committed *indirectly* via the
Log Matching Property. Missing this rule breaks agreement.

**Throughput/latency:** steady state = **one round trip** to a majority; commit
latency ≈ leader→follower RTT of the *median* follower (the one that completes
the quorum). Batching and pipelining `AppendEntries` amortize per-entry cost.
The leader is a throughput bottleneck and a single hop everyone funnels through.

---

## Raft, safety and membership changes

**The five safety properties:** Election Safety (≤1 leader/term), Leader
Append-Only (a leader never overwrites/deletes its own entries), Log Matching,
**Leader Completeness** (if an entry is committed in term T, it is present in the
logs of all leaders of terms > T), and State Machine Safety (no two nodes apply
different commands at the same log index).

**How Leader Completeness is enforced:** the **election restriction** — a voter
rejects any candidate whose log is *less up-to-date* (compare last entry: higher
term wins; same term → longer log wins). Since a committed entry is on a majority,
and any election needs a majority, the two majorities intersect → any new leader's
log already contains all committed entries. This is why a node with a stale log
*cannot* win and clobber committed data.

**Membership changes** are dangerous because you can't switch every node's config
atomically; a naive switch can transiently create **two disjoint majorities** →
two leaders → split brain. Raft offers two safe approaches:
- **Joint consensus (Cₒₗₐ)**: a transitional config requiring majorities in
  *both* old and new configurations simultaneously; overlaps prevent disjoint
  majorities. More complex, handles arbitrary changes.
- **Single-server changes** (recommended, simpler): add/remove **one** server at
  a time. Adding/removing one node cannot produce two disjoint majorities, so it's
  always safe. (Caveat: must handle the new node catching up as a non-voting
  learner first, and the "removed leader" / disruptive-server edge cases.)

**Log compaction:** logs can't grow forever. **Snapshots** capture state-machine
state up to an index; the log prefix is discarded. `InstallSnapshot` RPC ships a
snapshot to a follower that has fallen too far behind (past the leader's retained
log). Trade-off: snapshot size vs frequency vs memory/IO spikes.

---

## Zab and Viewstamped Replication

**Zab (ZooKeeper Atomic Broadcast)** powers ZooKeeper. Like Raft it is
leader-based (one "leader"/primary, others followers) and provides **primary-order
atomic broadcast**. Distinctive properties:
- **zxid** = 64-bit id: high 32 bits = **epoch** (≈ Raft term), low 32 bits =
  monotonic **counter** within the epoch. Total order of committed transactions.
- Two-phase commit-like broadcast: leader **proposes**, gathers **ACK** from a
  quorum, then **COMMIT**s. Uses a **discovery/synchronization/broadcast** phase
  structure on new-leader election to reconcile logs.
- **FIFO client order per session** and **prefix** guarantees: if a leader commits
  txn `a` before `b`, every server delivers `a` before `b`. Designed so a new
  primary's state reflects all previously-committed changes.

Zab and Raft are close cousins; the main conceptual differences are historical
(Zab predates Raft) and in recovery/sync details. ZooKeeper reads are served
locally by any server → **fast, but can be stale** unless you call `sync()`
before the read (linearizable writes, sequentially-consistent reads by default).

**Viewstamped Replication (VR, Oski/Liskov, 1988; "revisited" 2012)** predates
Paxos-in-practice and is essentially equivalent in power. Concepts: **views**
(≈ terms/epochs) with a **view-change** protocol to elect a new primary, and a
primary-driven normal-operation protocol. Raft's design is widely recognized as
close in spirit to VR. Interview point: Paxos, Raft, Zab, and VR are all
solutions to the *same* SMR problem — leader-based log replication over majority
quorums — differing mainly in *presentation* and recovery mechanics, not in the
fundamental guarantees or the majority-quorum requirement.

---

## Quorum intersection and majority quorums

A **quorum** is any subset of nodes large enough that operations that must "see"
each other are guaranteed to **overlap in at least one node**. Overlap is the
whole game: it's how a later operation learns about an earlier one.

**Majority (strict) quorums** for `N` nodes: a quorum is `⌊N/2⌋ + 1`. Any two
majorities intersect (their sizes sum to `> N`). This tolerates `f` crash faults
with `N = 2f + 1` nodes (e.g. N=3 tolerates 1, N=5 tolerates 2). Odd N is
preferred: N=4 also tolerates only 1 fault (`⌊4/2⌋+1 = 3`) but costs more and
enlarges the quorum → **even N gives no extra fault tolerance and worse latency**.

**Read/write quorums (Dynamo-style):** with per-object `N` replicas, choose read
quorum `R` and write quorum `W`. For a read to see the latest write you need:
- `W + R > N`  (read and write quorums overlap → **strong-ish** consistency), and
- `W > N/2`    (two writes overlap → prevents concurrent conflicting writes going
  undetected; needed to serialize writes).

Examples (N=3): `W=2,R=2` → overlap (common default, tolerates 1 down node for
both). `W=3,R=1` → fast reads, writes need all nodes (no write availability if
any node down). `W=1,R=3` → fast writes, slow reads, and W=1 ≤ N/2 so writes
aren't serialized.

**Sloppy quorums + hinted handoff** (Dynamo/Cassandra with `ANY`): during a
partition, accept writes on *any* N reachable nodes (not the "home" nodes), store
hints, hand back later. Boosts availability but **breaks the R+W>N guarantee** —
a subsequent read of the home nodes may miss the write. This is an availability
lever, not a consistency guarantee.

**BFT quorums** need `N = 3f + 1` and quorums of `2f + 1` (PBFT) to tolerate
`f` **Byzantine** (arbitrary/malicious) nodes, because two `2f+1` quorums
intersect in `≥ f+1` nodes, guaranteeing ≥1 honest node in the overlap.

---

## Flexible Paxos and grid quorums

**Flexible Paxos (FPaxos, Howard et al. 2016)** is a key theoretical refinement:
Paxos safety does **not** require *every* quorum to be a majority. It only
requires that **Phase-1 quorums (Q1, leader election) and Phase-2 quorums (Q2,
replication) intersect**: `|Q1| + |Q2| > N`. Q1s need **not** intersect each
other, and Q2s need **not** intersect each other.

Consequence: you can **shrink the replication quorum** (the hot path) at the cost
of a **larger election quorum** (the cold path). E.g. with N=5, choose Q2=2 (fast
commits, only 2 acks needed) if you accept Q1=4 (elections must reach 4 of 5).
Since replication happens constantly and elections rarely, this can cut steady-state
latency/tail — you pay only when a leader fails.

**Grid quorums:** arrange N nodes in a `rows × cols` grid. Let Q1 = a full **row**,
Q2 = a full **column** (or vice versa). A row and a column always intersect in
exactly one cell → intersection satisfied, while `|row| + |col|` can be far
smaller than a majority for large N. Great for scaling reads/writes across many
nodes with small quorums; trade-off is reduced fault tolerance for *some* failure
patterns (lose a whole row/column and you can't form that quorum).

**Trade-off summary:** FPaxos/grid quorums let you tune *where* the cost lives
(steady state vs recovery) and shrink quorum sizes, but smaller Q2 means fewer
copies of each committed entry → **less redundancy / durability margin** and more
fragile recovery. It's a latency-vs-durability-margin dial.

---

## Leader-based versus leaderless replication

**Leader-based (single-master, Raft/Paxos/Zab, primary-replica SQL):** all writes
go through one leader that imposes a total order.
- Gains: simple reasoning, easy linearizability, no write conflicts by construction,
  efficient (1 RTT to quorum).
- Costs: leader is a throughput/hotspot bottleneck and a failover gap
  (unavailability during election); cross-region writes pay WAN RTT to the leader;
  the "one hop everyone funnels through" limits scale.

**Multi-leader:** a leader per region/DC; async replication between them.
- Gains: low-latency local writes, survives DC isolation.
- Costs: **write conflicts** are now possible → need conflict resolution
  (LWW, CRDTs, app merge). Not linearizable. Good for geo, collaboration.

**Leaderless (Dynamo/Cassandra/Riak):** client (or coordinator) writes to `W`
replicas and reads from `R`, no elected leader.
- Gains: no failover gap (no leader to lose), smooth availability, tunable
  consistency per request.
- Costs: needs **read repair** and **anti-entropy** (Merkle-tree sync) to
  converge; **concurrent writes conflict** → resolve via version vectors / LWW /
  CRDTs; only "strong-ish" consistency (R+W>N) not true linearizability (sloppy
  quorums, no total order across keys, LWW can silently drop writes on clock skew).

**Rule of thumb:** need a total order / linearizability / a single "leader"
decision (locks, config, uniqueness, leader election) → **consensus**. Want
maximum write availability and can tolerate/merge conflicts → **leaderless +
CRDTs**. Geo-distributed writes with local latency → **multi-leader**.

---

## Physical clocks, skew and NTP limits

Two kinds of physical clock:
- **Time-of-day clock** (wall clock, `CLOCK_REALTIME`): ms since epoch, synced by
  NTP. **Can jump backward** (NTP correction, leap seconds) → *never* use for
  measuring durations or generating monotonic ordering.
- **Monotonic clock** (`CLOCK_MONOTONIC`): only moves forward, no absolute
  meaning; correct for measuring elapsed time / timeouts. Not comparable across
  machines.

**Clock skew** = difference between two machines' clocks. **Clock drift** = rate
of divergence (quartz oscillators drift ~ tens of ppm; unsynced clocks can drift
seconds/day; ~200 ppm worst-case cheap hardware ≈ 17 s/day).

**NTP realities:** over the public internet, NTP accuracy is typically
**~1–50 ms**, sometimes **>100 ms** under congestion; asymmetric network paths
bias the estimate. PTP (IEEE 1588) with hardware timestamping reaches
sub-microsecond in a datacenter, but needs special NICs/switches. Leap seconds
and VM live-migration/pauses cause discontinuities. Kleppmann's warning: treat
clocks as **an interval, not a point** — every reading has an error bar.

**The danger — Last-Write-Wins (LWW):** systems that resolve conflicts by
"highest wall-clock timestamp wins" (e.g. Cassandra LWW) can **silently discard**
a causally-later write if the losing node's clock was ahead. Two writes with
close-but-skewed timestamps → the "wrong" one wins → **silent data loss**.
Physical-clock ordering is not a safe substitute for causal ordering.

**Why you can't just "use timestamps for ordering":** with skew of `ε`, events
within `ε` of each other cannot be reliably ordered by wall clock; you'd need to
either wait out the uncertainty (TrueTime's commit-wait) or use logical clocks.

---

## Lamport timestamps and happens-before

**Happens-before (`→`, Lamport 1978)** is the causal partial order:
- If `a` and `b` are in the same process and `a` precedes `b`, then `a → b`.
- If `a` = send of a message and `b` = its receipt, then `a → b`.
- Transitive.
- If neither `a → b` nor `b → a`, they are **concurrent** (`a ∥ b`).

**Lamport timestamps** implement a counter `C` per process:
1. Increment `C` before each local event.
2. Send: attach `C`.
3. Receive `m` with timestamp `t`: `C = max(C, t) + 1`.

**Guarantee:** `a → b ⇒ C(a) < C(b)`. **But the converse is false**:
`C(a) < C(b)` does **not** imply `a → b` — they could be concurrent. So Lamport
timestamps give you a **total order consistent with causality** (break ties by
node id → a strict total order), but they **cannot detect concurrency**: given
two timestamps you can't tell if one caused the other or they're independent.

**Use cases:** imposing a total order where any consistent order is fine (e.g.
totally-ordered multicast, tie-breaking, allocating monotonic IDs). **Not** for
detecting conflicts — for that you need vector clocks. Cost: O(1) space (one int).

---

## Vector clocks and version vectors

**Vector clocks** carry the full causal history: each node keeps a vector `V` of
size N (a counter per node).
1. Local event on node i: `V[i] += 1`.
2. Send: attach whole vector.
3. Receive: `V[j] = max(V[j], msg[j])` for all j, then `V[i] += 1`.

**Comparison:** `Va ≤ Vb` iff `Va[k] ≤ Vb[k]` for all k.
- `Va < Vb` (≤ and ≠) ⇔ `a → b` (causally before),
- `Vb < Va` ⇔ `b → a`,
- neither ⇔ **concurrent** (a genuine conflict).

**This is the key win over Lamport:** vector clocks **detect concurrency**
exactly — the converse holds. That's how Dynamo/Riak surface **sibling** conflicts
for the application (or a CRDT) to merge instead of silently losing data.

**Version vectors** are the same idea applied to *replicas of a data item* (not
processes/events) — used to track which replica has seen which updates and detect
conflicting versions of an object.

**Trade-off — the cost:** vectors are **O(N)** in the number of participants,
and *grow* as clients/replicas come and go. In systems with many ephemeral
writers this bloats metadata. Mitigations: **dotted version vectors (DVV)** for
per-client accuracy without unbounded growth; server-side ids instead of
per-client; pruning with LWW fallback (risking the LWW hazard). This size cost is
why Lamport clocks (or HLC) are chosen when you only need *ordering*, not
*conflict detection*.

| Clock | Detects order `a→b`? | Detects concurrency? | Size | Physical-time meaning |
|---|---|---|---|---|
| Wall clock | approx (skew!) | no | O(1) | yes (± error) |
| Lamport | one-directional (order-consistent) | **no** | O(1) | no |
| Vector | yes | **yes** | O(N) | no |
| HLC | yes (causal) | no (encodes order) | O(1)+ | ≈ yes (close to NTP) |

---

## Hybrid Logical Clocks

**HLC (Kulkarni et al. 2014)** combines the best of physical and logical clocks:
one compact timestamp `(l, c)` where `l` tracks the max wall-clock seen (stays
close to physical time within NTP error) and `c` is a logical counter that breaks
ties / advances when physical time doesn't move enough.

Update (send/local): `l' = max(l, pt)`; if `l' == l` then `c += 1` else `c = 0`.
Receive `(lm, cm)` with local `pt`: `l' = max(l, lm, pt)`; `c` advances per which
term won the max.

**Guarantees / benefits:**
- **Captures happens-before** like a logical clock (`a → b ⇒ HLC(a) < HLC(b)`).
- Stays **within a bounded offset of physical time** (≈ NTP error), so timestamps
  are meaningful for humans, TTLs, and range queries — unlike Lamport.
- **O(1)** size (fixed 64-bit-ish), no O(N) vector.
- Monotonic and usable as a **commit timestamp** without special hardware.

**Used by:** CockroachDB and YugabyteDB (as commit timestamps + uncertainty
windows), MongoDB (cluster time). CockroachDB uses HLC + a **max-clock-offset**
assumption (e.g. 500 ms): if it can't rule out that a value was written within
the uncertainty window, it performs an **uncertainty restart** to preserve
serializability. If a node's clock exceeds the configured offset, it **self-terminates**
(crashes) to avoid violating consistency — the safety net for the "no TrueTime
hardware" world.

**Trade-off vs TrueTime:** HLC needs no atomic clocks/GPS, just NTP + a bounded
offset assumption, but it **cannot provide external consistency for free** —
where Spanner *waits out* uncertainty, HLC-based systems either retry
(uncertainty restarts, added tail latency) or accept a weaker guarantee. HLC
does **not** detect concurrency (it forces an order), so it's for ordering, not
conflict surfacing.

---

## TrueTime and commit-wait in Spanner

**Google Spanner** provides **external consistency** (= linearizability for
transactions, a.k.a. strict serializability) across a globally distributed
database. The enabler is **TrueTime**.

**TrueTime API** returns an **interval**, not a point: `TT.now() = [earliest,
latest]` with a guarantee that the true absolute time lies within it. The width
`ε = (latest - earliest)/2` is the uncertainty, kept small (historically avg
~1–7 ms, bounded by a few ms) using **GPS receivers + atomic clocks** in every
datacenter, cross-checked so a bad clock is detected and evicted. `2ε` is the
worst-case interval width.

**Commit-wait** is how Spanner turns bounded uncertainty into external
consistency: to assign commit timestamp `s = TT.now().latest`, the coordinator
**waits until `TT.now().earliest > s`** before releasing locks / making the
commit visible — i.e. it **sleeps out the uncertainty window (`~2ε`, a few ms)**.
This guarantees that if transaction T1 commits before T2 *starts* in real time,
then `s(T1) < s(T2)`, so timestamp order matches real-time order → external
consistency. Reads at a timestamp are consistent snapshots without locks (MVCC).

**Trade-offs:**
- **Gains:** globally strict serializability, lock-free consistent snapshot reads,
  a real global order — extremely powerful and rare.
- **Costs:** every read-write commit pays a **commit-wait ≈ 2ε** (a few ms) added
  latency; you must **shrink ε** with expensive, operationally-heavy hardware
  (GPS/atomic clocks, redundant time masters). Smaller ε = less wait = more infra
  cost. It's fundamentally "**spend hardware to shrink the uncertainty you must
  wait out.**"
- If ε ever blows up (time-master failures), commit-wait grows → latency
  degrades gracefully rather than correctness breaking. This is the crucial
  design choice: uncertainty affects *performance*, never *safety*.

**Contrast:** CockroachDB/YugabyteDB replicate Spanner's *ideas* with HLC and a
static max-offset assumption (no atomic clocks) → cheaper, but they get
*serializability with uncertainty restarts* rather than free external consistency,
and they must crash a node whose clock drifts past the offset.

---

## Consistency models, linearizability to eventual

A hierarchy from strongest to weakest (stronger = fewer allowed behaviors =
easier to program against, harder/slower to provide):

**Linearizability (strong / atomic / "the C in CAP"):** there exists a single
total order of operations consistent with **real-time** — once a write completes,
*every* subsequent read (by any client) sees it (or a later value). It's a
**recency + single-copy** guarantee on *single objects*. It does **not** by
itself give multi-object atomicity (that's serializability's job). Cost: requires
coordination on the critical path → higher latency, and it is exactly what CAP
says you must give up during a partition (CP systems block; AP systems stay up
but go non-linearizable).

**Sequential consistency (Lamport):** a single total order consistent with each
process's **program order**, but **not** tied to real-time — so a read may return
a stale value as long as everyone agrees on *an* order. Weaker than linearizable.

**Causal consistency:** operations related by happens-before are seen in that
order by all nodes; concurrent ops may be seen in different orders. This is the
**strongest model still available under a partition** (it does not require
recency), which makes it the sweet spot for available-but-not-eventual systems
(COPS, causal+). Implemented with vector/logical clocks and dependency tracking.

**Eventual consistency:** if writes stop, replicas *eventually* converge. Says
nothing about *when* or about intermediate reads → you can read stale, read
older-then-newer-then-older, etc. **Session guarantees** (read-your-writes,
monotonic reads, monotonic writes, writes-follow-reads) are useful practical
strengthenings between causal and pure eventual.

| Model | Real-time recency | Total order | Available under partition? | Typical cost |
|---|---|---|---|---|
| Linearizable | yes | yes | **no** (CP) | quorum RTT per op / consensus |
| Sequential | no | yes | no (in general) | ordering coordination |
| Causal | no | partial (causal) | **yes** | track deps (vector clocks) |
| Eventual | no | no | yes | cheapest; converge later |

**Testing (Jepsen intuition):** Jepsen hammers a system with concurrent ops
under injected partitions/clock skew, records a history of invocations/responses,
then uses a **linearizability checker (Knossos/Elle)** to search for *any* valid
linearization; if none exists, the system violated its claimed model. Elle also
infers causal/serializable anomalies from transaction dependency cycles. The
lesson: many systems' real guarantees are weaker than their marketing.

---

## When you need consensus versus CRDTs and eventual

**You genuinely need consensus / linearizability when a single global decision
must be unique and ordered:**
- **Leader election / fencing** — exactly one leader; needs a monotonic **fencing
  token** to stop zombies (see below).
- **Uniqueness constraints** — unique usernames, "spend this dollar once,"
  inventory that must not oversell.
- **Config / metadata / service discovery** — everyone must agree (etcd,
  ZooKeeper, Consul).
- **Distributed locks that must be correct** (not just advisory).
- **Ordered log / atomic commit across shards.**

**A CRDT / eventual approach suffices (and is better) when operations *commute*
or conflicts can be **merged** rather than prevented:**
- **CRDTs** (Conflict-free Replicated Data Types): data types with a
  mathematically-defined **merge** that is commutative, associative, idempotent →
  replicas converge with **no coordination**. Types: G-Counter/PN-Counter,
  OR-Set, LWW-Register, RGA/sequence CRDTs for text.
- Great for: collaborative editing, shopping carts, presence, counters, likes,
  offline-first / mobile sync.
- **The catch:** convergence is *automatic* but the merged result must be
  *acceptable*. CRDTs cannot enforce a **global invariant** like "balance ≥ 0" or
  "≤ 100 seats sold" — those are non-commutative constraints that require
  coordination (consensus). A shopping cart merges fine; overdraft protection does
  not.

**The Redlock debate (canonical interview topic):** Redis Redlock tries to build a
distributed lock over N independent Redis nodes via majority + time. Kleppmann's
critique: it relies on **bounded clocks and bounded pauses** — a GC pause,
NTP jump, or network delay can let a client believe it still holds a lock after
it expired, so **two clients act simultaneously**. For *correctness* (not just
efficiency) you need **fencing tokens**: the lock service issues a monotonically
increasing token with each grant, and the protected resource **rejects any
operation carrying an older token**. That converts "I think I hold the lock" into
a checkable, monotonic guarantee — which is exactly a tiny consensus/ordering
requirement. Antirez (Redis author) disputes parts of the analysis, but the
consensus in the field: **don't use a lock timeout for correctness without
fencing tokens.**

**Rule:** if getting it wrong causes *duplicate work / temporary weirdness*,
eventual/CRDT is fine. If getting it wrong causes *double-spend, oversell, or
split-brain*, you need consensus.

---

## The cost of consensus

Consensus is not free — quantify it:

**Latency:** every committed operation needs at least **one round trip to a
majority quorum**. Commit latency ≈ RTT to the *median* replica completing the
quorum (not the fastest, not the slowest). Cross-region: if replicas span
continents, each commit pays inter-region RTT (e.g. us-east↔eu ≈ 80–90 ms one
way → commit latency dominated by WAN). This is why global consensus is slow and
why Spanner's commit-wait matters.

**Availability during partition:** a consensus group needs a **majority up** to
make progress. Minority partitions **cannot commit** (they'd violate agreement) —
they become read-only or unavailable for writes. This is CAP's CP behavior:
consensus **chooses consistency over availability** during partitions. Losing
`f+1` of `2f+1` nodes → the group is down entirely.

**Throughput:** the **leader is the bottleneck** — all writes funnel through one
node and it must talk to a quorum for each (mitigated by batching, pipelining,
and **sharding** the keyspace across many independent Raft groups, e.g.
CockroachDB/TiKV ranges, Spanner splits). A single Raft group does *not* scale
horizontally for writes; you scale by partitioning into many groups.

**Fault-tolerance vs latency/cost knob:**
- More replicas (larger N) = tolerate more faults **but** larger quorum → higher
  latency and cost; each commit waits for more/farther nodes.
- Odd N only; N=5 (tolerate 2) is a common sweet spot; N=3 (tolerate 1) for
  cheaper. N=7+ rarely worth it (latency ↑, marginal durability).
- FPaxos/grid quorums, learners/read-replicas, and leader leases (serve reads
  without a round trip via a **leader lease** clamped by clock bounds) are the
  standard optimizations to claw back latency.

**Metastability caution:** consensus systems under overload can enter a
**metastable failure** state — e.g. leader flapping under load triggers more
elections which add load; retries amplify traffic (retry storms). Guardrails:
timeouts with **jittered exponential backoff**, circuit breakers, **load
shedding**, bounded queues, and avoiding synchronized retries. A healthy cluster
can stay stuck in a bad equilibrium even after the trigger is gone until you shed
load.

**Ballpark numbers to quote:** local-DC Raft commit ~1–5 ms; cross-region ~
tens–100+ ms; leader failover ~sub-second (election timeout). N=2f+1. Quorum size
⌊N/2⌋+1. Commit-wait ~few ms (2ε). NTP error ~1–50 ms; PTP ~µs.

---

## Common interview follow-up questions

- "Does FLP mean Raft can deadlock forever?" — No: Raft never *violates* safety;
  under pure asynchrony it may fail to make progress (liveness), but partial
  synchrony (timeouts) restores termination in practice.
- "Why must a Raft leader not commit a previous-term entry by counting replicas?"
  — Figure 8: such an entry can be overwritten; only commit current-term entries
  directly, prior ones commit indirectly (§5.4.2).
- "Why odd number of nodes?" — Even N gives no extra fault tolerance and a bigger
  quorum → worse latency for the same tolerance.
- "Linearizable vs serializable?" — Linearizable = real-time recency on single
  objects; serializable = transactions appear in *some* serial order (multi-object,
  no real-time requirement). **Strict serializability** = both.
- "Lamport vs vector clocks — when each?" — Lamport for a cheap total order;
  vector clocks when you must *detect* concurrent conflicts (O(N) cost).
- "How does Spanner get external consistency?" — TrueTime intervals + commit-wait
  (sleep out ~2ε uncertainty) so timestamp order = real-time order.
- "When would you NOT use consensus?" — Commutative/mergeable state → CRDTs;
  need max write availability and can tolerate conflicts.
- "Why is Redlock criticized and what fixes it?" — Relies on bounded clocks/pauses;
  fencing tokens (monotonic, checked at the resource) make it correct.
- "R+W>N — is that linearizable?" — No, only "strong-ish"; sloppy quorums,
  concurrent writes, and read-during-write make it non-linearizable in general.
- "How would you test consistency claims?" — Jepsen: inject partitions/skew,
  record history, check with Knossos/Elle for a valid linearization/serialization.
- "How do you scale writes past a single Raft group?" — Shard the keyspace into
  many independent groups (ranges), each its own leader.

## References

- Fischer, Lynch, Paterson, "Impossibility of Distributed Consensus with One
  Faulty Process" (FLP), 1985.
- Dwork, Lynch, Stockmeyer, "Consensus in the Presence of Partial Synchrony," 1988.
- Lamport, "Time, Clocks, and the Ordering of Events in a Distributed System," 1978.
- Lamport, "The Part-Time Parliament" (Paxos), 1998; "Paxos Made Simple," 2001.
- Chandra, Griesemer, Redstone, "Paxos Made Live — An Engineering Perspective," 2007.
- Ongaro, Ousterhout, "In Search of an Understandable Consensus Algorithm (Raft)," 2014
  (extended version + Ongaro's dissertation).
- Howard, Malkhi, Spiegelman, "Flexible Paxos: Quorum Intersection Revisited," 2016.
- Junqueira, Reed, Serafini, "Zab: High-performance broadcast for primary-backup
  systems," 2011.
- Oki, Liskov, "Viewstamped Replication" (1988) and Liskov, Cowling,
  "Viewstamped Replication Revisited," 2012.
- Corbett et al., "Spanner: Google's Globally-Distributed Database" (TrueTime), OSDI 2012.
- Peng, Dabek, "Large-scale Incremental Processing Using Distributed Transactions
  and Notifications" (Percolator), 2010.
- Thomson et al., "Calvin: Fast Distributed Transactions for Partitioned Database
  Systems," 2012.
- Kulkarni, Demirbas et al., "Logical Physical Clocks (HLC)," 2014.
- Kleppmann, "Designing Data-Intensive Applications," ch. 5, 8, 9 (esp. clocks,
  linearizability, consensus).
- Kleppmann, "How to do distributed locking" (Redlock critique), 2016;
  Antirez rebuttal.
- Chandra, Toueg, "Unreliable Failure Detectors for Reliable Distributed Systems," 1996.
- Shapiro et al., "Conflict-free Replicated Data Types (CRDTs)," 2011.
- Dean, Barroso, "The Tail at Scale," CACM 2013.
- Bronson et al., "Metastable Failures in Distributed Systems," HotOS 2021.
- Kingsbury (aphyr), Jepsen analyses and the Elle/Knossos checkers.
- AWS Builders' Library: "Timeouts, retries, and backoff with jitter,"
  "Static stability using Availability Zones."
- DeCandia et al., "Dynamo: Amazon's Highly Available Key-value Store," SOSP 2007.
