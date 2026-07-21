export const meta = {
  name: 'lld-and-ood-expansion',
  description: 'Expand the LLD & OOD domain with 15 new topics: 2 method topics (OOAD requirements->classes, concurrency in LLD) + 13 new canonical machine-coding problems (ATM, Stack Overflow, movie booking, logging framework, pub-sub, ride-sharing, traffic signal, digital wallet, calendar scheduler, text editor, file system, card game, task management). Author -> verify.',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'design-correctness + SOLID/pattern validation + schema check, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/lld-and-ood`

const SCOPE_NOTE = `
DOMAIN SCOPE — "Low-Level Design & Object-Oriented Design" for the MACHINE-CODING / LLD
interview round (45-90 min live-design sessions). This is the round BETWEEN DSA and HLD:
"design X as extensible OO code in 45-90 min." It's NOT distributed systems or infra — it's
clean, extensible, SOLID class design under time pressure. Target: backend / senior SDE candidates.

This domain ALREADY has these topics (do NOT duplicate; cross-reference them by slug when relevant):
- Foundational: oop-principles-pillars, solid-principles, design-principles-beyond-solid,
  uml-class-diagrams, lld-interview-method.
- Problems: design-parking-lot, design-elevator-system, design-library-management,
  design-vending-machine, design-tic-tac-toe, design-chess-game, design-snake-ladder,
  design-rate-limiter-oo, design-cache-oo, design-splitwise, design-hotel-booking,
  design-food-delivery-oo, design-auction-system.

WHAT EACH PROBLEM TOPIC MUST COVER (this is the "how to THINK and PLAN step by step" the user asked for):
1. REQUIREMENTS CLARIFICATION — the first 5 minutes (functional + non-functional; what to scope OUT)
2. USE-CASES / ACTORS — who uses it and how (the Grokking UML-first approach)
3. IDENTIFY CORE OBJECTS via NOUN/VERB EXTRACTION — show the actual technique: pull candidate
   classes from the nouns in the requirements, candidate methods from the verbs, then FILTER
   (not every noun is a class). This is the step-by-step design-thinking the user wants emphasized.
4. RESPONSIBILITIES & RELATIONSHIPS — assign each class a single responsibility (CRC-style:
   what it KNOWS and what it DOES + its collaborators); composition vs aggregation vs inheritance;
   multiplicity.
5. CLASS DIAGRAM — a Mermaid classDiagram (interview-grade: not enterprise overkill, not toy).
6. KEY DESIGN DECISIONS + PATTERNS — name each GoF pattern and WHY (classified by intent:
   Creational=construction, Structural=assembly, Behavioral=algorithm/responsibility).
7. API / METHOD SIGNATURES — key public methods with types.
8. CODE SKELETON — enough to show structure (Java preferred), not a full implementation.
9. EXTENSIBILITY — "now add X" follow-ups; demonstrate Open/Closed in action.
10. CONCURRENCY / EDGE CASES — locking, race conditions, invalid states (where relevant).

For the 2 METHOD topics: teach the technique concretely with worked examples, not abstract sermons.

BOUNDARY RULES (strict):
- design-patterns (dp-*) owns the GoF TAXONOMY. HERE, reference a pattern by name ("we use State
  because...") and cross-ref the dp-* topic; do NOT re-teach the pattern from scratch.
- dsa-coding owns data-structure internals. Use a HashMap/heap/trie by name; don't re-derive it.
- system-design owns distributed architecture. If a "scale to millions / make it distributed"
  follow-up arises, acknowledge it's an HLD concern and point there; keep the LLD design single-machine OO.

Language: primarily Java (LLD lingua franca) with language-agnostic prose.
`

const SCHEMA = `
CONTENT CONTRACT (follow exactly). Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1.
   - "## <Subtopic>" H2 per subtopic (MCQ anchor targets — keep stable).
   - PROBLEM topics: follow the 10-part structure above (Requirements, Use-cases/Actors,
     Noun/Verb Object Identification, Responsibilities & Relationships, Class Diagram, Design
     Decisions & Patterns, API, Code Skeleton, Extensibility, Concurrency/Edge Cases).
   - METHOD topics: teach the technique with worked before/after examples.
   - Mermaid classDiagram REQUIRED for problem topics (optionally stateDiagram-v2 for state
     machines like ATM/traffic-signal). NO ASCII-art. CRITICAL: no semicolons in sequenceDiagram
     message text (use commas). UML arrows: --|> inheritance, ..|> realization, --* composition,
     --o aggregation, ..> dependency.
   - End with "## Common Interview Follow-ups" and "## References".

2) questions.yaml — top-level keys:
     topic: "<Topic Name>"
     domain: lld-and-ood
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001    # unique, zero-padded 3-digit seq; prefix == slug
         difficulty: beginner     # beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options: ["<0>","<1>","<2>","<3>"]
         answer: 2                # 0-BASED index
         explanation: |
           <why correct; teach the design reasoning>
         ref: "concepts.md#<anchor>"  # resolves to a real "## " heading (GitHub slug rules)

   RULES: aim for 40-60 MCQs per topic. Focus MCQs on DESIGN REASONING ("which pattern fits this
   requirement?", "which SOLID principle does this violate?", "what is this class's responsibility?",
   "composition or inheritance here?"), EXTENSIBILITY ("add feature X without modifying existing
   code — how?"), TRADE-OFFS, and the STEP-BY-STEP METHOD (noun/verb identification, responsibility
   assignment). 3-5 options, exactly one correct, 0-based answer; VARY the correct index (no single
   index >40%, no guessable cycle); mixed difficulty; scenario-based items preferred; distractors
   plausible but wrong for a real design reason; no all/none-of-the-above; every 'ref' resolves to a
   real "## " heading; id prefix == slug. Quote any YAML option containing a colon+space or leading brace.

Use the Write tool. Research to ensure patterns are applied correctly and class designs are
industry-standard. Return: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  // --- 2 method topics ---
  { slug: 'ooad-requirements-to-classes', name: 'OOAD: From Requirements to Classes', hints: "THE step-by-step technique for translating a problem statement into a class model — the core 'how to think' skill. NOUN/VERB (Abbott textual) ANALYSIS: nouns/noun-phrases -> candidate classes or attributes; verbs -> candidate methods/responsibilities; it's a HEURISTIC not a mechanical rule (filter: not every noun is a class, some entities aren't discoverable this way; refine iteratively). CRC CARDS (Class-Responsibility-Collaborator): index cards with 3 sections; a responsibility = 'something a class knows or does'; a collaboration = 'a request for information or to do something'; the iterative session (extract classes -> find responsibilities -> define collaborators -> role-play to refine; 'if in doubt, make it a class'). RESPONSIBILITY-DRIVEN DESIGN (Wirfs-Brock): ask 'what responsibilities should this object OWN?' not 'what does this class do?' — software as cooperating objects each with a clear role. DOMAIN MODELING: identifying entities, value objects, relationships. Tie back to GRASP (Information Expert, Creator). Attribution: Abbott 1983, Booch, Larman 'Applying UML and Patterns', Beck & Cunningham (CRC, OOPSLA 1989). Worked example: run the full pipeline on a sample statement (e.g. a small booking system) from raw text -> nouns/verbs -> CRC cards -> class diagram. Cross-ref uml-class-diagrams, lld-interview-method, design-principles-beyond-solid (GRASP)." },
  { slug: 'concurrency-in-lld', name: 'Concurrency in Low-Level Design', hints: "The senior differentiator in machine-coding rounds — how to make an OO design THREAD-SAFE. When concurrency matters (shared mutable state: last parking spot, seat booking, wallet balance, inventory decrement). RACE CONDITIONS & how to reason about them (check-then-act, read-modify-write). LOCKING: synchronized/intrinsic locks, ReentrantLock, ReadWriteLock (many readers/one writer — good for caches), lock granularity (coarse vs fine — per-row/per-seat locking), lock ordering to avoid DEADLOCK. OPTIMISTIC vs PESSIMISTIC concurrency (version/CAS + retry vs lock-and-hold); when each fits (low vs high contention). ATOMICS (AtomicInteger, compareAndSet) & lock-free basics. Thread-safe SINGLETON (double-checked locking + volatile, or enum/holder idiom — a classic interview trap). Concurrent COLLECTIONS (ConcurrentHashMap vs synchronizedMap, BlockingQueue for producer-consumer). IMMUTABILITY as a concurrency strategy. Idempotency for retries. Cross-ref the problems that need it: design-movie-booking (seat lock), design-digital-wallet (balance), design-parking-lot (last spot), design-rate-limiter-oo, design-cache-oo. Keep it single-JVM OO (distributed locking -> system-design). Show a race-condition BEFORE and a fixed AFTER with the right lock." },
  // --- 13 new problems ---
  { slug: 'design-atm', name: 'Design an ATM', hints: "STATE-MACHINE heavy. States: IdleState, HasCardState, AuthenticatedState (PIN-verified), TransactionState (SelectOperation), DispensingState. Core objects: ATM, State (interface + concrete states), Card, Account, BankService (auth + balance backend), CashDispenser, Transaction (Withdrawal, Deposit, BalanceInquiry, Transfer — the operation hierarchy), Screen, Keypad. Patterns: STATE (the star — each state handles insertCard/enterPin/selectOperation/dispenseCash differently, no giant if-else), Strategy or Command (for transaction types), Chain of Responsibility or Strategy (for cash-dispensing denomination algorithm — greedy note count), Factory (transaction creation). Key flows: insert card -> authenticate PIN (limited attempts -> eat card) -> select operation -> execute -> return card. Cash-dispensing algorithm (which notes to dispense). Extensibility: add cheque deposit, cardless withdrawal, multi-currency. Edge cases: insufficient ATM cash, insufficient account balance, wrong PIN lockout, card retained. Mermaid stateDiagram-v2 (states) + classDiagram." },
  { slug: 'design-stack-overflow', name: 'Design Stack Overflow (Q&A)', hints: "RICH DOMAIN MODEL — tests entity/association modeling and reputation logic. Core objects: User, Question, Answer, Comment, Tag, Vote (upvote/downvote), Badge, Reputation, Account. Post as an abstract base for Question/Answer (both votable, commentable). Relationships: User 1->* Question, Question 1->* Answer, Post *->* Tag, User *->* Vote. Reputation system (upvote question +5/answer +10, downvote -2, accepted answer +15 — a Strategy or rules engine for reputation events). Badge awarding (Observer — award badges when reputation/action thresholds hit). Patterns: Observer (notifications + badge awarding on events), Strategy (reputation calculation, search/sort), Composite or shared Post abstraction, State (Question: Open, Closed, Duplicate, Protected). Search/filter by tag. Extensibility: bounties, moderation/flags, comment threads. Emphasize noun/verb -> the domain entities. Mermaid classDiagram." },
  { slug: 'design-movie-booking', name: 'Design a Movie Ticket Booking System', hints: "BookMyShow-style — CONCURRENCY is the key differentiator (seat locking). Core objects: Movie, Cinema, Hall/Screen, Show, Seat (seat types: Regular/Premium/Recliner), SeatBooking, Booking, Payment, User, City. The seat-hold/lock problem: when a user selects seats, LOCK them temporarily (with a timeout/expiry) so two users can't book the same seat — pessimistic lock or reservation-with-TTL; release on timeout or payment failure. Patterns: State (Booking: Created, SeatsHeld/Reserved, Confirmed, Cancelled, Expired), Strategy (pricing — seat type, weekday/weekend, dynamic; payment method), Observer (booking confirmation, seat-availability updates), Factory. Key flows: search shows (city+movie+date) -> select seats -> HOLD seats (concurrency!) -> pay -> confirm or release. Cross-ref concurrency-in-lld. Extensibility: waitlist, seat recommendations, group booking, refunds. Mermaid classDiagram + booking state diagram." },
  { slug: 'design-logging-framework', name: 'Design a Logging Framework', hints: "A Log4j/SLF4J-style design — the canonical CHAIN OF RESPONSIBILITY problem. Core objects: Logger, LogLevel (TRACE < DEBUG < INFO < WARN < ERROR < FATAL — ordered enum), LogMessage, Appender/Handler (interface: ConsoleAppender, FileAppender, DatabaseAppender), Formatter/Layout (Strategy for message format), LoggerConfig. Patterns: CHAIN OF RESPONSIBILITY (the star — a chain of handlers each deciding whether to handle a message based on level threshold, then pass to next; or a chain of loggers parent->root), STRATEGY (formatting/layout), SINGLETON (LogManager / root logger), Observer (append to multiple destinations), Factory (appender creation), Builder (log config). Key design: level filtering (only log if message level >= configured threshold), async logging (BlockingQueue + worker — cross-ref concurrency-in-lld), thread safety. Extensibility: new appenders (Open/Closed), log rotation, structured/JSON logging, per-package levels. Mermaid classDiagram showing the CoR + appender hierarchy." },
  { slug: 'design-notification-system', name: 'Design a Notification / Pub-Sub System', hints: "The canonical OBSERVER + publish-subscribe problem. Core objects: Notification, NotificationChannel (interface: EmailChannel, SMSChannel, PushChannel, SlackChannel — Strategy), Subscriber/Observer, Topic/Publisher, NotificationService, Message, Template. Two related designs to cover: (a) OBSERVER pattern (subject maintains observers, notifies on state change) and (b) PUB-SUB with a broker/topic decoupling publishers from subscribers (topic-based routing, subscriber registers interest in a topic). Patterns: OBSERVER (core), STRATEGY (channel selection + retry policy), Factory (channel/notification creation), Decorator (add formatting/priority), Template Method (notification send workflow). Key design: fan-out to multiple channels per user preference, delivery retry + failure handling, rate limiting (cross-ref design-rate-limiter-oo), async delivery (queue — cross-ref concurrency-in-lld). Observer vs Pub-Sub distinction (direct coupling vs broker-mediated). Extensibility: new channels (OCP), user preferences, digest/batching, priority. Mermaid classDiagram." },
  { slug: 'design-ride-sharing', name: 'Design a Ride-Sharing Service (OO)', hints: "Uber/Ola OO model (single-machine LLD, NOT distributed geo — point matching-at-scale to system-design). Core objects: User (Rider, Driver), Trip/Ride, Location, Vehicle (types), TripRequest, DriverMatchingService, PricingStrategy, Payment, Rating. Driver STATE (Available, EnRouteToPickup, InTrip, Offline), Trip STATE (Requested, DriverAssigned, InProgress, Completed, Cancelled). Patterns: STRATEGY (driver matching — nearest/highest-rated/least-busy; pricing — base + surge + distance), STATE (driver + trip states), Observer (trip status updates to rider/driver), Factory (vehicle/trip creation), Singleton (matching service). Key flows: rider requests -> match nearest available driver -> driver accepts -> pickup -> in-trip -> complete -> fare calc + pay + rate. Matching algorithm (proximity + availability). Cross-ref concurrency-in-lld (two riders, one driver). Extensibility: carpool/pool rides, scheduled rides, surge pricing, driver incentives. Mermaid classDiagram + trip state diagram." },
  { slug: 'design-traffic-signal', name: 'Design a Traffic Signal Controller', hints: "A compact STATE-pattern + timer problem. Core objects: TrafficLight, TrafficSignalSystem (controller for an intersection), Signal state (RED, YELLOW, GREEN — with durations), Intersection, Direction (N/S/E/W), Timer. Patterns: STATE (the star — each light state knows its next state and duration; RED->GREEN->YELLOW->RED cycle), Observer (lights observe the controller / a display observes lights), Singleton (controller), Strategy (timing plan — fixed-time vs adaptive/traffic-density-based). Key design: the state transition cycle with durations; coordinating perpendicular directions (N-S green while E-W red — mutual exclusion so no conflict); emergency-vehicle preemption (force a direction green); pedestrian crossing signals. Concurrency: timer-driven transitions (cross-ref concurrency-in-lld). Extensibility: adaptive timing from sensors, emergency override, pedestrian button, synchronized 'green wave' across intersections. Mermaid stateDiagram-v2 (light cycle) + classDiagram." },
  { slug: 'design-digital-wallet', name: 'Design a Digital Wallet', hints: "PayTM/PayPal-style wallet — TRANSACTION + LEDGER modeling, concurrency-critical (balance). Core objects: User, Wallet, Account, Transaction (Credit, Debit, Transfer — abstract Transaction base), TransactionType, Ledger/TransactionHistory, PaymentMethod (BankAccount, Card), Money (value object — amount + currency, avoid float!). DOUBLE-ENTRY bookkeeping concept (every transfer = a debit + a credit; balances reconcile). Patterns: Strategy (payment method, currency conversion), State (Transaction: Initiated, Pending, Success, Failed, Reversed), Command (transaction as a command — enables audit/replay), Observer (transaction notifications), Factory. Key design: atomic transfer (debit A + credit B must both succeed — cross-ref concurrency-in-lld for locking/optimistic version; idempotency keys to prevent double-spend on retry), balance integrity (never negative), Money as immutable value object (BigDecimal not double). Extensibility: multi-currency, transaction limits, cashback, refunds/reversals. Mermaid classDiagram + transaction state diagram." },
  { slug: 'design-calendar-scheduler', name: 'Design a Calendar / Meeting Scheduler', hints: "Google-Calendar-style — INTERVAL / CONFLICT-detection logic. Core objects: User, Calendar, Event/Meeting, TimeSlot (start, end — interval), Room/Resource, Attendee, RecurrenceRule, Invitation, Reminder. Key logic: CONFLICT DETECTION (two events overlap if start1 < end2 && start2 < end1); finding a FREE SLOT common to all attendees (merge busy intervals, find gaps — interval problem, cross-ref dsa-coding merge-intervals); recurring events (RRULE expansion — daily/weekly/monthly). Patterns: Strategy (recurrence expansion, conflict-resolution/notification), Observer (reminders + invitation responses), Factory (event creation), Composite (recurring event -> instances), State (Invitation: Pending, Accepted, Declined, Tentative). Concurrency: two people booking the same room (cross-ref concurrency-in-lld). Extensibility: time zones, room booking, find-a-time across N calendars, reminders. Mermaid classDiagram." },
  { slug: 'design-text-editor', name: 'Design a Text Editor (Undo/Redo)', hints: "The canonical COMMAND + MEMENTO problem. Core objects: TextEditor, Document/TextBuffer, Command (interface: InsertCommand, DeleteCommand, ReplaceCommand — each with execute() + undo()), Commandhistory (undo stack + redo stack), Caret/Cursor, Memento (snapshot of document state), Clipboard. Patterns: COMMAND (the star — each edit is a command object with execute/undo; the undo stack holds executed commands; undo pops + calls undo(), redo re-executes), MEMENTO (capture/restore document state for undo — alternative or complement to Command-undo), Strategy (text search/find), Iterator (traverse the buffer). Key design: undo/redo via two stacks (undo stack + redo stack; a new edit clears the redo stack); efficient text storage (gap buffer / piece table / rope — mention, cross-ref dsa-coding; array of lines for interview scope). Command-based undo vs Memento-based undo trade-off (delta vs snapshot — memory). Extensibility: macros (composite command), collaborative editing (mention -> HLD), syntax highlighting. Mermaid classDiagram." },
  { slug: 'design-file-system', name: 'Design an In-Memory File System', hints: "The canonical COMPOSITE-pattern problem (directory tree). Core objects: FileSystemNode (abstract — the Component), File (leaf — has content + size), Directory (composite — holds children: files + subdirectories), FileSystem, Path. Patterns: COMPOSITE (the star — File and Directory share a common FileSystemNode interface; Directory contains a list of FileSystemNodes; operations like getSize()/delete()/search() recurse uniformly — a Directory's size = sum of children), Iterator (traverse the tree — DFS/BFS), Visitor (operations over the tree without modifying node classes — e.g. size calculator, search), Strategy (search/matching). Key operations: mkdir, create/read/write/delete file, ls, find (path resolution — split path, walk the tree), move/copy. Recursion is the natural tool (cross-ref dsa-coding trees). Extensibility: symlinks, permissions, file metadata, in-memory vs disk (mention), wildcards/glob search. Mermaid classDiagram showing Composite (Directory *-- FileSystemNode, File & Directory ..|> FileSystemNode)." },
  { slug: 'design-card-game', name: 'Design a Card Game (Deck & Blackjack)', hints: "Tests REUSABLE ABSTRACTIONS + game modeling. Core objects: Card (Suit enum: HEARTS/DIAMONDS/CLUBS/SPADES + Rank/Value enum), Deck (52 cards, shuffle, deal/draw), Hand, Player (Dealer, HumanPlayer), Game (BlackjackGame), GameStatus. The reusable Deck/Card abstractions should be game-agnostic; Blackjack rules layered on top. Blackjack specifics: hand value calc (Ace = 1 or 11; face cards = 10; bust > 21; dealer hits until 17), hit/stand/double/split, dealer vs player. Patterns: Strategy (player strategy — dealer must-hit-17 vs human decisions; scoring rules per game), Factory (deck/card creation), State (game: Betting, Dealing, PlayerTurn, DealerTurn, Settlement), Observer (game events). Emphasize: design Card/Deck to be REUSABLE across card games (poker, blackjack) — then specialize. Extensibility: other card games (poker), multiple decks, betting/chips, multiplayer. Keep it clean, avoid over-engineering. Mermaid classDiagram." },
  { slug: 'design-task-management', name: 'Design a Task Management System', hints: "Jira/Trello/Asana-style — COMPOSITION + workflow. Core objects: User, Task, Project, Board, Column/Status, Comment, Label, Sprint, Team. Task attributes: title, description, assignee, priority, status, dueDate, subtasks (a Task can contain subtasks — Composite), dependencies (task blocks/blocked-by another). Task STATE workflow (TODO -> IN_PROGRESS -> IN_REVIEW -> DONE — configurable per board). Patterns: STATE (task status transitions with allowed-transition rules), Observer (notify assignee/watchers on change), Strategy (task sorting/filtering, notification), Composite (task -> subtasks), Command (task actions for audit/undo), Factory. Key design: the status workflow (which transitions are legal), assignment, task hierarchy (parent/subtask), dependency graph (cross-ref dsa-coding topological sort for ordering), priority. Concurrency: two users editing one task (cross-ref concurrency-in-lld — optimistic version). Extensibility: custom workflows, sprints/agile, time tracking, tags/filters, activity log. Mermaid classDiagram + task state diagram." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior software engineer and LLD interview coach authoring study material for the topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / subtopics + design hints for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . Remember: emphasize the STEP-BY-STEP design-thinking (requirements -> noun/verb object identification -> responsibilities -> relationships -> class diagram -> patterns -> code -> extensibility -> concurrency). Reference (don't re-teach) GoF patterns and cross-ref dp-* + other lld-and-ood topics. Always include Mermaid classDiagram(s). Always 40-60 MCQs on design reasoning, pattern application, SOLID, extensibility, and the method.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer (senior engineer + LLD interviewer) verifying OO design content for "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `Files: ${DIR}/${t.slug}/concepts.md and questions.yaml . Read BOTH. Check and FIX IN PLACE:\n` +
    `1) DESIGN CORRECTNESS: classes have clear single responsibilities; relationships correct (composition vs aggregation vs inheritance); pattern applications appropriate (not forced/wrong — e.g. State for ATM/traffic-signal, CoR for logging, Composite for file-system, Command for text-editor undo, Observer for notifications); interview-grade (not over-engineered, not too simple).\n` +
    `2) STEP-BY-STEP METHOD present: for problem topics, confirm the topic shows requirements -> noun/verb object identification -> responsibility/relationship assignment -> class diagram -> pattern justification (this is what the user specifically asked to emphasize). For the 2 method topics, confirm the technique is taught with worked examples.\n` +
    `3) SOLID COMPLIANCE of the authored design (OCP extensibility points, LSP, ISP, DIP). Fix violations.\n` +
    `4) MERMAID: >=1 classDiagram for problem topics; valid syntax; no semicolons in sequenceDiagram messages; correct UML notation (--|> inheritance, ..|> realization, --* composition, --o aggregation, ..> dependency).\n` +
    `5) SCHEMA: valid YAML; keys topic/domain(lld-and-ood)/topic_slug(${t.slug})/version/questions; 40-60 questions; ids (prefix '${t.slug}-', unique, 3-digit seq); difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based 'answer' in range; explanation; correct-option VARIED (rebalance if any index >40% or a guessable cycle — shuffle options, keep 'answer' pointing to the correct text). Quote any YAML option with a colon+space or leading brace.\n` +
    `6) Every 'ref' resolves to a real '## ' heading (GitHub slug rules). COVERAGE: all subtopics have MCQs; MCQs test DESIGN REASONING not trivia.\n\n` +
    `After fixing, return: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
