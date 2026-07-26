# lld-and-ood — Content Audit

**Executive summary.** This is a strong, mature domain. Across all 33 subtopics the writing is consistently intuition-first and senior-calibrated: clarity averages **4.76/5** and interview depth averages **4.52/5**, with almost every file leading with a "why this exists" mental model, reasoned (not listed) trade-offs, and a dedicated follow-ups/gotchas section. No subtopic is rated **high** priority. The refinement backlog is therefore about *polish, not rescue*: **0 high**, **30 medium**, **3 low**. But the polish is highly systemic and lands squarely on the two weighted refinement dimensions. The single dominant gap is **worked examples** (average **3.24/5**, the only sub-3.5 axis): the library teaches algorithms and mechanics through prose + code skeletons but rarely runs them with concrete numbers-in/numbers-out. The second, more dangerous theme is a recurring pattern where a **code skeleton contradicts the file's own prose/safety advice** — several skeletons literally demonstrate the exact bug the surrounding text warns against (movie-booking, traffic-signal, digital-wallet, atm, elevator, stack-overflow, task-management, library). These are the true priorities despite none being flagged "high," because a student copying the reference code inherits a real defect. 4 subtopics carry `needs_web_verification=true` (rate-limiter, splitwise, stack-overflow, uml-class-diagrams).

## Scorecard

Sorted by priority (high → medium → low), then by lowest total (clarity + examples + depth) first.

| Subtopic | Clarity | Examples | Depth | Priority | Verdict |
|---|---|---|---|---|---|
| design-rate-limiter-oo | 4 | 2 | 5 | medium | Excellent OO framing/depth, but every algorithm is prose/formula with no numeric trace; per-key vs per-rule model and composite-key handling are unresolved/buggy. |
| design-auction-system | 5 | 2 | 4 | medium | Exceptionally clear with strong depth, but teaches almost entirely through prose/skeletons — no numeric trace of the flagship scenarios (simultaneous bids, proxy, Vickrey). |
| design-chess-game | 4 | 2 | 5 | medium | Conceptually deep with great gotchas, but no concrete move/checkmate trace and the coordinate system is never pinned down. |
| design-file-system | 4 | 3 | 4 | medium | Structurally excellent Composite walkthrough that never traces a concrete tree; find() returning bare names is a real defect. |
| design-logging-framework | 4 | 3 | 4 | medium | Pattern-rich and interview-ready, but no traced hierarchy/level/rendered-line example; ordinal()-based levels flagged. |
| design-ride-sharing | 4 | 3 | 4 | medium | Strong walkthrough, but near-total absence of numeric fare/matching examples and an unresolved "auto-assign vs driver-accepts" conflict. |
| design-atm | 5 | 3 | 4 | medium | Excellent State-pattern walkthrough, but no dispensing trace and code contradicts its own funds-check invariant. |
| design-cache-oo | 4 | 3 | 5 | medium | Senior-grade OO decomposition, but policies taught structurally with no eviction trace; LFU minFrequency left unexplained. |
| design-library-management | 5 | 3 | 4 | medium | Outstanding domain modeling, but no numeric fine/reservation trace; returnBook NPE contradicts its "never crash" claim. |
| design-movie-booking | 5 | 3 | 4 | medium | Excellent teaching, but pay() skeleton demonstrates the exact race bug it warns against; no traced race/pricing math. |
| design-stack-overflow | 5 | 3 | 4 | medium | Excellent modeling method, but no rep-to-badge trace and vote-flip/retract reputation reversal is unhandled in code. |
| design-task-management | 5 | 3 | 4 | medium | Great scaffolding, but wholly abstract; undo of a status move re-runs workflow validation and can throw (hidden gotcha). |
| design-text-editor | 5 | 3 | 4 | medium | Excellent Command/Memento treatment, but never traces the two undo/redo stacks; caret restore on undo missed. |
| design-tic-tac-toe | 5 | 3 | 4 | medium | Sharp OO reasoning, but the headline O(1) counter win-check is never traced, and minimax is cited 4× yet never explained. |
| design-traffic-signal | 4 | 3 | 5 | medium | Excellent scaffolding, but skeleton contradicts its own safety rules (all-red, preemption wind-down) and never wires durations into the tick loop. |
| lld-interview-method | 5 | 3 | 4 | medium | Clear senior playbook, but a topic about "write compile-ready code" never fully implements a critical method; time budget sums to 50, not 45. |
| concurrency-in-lld | 4 | 4 | 4 | medium | Strong intuition-first reference; missing a step-by-step interleaving trace, thread-confinement, and a wait/notify vs BlockingQueue example. |
| design-calendar-scheduler | 5 | 3 | 5 | medium | Excellent structure/depth, but the two hardest algorithms (interval overlap, free-slot merge) have no numeric trace. |
| design-card-game | 5 | 3 | 5 | medium | Senior-grade walkthrough, but hand-value and payout algorithms shown as code, never traced with numbers. |
| design-food-delivery-oo | 5 | 3 | 5 | medium | Strong pattern motivation, but no traced scenario/composite-score math; assignPartner skeleton shows the racy version it warns against. |
| design-notification-system | 5 | 3 | 5 | medium | Excellent pattern reasoning, but no end-to-end traced publish; unsubscribe List.of() bug and blocking sleep-in-pool. |
| design-parking-lot | 5 | 3 | 5 | medium | Excellent intuition/depth, but pricing math and BestFit-vs-Nearest failure are prose-only; unparkVehicle signature inconsistent across 3 sections. |
| design-snake-ladder | 5 | 3 | 5 | medium | Excellent reasoning, but never traces a simulated game (the thing this problem is famous for) or the cycle-detection set. |
| design-splitwise | 5 | 3 | 5 | medium | Senior-grade coverage, but the greedy debt-simplification is described, never traced; no greedy-suboptimal counterexample. |
| design-vending-machine | 5 | 3 | 5 | medium | Excellent State/Strategy treatment, but no full-transaction trace and the emphasized limited-float change subtlety is never shown. |
| solid-principles | 5 | 4 | 4 | medium | Excellent intuition-first SOLID reference; gaps are the "OCP just moves the switch" pushback and LSP precondition/postcondition rules. |
| design-digital-wallet | 5 | 4 | 5 | medium | Excellent money modeling, but the idempotency skeleton demonstrates a double-spend; PENDING/reserve-confirm and CAS shown only in prose. |
| design-elevator-system | 5 | 4 | 5 | medium | Excellent teaching, but chooseDirection() has a real LOOK bug and addStop() drops hall-call direction. |
| design-principles-beyond-solid | 5 | 4 | 5 | medium | Unusually strong, interview-tuned; Liskov Square/Rectangle and the Instability metric asserted without a concrete walkthrough. |
| ooad-requirements-to-classes | 5 | 5 | 4 | medium | Excellent OOAD pipeline with a full worked example, but the flagship example models per-show availability on the physical Seat (a real bug) and dodges the concurrency its prompt raises. |
| oop-principles-pillars | 5 | 4 | 4 | low | Interview-calibrated four-pillars treatment; minor gaps (fragile-base-class trace, two senior inheritance gotchas). |
| design-hotel-booking | 5 | 4 | 5 | low | Exemplary teaching doc; only gap is pricing/overlap logic shown as code but never walked through with numbers. |
| uml-class-diagrams | 5 | 5 | 5 | low | Unusually strong UML-for-interviews doc; only minor Mermaid-syntax consistency polish remains. |

## Systemic issues

These recurring themes cut across the domain and should drive a batch strategy rather than one-off edits.

### 1. Missing numbers-in/numbers-out worked traces (≈30 of 33 files) — the dominant gap
This is the #1 refinement lever. The library reliably shows the *machine* (code skeletons, formulas, class diagrams) but rarely *runs* it on concrete inputs. It appears as a **high-severity** `example-gap` in almost every file and is the reason the examples axis (3.24) is the only sub-3.5 score. The gap consistently lands on each problem's single hardest/most-probed concept:
- **Algorithms:** cache eviction trace (design-cache-oo), hand-value/soft-ace (design-card-game), greedy debt simplification (design-splitwise), token-bucket/sliding-window math (design-rate-limiter-oo, lld-interview-method), free-slot merge + interval overlap (design-calendar-scheduler), fare math (design-ride-sharing, design-movie-booking), change-making with limited float (design-vending-machine), O(1) counter win-check (design-tic-tac-toe), Composite getSize recursion (design-file-system), Composite estimate roll-up (design-task-management).
- **State/flow mechanics:** two-stack undo/redo (design-text-editor), full transaction through states (design-vending-machine, design-atm), reputation→badge path (design-stack-overflow), a simulated game (design-snake-ladder), end-to-end publish (design-notification-system).
- **Metrics/principles:** Liskov Square/Rectangle and Instability metric (design-principles-beyond-solid), fragile-base-class double-count (oop-principles-pillars).

### 2. Code skeletons that contradict their own prose / demonstrate the warned-against bug (≈10 files) — the most dangerous theme
Correctness findings where the *reference code* is wrong in a way a student would copy, often directly contradicting a safety rule the same file emphasizes. This is why several files are effectively higher-priority than their "medium" label:
- **design-movie-booking** — pay() has a "re-verify the hold" comment but does not re-verify, and charges before confirming the lock (the exact bug Follow-up #3 warns about).
- **design-traffic-signal** — preempt() slams to all-red with no yellow wind-down; durations never wired into the tick loop; no real all-red clearance beat — all contradicting emphasized safety prose.
- **design-digital-wallet** — the idempotency skeleton does read-check-execute-then-store, enabling the double-spend the "Idempotency" section says to prevent.
- **design-atm** — reads balance then debits as two racy steps and ignores debit()'s return, contradicting its own concurrency warning.
- **design-elevator-system** — chooseDirection() reverses early (LOOK bug); addStop() discards hall-call direction, boarding riders going the wrong way.
- **design-library-management** — returnBook() NPEs on a double-scan, contradicting "never a crash."
- **design-food-delivery-oo** — assignPartner() shows the racy version the Concurrency section says to replace with an atomic claim.
- **design-stack-overflow** — vote flip/retract never reverses previously granted reputation; "remove-then-add atomically" prose contradicts the atomic-put code.
- **design-task-management** — MoveTaskCommand.undo() re-runs workflow validation, which can throw on a one-directional reverse edge.
- **design-chess-game** — Pawn skeleton omits the attacks() override the prose requires, reproducing the castling-transit bug it warns against.

### 3. Concurrency "told, not shown" (≈8 files)
Concurrency depth is a genuine strength in prose, but the payoff is repeatedly abstract: races are asserted, not traced as a two-thread interleaving, and optimistic locking is name-dropped without a CAS retry loop. Add interleaving timelines and ~6–10 line CAS snippets to: concurrency-in-lld, design-auction-system, design-digital-wallet, design-food-delivery-oo, design-movie-booking, design-hotel-booking, design-library-management (the symmetric per-*member* race is missed), lld-interview-method.

### 4. Diagram ↔ API ↔ skeleton inconsistencies (≈9 files)
The same entity/method is modeled differently across the class diagram, the API section, and the code skeleton, forcing students to reconcile conflicting signatures. Examples: unparkVehicle across 3 sections (design-parking-lot), SeatLock per-seat vs per-set (design-movie-booking), getBalances List vs Map (design-splitwise), Notification missing its topic field (design-notification-system), Task missing getBaseVersion/bumpVersion (design-task-management), Deck shuffle()/reset() (design-card-game), Elevator getDirection()/direction field (design-elevator-system), auto-assign vs acceptTrip (design-ride-sharing), abstract-classifier `*` placement (uml-class-diagrams).

### 5. Pattern claimed but not actually implemented or mislabeled (≈6 files)
A named pattern doesn't match the code: "Template Method flavor" that is plain polymorphism (design-atm), Observer that is a direct call (design-library-management), Chain-of-Responsibility framing for a fan-out (design-logging-framework), a promised Privilege abstraction that never appears (design-stack-overflow), SeatAssignment named in guidance but unused in the worked example (ooad-requirements-to-classes), strategy-governed visibility contradicted by inline outbid fire (design-auction-system).

### 6. Undefined jargon / missing micro-intuition (≈6 files, low severity)
Load-bearing terms used without a one-clause gloss: happens-before (concurrency-in-lld), SSTF (design-elevator-system), flyweight/Memento (design-vending-machine), covariant return (oop-principles-pillars), double-dispatch (design-file-system), OCP/LSP/YAGNI before first expansion (lld-interview-method).

## High-priority subtopics

**No subtopic was rated `high` priority** — the domain has no rescue cases. The effective top of the backlog is the set of subtopics that combine the lowest total scores with a **correctness bug in the reference code** (systemic theme #2), since those mislead a student most directly. The five below should be treated as the de-facto high-priority queue.

### design-rate-limiter-oo (11 total; lowest-scoring; `needs_web_verification=true`)
1. **[high] No numeric algorithm trace.** Every algorithm is formula-only. Fix: add per-algorithm numeric traces — sliding-counter (limit 100/min, prev 80, 20s into current with 30 → 80·0.667+30=83 → allow), fixed-window 2× boundary burst, token-bucket refill/deny.
2. **[medium] Per-key vs per-rule model is unresolved.** `allow(String key)` coexists with one-limiter-per-key registry and a single-`tokens` field, so `key` is effectively dead inside the limiter. Fix: pick (a) per-key limiter with `allow()` no-arg, or (b) internal `ConcurrentHashMap<key,State>` with one limiter per *rule*; make the skeleton consistent.
3. **[medium] Composite forwards one opaque key to all dimensions.** A per-user and per-API limiter can't share one key string. Fix: composite operates on a `Request` (or per-delegate key resolver).
4. **[low] Leaky bucket has no code and no queue-vs-meter contrast.** Fix: add a FIFO-queue trace (leak 2/s, cap 5, 10 arrive → 5 queued, 5 dropped) contrasted with token bucket.

### design-movie-booking (12 total; correctness bug on the core path)
1. **[high] pay() demonstrates the bug it warns against.** The "re-verify the hold" comment isn't implemented, and it charges before confirming the lock. Fix: re-verify ownership under the per-show lock before charging (or verify→charge→confirm with a compensating refund) and explain why verify precedes charge.
2. **[medium] The double-book race is never traced.** Fix: add a T0/T1/T2 interleaving table (both read AVAILABLE → double-book) then the synchronized(show) version.
3. **[medium] Pricing composition has no numbers.** Fix: RECLINER 300 → ×1.2 weekend = 360 → ×1.15 demand ≈ 414.
4. **[medium] Dual source of truth (ShowSeat.status vs SeatLock) unreconciled.** Fix: name status the fast-read projection and SeatLock the authoritative record, mutated atomically together.
5. **[low] SeatLock is per-set in the diagram but per-seat in code.** Fix: pick one representation.

### design-traffic-signal (12 total; three correctness bugs on safety-critical paths)
1. **[high] preempt() slams to all-red with no yellow wind-down** — directly contradicts the emphasized safety rule. Fix: stage the wind-down (green→yellow→all-red→new green across ticks) or flag the simplification explicitly.
2. **[high] Durations never consumed.** `getDurationSeconds()` / `TimingStrategy` are dead; onTick() advances a full phase every tick. Fix: add an elapsed-seconds counter and only advance when elapsed ≥ current duration.
3. **[high] No real all-red clearance beat** despite the comment claiming one. Fix: insert an ALL_RED hold (or explicit AllRedState).
4. **[medium] No traced full cycle.** Fix: a second-by-second table (GREEN 0–25, YELLOW 25–30, all-red 30–32, then cross street).
5. **[medium] AdaptiveTimingStrategy output never consumed.** Fix: show the controller reading `timing.greenDurationSeconds(...)` when a group turns green.

### design-digital-wallet (14 total; double-spend in reference code)
1. **[high] Idempotency skeleton enables double-spend.** get→execute→putIfAbsent lets two concurrent retries both execute. Fix: reserve the key *before* executing (putIfAbsent PENDING / unique-constraint insert as the commit gate); make code and prose agree.
2. **[medium] PENDING / reserve-then-confirm has no code.** Fix: add topUp()/withdraw() skeletons with reserve→PENDING→onGatewayConfirm/Decline.
3. **[medium] Optimistic locking is prose-only.** Fix: add a ~10-line CAS retry loop.
4. **[medium] Currency rounding never shown with numbers.** Fix: convert ₹1000 at 0.01203, or a 3-way $10 split (3.33/3.33/3.34), naming who absorbs the remainder and why HALF_EVEN.

### design-elevator-system (14 total; LOOK bug in reference code)
1. **[high] chooseDirection() reverses early.** DOOR_OPEN falls into the else branch and prefers downStops even with pending upStops above — the yo-yo behavior LOOK forbids. Fix: track a committed travel direction separately from ElevatorState.
2. **[medium] addStop() discards hall-call direction**, serving DOWN-above calls on the UP sweep. Fix: route stops to the matching sweep by request direction.
3. **[medium] Fleet cost function never computed.** Fix: 3-car worked example scoring idle/toward/away with concrete penalties.
4. **[low] getDirection()/direction field referenced but never defined** in the Elevator skeleton. Fix: add and maintain the field.

## Refinement plan

**Recommended order of attack** (correctness first — a wrong skeleton is worse than a missing example — then the examples sweep, then polish):

1. **Wave 1 — Fix the code-vs-prose contradictions (systemic theme #2).** These are latent defects students copy. Do the five effective-high subtopics above (rate-limiter, movie-booking, traffic-signal, digital-wallet, elevator), then the remaining theme-#2 files: design-atm, design-library-management, design-food-delivery-oo, design-stack-overflow, design-task-management, design-chess-game, and the ooad-requirements-to-classes per-show-Seat modeling bug. Each is a small, surgical edit with outsized correctness payoff.

2. **Wave 2 — The worked-examples sweep (systemic theme #1, the biggest score lever).** Add one numbers-in/numbers-out trace to each subtopic's single hardest concept. This is batchable and mechanical; prioritize the sum-11/12 files first (they gain the most), then the sum-13/14 files. This wave alone should lift the examples axis from ~3.2 toward ~4.

3. **Wave 3 — Concurrency traces & CAS snippets (theme #3)** and **diagram/API/skeleton reconciliation (theme #4).** Add interleaving timelines + short CAS loops; pick one canonical signature per entity and propagate it across all three sections.

4. **Wave 4 — Polish.** Pattern-label corrections (theme #5), jargon glosses (theme #6), and the low-priority trio (oop-principles-pillars, design-hotel-booking, uml-class-diagrams), which need only minor touch-ups.

**Web verification.** Re-verify external claims before/while editing these 4 subtopics flagged `needs_web_verification=true`:
- **design-rate-limiter-oo** — sliding-window-counter formula and token/leaky-bucket semantics.
- **design-splitwise** — NP-hardness framing of optimal debt settlement and the ≤ n−1 bound.
- **design-stack-overflow** — the specific reputation deltas (+10/+5/+15/−2, downvote-cast −1) and privilege thresholds.
- **uml-class-diagrams** — the canonical Mermaid position of the abstract classifier (`*` / `$`) relative to the return type before standardizing the syntax.

*Audit coverage: 33 of 33 files read; 0 missing or unreadable.*
