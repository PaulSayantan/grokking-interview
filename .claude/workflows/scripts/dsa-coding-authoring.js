export const meta = {
  name: 'dsa-coding-authoring',
  description: 'Author DSA & coding-interview study content for all 20 topics: deep data-structure internals, algorithms, complexity, problem-solving patterns, a per-topic "Interview Problems" LeetCode section, and a lighter MCQ set (internals/complexity/pattern-choice). Author -> verify.',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact/complexity-check + LeetCode-link sanity + schema-check, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/dsa-coding`

const SCOPE_NOTE = `
DOMAIN SCOPE — "Data Structures, Algorithms & Coding Interviews" for BACKEND + SENIOR developer
coding rounds. This domain is PRIMARILY CODING PRACTICE, but the study content must be excellent.
Two things the user emphasized:
1. DEEP DATA-STRUCTURE INTERNALS. Students skip the basics and how the BUILT-IN structures actually
   work. For every data-structure topic, clearly explain HOW IT WORKS UNDER THE HOOD, not just the
   API: e.g. HashMap = array of buckets + hash function + collision resolution (chaining vs open
   addressing) + load factor + resize/rehash + why O(1) average / O(n) worst; HashSet = a HashMap
   with dummy values; Trie = tree of nodes keyed by character + end-of-word flag; Heap = complete
   binary tree stored in an ARRAY with sift-up/sift-down; Graph = adjacency list vs matrix trade-offs;
   BST = ordering invariant + why balance matters; Union-Find = parent array + path compression +
   union by rank. Include time/space complexity for every operation and the underlying memory layout.
2. PROBLEM-SOLVING PATTERNS & TECHNIQUES. Teach the recurring patterns that unlock most problems
   (two-pointer, sliding window, fast/slow pointers, BFS/DFS, backtracking, binary-search-on-answer,
   monotonic stack, top-K with a heap, DP (memo vs tabulation), greedy, union-find, prefix sum, etc.)
   — WHEN to reach for each (the recognition signals) and the template.

Language-agnostic where possible (pseudocode / clear prose), but you MAY show a short idiomatic
snippet (Java/Python) to illustrate. Ground complexity claims and structure internals in standard
references (CLRS, the Java Collections / Python data-model docs for the built-ins, competitive-
programming canon). Verify any complexity claim you're unsure of.
`

const INTERVIEW_PROBLEMS = `
MANDATORY "## Interview Problems" SECTION (near the end, before Common follow-up questions):
Add a "## Interview Problems" H2 listing ~15 CANONICAL LeetCode problems that this topic's
structure/pattern drills — the ones predominantly asked in SDE interviews. Format each as a
markdown list item: problem name as a LINK to its leetcode.com/problems/<slug>/ URL, its
difficulty (Easy/Medium/Hard), and a few words on which technique it exercises. Example:
  - [Two Sum](https://leetcode.com/problems/two-sum/) — Easy — hash map for O(n) complement lookup
Use REAL, well-known problems and their correct canonical slugs (two-sum, valid-parentheses,
number-of-islands, lru-cache, merge-k-sorted-lists, course-schedule, word-search, etc.). Prefer
famous classics you are confident about over obscure ones. If unsure of a slug, pick a more famous
problem you ARE sure of rather than guessing a URL. Group by difficulty or sub-pattern if helpful.
`

const SCHEMA = `
CONTENT CONTRACT (follow exactly). Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1.
   - "## <Subtopic>" H2 per subtopic (MCQ anchor targets — keep stable). For a data-structure topic,
     lead with the INTERNALS (how it works under the hood, memory layout, per-operation complexity),
     then patterns/usage, then gotchas. For a pattern topic, teach the recognition signal + template
     + complexity + variations.
   - Concrete: complexity tables (operation -> avg/worst time + space), short code/pseudocode,
     a worked example, comparison tables (e.g. adjacency list vs matrix; memoization vs tabulation).
   - A "## Interview Problems" section per the rules below.
   - If a diagram helps (heap-as-array, trie structure, BFS/DFS traversal, hashmap buckets, DP grid),
     use a \`\`\`mermaid fenced block (flowchart/graph/stateDiagram-v2). NO ASCII-art. CRITICAL: no
     semicolons in sequenceDiagram message text (breaks the parser — use commas).
   - End with "## Common follow-up questions" and "## References".
   ${INTERVIEW_PROBLEMS}

2) questions.yaml — top-level keys:
     topic: "<Topic Name>"
     domain: dsa-coding
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
           <why correct; teach the concept>
         ref: "concepts.md#<anchor>"  # resolves to a real "## " heading (GitHub slug rules)

   RULES: this domain is coding-first, so MCQs are LIGHTER — aim for 15-40 per topic (MINIMUM 12; a
   topic MUST have at least a few so it renders on the site). Focus MCQs on: data-structure INTERNALS
   (buckets/collisions/load-factor/rehash, heap sift, BST balance, trie nodes, graph representation),
   COMPLEXITY ("what's the worst-case time of X"), and PATTERN CHOICE ("which technique best solves
   this problem shape"). 3-5 options, exactly one correct, 0-based answer; VARY the correct index (no
   clustering, no trivially-guessable cycle); mixed difficulty; scenario/"which pattern fits" items;
   distractors plausible but wrong for a real reason (e.g. a plausible-but-wrong complexity); no
   all/none-of-the-above; every 'ref' resolves to a real "## " heading; id prefix == slug.

Use the Write tool. Do your own research to ensure complexity/internals are correct and LeetCode
slugs are real. Return: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions), <k> LC problems".
`

const TOPICS = [
  { slug: 'complexity-analysis-big-o', name: 'Complexity Analysis & Big-O', hints: "asymptotic notation (Big-O/Omega/Theta, why we drop constants & lower terms); common classes O(1)/O(log n)/O(n)/O(n log n)/O(n^2)/O(2^n)/O(n!) with examples; time vs SPACE complexity (incl. recursion stack space, in-place); amortized analysis (dynamic array doubling -> amortized O(1) append; aggregate/accounting/potential methods intuition); best/avg/worst case; analyzing loops/nested loops/recursion (recurrence -> Master Theorem intuition); log bases don't matter in O; how to state complexity in an interview; common mistakes (ignoring input-size of hidden ops, sort inside a loop)." },
  { slug: 'coding-patterns-overview', name: 'Coding Interview Patterns Overview', hints: "the meta-topic: the recurring PATTERNS that solve ~most interview problems + how to RECOGNIZE which to use (the signal). Catalogue with a one-line 'reach for this when...': two pointers, sliding window, fast/slow pointers, merge intervals, cyclic sort, in-place reversal, BFS, DFS, backtracking, top-K/heap, K-way merge, binary search (+ on answer), monotonic stack, prefix sum, union-find, topological sort, trie, dynamic programming (memo/tabulation), greedy, bit manipulation; a decision guide (sorted array -> binary search/two pointers; contiguous subarray -> sliding window; tree/graph shortest -> BFS; all combinations -> backtracking; 'kth' -> heap; overlapping subproblems -> DP); the general problem-solving process (clarify -> examples -> brute force -> optimize -> code -> test); complexity trade-offs." },
  { slug: 'arrays-strings-hashing', name: 'Arrays, Strings & Hashing', hints: "arrays (contiguous memory, O(1) index, O(n) insert/delete-middle, dynamic array/amortized resize); strings (immutability in Java/Python -> O(n) concat pitfalls, StringBuilder, char arrays); the HASHING technique for O(1) lookups (use a hash map/set to trade space for time — frequency maps, seen-sets, complement lookup, grouping by key); in-place array tricks; 2D arrays; common gotchas (off-by-one, integer overflow, string vs char). Interview Problems: Two Sum, Group Anagrams, Top K Frequent, Product Except Self, Valid Anagram, Contains Duplicate, Longest Consecutive Sequence, etc." },
  { slug: 'hashmap-hashset-internals', name: 'Hash Tables: HashMap & HashSet Internals', hints: "THE INTERNALS the user cares about: hash table = array of BUCKETS + a HASH FUNCTION mapping key -> bucket index; COLLISION resolution — separate CHAINING (linked list / tree per bucket; Java 8 treeifies a bucket to a red-black tree at 8+ entries) vs OPEN ADDRESSING (linear/quadratic probing, Robin Hood, tombstones on delete); LOAD FACTOR (size/capacity, default 0.75 in Java) triggers RESIZE/REHASH (double capacity, rehash all — why it's amortized O(1)); why get/put are O(1) AVERAGE but O(n) WORST (all collide); why keys need consistent hashCode + equals (and immutability); HashSet = HashMap with a dummy value; LinkedHashMap (insertion order) & TreeMap (sorted, O(log n)); iteration order not guaranteed; hash flooding. Interview Problems: Two Sum, LRU Cache (map+DLL), Group Anagrams, Subarray Sum Equals K, First Unique Char, etc." },
  { slug: 'two-pointers-sliding-window', name: 'Two Pointers, Sliding Window & Prefix Sum', hints: "TWO POINTERS (opposite-ends converging for sorted arrays/palindrees; or same-direction) — signal: sorted array, pair/triplet, in-place; SLIDING WINDOW (fixed or variable-size window over a contiguous subarray/substring; expand right, shrink left; track window state) — signal: 'contiguous subarray/substring with property', longest/shortest/max/min; PREFIX SUM (precompute cumulative sums for O(1) range-sum queries; + hashmap for subarray-sum-equals-k); the templates & complexity (O(n) vs the O(n^2) brute force they replace). Interview Problems: Two Sum II, 3Sum, Container With Most Water, Longest Substring Without Repeating, Minimum Window Substring, Longest Repeating Char Replacement, Subarray Sum Equals K, Trapping Rain Water, etc." },
  { slug: 'linked-lists', name: 'Linked Lists & Fast/Slow Pointers', hints: "singly vs doubly linked list (node = value + next[/prev]; O(1) insert/delete given the node, O(n) search/index — vs array trade-off); the DUMMY/SENTINEL head trick; in-place REVERSAL (iterative 3-pointer, recursive); FAST/SLOW POINTERS (Floyd's cycle detection — detect loop, find cycle start, find middle); merge two sorted lists; why linked lists lose to arrays on cache locality; common bugs (losing the next pointer, null handling). Interview Problems: Reverse Linked List, Linked List Cycle, Merge Two Sorted Lists, Remove Nth From End, Reorder List, Add Two Numbers, Copy List with Random Pointer, LRU Cache, Merge k Sorted Lists, etc." },
  { slug: 'stacks-queues-monotonic', name: 'Stacks, Queues & Monotonic Stack', hints: "STACK (LIFO; array or linked impl; uses: matching/parentheses, undo, DFS, expression eval, function call stack); QUEUE (FIFO; array-backed circular buffer or linked; deque as both); the MONOTONIC STACK/queue pattern (maintain increasing/decreasing stack to find next-greater/next-smaller element in O(n)) — signal: 'next greater/smaller', histogram, temperatures; min-stack (auxiliary stack); using two stacks as a queue & vice versa. Interview Problems: Valid Parentheses, Min Stack, Daily Temperatures, Next Greater Element, Largest Rectangle in Histogram, Evaluate RPN, Implement Queue using Stacks, Sliding Window Maximum (monotonic deque), Car Fleet, etc." },
  { slug: 'binary-search', name: 'Binary Search & Its Variants', hints: "the core (sorted input, halve the search space, O(log n)) & the correct template (avoid overflow mid = lo + (hi-lo)/2, loop invariant, off-by-one/termination — the classic source of bugs); VARIANTS — leftmost/rightmost insertion point (lower_bound/upper_bound), search in rotated sorted array, find peak, search a 2D matrix; BINARY SEARCH ON THE ANSWER (search a monotonic predicate over a value range, not an array — 'minimize the max' / 'can we do it in X?' — Koko eating bananas, ship packages, split array) — a huge senior pattern; why the naive template has bugs. Interview Problems: Binary Search, Search in Rotated Sorted Array, Find Minimum in Rotated Sorted Array, Search a 2D Matrix, Koko Eating Bananas, Find First and Last Position, Median of Two Sorted Arrays, Time Based Key-Value Store, etc." },
  { slug: 'sorting-and-selection', name: 'Sorting Algorithms & Selection', hints: "the classic sorts & their complexity/stability/in-place: bubble/insertion/selection (O(n^2), insertion good for nearly-sorted/small), MERGE SORT (O(n log n), stable, O(n) space, divide-and-conquer), QUICK SORT (O(n log n) avg / O(n^2) worst, in-place, not stable, pivot choice/partition), HEAP SORT (O(n log n), in-place, not stable), counting/radix/bucket (linear, non-comparison, constraints); why comparison sorts are >= O(n log n); what real libraries use (Timsort in Java/Python for objects, dual-pivot quicksort for primitives); QUICKSELECT (O(n) average kth-largest via partition) — the selection pattern; sorting as a preprocessing step. Interview Problems: Sort Colors, Kth Largest Element, Merge Intervals, Largest Number, Sort List, Top K Frequent, Meeting Rooms, etc." },
  { slug: 'recursion-backtracking', name: 'Recursion & Backtracking', hints: "RECURSION (base case + recursive case, the call stack, stack space, when it beats iteration; recursion-to-iteration with an explicit stack; tail recursion); BACKTRACKING (build a candidate incrementally, abandon ('backtrack') when it can't lead to a solution — the choose/explore/unchoose template; prune early) — signal: 'all combinations/permutations/subsets', constraint satisfaction, generate all valid X; the decision-tree view & complexity (often exponential — O(2^n)/O(n!)); permutations vs combinations vs subsets templates; pruning to cut the search space. Interview Problems: Subsets, Permutations, Combination Sum, Word Search, N-Queens, Palindrome Partitioning, Letter Combinations of a Phone Number, Generate Parentheses, Sudoku Solver, etc." },
  { slug: 'trees-bst-traversals', name: 'Trees, BST & Traversals', hints: "binary tree structure (node = val + left + right; height/depth/balanced/complete/full); TRAVERSALS — DFS preorder/inorder/postorder (recursive + iterative-with-stack; inorder of a BST is SORTED), BFS level-order (queue); BINARY SEARCH TREE (left < node < right invariant -> O(h) search/insert/delete; O(log n) if balanced, O(n) if skewed -> why self-balancing: AVL/red-black rotations, brief); lowest common ancestor; tree DP (bottom-up return values); serialize/deserialize; recursion is the natural tool. Interview Problems: Invert Binary Tree, Max Depth, Diameter, Balanced Binary Tree, Same Tree, Subtree, LCA (BST & binary), Level Order, Validate BST, Kth Smallest in BST, Construct from Preorder/Inorder, Serialize/Deserialize, Right Side View, etc." },
  { slug: 'heaps-priority-queues-topk', name: 'Heaps, Priority Queues & Top-K', hints: "THE INTERNALS: a binary HEAP is a COMPLETE binary tree stored in an ARRAY (parent i -> children 2i+1/2i+2; no pointers) with the heap invariant (min-heap: parent <= children); SIFT-UP (on insert) and SIFT-DOWN (on extract-min) are O(log n); build-heap is O(n); peek O(1); a PriorityQueue is a heap; heapify; the TOP-K pattern (keep a heap of size k -> O(n log k) for k-largest/smallest; min-heap for k-largest) — signal: 'kth largest/smallest', 'top k', 'k closest', streaming; two-heaps pattern (median of a stream); heap vs sorting for top-k; K-way merge with a heap. Interview Problems: Kth Largest Element, Top K Frequent, Find Median from Data Stream, Merge k Sorted Lists, K Closest Points, Task Scheduler, Kth Largest in a Stream, Reorganize String, etc." },
  { slug: 'tries', name: 'Tries (Prefix Trees)', hints: "THE STRUCTURE: a trie is a tree where each NODE represents a character and a path from root spells a prefix; node = map/array of children (26 for lowercase) + an is-end-of-word flag; insert/search/startsWith are O(L) in the key length (independent of the number of words) — the win over a hash set for PREFIX queries; space cost (many nodes; compressed/radix trie & ternary search trie as optimizations); when to use (autocomplete, prefix matching, word dictionaries, IP routing) vs a hash map (exact lookup); building on a trie (word search II with DFS + trie). Interview Problems: Implement Trie, Design Add and Search Words, Word Search II, Longest Word in Dictionary, Replace Words, Maximum XOR of Two Numbers (bit-trie), etc." },
  { slug: 'graphs-bfs-dfs-topological', name: 'Graphs: Representations, BFS, DFS & Topological Sort', hints: "REPRESENTATIONS: adjacency LIST (space O(V+E), good for sparse — the usual choice) vs adjacency MATRIX (O(V^2), O(1) edge lookup, dense) vs edge list; directed/undirected, weighted, cyclic; TRAVERSALS — BFS (queue, shortest path in UNWEIGHTED graph, level by level) vs DFS (stack/recursion, cycle detection, connected components, path existence); visited-set to avoid revisits; TOPOLOGICAL SORT (DAG ordering — Kahn's BFS with in-degrees, or DFS post-order; detects cycles) — signal: dependencies/ordering/prerequisites; grid-as-graph (islands, flood fill); connected components; shortest path preview (Dijkstra weighted -> heap; pointer to advanced). Interview Problems: Number of Islands, Clone Graph, Course Schedule (I & II), Pacific Atlantic, Rotting Oranges, Word Ladder, Graph Valid Tree, Redundant Connection, Network Delay Time, etc." },
  { slug: 'union-find-dsu', name: 'Union-Find (Disjoint Set Union)', hints: "THE STRUCTURE: DSU maintains disjoint sets via a PARENT array (each element points toward its set root); FIND (follow parents to the root) + UNION (attach one root under another); the two optimizations that make it near-O(1) — PATH COMPRESSION (flatten during find) + UNION BY RANK/SIZE (attach smaller under larger) -> nearly O(α(n)) amortized (inverse Ackermann, ~constant); when to reach for it — dynamic connectivity, cycle detection in an UNDIRECTED graph, counting connected components, Kruskal's MST, grouping/equivalence; DSU vs BFS/DFS for connectivity (DSU wins for incremental union queries). Interview Problems: Number of Connected Components, Redundant Connection, Graph Valid Tree, Accounts Merge, Number of Islands II, Most Stones Removed, Satisfiability of Equality Equations, etc." },
  { slug: 'dynamic-programming', name: 'Dynamic Programming', hints: "the two properties (OPTIMAL SUBSTRUCTURE + OVERLAPPING SUBPROBLEMS) that signal DP; TOP-DOWN memoization (recursion + cache) vs BOTTOM-UP tabulation (iterative table) + space optimization (rolling array); the method — define the state, the recurrence/transition, base cases, order of evaluation, answer location; classic families: 0/1 knapsack & subset-sum, unbounded knapsack (coin change), LIS, LCS/edit distance, matrix-path/grid DP, house robber/decision DP, interval DP, DP on trees, bitmask DP, Kadane (max subarray); recognizing DP vs greedy vs backtracking; complexity = #states x transition cost. Interview Problems: Climbing Stairs, House Robber (I/II), Coin Change, Longest Increasing Subsequence, Longest Common Subsequence, Word Break, Unique Paths, Edit Distance, Maximum Subarray, Partition Equal Subset Sum, Decode Ways, Best Time to Buy/Sell Stock (with cooldown), Longest Palindromic Substring, etc." },
  { slug: 'greedy-intervals-divide-conquer', name: 'Greedy, Intervals & Divide-and-Conquer', hints: "GREEDY (make the locally optimal choice at each step; only correct when the problem has the greedy-choice property + optimal substructure — must PROVE/argue it, e.g. exchange argument; when greedy fails vs DP); interval problems (SORT by start or end, then sweep — merge intervals, insert interval, non-overlapping/erase, meeting rooms I/II with a heap) — a super common pattern; DIVIDE-AND-CONQUER (split, solve, combine — merge sort, quickselect, majority element, max subarray D&C); greedy vs DP decision. Interview Problems: Merge Intervals, Insert Interval, Non-overlapping Intervals, Meeting Rooms I & II, Jump Game (I/II), Gas Station, Task Scheduler, Partition Labels, Maximum Subarray, Candy, etc." },
  { slug: 'bit-manipulation-math', name: 'Bit Manipulation & Math', hints: "bitwise ops (AND/OR/XOR/NOT/shifts) & tricks — XOR properties (a^a=0, a^0=a -> find single number, swap without temp), check/set/clear/toggle the i-th bit (mask 1<<i), n & (n-1) clears lowest set bit (count bits, power-of-two check), lowest set bit n & -n, all subsets via bitmask; two's complement & signed shifts; MATH for interviews — GCD/Euclid, LCM, modular arithmetic & overflow (use long, mod 1e9+7), prime sieve (Eratosthenes), fast exponentiation (binary), factorials/combinatorics, integer overflow handling, Newton's method for sqrt; when bit tricks matter (constraints, sets, hashing). Interview Problems: Single Number (I/II/III), Number of 1 Bits, Counting Bits, Reverse Bits, Missing Number, Sum of Two Integers, Power of Two, Bitwise AND of Range, Pow(x,n), etc." },
  { slug: 'design-data-structures', name: 'Design Data Structures (LRU, LFU, etc.)', hints: "the 'implement/design a data structure' interview genre — COMPOSE known structures to hit required complexities; LRU CACHE (hash map + doubly linked list for O(1) get/put — the canonical one: map key->node, DLL for recency, move-to-front on access, evict tail); LFU cache (map + frequency buckets); insert/delete/getRandom O(1) (array + hashmap of index); min-stack (aux stack); implement a trie/hashmap/queue-with-stacks; median finder (two heaps); design a rate limiter / hit counter / iterator / circular buffer / snapshot array; the method (list required ops + target complexity -> pick backing structures that give each op its complexity). Interview Problems: LRU Cache, LFU Cache, Insert Delete GetRandom O(1), Min Stack, Implement Trie, Design Twitter, Time Based Key-Value Store, Design HashMap, Median Finder, Design Hit Counter, etc." },
  { slug: 'advanced-structures-string-algorithms', name: 'Advanced Structures & String Algorithms', hints: "(rarer but real, senior/hard) SEGMENT TREE (range query + point/range update in O(log n), lazy propagation) & FENWICK/BINARY INDEXED TREE (prefix sums with update, O(log n), compact) — signal: many range-sum/range-min queries with updates; balanced BSTs (red-black/AVL rotations — conceptual); STRING ALGORITHMS — KMP (failure function, O(n+m) pattern match), Rabin-Karp (rolling hash), Z-algorithm, Manacher (longest palindrome O(n)), suffix array/automaton (mention); when these come up vs when a hashmap/sort suffices; complexity wins. Interview Problems: Range Sum Query - Mutable (segment/Fenwick), Count of Smaller Numbers After Self (BIT), Implement strStr (KMP), Shortest Palindrome (KMP), Longest Palindromic Substring (Manacher), Sliding Window Maximum, etc." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior engineer, competitive-programmer, and coding-interview coach authoring study material for the DSA topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / subtopics + suggested interview problems for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . Remember: DEEP internals for data-structure topics, the recognition-signal for pattern topics, a "## Interview Problems" section with ~15 real LeetCode links, and a LIGHTER MCQ set (15-40, min 12) focused on internals/complexity/pattern-choice.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer (senior engineer + competitive programmer) verifying DSA interview content for "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `Files: ${DIR}/${t.slug}/concepts.md and questions.yaml . Read BOTH. Check and FIX IN PLACE:\n` +
    `1) COMPLEXITY & INTERNALS accuracy (the most important thing here) — every Big-O claim, every data-structure internal (hashmap chaining/open-addressing/load-factor 0.75/treeify-at-8/resize; heap array-indexing & sift O(log n) & build-heap O(n); BST O(h); trie O(L); union-find path-compression+rank ~O(alpha); binary-search off-by-one; DP state/transition; sort stability/in-place/complexity; XOR/bit tricks) MUST be correct. A wrong complexity or a wrong internal is the WORST defect — web-research anything uncertain and fix it.\n` +
    `2) INTERVIEW PROBLEMS section present with ~15 items; each is a real, well-known LeetCode problem with a plausible-correct canonical slug URL (leetcode.com/problems/<slug>/) + difficulty + technique note. If a slug looks wrong/obscure/guessed, REPLACE it with a famous problem you are confident about (never leave a fabricated-looking URL). Confirm the section exists.\n` +
    `3) PATTERNS: confirm the topic teaches the recognition signal + template for its pattern(s).\n` +
    `4) SCHEMA: valid YAML; top-level keys topic/domain(dsa-coding)/topic_slug(${t.slug})/version/questions; >=12 questions (coding domain -> lighter is OK, but must have at least a few so it renders); ids (prefix '${t.slug}-', unique, 3-digit seq); difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based 'answer' in range; explanation; correct-option VARIED (rebalance if any index >40% OR a guessable cycle). Quote any YAML option with a colon+space or leading brace.\n` +
    `5) Every 'ref' resolves to a real '## ' heading; Mermaid valid (no semicolons in sequenceDiagram messages).\n` +
    `6) COVERAGE: every subtopic represented; MCQs focus on internals/complexity/pattern-choice.\n\n` +
    `After fixing, return: "<slug>: <questionCount> questions, <k> LC problems, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
