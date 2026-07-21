export const meta = {
  name: 'lld-and-ood-authoring',
  description: 'Author Low-Level Design & OOD study content for all 18 topics: OOP/SOLID foundations, the LLD interview method, and canonical machine-coding problems with full class designs. Author -> verify.',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'design-correctness check + SOLID/pattern validation + schema check, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/lld-and-ood`

const SCOPE_NOTE = `
DOMAIN SCOPE — "Low-Level Design & Object-Oriented Design" for the MACHINE-CODING /
LLD interview round (45-90 min live-design sessions). This is the round BETWEEN DSA and
HLD: "design a parking-lot / elevator / rate-limiter / LRU / Splitwise as extensible
OO code in 45-90 min." It's NOT about distributed systems or infrastructure — it's about
clean, extensible, SOLID class design under time pressure.

TARGET AUDIENCE: backend / senior SDE candidates preparing for the OO design round at FAANG,
startups, and product companies.

WHAT EACH TOPIC MUST COVER (for a PROBLEM topic like "Design Parking Lot"):
1. REQUIREMENTS CLARIFICATION — the first 5 minutes (what questions to ask, what to scope out)
2. CORE OBJECTS/ENTITIES — identify the nouns (classes), their responsibilities, relationships
3. CLASS DIAGRAM — a Mermaid classDiagram showing the structure (keep it interview-grade: not
   enterprise overkill, not toy)
4. KEY DESIGN DECISIONS — which patterns apply and WHY (Strategy for pricing, State for elevator,
   Observer for notifications, Factory for object creation, etc.)
5. API / METHOD SIGNATURES — key public methods with types
6. CODE SKELETON — enough to show structure, not a full implementation (Java or Python, keep
   language-agnostic where possible)
7. EXTENSIBILITY — how would you extend if the interviewer asks "now add X"? (the follow-up Q)
8. CONCURRENCY / EDGE CASES — locking, race conditions, error states (if relevant)

For FOUNDATIONAL topics (OOP, SOLID, UML, method):
- Teach the PRINCIPLE with concrete code examples (not abstract sermons)
- Show how violations look vs. correct design
- Tie every principle back to "why this matters in a 45-min design session"

BOUNDARY RULES (strict):
- design-patterns (dp-*) owns the GoF taxonomy. HERE, reference patterns by name ("we use
  Strategy here because...") but don't re-teach the pattern from scratch. Cross-reference
  the dp-* topics.
- dsa-coding owns data-structure internals. If a problem uses a HashMap/Queue internally,
  say so; don't re-derive how HashMap works.
- system-design owns distributed architecture. If a problem has a "scale to millions" follow-up,
  acknowledge it's an HLD concern and point there; keep the LLD design single-machine OO.

Language: primarily Java (the lingua franca of LLD interviews) with language-agnostic prose.
A Python alternative snippet is welcome but not required.
`

const SCHEMA = `
CONTENT CONTRACT (follow exactly). Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1.
   - "## <Subtopic>" H2 per subtopic (MCQ anchor targets — keep stable).
   - For PROBLEM topics: follow the structure above (Requirements, Entities, Class Diagram,
     Design Decisions, API, Code Skeleton, Extensibility, Edge Cases).
   - For FOUNDATIONAL topics: teach the principle with code examples, violations vs. fixes.
   - Mermaid diagrams REQUIRED for problem topics (classDiagram showing relationships;
     optionally stateDiagram-v2 for state machines like elevator/vending). NO ASCII-art.
     CRITICAL: no semicolons in sequenceDiagram message text (use commas).
   - End with "## Common Interview Follow-ups" (the "now extend it" questions an interviewer
     would ask) and "## References".

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

   RULES: aim for 40-60 MCQs per topic. Focus MCQs on:
   - DESIGN REASONING ("which pattern fits this requirement?", "which SOLID principle does
     this violate?", "what's the responsibility of this class?")
   - EXTENSIBILITY ("how would you add feature X without modifying existing code?")
   - TRADE-OFFS ("why Strategy over if-else chains here?")
   - CLASS RELATIONSHIPS ("which relationship — composition, inheritance, aggregation?")
   3-5 options, exactly one correct, 0-based answer; VARY the correct index (no clustering:
   no single index >40%); mixed difficulty; scenario-based items preferred; distractors
   plausible but wrong for a real design reason; no all/none-of-the-above; every 'ref'
   resolves to a real "## " heading; id prefix == slug.

Use the Write tool. Do your own research to ensure design patterns are applied correctly and
class designs are industry-standard. Return: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'oop-principles-pillars', name: 'OOP Principles & Pillars', hints: "The four pillars of OOP: ENCAPSULATION (information hiding, access modifiers, tell-don't-ask, getters that expose internals = violation), ABSTRACTION (hiding complexity behind interfaces, abstract classes vs interfaces, when to use each), INHERITANCE (is-a relationship, method overriding, super, the fragile-base-class problem, PREFER COMPOSITION OVER INHERITANCE — why, Liskov preview), POLYMORPHISM (compile-time/overloading vs runtime/overriding, interface polymorphism, strategy pattern as polymorphism in action, dynamic dispatch). Teach with SHORT Java code examples — a violation example + fixed version for each. Connect to 'why this matters in a 45-min LLD session'." },
  { slug: 'solid-principles', name: 'SOLID Principles Deep Dive', hints: "S — Single Responsibility (one reason to change; class doing I/O + business logic = violation; refactor: separate concerns); O — Open/Closed (open for extension, closed for modification; if-else type-checking = violation; fix: strategy/polymorphism); L — Liskov Substitution (subtypes must be substitutable; Square extends Rectangle violation; fix: separate abstractions); I — Interface Segregation (no client forced to depend on unused methods; fat interface = violation; fix: split); D — Dependency Inversion (depend on abstractions not concretions; new ConcreteService() in high-level = violation; fix: inject interface). Each with a BEFORE/AFTER code example. Show how violations compound in a 45-min design (rigid, fragile, immobile code). The principles as a CHECKLIST during LLD interviews." },
  { slug: 'design-principles-beyond-solid', name: 'Design Principles Beyond SOLID', hints: "DRY (don't repeat yourself — but WRONG DRY = premature abstraction coupling unrelated code; when duplication is acceptable); KISS (simplest solution that works — don't over-engineer in a 45-min interview); YAGNI (you aren't gonna need it — scope control in LLD); Composition over Inheritance (why, delegation pattern, has-a vs is-a decision, the diamond problem); Law of Demeter (don't talk to strangers, a.getB().getC().doX() = violation, fix: delegate); Tell Don't Ask (command objects vs querying then deciding); Separation of Concerns; High Cohesion + Low Coupling (metrics: afferent/efferent coupling, instability); the GRASP patterns (Creator, Information Expert, Controller, Low Coupling, High Cohesion, Polymorphism, Pure Fabrication, Indirection, Protected Variations). Show how each applies in real LLD decisions." },
  { slug: 'uml-class-diagrams', name: 'UML Class Diagrams for Interviews', hints: "What you ACTUALLY need to draw in a 45-min LLD round (not full UML spec): CLASSES (name, key attributes, key methods); RELATIONSHIPS — association (has-a, solid line), aggregation (hollow diamond — whole/part, part can exist alone), composition (filled diamond — part dies with whole), inheritance/generalization (hollow triangle arrow), interface implementation (dashed triangle), dependency (dashed arrow). Multiplicity (1, 0..1, *, 1..*). How to QUICKLY sketch a class diagram on a whiteboard: start with nouns -> classes, verbs -> methods, relationships -> lines. Show with Mermaid classDiagram syntax (the same tool used in the study site). Common mistakes (too many classes, missing relationships, god class). A Mermaid classDiagram cheat-sheet." },
  { slug: 'lld-interview-method', name: 'The LLD Interview Method', hints: "THE STEP-BY-STEP METHOD for the 45-90 min round: 1) CLARIFY REQUIREMENTS (5 min: ask scope Qs, identify actors/use-cases, confirm constraints — single machine? concurrent? which features in/out?); 2) IDENTIFY CORE OBJECTS (5 min: nouns from requirements -> candidate classes; assign single responsibility to each); 3) ESTABLISH RELATIONSHIPS (5 min: is-a vs has-a, multiplicity, who creates whom — draw a rough class diagram); 4) DEFINE KEY INTERFACES & METHODS (10 min: public API, method signatures, return types — what each class DOES); 5) APPLY PATTERNS (ongoing: Strategy for varying algorithms, Factory for creation, Observer for events, State for FSM, Singleton for shared resource — name the pattern and WHY); 6) WRITE CODE (20-40 min: skeleton + critical methods, compile-ready style, show extensibility); 7) DISCUSS EXTENSIBILITY & EDGE CASES (5 min: 'what if we add X?' — demonstrate OCP in action, mention concurrency if relevant). EVALUATION CRITERIA interviewers use: correctness, SOLID adherence, pattern knowledge, communication clarity, handling follow-ups. Common pitfalls: over-engineering, not clarifying scope, monolithic god class, no pattern justification." },
  { slug: 'design-parking-lot', name: 'Design a Parking Lot', hints: "THE classic LLD problem. Requirements: multi-floor parking lot, different vehicle sizes (motorcycle/car/bus), multiple entry/exit gates, ticketing system, payment (hourly rate). Core objects: ParkingLot, Floor, ParkingSpot (types: Compact, Large, Handicapped, Motorcycle), Vehicle (Car, Bus, Motorcycle), Ticket, Payment, EntryGate, ExitGate, DisplayBoard. Patterns: Strategy (for pricing — hourly, daily, first-hour-free), Factory (for spot/vehicle creation), Singleton (ParkingLot instance). Key design decisions: how to find the nearest available spot (per floor tracking), spot assignment strategy (first available vs optimize compactness), payment calculation. Extensibility: add EV charging spots, valet parking, subscription/monthly passes. Concurrency: two cars arriving simultaneously for last spot — locking. Class diagram in Mermaid." },
  { slug: 'design-elevator-system', name: 'Design an Elevator System', hints: "Multiple elevators in a building, handling up/down requests from floors and destination requests from inside. Core objects: ElevatorSystem (controller/dispatcher), Elevator, Request (external: floor+direction; internal: destination floor), Door, Display, Button (HallButton, ElevatorButton). Patterns: Strategy (for scheduling/dispatching algorithm — SCAN/LOOK, shortest-seek, nearest-car), State (Elevator states: IDLE, MOVING_UP, MOVING_DOWN, DOOR_OPEN), Observer (notify displays). Key algorithms: LOOK/SCAN algorithm (continue in current direction, service all requests, then reverse), how to assign an external request to the best elevator (minimize wait). The state machine for a single elevator. Extensibility: VIP/express elevator, weight limit, emergency mode, maintenance mode. Concurrency: multiple simultaneous button presses. Mermaid stateDiagram-v2 for elevator states + classDiagram." },
  { slug: 'design-library-management', name: 'Design a Library Management System', hints: "A system for managing books, members, borrowing, returning, reservations, fines. Core objects: Library, Book, BookItem (physical copy — multiple copies per Book), Member, Librarian, BookReservation, BookLending, Fine, Rack, Notification. Patterns: Observer (notify when reserved book available), Strategy (fine calculation), State (BookItem: Available, Reserved, Loaned, Lost). Key flows: search book (by title/author/subject/ISBN), checkout (check availability, max limit), return (calculate fine if overdue), reserve (queue if all copies out). Relationships: Book 1->* BookItem (one title, many copies), Member *->* BookLending. Extensibility: digital books/e-reader, inter-library loan, recommendation engine. Mermaid classDiagram." },
  { slug: 'design-vending-machine', name: 'Design a Vending Machine', hints: "A state-machine-heavy design. States: IDLE, HAS_MONEY, DISPENSING, SOLD_OUT (per slot). Core objects: VendingMachine, State (interface + concrete: IdleState, HasMoneyState, DispensingState), Slot, Product, Coin/Payment, Inventory. Patterns: STATE pattern (the star here — each state handles insertCoin/selectProduct/dispense differently; avoids massive if-else), Strategy (for change-making algorithm), Factory (for state transitions). Key logic: accept coins -> track balance -> select product -> check balance >= price -> dispense + return change -> reset; coin-change algorithm (greedy for standard denominations). Extensibility: card payment, touch screen, remote inventory monitoring. Edge cases: insufficient change available, simultaneous users (unlikely for physical), power failure (persist state). Mermaid stateDiagram-v2 is PERFECT for this." },
  { slug: 'design-tic-tac-toe', name: 'Design a Tic-Tac-Toe Game', hints: "Simple but tests OO fundamentals well. Core objects: Game, Board, Cell, Player (HumanPlayer, ComputerPlayer), Move, GameStatus. Key design: Board stores a grid of Cells; a Cell has a state (empty/X/O); Game manages turn order; win-check logic (rows/cols/diagonals — O(1) trick: maintain row/col/diag counters per player, check if any equals N). Patterns: Strategy (for ComputerPlayer AI — random, minimax, alpha-beta), Factory (create players). SOLID: Game doesn't know if player is human/computer (polymorphism). Extensibility: NxN board, connect-K, multiplayer over network, undo move (Command pattern preview). Important: keep it SIMPLE — this tests clean OO, not algorithmic wizardry. The O(1) win-check (counters approach vs O(n) scan) is the key insight. Mermaid classDiagram." },
  { slug: 'design-chess-game', name: 'Design a Chess Game', hints: "Complex LLD — tests inheritance/polymorphism heavily. Core objects: Game, Board, Cell/Square, Piece (abstract: King, Queen, Rook, Bishop, Knight, Pawn — each overrides canMove/getValidMoves), Player, Move, GameStatus (ACTIVE, CHECK, CHECKMATE, STALEMATE, RESIGNED). Key design: Piece is abstract with canMove(Board, start, end) — each subclass implements movement rules; Board is 8x8 grid of Squares; Move validation (is the path clear? does it leave own king in check?). Patterns: no forced pattern overkill — inheritance/polymorphism IS the pattern (each Piece type is a subclass with its own movement logic); Command (for undo/move history); Observer (for check/checkmate notification). The tricky parts: castling (special move with conditions), en passant, pawn promotion, check/checkmate detection (simulate all opponent responses). Extensibility: undo, move timer, variants. Mermaid classDiagram showing Piece hierarchy." },
  { slug: 'design-snake-ladder', name: 'Design a Snake & Ladder Game', hints: "Tests basic OO + game-loop design. Core objects: Game, Board, Cell, Snake (head, tail), Ladder (start, end), Player, Dice. Key design: Board is a linear array of cells (1-100); some cells have a Snake (sends you down) or Ladder (sends you up); Game loop: roll dice -> advance player -> check for snake/ladder -> check win (reach/pass 100). Simple but tests: separating game logic from board setup, the game loop pattern, handling multiple players, validation (no snake at 100, head > tail for snake, end > start for ladder, no overlap). Patterns: no over-engineering needed — Factory for board setup, maybe Strategy for dice (single vs double). Extensibility: configurable board size, special cells (skip turn, extra roll), multiplayer online. This is a SIMPLER problem — show that you can solve it cleanly WITHOUT over-engineering (a common mistake). Mermaid classDiagram." },
  { slug: 'design-rate-limiter-oo', name: 'Design a Rate Limiter (OO)', hints: "An LLD classic that bridges system design. Focus on the OO CLASS DESIGN of a rate limiter (single-machine, not distributed). Core objects: RateLimiter (interface), concrete strategies (TokenBucketLimiter, SlidingWindowLimiter, FixedWindowLimiter, LeakyBucketLimiter), RateLimitRule (requests-per-window, per userId/IP/API), RateLimitResponse (allowed/denied + retry-after). Patterns: STRATEGY (the core pattern — different algorithms behind a common interface), Factory (create the right limiter from config), Decorator/Chain (compose: per-user AND per-API limits). Key algorithms (OO structure, not deep math): Token Bucket (bucket with tokens, refill rate, consume on request), Sliding Window Log (sorted timestamps, count in window), Sliding Window Counter (approx: current window count + fraction of previous), Fixed Window (counter + reset). Class design: interface RateLimiter { boolean allow(Request) }, each strategy implements differently. Extensibility: distributed (Redis-backed — mention as HLD extension), composite rules, whitelisting. Concurrency: CAS/atomic operations for thread safety. Mermaid classDiagram + strategy relationship." },
  { slug: 'design-cache-oo', name: 'Design an LRU / LFU Cache (OO)', hints: "The OO DESIGN perspective (not just the data-structure trick from DSA). Core objects: Cache (interface: get, put, evict), EvictionPolicy (interface: LRUEvictionPolicy, LFUEvictionPolicy, FIFOEvictionPolicy), CacheEntry, Storage (HashMap). Patterns: STRATEGY (eviction policy is interchangeable), Factory (create cache with config), Observer (notify on eviction for write-behind), Decorator (add TTL on top of base cache). LRU internals from an OO lens: DoublyLinkedList + HashMap, but wrapped in clean classes (not raw pointers). LFU: frequency map + min-frequency tracking. Design decisions: max size, eviction trigger (on put when full), thread safety (ReadWriteLock), null handling. Extensibility: TTL-based expiry (lazy vs active cleanup), distributed cache (memcached/Redis — HLD), write-through vs write-behind, multi-level cache (L1 in-memory + L2 remote). Show how SOLID applies: single-responsibility (storage vs eviction vs timing), open-closed (new eviction policy without changing Cache). Mermaid classDiagram." },
  { slug: 'design-splitwise', name: 'Design Splitwise / Expense Sharing', hints: "A popular LLD problem at Indian product companies and increasingly elsewhere. Core objects: User, Group, Expense (EqualExpense, ExactExpense, PercentExpense — the split types), Split (EqualSplit, ExactSplit, PercentSplit), Balance, ExpenseService. Key logic: when A pays 300 for A/B/C equally -> B owes A 100, C owes A 100; maintain a balance sheet (who owes whom how much); simplify debts (minimize transactions — the graph-based simplification algorithm). Patterns: Strategy (split calculation: equal, exact amount, percentage, shares-based), Observer (notify users of new expenses), Factory (create appropriate Split type). Data model: balanceSheet[userA][userB] = net amount owed; simplify = min-cash-flow problem (NP-hard optimal, but greedy works for interviews). Extensibility: settle-up, recurring expenses, multi-currency, group admin. Show the Expense class hierarchy (abstract Expense + concrete splits). Mermaid classDiagram." },
  { slug: 'design-hotel-booking', name: 'Design a Hotel Booking System', hints: "Core objects: Hotel, Room (types: Single, Double, Suite, Deluxe), RoomBooking, Guest, Payment, Notification. Key flows: search available rooms (date range + type + location), book (check availability, reserve, payment), cancel (refund policy), check-in/check-out. Patterns: Strategy (pricing — seasonal, weekend, dynamic), State (Room: AVAILABLE, RESERVED, OCCUPIED, UNDER_MAINTENANCE, CHECKED_OUT), Factory (room creation by type), Observer (booking confirmation notifications). Design decisions: how to check availability efficiently (date-range overlap query: a room is available if no existing booking overlaps [checkIn, checkOut)); overbooking policy (airlines do it, hotels usually don't); concurrent booking for last room (pessimistic lock on room+date). Extensibility: add amenities/packages, loyalty points, third-party aggregator API, cancellation waitlist. Mermaid classDiagram + state diagram for Room." },
  { slug: 'design-food-delivery-oo', name: 'Design a Food Delivery App (OO)', hints: "Core objects: User (Customer, DeliveryPartner, RestaurantOwner), Restaurant, Menu, MenuItem, Order, OrderItem, Payment, DeliveryPartner, Cart, Rating, Notification. Key flows: browse restaurants (location-based), add to cart, place order (payment), assign delivery partner, track order, deliver, rate. Patterns: Strategy (delivery assignment — nearest available, lowest load, rating-weighted), Observer (order status updates to customer/restaurant/partner), State (Order: PLACED, CONFIRMED, PREPARING, PICKED_UP, IN_TRANSIT, DELIVERED, CANCELLED), Factory (payment types). Design decisions: how to assign a delivery partner (proximity + availability + load balancing), order state machine, cart management (one restaurant per cart? multiple?). Extensibility: promo codes/discounts, surge pricing, scheduled orders, restaurant analytics. Keep it OO/single-machine scope — distributed geo-search is HLD. Mermaid classDiagram + order state diagram." },
  { slug: 'design-auction-system', name: 'Design an Online Auction System', hints: "Core objects: User (Buyer, Seller), Auction (types: English/ascending, Dutch/descending, Sealed-bid), Item, Bid, AuctionStatus, Payment, Notification. Key flows: seller creates auction (item + reserve price + duration), buyers place bids (must exceed current highest + minimum increment), auction ends (highest bidder wins if >= reserve), payment + transfer. Patterns: Strategy (auction type determines bidding rules — English: ascending open bids; Dutch: descending price, first to accept wins; Sealed: one secret bid each), Observer (notify on outbid, auction ending, won), State (Auction: CREATED, ACTIVE, ENDED, CANCELLED, PAYMENT_PENDING, COMPLETED). Design decisions: bid validation (> current + increment, user != seller, auction still active), anti-sniping (extend time on last-second bid), reserve price (hidden minimum). Concurrency: two bids arriving simultaneously for the same auction (optimistic lock + retry or synchronized). Extensibility: auto-bidding (proxy bid up to max), buy-it-now, auction categories. Mermaid classDiagram + auction state diagram." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior software engineer and LLD interview coach authoring study material for the topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / subtopics + design hints for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . Remember: for PROBLEM topics, follow the full structure (Requirements -> Entities -> Class Diagram -> Design Decisions -> API -> Code Skeleton -> Extensibility -> Edge Cases). For FOUNDATIONAL topics, teach principles with BEFORE/AFTER code. Always include Mermaid classDiagram(s). Always 40-60 MCQs focused on design reasoning, pattern application, SOLID, and extensibility.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer (senior engineer + LLD interviewer) verifying OO design content for "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `Files: ${DIR}/${t.slug}/concepts.md and questions.yaml . Read BOTH. Check and FIX IN PLACE:\n` +
    `1) DESIGN CORRECTNESS: classes have clear single responsibilities; relationships are correct (composition vs aggregation vs inheritance); pattern applications are appropriate (not forced/wrong); the design is interview-grade (not over-engineered, not too simple).\n` +
    `2) SOLID COMPLIANCE: does the design itself follow SOLID? Open-Closed for extensibility points, Liskov where inheritance is used, ISP for interfaces, DIP for high-level -> abstraction. Flag and fix any violations in the AUTHORED design.\n` +
    `3) MERMAID DIAGRAMS: at least one classDiagram for problem topics; valid syntax; no semicolons in sequenceDiagram messages; relationships use correct UML notation (--|> inheritance, ..> dependency, --* composition, --o aggregation, -- association).\n` +
    `4) SCHEMA VALIDITY: valid YAML; top-level keys topic/domain(lld-and-ood)/topic_slug(${t.slug})/version/questions; 40-60 questions; ids (prefix '${t.slug}-', unique, 3-digit seq); difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based 'answer' in range; explanation; correct-option VARIED (rebalance if any single index >40% or a guessable repeating cycle — shuffle the option order while keeping 'answer' pointing to the correct one). Quote any YAML option containing a colon+space or leading brace.\n` +
    `5) Every 'ref' resolves to a real '## ' heading in concepts.md (GitHub slug rules: lowercase, spaces->hyphens, strip special chars).\n` +
    `6) COVERAGE: all subtopics from the concepts have MCQs; MCQs test DESIGN REASONING (not trivia); for problem topics, MCQs test pattern choice, class responsibility, relationship decisions, extensibility.\n\n` +
    `After fixing, return: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
