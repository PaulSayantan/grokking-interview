# system-design — Content Audit

**Executive summary.** This audit covers **86 subtopics** of the `system-design` domain (one planned file, `aws-security-iam-deep-dive`, was not present in the audit cache and is excluded — see the final note). The domain is in **strong overall health**: average **clarity 4.81/5** and **depth 4.72/5** are near-ceiling, and no subtopic was flagged as broken. Against the repo's three-part refinement bar the standings are lopsided — intuition/clarity and interview depth are already excellent, but **worked examples are the systemic weak link (average example 3.28/5)**. By priority the audit assigned **0 high, 61 medium, 25 low** — there is no "on fire" content, but a long tail of otherwise-excellent notes lose a point (or two) purely because their hardest, most quantitative concepts are *asserted in prose rather than traced with numbers-in/numbers-out*. The single highest-leverage takeaway: **`example-gap` is the dominant issue type (212 of 358 issues, touching 85 of 86 subtopics)** — a domain-wide worked-example pass would move the needle more than any other single effort. Secondary themes are a thin-but-recurring layer of **stale/hedged AWS numbers (57 correctness issues; 57 subtopics carry `needs_web_verification`)** and a cluster of **abstract architecture/pattern-catalog files (the `arch-*` and `ccp-*` groups) that scored example=2** and should be worked first.

A note on priority interpretation: because the audit tagged **no subtopic `high`**, this report treats the **14 example-starved subtopics (example_score = 2)** as the *de-facto* top tier for refinement, since the refinement bar weights worked examples second and these are the files where that dimension has collapsed. They are detailed in the "High-priority subtopics" section below.

## Scorecard

Sorted high priority first, then by lowest total (clarity + example + depth) first. A `*` after the slug marks `needs_web_verification = true`.

| Subtopic | Clarity (/5) | Examples (/5) | Depth (/5) | Priority | Verdict |
|---|---|---|---|---|---|
| arch-code-organization | 4 | 2 | 4 | medium | Intuition-first survey with strong trade-off/altitude framing, but teaches dependency inversion — the hardest idea — in prose with zero code. |
| arch-fundamentals-and-styles* | 4 | 2 | 4 | medium | Clean, well-framed style catalog with interview-gold scaffolding, but almost no numbers-in/numbers-out worked examples. |
| arch-specialized | 4 | 2 | 4 | medium | Clear taxonomy with strong problem-first framing and trade-offs, but 100% abstract prose — no worked examples anywhere. |
| arch-ui-presentation* | 4 | 2 | 4 | medium | Senior-depth comparison of UI presentation architectures; one real weakness is total absence of code / traced-scenario examples. |
| aws-fundamentals-well-architected* | 4 | 2 | 4 | medium | Dense AWS mental map with excellent trade-off reasoning, but tells rather than shows — availability/capacity/IAM math never worked. |
| ccp-architecture-components-coupling | 4 | 2 | 4 | medium | Well-organized pattern reference with strong follow-ups, but near-total absence of numeric/traced worked examples. |
| ccp-composite-hybrid | 4 | 2 | 4 | medium | Clean "name-the-force" catalogue with a good follow-ups layer, but zero concrete numbers-in/numbers-out examples. |
| ccp-composite-tiers-cdn | 4 | 2 | 4 | medium | Intent-first tiers/CDN treatment with strong trade-offs, but no capacity or CDN math anywhere. |
| ccp-management-elasticity-resiliency* | 4 | 2 | 4 | medium | Trade-off-aware pattern catalogue with strong follow-ups, but zero worked examples and one outdated billing premise. |
| arch-dataflow-event | 5 | 2 | 4 | medium | Exceptionally clear map of data-flow/event styles, but teaches via prose/analogy — event replay, Lambda/Kappa merge, CQRS timing untraced. |
| arch-distributed-infrastructure* | 5 | 2 | 4 | medium | Exceptionally clear survey of distributed styles whose one real weakness is near-total absence of worked examples. |
| aws-api-layer-apigateway-appsync* | 4 | 2 | 5 | medium | Deep and interview-savvy on trade-offs/gotchas, but almost devoid of worked examples (cost crossover, token-bucket trace, tiers). |
| ccp-architecture-state-tenancy-integration | 5 | 2 | 4 | medium | Crisp pattern catalog with strong intuition, held back by zero worked examples for its most counterintuitive patterns. |
| ccp-fundamentals-workloads-models | 5 | 2 | 4 | medium | Clear pattern-language teaching with strong intuition, but almost entirely qualitative — never shows a single number. |
| ccp-offerings-compute-elasticity* | 5 | 2 | 4 | medium | Clear pattern-vocabulary file with sibling-pair framing, but never shows a number — even the availability math it tells you to compute. |
| aws-analytics-datalake-redshift-emr* | 4 | 4 | 4 | medium | Strong survey with excellent cost math, but Redshift dist/sort-key tuning argued in prose; a couple of node-family claims need verifying. |
| aws-containers-ecs-eks* | 5 | 2 | 5 | medium | Excellent 2x2 mental model and follow-ups, but worked examples are almost entirely qualitative prose. |
| aws-cost-optimization-scaling* | 5 | 3 | 4 | medium | Clear, intuition-first coverage of cost levers; signature serverless/provisioned crossover reasoned but never computed. |
| aws-databases-rds-aurora* | 5 | 3 | 4 | medium | Excellent structure and trade-offs, but quorum math, connection exhaustion, and ACU cost asserted rather than worked. |
| aws-load-balancing-elb-autoscaling* | 4 | 3 | 5 | medium | Excellent trade-off depth, but LCU billing, target-tracking, flow hashing lack numeric walkthroughs; two internal inconsistencies. |
| aws-microservices-patterns* | 5 | 2 | 5 | medium | Exceptionally clear, senior-grade coverage whose one real weakness is near-total absence of worked examples in the body. |
| aws-saas-isolation-patterns* | 4 | 3 | 5 | medium | Senior-grade depth, but teaches via number-dense bullet dumps not step-by-step examples; drops undefined acronyms/tool lists. |
| aws-storage-s3-deep-dive* | 5 | 3 | 4 | medium | Excellent trade-off-first S3 note, but leans on prose over numeric walkthroughs; omits S3 Express One Zone. |
| ccp-offerings-storage-data-communication* | 5 | 3 | 4 | medium | Consistently-templated catalogue with reasoned trade-offs, but the two consistency patterns state quorum symbolically, never with numbers. |
| consensus-clocks-and-time* | 4 | 3 | 5 | medium | Exceptionally deep senior/staff content, but Lamport/vector/Raft/HLC/Paxos mechanics described algorithmically, rarely with concrete numbers. |
| ddd-strategic-context-mapping | 5 | 3 | 4 | medium | Exceptionally clear, intuition-first DDD strategy; gaps are missing Conway's-Law/team-topology framing and no traced end-to-end context map. |
| aws-caching-elasticache-dax* | 5 | 3 | 5 | medium | Exceptionally clear and interview-deep; capacity sizing, hash-slot mapping, DAX-vs-RCU cost described abstractly not walked through. |
| aws-dns-cdn-route53-cloudfront* | 5 | 3 | 5 | medium | Interview-grade coverage of the edge trio, but "examples" are tables/prose not step-by-step numeric walkthroughs. |
| aws-dynamodb-deep-dive* | 5 | 4 | 4 | medium | Strong DynamoDB deep dive with solid capacity math; gaps are sparse-index/filter-RCU gotchas and no single-table/write-shard worked example. |
| aws-messaging-sqs-sns-eventbridge* | 5 | 3 | 5 | medium | Clear, trade-off-rich comparison; gap is worked examples for FIFO throughput, visibility-timeout/DLQ traces, dedup window. |
| aws-ml-genai-sagemaker-bedrock* | 5 | 3 | 5 | medium | Well-organized senior-depth ML/GenAI coverage; worked examples stop at setup and never carry numbers to a concrete output. |
| aws-networking-vpc-privatelink* | 5 | 3 | 5 | medium | Excellent trade-off coverage; cost/capacity claims rarely carried through a walkthrough; one TGW per-flow-cap inconsistency. |
| aws-observability-cloudwatch-xray* | 5 | 3 | 5 | medium | Crisp mental models but thin on worked examples for sampling, burn-rate, error budget, EMF. |
| aws-reference-architectures* | 5 | 3 | 5 | medium | Trade-off-rich capstone whose quantitative claims (write amp, egress, serverless crossover) are asserted not worked. |
| aws-resilience-multiregion-dr* | 5 | 3 | 5 | medium | Interview-deep on trade-offs/gotchas, but almost no worked examples for availability math, quorum, failover timelines. |
| aws-saas-metering-tiering-throttling* | 5 | 3 | 5 | medium | Limits-heavy senior treatment; many numbers stated as facts but rarely worked (apportionment, token-bucket, write-sharding). |
| aws-saas-multitenancy-foundations* | 5 | 3 | 5 | medium | Clear and interview-deep on quotas, but isolation-enforcement described in prose with no policy snippet or numeric walkthrough. |
| aws-saas-tenant-identity-and-routing* | 5 | 3 | 5 | medium | Excellent intuition and depth; hardest concepts (scoped IAM creds, JWT claims, STS caching) lack concrete numbers/JSON examples. |
| aws-security-kms-secrets-cognito-waf* | 5 | 3 | 5 | medium | Interview-deep on trade-offs, but a few worked examples (KMS cost math, rotation timeline) would remove all doubt. |
| aws-serverless-lambda-stepfunctions* | 5 | 3 | 5 | medium | Well-structured senior treatment; worked examples stop short of finished numbers (cost never reaches a dollar; SFN per-transition no math). |
| ddd-tactical-patterns | 5 | 4 | 4 | medium | Exceptionally clear tour of tactical DDD; gaps are the missing optimistic-concurrency mechanism and no traced numeric scenario. |
| design-location-and-payment-systems* | 5 | 4 | 4 | medium | Well-structured synthesis, but headline examples (kNN query, idempotency race, saga compensation) described not traced; one geohash error. |
| design-search-autocomplete-typeahead | 5 | 3 | 5 | medium | Well-structured and trade-off-rich, but BM25, RRF, edit-distance/SymSpell, trie top-k explained in prose with no worked example. |
| design-video-platform-distributed-cache* | 5 | 3 | 5 | medium | Excellent coverage of both halves, but cache math (consistent hashing K/N, quorum, LRU-vs-LFU) never walked through. |
| design-web-crawler-data-processing* | 4 | 4 | 5 | medium | Trade-off-rich, but load-bearing mechanisms (Bloom, SimHash, consistent hashing, LSH, watermarks) named/used but never explained. |
| dp-concurrency | 5 | 4 | 4 | medium | Strong concurrency-pattern catalog with problem-first intuition; gaps are near-absence of numeric examples and missing virtual-threads/Loom. |
| event-driven-cqrs-saga-cdc | 5 | 3 | 5 | medium | Strong on intuition/trade-offs/gotchas; one gap is concrete traces for saga, idempotency, outbox (explained only in prose). |
| microservices-ddd-and-boundaries* | 5 | 3 | 5 | medium | Intuition-first and gotcha-rich; flagship saga/idempotency/outbox taught in prose with no step-by-step traced walkthrough with state shown. |
| microservices-monolith-api-design* | 5 | 3 | 5 | medium | Trade-off-rich survey; most hard concepts lack numeric walkthroughs and heavily-referenced saga/2PC are never actually explained. |
| multi-tenancy-and-saas-isolation* | 5 | 3 | 5 | medium | Senior-grade tenancy coverage; near-total absence of numeric examples for the cost/density, pool-pressure, rate-limit trade-offs it's built on. |
| probabilistic-data-structures* | 5 | 3 | 5 | medium | Clear senior-grade coverage; hardest structures (HLL, Count-Min, LSH, DDSketch) give formulas but no numbers-in/numbers-out examples. |
| security-authentication-data-protection* | 5 | 3 | 5 | medium | Interview-deep on trade-offs/gotchas, but almost every "example" is a diagram or prose, with very few traceable numeric walkthroughs. |
| strangler-fig-and-monolith-migration | 5 | 3 | 5 | medium | Excellent intuition-first coverage; hard sections (parallel run, backfill/CDC) teach with code/prose but never a concrete trace. |
| aws-migration-modernization* | 5 | 4 | 5 | medium | Strong migration guide with network-math examples; gaps are a missing TCO number-walkthrough and a few possibly-stale service limits. |
| aws-streaming-kinesis-msk* | 5 | 4 | 5 | medium | Superb log-vs-queue model and KDS worked example; asymmetric depth on Kafka/MSK internals and no MSK sizing example. |
| caching-and-cdn | 5 | 4 | 5 | medium | Trade-off-first caching doc reading like senior prep; capacity sizing, consistent hashing, XFetch asserted without a walkthrough. |
| design-feed-chat-notification* | 5 | 4 | 5 | medium | Strong treatment of three fan-out systems; celebrity threshold, Snowflake bit layout, hybrid read merge explained but not walked with numbers. |
| distributed-transactions-advanced* | 5 | 4 | 5 | medium | Exceptionally deep; only gap is Percolator and TrueTime commit-wait explained in prose without a traced numeric example. |
| failure-theory-advanced | 5 | 4 | 5 | medium | Excellent on metastable failure/overload; a few hard concepts left abstract (Little's Law, trigger-vs-sustaining load) plus missing hedged requests. |
| message-queues-and-async* | 5 | 4 | 5 | medium | Strong treatment; main gap is missing Kafka durability internals (ISR/min.insync.replicas) and a couple of undemonstrated concepts. |
| rate-limiting-and-consistent-hashing* | 5 | 4 | 5 | medium | Excellent trade-off reasoning; distributed/CHWBL/rendezvous sections argue in prose without the worked examples earlier algorithms enjoy. |
| dp-behavioral | 5 | 3 | 5 | low | Near-exemplary GoF behavioral reference; one gap is code samples are structural sketches not traced numbers-in/numbers-out walkthroughs. |
| scalability-and-load-balancing* | 4 | 4 | 5 | low | Excellent teaching file; gaps are a few undefined acronyms in a load-bearing table and consistent-hashing/P2C without a numeric trace. |
| aws-compute-ec2-fargate-lambda* | 5 | 4 | 5 | low | Excellent compute-spectrum note; cost-crossover claim sketched not worked, and one estimation figure understates Lambda compute cost. |
| aws-iot-edge-computing* | 5 | 4 | 5 | low | Excellent IoT/edge overview; gap is device-shadow delta and an end-to-end pipeline explained in prose without a JSON/numeric walkthrough. |
| aws-saas-data-partitioning* | 5 | 4 | 5 | low | Standout data-tier isolation deep-dive; only gap is a few numeric walkthroughs (break-even, fan-out) and one IAM quantifier caveat. |
| aws-storage-ebs-efs-fsx* | 5 | 4 | 5 | low | Excellent storage-selection reference; main gap is its single "worked example" is qualitative not a numbers-in/numbers-out calculation. |
| cap-theorem-and-consistency* | 5 | 4 | 5 | low | Near-exemplary; only gap is vector-clock compare, CRDT counter merge, sloppy-quorum stale read explained but not traced with numbers. |
| data-internals-storage-engines | 5 | 4 | 5 | low | Exceptionally strong storage-internals doc; only gap is LSM amplification, B+tree fanout, MVCC visibility explained in prose without traces. |
| databases-sql-nosql-sharding-replication | 5 | 4 | 5 | low | Near-exemplary survey; only gap is quorum arithmetic and composite-index leftmost-prefix stated as rules rather than traced with numbers. |
| design-coordination-locking-collaboration | 5 | 4 | 5 | low | Standout worked examples (GC-pause race, fencing trace, presence capacity); only gap is OT/CRDT lack a concrete numeric merge/transform trace. |
| design-job-scheduler-task-queue* | 5 | 4 | 5 | low | Trade-off-saturated and interview-ready; only a couple of mechanisms (timing wheel, outbox) named without a concrete walkthrough. |
| design-url-shortener | 5 | 4 | 5 | low | Exceptionally well-structured teaching doc; only a couple of small worked-example inaccuracies (base62 micro-example, collision bound). |
| dp-creational | 5 | 4 | 5 | low | Exceptionally well-structured creational tour; only gaps are a couple of missing traced/numeric examples (shallow-copy bug, pool sizing). |
| dp-distributed-cloud | 5 | 4 | 5 | low | Consistently-structured pattern catalog; only weighted gap is quantitative patterns give scenarios but stop short of true math. |
| dp-enterprise-application | 5 | 4 | 5 | low | Rigorous ~50-pattern catalog; only weakness is a handful of hard concepts (inheritance mapping, N+1) teach by prose not a walkthrough. |
| dp-structural | 5 | 4 | 5 | low | Intent-first GoF structural tour; a couple of gaps (Flyweight memory math, analogies, Spring proxy self-invocation gotcha). |
| genai-llm-system-design* | 5 | 4 | 5 | low | Excellent GenAI/RAG design file; only a few hard concepts (KV cache math, RRF, speculative decoding) lack a plug-in worked example. |
| interview-method-scenario-playbooks | 5 | 4 | 5 | low | Exceptionally well-taught playbook; minor gaps (promised-but-unshown quorum example, no USL formula, one redundant section). |
| networking-and-protocols* | 5 | 4 | 5 | low | Near-exemplary survey; only a few undefined jargon terms and one thin worked example keep it from perfect. |
| observability-monitoring-reliability | 5 | 4 | 5 | low | Near-exemplary observability/SRE reference; only a couple of small worked-example and coverage gaps. |
| realtime-streaming-systems* | 5 | 4 | 5 | low | Exemplary streaming primer; only a few hard concepts (barrier alignment, backpressure) lack a fully traced numeric walkthrough. |
| resilience-tradeoffs-deep-dive* | 5 | 4 | 5 | low | Near-exemplary resilience deep-dive; only a few hard concepts lack a traced numeric example and request hedging is missing. |
| capacity-modeling-and-tail-latency* | 5 | 5 | 5 | low | Near-exemplary: intuition-first, dense with worked math (Little's Law, M/M/1 knee, USL, fan-out); only minor depth gaps. |
| dp-fundamentals-and-principles | 5 | 5 | 5 | low | Exemplary problem-first fundamentals: every section leads with the pain, before/after code, trade-offs, disambiguation. |
| fundamentals-and-framework | 5 | 5 | 5 | low | Near-exemplary fundamentals doc: mental model + worked example + trade-offs + gotchas throughout; only minor polish warranted. |

## Systemic issues

Clustered across all 86 subtopics (358 issues total). Sorted by leverage.

### 1. Worked-example gap — the dominant, domain-wide theme (212 issues, 85 of 86 subtopics)
Nearly every file — including the top scorers — was flagged for at least one `example-gap`. The recurring failure mode is identical everywhere: **a hard, quantitative concept is explained correctly in prose or with a topology diagram, but never traced numbers-in → numbers-out.** This is exactly the repo's #2-weighted dimension, so it is the highest-leverage fix. Sub-patterns:
- **AWS cost/capacity crossovers asserted, never computed.** The "serverless vs provisioned/container" break-even appears verbally in at least five files without arithmetic: `aws-api-layer-apigateway-appsync`, `aws-cost-optimization-scaling`, `aws-compute-ec2-fargate-lambda`, `aws-serverless-lambda-stepfunctions`, `aws-reference-architectures`.
- **Quorum / replication math stated symbolically (W+R>N) but never plugged in:** `ccp-offerings-storage-data-communication`, `databases-sql-nosql-sharding-replication`, `aws-databases-rds-aurora`, `aws-resilience-multiregion-dr`, `design-video-platform-distributed-cache`, `cap-theorem-and-consistency`.
- **Availability composition ("compose 99.99% ALB + 3×99.9% EC2") never worked:** `aws-fundamentals-well-architected`, `ccp-offerings-compute-elasticity`, `aws-resilience-multiregion-dr`.
- **Token-bucket / rate-limit behavior described as a definition, not traced with burst+refill numbers:** `aws-api-layer-apigateway-appsync`, `aws-saas-metering-tiering-throttling`, `rate-limiting-and-consistent-hashing`.
- **Distributed-consistency traces (saga compensation, idempotency race, transactional outbox, event replay) told in prose with no state shown:** `event-driven-cqrs-saga-cdc`, `microservices-ddd-and-boundaries`, `microservices-monolith-api-design`, `arch-dataflow-event`, `design-location-and-payment-systems`.
- **Probabilistic/algorithmic structures give the formula but no numeric instance:** `probabilistic-data-structures` (HLL, Count-Min, LSH, DDSketch), `design-search-autocomplete-typeahead` (BM25, RRF, SymSpell), `consensus-clocks-and-time` (Lamport/vector/Raft).

### 2. The `arch-*` and `ccp-*` pattern-catalog groups are the biggest concentration of the problem (14 subtopics at example = 2)
Every subtopic scoring example = 2 belongs to one of two families: the architecture-style survey group (`arch-code-organization`, `arch-fundamentals-and-styles`, `arch-specialized`, `arch-ui-presentation`, `arch-dataflow-event`, `arch-distributed-infrastructure`) and the cloud-design-pattern catalog group (`ccp-architecture-components-coupling`, `ccp-composite-hybrid`, `ccp-composite-tiers-cdn`, `ccp-management-elasticity-resiliency`, `ccp-architecture-state-tenancy-integration`, `ccp-fundamentals-workloads-models`, `ccp-offerings-compute-elasticity`), plus `aws-fundamentals-well-architected` and `aws-api-layer-apigateway-appsync`. These are strong on clarity (mostly 4–5) and depth (4) but are **100% conceptual prose** — they teach the vocabulary and the trade-off but never once let the student watch a mechanism operate on concrete data. This is where a worked-example pass has the highest marginal payoff.

### 3. Stale / hedged / drifting AWS numbers (57 correctness issues; 57 subtopics carry `needs_web_verification`)
The AWS-heavy subtopics lean on specific service limits, prices, and defaults that date quickly, and several are stated as hard facts. Confirmed factual problems (not just "verify"):
- **`aws-compute-ec2-fargate-lambda`** — a cost example understates Lambda compute (625k GB-s ≈ $10.4, not "a few dollars").
- **`aws-networking-vpc-privatelink`** — internal contradiction: TGW per-flow cap given as "~5 Gbps" in the body and "~50 Gbps" in references.
- **`aws-load-balancing-elb-autoscaling`** — fail-open/fail-closed stated inconsistently; predictive-scaling history requirement given as both ">=24 h" and "weeks."
- **`aws-resilience-multiregion-dr`** — "up to 10 secondary Regions" for Aurora Global DB (historically 5).
- **`ccp-management-elasticity-resiliency`** — core motivation rests on outdated hourly/fixed-slot billing.
- **`design-url-shortener`** — `base62(125)="cb"` contradicts the stated `[0-9a-zA-Z]` alphabet.
- **`design-location-and-payment-systems`** — misleading geohash claim that points 1 m apart "share no common prefix."
- **`probabilistic-data-structures`** — HLL "~1.5 KB" / error-attribution math is muddled.
Plus lower-severity "verify these figures before parroting" flags across nearly every `aws-*` file (S3 prices, DynamoDB partition limits, Kinesis ceilings, Cognito RPS, EKS support windows, KMS/CloudHSM FIPS level, SQS FIFO throughput, etc.). Treat every `*`-marked slug in the scorecard as needing a numbers-verification pass.

### 4. Named-but-unexplained mechanisms & undefined jargon (24 missing-intuition + 17 jargon issues)
Load-bearing mechanisms are frequently *used* before being *explained*, which silently blocks any reader who doesn't already know them:
- **Mechanisms referenced but never actually taught:** `design-web-crawler-data-processing` (Bloom filter, SimHash, LSH, watermarks), `microservices-monolith-api-design` (saga, 2PC), `arch-specialized` (DHT lookup, split-brain/fencing), `ccp-composite-tiers-cdn` ("Elasticity Manager control loop", push vs pull CDN).
- **Undefined acronyms/terms on first use:** `2PC` (`arch-fundamentals-and-styles`), `-ilities`/`altitude` (`arch-ui-presentation`), `brownout` (`ccp-management-elasticity-resiliency`), plus acronym gaps in `scalability-and-load-balancing`, `networking-and-protocols`, `aws-saas-isolation-patterns`, `caching-and-cdn`.

### 5. Missing senior-interview gotchas (70 gotchas-followups issues, 67 subtopics)
Even excellent files repeatedly omit one or two of the exact follow-ups a senior interviewer reliably probes. Recurring examples: the **dual-write / transactional-outbox problem** (`arch-dataflow-event`, `event-driven-cqrs-saga-cdc`); **poison-message/DLQ + max-receive-count loops** (`ccp-architecture-components-coupling`); **anemic-domain-model trap** (`arch-code-organization`); **sidecar-less / ambient service mesh** (`arch-distributed-infrastructure`); **sticky-session anti-pattern** (`ccp-composite-tiers-cdn`); **request hedging / tied requests** (`failure-theory-advanced`, `resilience-tradeoffs-deep-dive`); **shared-responsibility model naming** (`ccp-fundamentals-workloads-models`). Also: `aws-fundamentals-well-architected` poses 10 great follow-up questions but provides no model answers.

### 6. Comparison-as-prose and thin visuals (42 depth + 26 visual issues)
Two smaller recurring polish items: (a) trade-offs delivered as bare "Pros:/Cons:" bullet lists rather than reasoned "gain X, give up Y, choose when Z" arguments (`arch-fundamentals-and-styles` and most `arch-*`/`ccp-*` files); and (b) inherently sequential/state mechanics (visibility-timeout redelivery, async 202+poll, OT/CRDT merges) shown as numbered prose lists where a sequence/state diagram would teach far better (`ccp-architecture-components-coupling`, `aws-api-layer-apigateway-appsync`, `ddd-*`).

## High-priority subtopics

The audit assigned no `high` tag; the following are the **example = 2 subtopics** — the de-facto top tier under the worked-examples bar. Each is otherwise clarity/depth-strong, so the fix is almost purely "add a traced worked example."

### arch-code-organization (4/2/4)
1. **[high · example-gap]** Dependency inversion (Clean/Hexagonal/Onion, the KEY-TAKEAWAY) — the file's whole thesis ("source deps point inward while control flows outward") is taught in prose with zero code. *Fix:* add a minimal code pair showing an inner use-case depending on an interface the outer DB adapter implements.
2. **[medium · example-gap]** Layered "architecture sinkhole" anti-pattern is abstract. *Fix:* show a concrete request falling through layers doing no work, and state the 20% rule threshold.
3. **[medium · gotchas]** Missing the anemic-domain-model trap and the "which of Onion/Clean/Hexagonal to actually prefer" senior decision guidance.
4. **[low · visual]** The Clean Architecture mermaid self-loop for the Dependency Rule is confusing; redraw to show inward direction.

### arch-fundamentals-and-styles (4/2/4) — `needs_web_verification`
1. **[high · example-gap]** 20+ diagrams but no numbers-in/numbers-out example; Space-/Cell-Based, Serverless, CQRS/ES/Saga trade-offs asserted ("DB becomes the bottleneck"). *Fix:* one quantified example per hardest style.
2. **[medium · example-gap]** ADR section describes the shape but shows no filled-in ADR. *Fix:* include one complete worked ADR.
3. **[medium · missing-intuition]** "Architecture quantum" defined abstractly, never counted on a concrete system.
4. **[low · correctness]** Inverse Conway Maneuver misattributed to Fowler (it's LeRoy & Simons / Skelton & Pais). **[low · jargon]** `2PC` used unexpanded.

### arch-specialized (4/2/4)
1. **[high · example-gap]** Entirely conceptual — Primary-Replica, Master-Worker, Blackboard have no traced walkthrough anywhere. *Fix:* trace one request through Primary-Replica including a failover.
2. **[medium · missing-intuition]** Broker/Blackboard/Interpreter jump into components (proxy/stub/skeleton, IDL) with no everyday analogy first.
3. **[medium · gotchas]** Split-brain, fencing, read-your-writes named but not explained at senior depth.
4. **[low · depth]** P2P names DHT/gossip/consensus but never gives the 2-line intuition of a DHT lookup (ring, O(log N) hops).

### arch-ui-presentation (4/2/4) — `needs_web_verification`
1. **[high · example-gap]** No code or traced scenario for patterns *defined by* their code shape (MVP/MVVM/MVU/Redux/MVI). *Fix:* trace one scenario ("click Save on a form with an empty required field") through each.
2. **[high · example-gap]** Comparison matrix compares axis-by-axis but never runs one concrete scenario through the styles.
3. **[medium · gotchas]** "Massive View Controller" and MVVM two-way-binding cons named but the *why* is never explained.
4. **[low · correctness]** MVVM two-way-binding memory-leak/perf claim is framework-specific (WPF/old-Angular) but stated as a blanket property.

### aws-fundamentals-well-architected (4/2/4) — `needs_web_verification`
1. **[high · example-gap]** Nines/RTO/RPO stated but availability composition never worked. *Fix:* compose ALB + 3 EC2 + AZ redundancy to a number.
2. **[high · example-gap]** DynamoDB capacity/partitions and Lambda concurrency given as bare limits, never translated from a workload.
3. **[medium · example-gap]** Envelope encryption called "the pattern that makes KMS scale" but never walked (data-key/plaintext-key flow).
4. **[medium · example-gap]** IAM "explicit deny > allow > implicit deny" and the SCP-vs-role-policy scenario posed but not answered. **[low · correctness]** SQS FIFO "capped at 3,000 msg/s" ignores high-throughput mode.

### ccp-architecture-components-coupling (4/2/4)
1. **[high · example-gap]** Visibility-timeout redelivery → duplicate processing (the file's key concept) explained only in prose. *Fix:* a clock-timeline trace showing the redelivery branch.
2. **[high · example-gap]** Dedup vs idempotent-semantics abstract. *Fix:* trace "set status=SHIPPED vs increment count" on concrete data.
3. **[medium · depth]** Transaction-based Processor says distributed txns are "impractical" and names outbox but never says *why* (2PC coordinator blocking, no XA on SQS).
4. **[low · gotchas]** Missing poison-message/DLQ loop and dedup-retention-window gotchas. **[low · visual]** redelivery lifecycle wants a state/sequence diagram.

### ccp-composite-hybrid (4/2/4)
1. **[high · example-gap]** Entirely abstract; Hybrid Processing/Backend have no numbers. *Fix:* a cloud-bursting example with concrete on-prem baseline + burst capacity.
2. **[medium · gotchas]** Cloud bursting presented uncritically; missing the standard senior pushback (data-sync latency, licensing, cold pools).
3. **[medium · depth]** The driving concept "data gravity" is never named.
4. **[low · visual/missing-intuition]** Wants a force→pattern decision tree; "static vs elastic environment" defined only parenthetically.

### ccp-composite-tiers-cdn (4/2/4)
1. **[high · example-gap]** Independent scaling "10 UI instances vs 3 logic" just restates the abstraction. *Fix:* a real per-tier scaling calc.
2. **[high · example-gap]** CDN section claims "slashes latency/origin load" with zero numbers. *Fix:* cache-hit-ratio → origin-offload and before/after latency math.
3. **[medium · jargon]** "Elasticity Manager control loop" used as if defined.
4. **[medium · gotchas]** Missing push-vs-pull CDN as a design choice, cache stampede, and the sticky-session anti-pattern.

### ccp-management-elasticity-resiliency (4/2/4) — `needs_web_verification`
1. **[high · example-gap]** Standby Pooling / Elastic Queue / Elasticity Management have no numeric walkthrough. *Fix:* size a standby pool to a stated spike magnitude.
2. **[medium · correctness]** Core motivation rests on outdated fixed-time-slot billing (pre per-second EC2 billing).
3. **[medium · missing-intuition]** Most sections open on the formal "Intent" quote with no plain-language model.
4. **[low · gotchas/jargon]** Missing expand/contract schema migration nuance; "brownout" undefined.

### arch-dataflow-event (5/2/4)
1. **[high · example-gap]** Event Sourcing describes state as a "left fold" over events but never traces one. *Fix:* trace a balance from an event stream.
2. **[medium · example-gap]** CQRS eventual-consistency (the #1 gotcha) stays abstract. *Fix:* show the exact stale-read a user sees.
3. **[medium · gotchas]** Dual-write / transactional-outbox problem missing across EDA/Pub-Sub/CQRS/ES.
4. **[low · depth/structure]** Backpressure abstract; Batch/Stream/Lambda/Kappa need a consolidated comparison.

### arch-distributed-infrastructure (5/2/4) — `needs_web_verification`
1. **[high · example-gap]** "1 of N cells = 1/N blast radius" and other quantitative claims never worked. *Fix:* one worked blast-radius/capacity example.
2. **[medium · example-gap]** Diagrams are topology-only; no request traced end-to-end with a failure branch.
3. **[medium · gotchas]** Service Mesh presented as sidecar-only; missing the ambient/sidecar-less (Istio ambient, Cilium/eBPF) shift; Serverless missing concurrency-limit/thundering-herd gotchas.
4. **[low · missing-intuition/structure]** Space-Based grids lack an anchoring analogy; comparison-matrix N/A cells misalign axes.

### aws-api-layer-apigateway-appsync (4/2/5) — `needs_web_verification`
1. **[high · example-gap]** Serverless-vs-container cost crossover (the most-probed question) asserted verbally. *Fix:* work it to a break-even RPS.
2. **[high · example-gap]** Token-bucket throttling and SaaS tiering never traced with numbers.
3. **[medium · example-gap]** Caching "is it worth it" never calculated. **[medium · correctness]** WAF status, "~70% cheaper" HTTP API, and June-2024 timeout mechanics are hedged rather than resolved.
4. **[low · visual]** Async "202 + poll/push" redesign (top follow-up) wants a sequence diagram.

### ccp-architecture-state-tenancy-integration (5/2/4)
1. **[high · example-gap]** The tenancy dial (cheapest→priciest) never shows *why* the cost curve bends. *Fix:* a concrete per-tenant cost comparison across shared/pool/silo.
2. **[medium · example-gap]** Application Component Proxy's counterintuitive outbound-initiated connection needs a traced example.
3. **[medium · example-gap]** Restricted Data Access vs Compliant Data Replication distinguished only by "request-time vs replication-time"; the filter+enricher reconciliation is subtle and untraced.
4. **[low · gotchas/structure]** Message Mover names duplicates/ordering but doesn't reason about handling; Multi-Component Image sits off the doc's through-line.

### ccp-fundamentals-workloads-models (5/2/4)
1. **[high · example-gap]** All five workload patterns are qualitative; "bigger peak-to-average gap → elasticity pays off more" never shown with a number. *Fix:* one peak/average cost comparison.
2. **[medium · gotchas]** IaaS/PaaS/SaaS split never named as the "shared responsibility model."
3. **[medium · depth]** PaaS/SaaS lock-in asserted without the concrete migration-cost mechanism.
4. **[low · visual/depth]** Service/deployment models want comparison tables; the five NIST essential characteristics are name-dropped, not defined.

### ccp-offerings-compute-elasticity (5/2/4) — `needs_web_verification`
1. **[high · example-gap]** Never shows a number — most glaringly the availability redundancy math it explicitly tells the student to compute. *Fix:* work the N-redundancy availability calc it references.
2. **[medium · example-gap]** Sibling-pair patterns (elasticity flavors) argued in prose without a scaling walkthrough.
3. **[low · correctness]** Single-instance EC2/Azure-VM SLA and 99.95% figures (and their disk/AZ prerequisites) should be verified.

### aws-microservices-patterns (5/2/5) — `needs_web_verification`
1. **[high · example-gap]** Near-total absence of worked examples in the body despite senior-grade trade-off coverage. *Fix:* trace one pattern (e.g., saga or CQRS) end-to-end with concrete state.
2. **[high · example-gap]** Second worked-example gap flagged alongside the first — the pattern trade-offs are asserted, not demonstrated.
3. **[low · correctness]** API Gateway REST 29 s integration-timeout "raisable via quota" and similar limits need re-verification.

### aws-containers-ecs-eks (5/2/5) — `needs_web_verification`
1. **[high · example-gap]** Great 2x2 mental model, but the file "never once puts real numbers in and gets real numbers out." *Fix:* a task-sizing or Fargate-vs-EC2 cost walkthrough.
2. **[high · example-gap]** Second worked-example gap — capacity/cost claims stay qualitative.
3. **[low · correctness]** EKS support windows (~14 mo standard, +$0.50/cluster/hr extended), Fargate max 16 vCPU, and pricing need verification.

## Refinement plan

**Order of attack (highest leverage first):**

1. **Worked-example pass on the 14 example=2 subtopics** (the `arch-*` + `ccp-*` groups plus `aws-fundamentals-well-architected`, `aws-api-layer-apigateway-appsync`, `aws-microservices-patterns`, `aws-containers-ecs-eks`). These are clarity/depth-strong and lose the most against the weighted bar; a single traced example per file is the biggest bang-for-buck. Start with `arch-code-organization`, `arch-ui-presentation`, and `ccp-architecture-components-coupling` (their missing example *is* the hardest concept in the topic).
2. **Confirmed-correctness fixes (fast, do alongside pass 1)** — these are outright errors, not just drift: `aws-compute-ec2-fargate-lambda` (Lambda cost), `aws-networking-vpc-privatelink` (TGW 5 vs 50 Gbps), `aws-load-balancing-elb-autoscaling` (fail-open + predictive-history contradictions), `aws-resilience-multiregion-dr` (Aurora secondary-Region count), `design-url-shortener` (base62 example), `design-location-and-payment-systems` (geohash prefix claim), `probabilistic-data-structures` (HLL math), `arch-fundamentals-and-styles` (Inverse Conway attribution), `ccp-management-elasticity-resiliency` (billing premise).
3. **Worked-example top-ups on the medium tier at example=3** — the large band of otherwise-excellent `aws-*`, `design-*`, `microservices-*`, and SaaS files that need one or two numeric traces (quorum math, cost crossover, token-bucket, saga/idempotency/outbox with state shown, Kafka ISR internals).
4. **Web-verification sweep of all 57 `needs_web_verification` slugs** — a dedicated pass to re-check AWS limits/prices/defaults against current docs before students memorize them. Every `*`-marked slug in the scorecard is in scope; the AWS-service files are highest risk. **Do this pass with live doc access**, since the audit could only flag "verify," not resolve. Full list: `arch-distributed-infrastructure`, `arch-fundamentals-and-styles`, `arch-ui-presentation`, `aws-analytics-datalake-redshift-emr`, `aws-api-layer-apigateway-appsync`, `aws-caching-elasticache-dax`, `aws-compute-ec2-fargate-lambda`, `aws-containers-ecs-eks`, `aws-cost-optimization-scaling`, `aws-databases-rds-aurora`, `aws-dns-cdn-route53-cloudfront`, `aws-dynamodb-deep-dive`, `aws-fundamentals-well-architected`, `aws-iot-edge-computing`, `aws-load-balancing-elb-autoscaling`, `aws-messaging-sqs-sns-eventbridge`, `aws-microservices-patterns`, `aws-migration-modernization`, `aws-ml-genai-sagemaker-bedrock`, `aws-networking-vpc-privatelink`, `aws-observability-cloudwatch-xray`, `aws-reference-architectures`, `aws-resilience-multiregion-dr`, `aws-saas-data-partitioning`, `aws-saas-isolation-patterns`, `aws-saas-metering-tiering-throttling`, `aws-saas-multitenancy-foundations`, `aws-saas-tenant-identity-and-routing`, `aws-security-kms-secrets-cognito-waf`, `aws-serverless-lambda-stepfunctions`, `aws-storage-ebs-efs-fsx`, `aws-storage-s3-deep-dive`, `aws-streaming-kinesis-msk`, `cap-theorem-and-consistency`, `capacity-modeling-and-tail-latency`, `ccp-management-elasticity-resiliency`, `ccp-offerings-compute-elasticity`, `ccp-offerings-storage-data-communication`, `consensus-clocks-and-time`, `design-feed-chat-notification`, `design-job-scheduler-task-queue`, `design-location-and-payment-systems`, `design-video-platform-distributed-cache`, `design-web-crawler-data-processing`, `distributed-transactions-advanced`, `genai-llm-system-design`, `message-queues-and-async`, `microservices-ddd-and-boundaries`, `microservices-monolith-api-design`, `multi-tenancy-and-saas-isolation`, `networking-and-protocols`, `probabilistic-data-structures`, `rate-limiting-and-consistent-hashing`, `realtime-streaming-systems`, `resilience-tradeoffs-deep-dive`, `scalability-and-load-balancing`, `security-authentication-data-protection`.
5. **Gotcha & jargon backfill** — add the missing senior follow-ups (dual-write/outbox, DLQ loops, ambient mesh, request hedging, shared-responsibility naming) and define first-use jargon; add model answers to the `aws-fundamentals-well-architected` follow-up bank. Lowest urgency; can ride along with passes 1 and 3.
6. **Leave the 25 `low`-priority subtopics essentially as-is** — the `dp-*`, `fundamentals-and-framework`, `capacity-modeling-and-tail-latency`, and `interview-method-scenario-playbooks` files are exemplary (three scored a perfect 5/5/5) and should serve as the *template* for what a fully-worked example looks like when refining the rest.

**Missing files:** 1 of the 87 requested audit files was not present in the cache — `system-design__aws-security-iam-deep-dive.json` — so IAM deep-dive is excluded from all counts and averages above (n = 86).
