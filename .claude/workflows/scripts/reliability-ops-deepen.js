export const meta = {
  name: 'reliability-ops-deepen',
  description: 'Pass 2 for Reliability Engineering & Operations: exhaustive research gap-analysis, then deepen concepts + append advanced/expert MCQs to 70-90 per topic, then verify — additively',
  phases: [
    { title: 'Research', detail: 'exhaustive web gap-analysis per topic: what SRE/resilience concepts are we missing?' },
    { title: 'Deepen', detail: 'fill gaps in concepts + append advanced/expert MCQs' },
    { title: 'Verify', detail: 'fact-check numbers/mechanisms, dedupe, schema-check each topic in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/reliability-ops`

const SCOPE = `
DOMAIN SCOPE — "Reliability Engineering & Operations" is vendor/language-agnostic. The discipline
of running systems reliably in production: resilience patterns, the incident lifecycle, and the
practices that make reliability a first-class goal. Grounded in the Google SRE books ("Site
Reliability Engineering", "The SRE Workbook"), Michael Nygard's "Release It!" (2nd ed), the AWS
Well-Architected Reliability pillar, and AWS Builders' Library.
- BOUNDARY vs already-authored domains (teach the RELIABILITY angle, CROSS-REFERENCE, do NOT re-teach):
  * observability OWNS telemetry (metrics/logs/traces), OpenTelemetry, Prometheus/PromQL, dashboards,
    and the MECHANICS of SLO-based *alerting* (multi-burn-rate rules) + alert-fatigue tuning. HERE,
    treat SLI/SLO/error-budget as reliability CONCEPTS + how they drive decisions; reference
    observability for how you measure/alert.
  * devops-cicd OWNS the CI/CD pipeline, IaC/Terraform, deployment strategies, GitOps, and the
    DevOps-culture framing of SRE + a light incident-management topic. HERE, go DEEPER on the
    resilience-engineering substance.
  * system-design OWNS CAP, failure theory, and multi-region DR ARCHITECTURE at a high level.
    HERE, the OPERATIONAL practice and concrete patterns/runbooks/numbers.
  * security OWNS rate-limiting as abuse-prevention. HERE, load-shedding/rate-limiting as a
    RELIABILITY mechanism.
- Ground EVERY number/claim (nines-of-availability figures, MTBF/MTTR math, RPO/RTO tiers, backoff
  math, circuit-breaker config defaults, Little's Law, error-budget burn math, the four golden
  signals, toil's definition) in authoritative sources and verify anything uncertain via web research.
`

// slug -> next question seq (new questions start here); + research focus per topic.
const TOPICS = [
  { slug: 'reliability-fundamentals-and-availability-math', name: 'Reliability Fundamentals & Availability Math', start: 49,
    dig: "availability composition math depth (series product, parallel 1-(1-a)^n, k-of-n/M-out-of-N redundancy, availability of a request path across N hard dependencies, why redundancy has diminishing returns), correlated vs independent failures (why the naive product overstates availability — shared fate, common-cause failure, correlated AZ failure), MTBF vs MTTF vs MTTR vs MTTD vs MTTA vs MTTF exact definitions & the availability=MTBF/(MTBF+MTTR) derivation, failure rate lambda & the bathtub curve, the difference between reliability R(t)=e^(-lambda t) and availability, durability (11 nines / annual-durability) vs availability, request-success-rate vs time-based availability & which to use, the 'nine fallacy' (measuring availability wrong), tail-tolerant vs fail-fast, why user-perceived availability differs from server-side, hardware AFR/annualized failure rate." },
  { slug: 'slos-error-budgets-and-velocity-tradeoff', name: 'SLOs, Error Budgets & the Reliability–Velocity Tradeoff', start: 53,
    dig: "multi-window multi-burn-rate concepts (the CONCEPT of burn rate & budget-consumption windows — leave alerting-rule mechanics to observability), error-budget POLICY governance (who owns it, freeze triggers, exec buy-in, the SRE Workbook policy template), SLO math (request-based vs windowed-based SLO, rolling vs calendar window, the 28-day choice), choosing SLI specification (good-events/valid-events ratio, the SLI menu: availability/latency/quality/freshness/correctness/coverage/throughput), latency SLOs done right (percentile threshold + proportion, not average), aggregation pitfalls (averaging percentiles, Simpson's paradox across endpoints), dependency SLOs & the error-budget of a composed service, the '100% is wrong' argument + cost curve, SLO for a service with hard dependencies (your ceiling), user-journey/critical-user-journey SLOs, achievability vs aspirational, silver-vs-gold tiers, when SLA penalties apply." },
  { slug: 'retries-timeouts-and-backoff', name: 'Retries, Timeouts & Backoff', start: 47,
    dig: "jitter variants exact formulas (full jitter random(0,min(cap,base*2^n)), equal jitter, decorrelated jitter min(cap,random(base,prev*3)) — AWS Brooker), retry budgets / token-bucket retry limiting (Google SRE: cap retries to ~10% of requests, the client-side retry-budget), retry amplification R^depth in layered systems & why only the lowest layer should retry (or retry-at-one-layer), timeout budgets propagated across a call chain (deadline propagation, gRPC deadlines, the caller-timeout must exceed sum of downstream), idempotency & idempotency keys for safe retries of writes (exactly-once illusion), hedged/backup requests (tail-latency reduction, request when p95 exceeded) vs retries, circuit-breaker+retry interaction, retry only on retryable errors (which HTTP/gRPC codes: 503/429/502 yes, 400/404/409 no), metastable failure from retries + the recovery (drop retries), Retry-After honoring, the 'retry storm' + thundering herd, connection vs read timeout, why unbounded/infinite retries are dangerous." },
  { slug: 'circuit-breakers-and-bulkheads', name: 'Circuit Breakers & Bulkheads', start: 55,
    dig: "Resilience4j config exact defaults (failureRateThreshold=50%, slowCallRateThreshold, slowCallDurationThreshold, minimumNumberOfCalls=100, permittedNumberOfCallsInHalfOpenState=10, waitDurationInOpenState=60s, slidingWindowType COUNT_BASED vs TIME_BASED, slidingWindowSize=100), Hystrix defaults & why deprecated (requestVolumeThreshold=20, errorThresholdPercentage=50, sleepWindow=5s, rolling 10s) & migration, half-open trial mechanics & the risk of a flood on half-open, count-based vs time-based sliding window trade-off, breaker granularity (per-endpoint/per-dependency/per-instance) & shared-vs-isolated state in a cluster, thread-pool bulkhead vs semaphore bulkhead (Resilience4j maxConcurrentCalls, maxWaitDuration) trade-offs, the ship-hull bulkhead metaphor & resource-pool isolation, combining breaker+bulkhead+timeout+retry+ratelimiter (Resilience4j decorator order: Retry(CircuitBreaker(RateLimiter(TimeLimiter(Bulkhead(call)))))), fail-fast vs fail-silent, forced-open/disabled states, breaker for slow calls not just errors, adaptive concurrency limits (Netflix concurrency-limits, TCP-Vegas-style, AIMD) as a dynamic bulkhead." },
  { slug: 'load-shedding-and-backpressure', name: 'Load Shedding & Backpressure', start: 49,
    dig: "adaptive/dynamic load shedding (CPU/latency-based, Netflix concurrency-limits, Google's per-criticality shedding, the 'do less work' principle), prioritized/criticality-based shedding (CRITICAL_PLUS/CRITICAL/SHEDDABLE tiers, cost-aware), admission control & queue-management (CoDel controlled-delay, active queue management, PIE), LIFO vs FIFO under overload (LIFO drops stale already-timed-out work — Facebook/Meta), bounded queue sizing (Little's Law L=lambda*W to size, why unbounded queues cause latency blowup + OOM), backpressure propagation mechanics (Reactive Streams request(n) demand signaling, TCP flow-control/receive-window analogy, gRPC flow control, Kafka consumer lag & pause/resume), brownout (degrade optional work under load), the golden-signal 'saturation', the difference load-shedding(reject) vs backpressure(slow upstream) vs rate-limiting(policy quota), graceful vs hard shedding, retry-after on shed, positive-feedback overload & metastability, work-conserving vs non-work-conserving." },
  { slug: 'graceful-degradation-and-fallbacks', name: 'Graceful Degradation & Fallbacks', start: 51,
    dig: "static stability (AWS Builders' Library — operate on last-known-good, pre-provision so failover needs no control-plane, the 'don't depend on the thing you need during failure' principle), fail-open vs fail-closed decision framework (fail-closed for authz/payment/safety, fail-open for enrichment/reco — and the security implications), fallback anti-patterns (fallback that also fails, silent quality degradation, fallback masking the incident, fallback amplifying load), monitoring fallback RATE as a signal, cache-as-fallback (serve stale on origin failure, stale-while-revalidate, negative caching), feature flags / kill switches for shedding features, dependency criticality classification (critical vs non-critical path), the 'constant work' pattern (do the same work regardless of load to avoid bimodal behavior), degraded modes tied to health, default values & their risks, chaos-testing the degradation path, load-shedding as degradation, circuit-breaker fallback integration." },
  { slug: 'redundancy-failover-and-health-checks', name: 'Redundancy, Failover & Health Checks', start: 51,
    dig: "split-brain deep (quorum/majority, fencing tokens, STONITH, why 2-node clusters are dangerous, witness/tiebreaker nodes), failure detection (heartbeats, phi-accrual failure detector, timeout tuning, the false-positive vs detection-latency trade-off), health-check depth: liveness vs readiness vs startup probes (K8s cross-ref) + shallow vs DEEP health checks & the 'deep health check cascading failure' anti-pattern (a shared dependency blip marks all instances unhealthy -> total outage) + the fix (fail-open health checks / dependency-health separate signal), health-check death spiral, active-active vs active-passive (hot/warm/cold standby RTO trade-off), N+1/N+2/2N redundancy & failure domains (AZ/region/rack/power/cell-based architecture), graceful shutdown & connection draining (SIGTERM, preStop hook, LB deregistration delay, in-flight request completion), leader election (Raft/Paxos/lease-based — cross-ref system-design), DNS failover TTL problems, load-balancer health-check config (interval/threshold/timeout), gray failures (partial/differential failure the health check misses)." },
  { slug: 'cascading-failures-and-antipatterns', name: 'Cascading Failures & Resilience Anti-Patterns', start: 49,
    dig: "metastable failure deep (the sustaining feedback loop, trigger vs sustaining-effect, why the system stays down after the trigger is gone, the 2021+ metastable-failures research + the recovery requires reducing load below a lower threshold — hysteresis), cache stampede/dogpile in depth (thundering herd on cache miss, fixes: request coalescing/single-flight, probabilistic early expiration/XFetch, locking, stale-while-revalidate, negative caching), retry storms, queue backup & the death spiral, the AWS/Google canonical cascading-failure story (a capacity reduction -> latency -> retries -> more load -> more failures), server overload -> GC death spiral / thread-pool exhaustion, load-induced/query-of-death, positive feedback loops as root cause, gray failures & differential observability, correlated failures & shared fate, the fixes toolbox (shed load, drop retries, reduce fan-out, restart to break metastability, add capacity carefully, circuit-break), Nygard's integration-point failures & the 8 stability anti-patterns (integration points, chain reactions, cascading failures, users, blocked threads, self-denial, scaling effects, unbalanced capacities, dogpile, slow responses, unbounded result sets)." },
  { slug: 'incident-response-and-command', name: 'Incident Response & Command', start: 51,
    dig: "the Incident Command System depth (ICS origin FEMA/wildfire -> Google IMAG 'Managing Incidents' -> PagerDuty/Atlassian, the exact roles: Incident Commander/IC, Ops/Operations Lead, Communications Lead, Planning Lead, Scribe, Subject-Matter-Experts — and the anti-pattern of the IC also doing hands-on work), severity classification frameworks (SEV1-5 vs P0-P4, dimensions: user impact/scope/data-loss/duration, and how sev drives response), the 'mitigate before diagnose / stop the bleeding' principle (roll back, failover, shed, feature-flag off), MTTx breakdown (MTTD detect, MTTA acknowledge, MTTR repair/mitigate, MTTResolve), communication cadence & stakeholder/status-page updates & customer comms, the 3 C's (coordinate/communicate/control), incident declaration threshold (err toward declaring), war-room/bridge/Slack-channel management, handoff across shifts (follow-the-sun), incident roles training & the IC rotation, the difference incident management vs problem management (ITIL), tabletop exercises, avoiding too-many-cooks & the single-writer principle, incident automation/tooling (auto-create channel/doc/bridge)." },
  { slug: 'on-call-escalation-and-runbooks', name: 'On-Call, Escalation & Runbooks', start: 49,
    dig: "sustainable on-call quantitative guidance (Google SRE: <=2 incidents per on-call shift, on-call compensation/time-in-lieu, the 25%-max ops-load / 50% engineering split, primary+secondary, rotation length trade-offs, min responders for coverage), escalation policy design (auto-escalate on no-ack timeout, primary->secondary->EM->service-owner, round-robin vs layered, escalation to related services), paging philosophy (every page must be urgent + actionable + novel + about real user impact; symptom-based not cause-based alerting -> cross-ref observability alert-fatigue), the alert->runbook->automation maturity progression, what makes a GOOD runbook (specific steps, tested, linked dashboards/queries, decision trees, kept current, owned; anti-pattern: stale/vague/'be careful' runbooks), playbook vs runbook, on-call handoff checklist, on-call for the person who wrote the code ('you build it you run it' - Werner Vogels), reducing pages (tune thresholds, dedupe, group, auto-remediate), on-call health metrics (page volume, night pages, time-to-ack), just-in-time paging vs ticket for non-urgent, ChatOps." },
  { slug: 'blameless-postmortems-and-learning', name: 'Blameless Postmortems & Learning', start: 49,
    dig: "Just Culture depth (Sidney Dekker: the line between human error/at-risk/reckless behavior, substitution test, 'human error is a symptom not a cause', first vs second story), Safety-II & resilience engineering (Hollnagel: learn from what goes RIGHT too, work-as-imagined vs work-as-done, adaptive capacity), the SRE postmortem template sections (summary, impact, root/contributing causes, trigger, resolution, detection, timeline, action items, lessons: what went well/poorly/where we got lucky), blameless != accountability-free (the common misunderstanding), action-item quality (SMART, owned, tracked to completion, prioritized against feature work via error budget; anti-pattern: 'be more careful', un-owned, never-done), postmortem triggers/criteria (SEV threshold, data loss, repeat, customer-visible), counterfactual reasoning trap ('they should have known'), hindsight & outcome bias, near-miss/close-call analysis, postmortem culture (blameless review meetings, sharing widely, postmortem-of-the-month, reading groups), single-root-cause fallacy (multiple contributing factors), the 'five whys' critique in postmortems, learning organizations & psychological safety." },
  { slug: 'root-cause-analysis-and-troubleshooting', name: 'Root-Cause Analysis & Troubleshooting', start: 51,
    dig: "RCA method depth & critique (5 Whys limits: linear/single-path/stops-early/subjective; Fishbone-Ishikawa categories 6M; Fault Tree Analysis top-down boolean; Apollo RCA; Kepner-Tregoe; causal-factor/contributing-factor trees), the Swiss Cheese model (layered defenses, latent vs active failures, holes lining up) & why complex-system failure is multi-causal (Richard Cook 'How Complex Systems Fail' - the 18 points), the SRE scientific-method troubleshooting loop (observe symptoms -> hypothesize -> predict -> test -> repeat; bisection; the 'what changed?' change-first heuristic since most incidents follow a deploy/config change), the four golden signals (latency/traffic/errors/saturation) + RED (rate/errors/duration) + USE (utilization/saturation/errors) methods & when each applies (cross-ref observability), differential diagnosis, using distributed tracing to localize the slow hop, log/metric/trace correlation, correlation-vs-causation, confirmation bias & anchoring in debugging, dark debt & unknown-unknowns, reproduction & the heisenbug, USE-method saturation as the overload signal, telemetry-driven vs guess-driven." },
  { slug: 'chaos-engineering-and-fault-injection', name: 'Chaos Engineering & Fault Injection', start: 51,
    dig: "the Principles of Chaos Engineering (principlesofchaos.org: build a hypothesis around steady-state behavior, vary real-world events, run in production, automate continuously, minimize BLAST RADIUS), the exact experiment loop (define steady-state metric -> hypothesize it holds -> inject fault -> attempt to disprove -> if steady-state broke, you found a weakness), maturity/sophistication levels, the Simian Army detail (Chaos Monkey instance kill, Latency Monkey, Conformity/Janitor/Security Monkey, Chaos Kong region evacuation, Chaos Gorilla AZ), Netflix ChAP (Chaos Automation Platform, canary vs control), GameDays / fire drills / DiRT (Google Disaster Recovery Testing), FIT (Failure Injection Testing), fault types (kill/latency/error/resource-exhaustion/network-partition/clock-skew/dependency-fail/disk-fill), prerequisites (mature observability, ability to ABORT/rollback, steady-state metric, not during an incident), blast-radius control (small % traffic, canary, circuit-breaker on the experiment, auto-halt on SLO breach), staging-then-prod, chaos as CI (continuous verification), tools (Chaos Toolkit, Gremlin, LitmusChaos, AWS FIS, Chaos Mesh), the difference chaos-engineering vs testing vs fault-injection, security chaos engineering." },
  { slug: 'disaster-recovery-rpo-rto-strategies', name: 'Disaster Recovery: RPO, RTO & Strategies', start: 52,
    dig: "the AWS DR strategy spectrum exact ordering/characteristics (Backup & Restore: hours RTO, cheap; Pilot Light: core/data replicated + minimal always-on, scale on DR; Warm Standby: scaled-down full running copy, minutes RTO; Multi-Site Active-Active/Hot Standby: near-zero RTO/RPO, most expensive) + the cost vs RTO/RPO curve, RPO drives backup/replication frequency & RTO drives failover architecture (independent axes), sync vs async replication & the RPO=0 requires-synchronous (with latency/availability cost — CAP tie-in), the 3-2-1(-1-0) backup rule, immutable/air-gapped/offsite backups vs ransomware & the 'backups are not DR' point, TEST YOUR RESTORES (untested backup = no backup; restore drills, backup validation), point-in-time recovery & continuous backup / WAL archiving, logical vs physical failures (replication propagates corruption & deletes — you need backups not just replicas; delayed replica), data-corruption/bit-rot & checksums, DR runbook & regular DR drills/failover tests, failback & the reverse-replication problem, cross-region vs cross-AZ scope, dependency-order recovery (recovery-time of the whole graph), pilot-light vs warm-standby cost math, RTO/RPO tiering per data class, GameDay for DR, business-continuity vs DR." },
  { slug: 'capacity-planning-and-load-management', name: 'Capacity Planning & Load Management', start: 59,
    dig: "queueing theory depth (Little's Law L=lambda*W applications, M/M/1 utilization-vs-latency hockey-stick: response time ~ 1/(1-rho), why you can't run at 100% utilization, the knee ~70-80%), coordinated omission deep (the load-test measurement trap where the tester stops sending during a stall, hiding true latency; HdrHistogram + Gil Tene's fix; open vs closed-model load generation), load test taxonomy (load vs stress vs soak/endurance vs spike vs breakpoint/capacity test) & what each finds (soak finds leaks/resource exhaustion, spike finds autoscale lag), the USE method saturation, headroom & N+1/N+2 provisioning & running below the knee, autoscaling deep (reactive/target-tracking vs predictive/scheduled, scale-up LAG & provisioning time, the metric to scale on, flapping/thrashing & cooldown, scale-in risk, why autoscaling isn't instant & pre-scaling for known events), demand forecasting (organic + inorganic/launch + seasonality), overprovision-cost vs under-provision-risk, capacity as a function of the bottleneck resource, percentile-based capacity (provision for p99 not mean), the 'square-root staffing' / Erlang, utilization vs throughput vs latency triangle, gray-box capacity models, load-shedding as the safety net when capacity is exceeded (cross-ref), cell-based architecture for capacity isolation." },
  { slug: 'toil-reduction-and-operational-excellence', name: 'Toil Reduction & Operational Excellence', start: 46,
    dig: "the exact SRE toil definition (6 properties: manual, repetitive, automatable, tactical, no-enduring-value, scales-linearly-with-service-growth) & what is NOT toil (overhead like meetings/email, one-off project work, careful judgment work), the <=50% toil cap & error-budget-style toil budget, measuring/tracking toil (toil surveys, % time, toil-per-service), the automation maturity hierarchy (0 no-automation -> documented runbook -> externally-maintained -> self-service tooling -> approval-based automation -> fully-autonomous self-healing; Google's 'Hierarchy of Automation'), when NOT to automate (rare, risky, high-judgment, cheaper-to-do-manually, the automation-that-causes-bigger-outages risk e.g. the automation runs amok), self-healing / auto-remediation with guardrails (rate-limit the remediation, circuit-break it, human-in-the-loop for risky actions), operational-excellence practices (production readiness reviews/PRR & launch checklists, operational reviews, error-budget-driven prioritization, reducing operational load, the virtuous cycle automate-after-runbook), toil vs engineering-work balance & burnout, SRE engagement/handoff model & the production-readiness bar, platform/self-service to eliminate toil (cross-ref devops platform-engineering), the 'automate yourself out of a job' philosophy, KTLO (keep-the-lights-on) vs project work." },
]

const RULES = (t) => `
GOAL: make this topic's MCQ bank DEEPER and HARDER and fill any concept gaps — WITHOUT
removing or altering existing content. This is Pass 2; a research brief of likely-missing
concepts is provided.

${SCOPE}

STEP 1 — READ both existing files first:
  ${DIR}/${t.slug}/concepts.md
  ${DIR}/${t.slug}/questions.yaml
Understand what's already covered so you do NOT duplicate existing questions or concepts.

STEP 2 — ENRICH concepts.md (edit in place, ADDITIVE):
  - Use the RESEARCH BRIEF (provided separately) plus your own web research to add MISSING
    high-value concepts and deepen thin subtopics (advanced mechanism internals, concrete
    numbers/config defaults/formulas, edge cases, real incidents/canonical stories, standards
    detail). You MAY add new "## " subsections for genuinely missing areas. Keep EXISTING "## "
    headings stable (questions ref them). Keep "## Common Interview Follow-ups" and "## References" last.
  - Vendor/language-agnostic; cite correct sources (Google SRE book chapters, Release It! patterns,
    AWS Well-Architected/Builders' Library, principlesofchaos.org) and CURRENT best practice.
    Where a new diagram clarifies, add a \`\`\`mermaid block (no semicolons in sequenceDiagram messages).

STEP 3 — APPEND new questions to questions.yaml (do NOT rewrite existing ones):
  - Add AT LEAST 25 new questions (target total 70-90). New ids are "${t.slug}-NNN" starting
    at ${String(t.start).padStart(3, '0')}, incrementing, zero-padded 3-digit, unique.
  - Difficulty of NEW questions: heavily ADVANCED and EXPERT (~50% expert, 40% advanced,
    10% intermediate). Use 'expert' for deep numbers/standards detail, subtle mechanism
    distinctions, and senior/staff scenario questions.
  - DEEP-DIVE every subtopic + the newly added concepts. Prioritize SCENARIO/JUDGMENT questions
    ("dependency is slow and threads are piling up — retry, shed, or circuit-break?" / "which
    fix actually stops the cascade?" / "given RPO=0 requirement, which replication?"), NUMBER
    questions (nines downtime, burn rate, RTO tiers, Little's Law), and subtle-distinction
    (backpressure vs load-shedding vs rate-limiting; liveness vs readiness; MTTR vs MTTF).
    Distractors must be wrong for a real, specific reason. Never let a dangerous/wrong-in-practice
    option be the key (e.g. "retry non-idempotent writes", "run at 100% utilization", "unbounded
    queue", "untested backup is fine", "deep health check everything").
  - No "all/none of the above". Do NOT duplicate an existing question's meaning.

SCHEMA (must hold for every new question): keys id, difficulty
(beginner|intermediate|advanced|expert), tags[], question, options[3-5], answer (0-BASED,
in range), explanation, ref ("concepts.md#anchor" resolving to a real "## " heading via
GitHub slug rules — lowercase, spaces->-, punctuation stripped, "A & B" -> "#a--b" double
dash). VARY correct-option position (do NOT cluster on one index; aim for a roughly even
spread). Keep top-level topic/domain(reliability-ops)/topic_slug(${t.slug})/version intact.

Use Edit/Write. Return one line: "${t.slug}: +<newCount> questions (now <total>), concepts enriched: <yes/no>, gaps filled: <short list>".
`

phase('Research')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are researching the topic "${t.name}" for a vendor-agnostic "Reliability Engineering & Operations" interview library, to make sure Pass-2 deepening misses NOTHING.\n\n${SCOPE}\n\n` +
    `FIRST read the current material at ${DIR}/${t.slug}/concepts.md (its "## " headings show what's already covered).\n` +
    `THEN do EXHAUSTIVE web research (the Google SRE books & SRE Workbook chapters, Nygard "Release It!", AWS Well-Architected Reliability pillar + AWS Builders' Library, principlesofchaos.org, "senior/staff SRE interview questions 2024/2025", real public postmortems & outage write-ups) and produce a GAP BRIEF for this topic:\n` +
    `- MISSING concepts/patterns/numbers not in the current concepts.md that a strong 2025 senior SRE/backend interview expects (with a one-line why each matters).\n` +
    `- THIN areas needing deeper treatment (advanced mechanism internals / concrete config defaults & formulas / failure-mode edge cases / canonical incident stories / standards detail).\n` +
    `- Specific hard/senior question angles worth adding (scenario / "which mitigation is correct" / numbers / subtle-distinction framings).\n` +
    `Focus hints to make sure you cover: ${t.dig}\n\n` +
    `Return a concise but COMPLETE brief (bullet lists). This brief is handed to the deepening author, so be concrete and specific (name the SRE-book concept, the AWS pattern, the config default, the formula, the incident).`,
    { label: `research:${t.slug}`, phase: 'Research', effort: 'high' }
  ),
  (brief, t) => agent(
    `You are a staff-level Site Reliability Engineer and senior interviewer deepening the interview-prep material for "${t.name}" (slug: ${t.slug}). Add the hard, real-world resilience/operations questions and missing concepts that separate senior candidates from juniors.\n\n` +
    `RESEARCH BRIEF (gaps + angles found for this topic — incorporate these):\n${brief}\n\n${RULES(t)}`,
    { label: `deepen:${t.slug}`, phase: 'Deepen', effort: 'high' }
  ),
  (deepenSummary, t) => agent(
    `Verify the deepened Reliability-Ops topic "${t.name}" (slug: ${t.slug}). Read ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and FIX IN PLACE:\n` +
    `1) FACTUAL errors in any concept text, MCQ answer index, or explanation — web-research anything uncertain (nines-of-availability downtime figures, availability=MTBF/(MTBF+MTTR), error-budget=100%-SLO, burn-rate math, RPO=data-loss vs RTO=downtime, the DR-spectrum ordering by cost/RTO, circuit-breaker config defaults incl. Resilience4j waitDurationInOpenState=60s / failureRateThreshold=50 / minimumNumberOfCalls=100 / permittedInHalfOpen=10, Little's Law, jitter formulas, the four golden signals, toil's 6-part definition, Chaos principles). A wrong 'answer' index or a wrong number/definition is the WORST defect — fix it.\n` +
    `2) BAD-IN-PRACTICE ADVICE: ensure no question's correct answer or concept text recommends an operationally dangerous practice as correct (retrying non-idempotent writes, retries without backoff/jitter, running at ~100% utilization, unbounded queues, untested backups, deep health checks that cause cascades, blame in postmortems, IC also doing hands-on fixes). A plausible-but-wrong-in-practice option must be a DISTRACTOR, never the key.\n` +
    `3) SCOPE DRIFT: refocus content that belongs to observability (telemetry + SLO alerting-rule mechanics), devops-cicd (pipeline/deploy/IaC), system-design (CAP/failure-theory/DR-architecture), or security (rate-limit-as-abuse) onto the RELIABILITY/operational-practice angle, cross-referencing not duplicating.\n` +
    `4) DUPLICATES: if a newly added question is a semantic duplicate of an existing one, rewrite it to cover something new.\n` +
    `5) SCHEMA: valid YAML; unique ids all prefixed '${t.slug}-' 3-digit seq, no collisions; difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based in-range 'answer'; every 'ref' resolves to a real '## ' heading. Fix violations. Confirm correct-option positions are VARIED — REBALANCE by reordering options if any index exceeds ~35% share.\n` +
    `6) DIFFICULTY/COVERAGE: confirm the bank now has a strong block of advanced+expert questions and reaches 70-90 total; expert-tagged ones must be genuinely hard. Re-tag/ADD if short.\n\n` +
    `Return one line: "${t.slug}: <total> questions (<nBeg>/<nInt>/<nAdv>/<nExp>), <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
