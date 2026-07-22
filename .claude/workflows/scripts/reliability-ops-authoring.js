export const meta = {
  name: 'reliability-ops-authoring',
  description: 'Author Reliability Engineering & Operations study content for all 16 topics: availability math, SLO/error-budgets, resilience patterns (retries/circuit-breakers/bulkheads/load-shedding/degradation), incident lifecycle (response/on-call/postmortems/RCA), chaos engineering, DR (RPO/RTO), capacity planning, toil. Author -> verify.',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact/precision check + boundary-scope check + schema check, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/reliability-ops`

const SCOPE_NOTE = `
DOMAIN SCOPE — "Reliability Engineering & Operations" for BACKEND + SENIOR / SRE-adjacent
interviews. The discipline of running systems reliably in production: resilience patterns that
keep a system up when dependencies fail, the operational lifecycle of incidents, and the
practices that make reliability a first-class goal. Grounded in the Google SRE books ("Site
Reliability Engineering", "The SRE Workbook"), Michael Nygard's "Release It!" (stability
patterns), and the AWS Well-Architected Reliability pillar. Vendor/language-agnostic where
possible; a short idiomatic example (e.g. Resilience4j, a runbook snippet, an SLO spec) is
welcome to make it concrete.

BOUNDARY RULES (STRICT — this library already has overlapping domains; CROSS-REFERENCE, don't duplicate):
- observability OWNS: telemetry (metrics/logs/traces), OpenTelemetry, Prometheus/PromQL, dashboards,
  the MECHANICS of SLO-based *alerting* (multi-burn-rate alert rules), and alert-fatigue tuning.
  HERE: define SLI/SLO/error-budget as reliability CONCEPTS and how they drive decisions (the
  velocity tradeoff, budget policies), and reference observability for how you MEASURE/ALERT on them.
- devops-cicd OWNS: the CI/CD pipeline, IaC/Terraform, deployment strategies (blue-green/canary),
  GitOps, and the DevOps-culture framing of SRE + a light incident-management topic. HERE: go DEEPER
  on the reliability-engineering substance (the stability patterns, the incident command discipline,
  postmortem craft, chaos, DR strategy) — reference devops-cicd for pipeline/deploy mechanics.
- system-design OWNS: the theoretical resilience trade-offs, CAP, failure theory, multi-region DR
  architecture at a high level. HERE: the OPERATIONAL practice and the concrete patterns/runbooks.
- security OWNS: rate-limiting as abuse-prevention. HERE: load-shedding/rate-limiting as a
  RELIABILITY mechanism (shed load to protect the system), cross-ref security + design-rate-limiter.
When a topic overlaps, explicitly say "see <domain>/<topic>" and cover the reliability-specific angle.

Ground every number/claim (nines-of-availability minutes, RPO/RTO tiers, backoff math, the "four
golden signals", MTTR/MTBF definitions) in authoritative sources and verify anything uncertain.
`

const SCHEMA = `
CONTENT CONTRACT (follow exactly). Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1.
   - "## <Subtopic>" H2 per subtopic (MCQ anchor targets — keep stable).
   - Interview-grade depth: define the concept, explain the MECHANISM (how/why it works),
     give concrete numbers/formulas where they exist (availability math, backoff formulas,
     RPO/RTO tiers, error-budget math), and always cover the TRADE-OFFS (this is a
     judgment-heavy domain — when to use X vs Y, what breaks if you get it wrong).
   - Use comparison tables (e.g. retry strategies, DR strategies backup-restore/pilot-light/
     warm-standby/multi-site with cost vs RTO, resilience patterns).
   - Where a diagram clarifies (circuit-breaker state machine, cascading-failure propagation,
     retry+backoff timeline, DR strategy spectrum, incident lifecycle), use a \`\`\`mermaid fenced
     block (stateDiagram-v2 / flowchart). NO ASCII-art. CRITICAL: no semicolons in sequenceDiagram
     message text (use commas).
   - End with "## Common Interview Follow-ups" and "## References".

2) questions.yaml — top-level keys:
     topic: "<Topic Name>"
     domain: reliability-ops
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

   RULES: aim for 40-60 MCQs per topic. Focus on: MECHANISM ("what does a circuit breaker do in
   the half-open state?"), NUMBERS ("three-nines allows how much downtime/year?", "what does
   RPO=0 require?"), TRADE-OFFS + JUDGMENT ("dependency is slow — retry or shed load?", scenario
   picks), and ANTI-PATTERNS ("retry storm", "thundering herd", "retries without backoff/jitter").
   3-5 options, exactly one correct, 0-based answer; VARY the correct index (no single index >40%,
   no guessable cycle); mixed difficulty; scenario-based items preferred; distractors plausible but
   wrong for a real reason; no all/none-of-the-above; every 'ref' resolves to a real "## " heading;
   id prefix == slug. Quote any YAML option containing a colon+space or leading brace.

Use the Write tool. Research to ensure numbers/definitions are correct. Return:
"<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'reliability-fundamentals-and-availability-math', name: 'Reliability Fundamentals & Availability Math', hints: "The vocabulary + the math. Availability = uptime/(uptime+downtime); the NINES table (90%/99%/99.9%/99.95%/99.99%/99.999% -> downtime per year/month/week/day — memorize: three-nines ~8.76h/yr, four-nines ~52.6min/yr, five-nines ~5.26min/yr). Reliability vs availability vs durability (distinct!). MTBF, MTTF, MTTR, MTTD, MTTA and how they relate (availability = MTBF/(MTBF+MTTR)). Serial vs parallel availability (dependencies in series MULTIPLY -> availability drops; redundancy in parallel: 1-(1-a)^n -> improves); why a system is only as available as its least-available critical dependency; the 'availability budget' across a request path. Hard vs soft dependencies. Fault vs error vs failure. Cross-ref system-design availability, observability (measuring it)." },
  { slug: 'slos-error-budgets-and-velocity-tradeoff', name: 'SLOs, Error Budgets & the Reliability–Velocity Tradeoff', hints: "SLI (a measured indicator — request success rate, latency percentile), SLO (the target — e.g. 99.9% of requests < 300ms over 28 days), SLA (the CONTRACT with consequences — always looser than the SLO). ERROR BUDGET = 100% - SLO (e.g. 99.9% -> 0.1% budget); the KEY INSIGHT: the budget is a currency you SPEND on velocity/risk — budget remaining -> ship fast; budget exhausted -> freeze features, focus on reliability. Error-budget POLICY (what happens when it's burned). Choosing good SLIs (the request/response ratio, availability vs latency SLOs); the 'happiness test'; user-journey SLOs. Why 100% is the wrong target (cost + it removes the budget for change). Burn rate (concept — measurement/alerting details -> observability slo-based-alerting). Cross-ref observability (slo-based-alerting-and-error-budgets), devops-cicd (sre-sla-slo-sli)." },
  { slug: 'retries-timeouts-and-backoff', name: 'Retries, Timeouts & Backoff', hints: "The most-asked resilience mechanism. TIMEOUTS first (never wait forever; connect vs read/socket timeout; how to pick one — based on the p99 + headroom, not a guess; timeout budgets across a call chain so the total < the caller's timeout). RETRIES: only retry IDEMPOTENT + TRANSIENT failures (never retry a 400/business error; retrying a non-idempotent write can double-charge); RETRY STORMS / thundering herd (synchronized retries amplify load and cause a metastable failure). BACKOFF: fixed vs exponential (base * 2^attempt, capped); JITTER (full/equal/decorrelated) — why jitter is essential to de-synchronize clients (AWS 'exponential backoff and jitter'). RETRY BUDGETS / token buckets (cap retries to a % of requests). Retry amplification in layered systems (each layer retries -> N^depth). Cross-ref circuit-breakers (stop retrying a dead dependency), messaging (dead-letter), design-rate-limiter." },
  { slug: 'circuit-breakers-and-bulkheads', name: 'Circuit Breakers & Bulkheads', hints: "Nygard 'Release It!' stability patterns. CIRCUIT BREAKER: a state machine (CLOSED -> normal; OPEN -> fail fast after error threshold, don't call the dying dependency; HALF-OPEN -> after a cooldown, let a trial request through to test recovery -> back to CLOSED on success or OPEN on failure); why it PREVENTS cascading failure + gives the dependency time to recover + fails fast (better than piling up on timeouts). Tuning (error-rate threshold, volume threshold, sleep window). BULKHEAD: isolate resources into pools (separate thread pools/connection pools per dependency) so one saturated dependency can't consume ALL resources and sink the whole app (ship-hull metaphor); thread-pool vs semaphore bulkhead. Combine breaker+bulkhead+timeout. Resilience4j/Hystrix (Hystrix deprecated). A stateDiagram-v2 for the breaker is ideal. Cross-ref cascading-failures, retries." },
  { slug: 'load-shedding-and-backpressure', name: 'Load Shedding & Backpressure', hints: "Protecting a system from overload. LOAD SHEDDING: when near capacity, deliberately REJECT some requests (return 503/429 fast) to keep the rest healthy — better to serve 90% well than 100% badly / collapse; prioritized shedding (drop low-priority/cheap-to-reject first; shed by criticality, cost, or user tier); admission control. BACKPRESSURE: signaling upstream to SLOW DOWN when a downstream can't keep up (bounded queues that reject when full, reactive streams request(n), TCP flow control as the analogy, Kafka consumer lag); push vs pull (pull is naturally backpressured). Queues: bounded vs unbounded (unbounded queue = latent OOM + latency blowup — an anti-pattern); the danger of buffering. LIFO vs FIFO under overload (LIFO sheds old/already-timed-out work). Brownout / degradation as a form of shedding. Little's Law intuition. Cross-ref capacity-planning, graceful-degradation." },
  { slug: 'graceful-degradation-and-fallbacks', name: 'Graceful Degradation & Fallbacks', hints: "Keep core function working when parts fail. GRACEFUL DEGRADATION: reduce functionality instead of full outage (e.g. show cached/stale data, hide the recommendations widget, disable non-critical features) — feature-by-feature degradation tied to dependency health. FALLBACKS: a default/alternative when a call fails (cached value, static default, secondary provider, degraded response); fallback chains; the RISK of fallbacks (silent quality loss, fallback that also fails, masking incidents — monitor fallback rate). STATIC STABILITY (AWS) — the system keeps working on last-known-good state without the failed dependency (e.g. serve from cache even if the DB is down). Fail-open vs fail-closed (and when each is right — fail-closed for auth/security, fail-open for a non-critical enrichment). Degradation modes tied to load (brownout). Cross-ref circuit-breakers (fallback on open), caching, security (fail-closed for authz)." },
  { slug: 'redundancy-failover-and-health-checks', name: 'Redundancy, Failover & Health Checks', hints: "Eliminating single points of failure. REDUNDANCY: N+1 / N+2, active-active vs active-passive (hot/warm/cold standby — tradeoff of cost vs failover time); redundancy across failure domains (AZ/region/rack). FAILOVER: automatic vs manual; the danger of failover (split-brain — two primaries; fencing/STONITH; quorum to avoid it); failback. HEALTH CHECKS: liveness vs readiness (liveness = restart me if dead; readiness = don't send traffic yet — K8s cross-ref); shallow vs DEEP health checks (deep checks dependencies but can cause cascading failure if a shared dependency blip marks everything unhealthy — a known anti-pattern); health-check-driven load balancer removal; the 'health check death spiral'. Heartbeats & failure detection (timeouts, phi-accrual — brief). Graceful shutdown (drain connections, SIGTERM handling). Cross-ref kubernetes (probes), system-design." },
  { slug: 'cascading-failures-and-antipatterns', name: 'Cascading Failures & Resilience Anti-Patterns', hints: "How systems collapse + what NOT to do. CASCADING FAILURE: a failure in one component overloads others, which fail, spreading (e.g. one slow dependency -> threads pile up -> pool exhausted -> service unresponsive -> its callers pile up...). METASTABLE FAILURE (the system stays broken even after the trigger is removed, because of a sustaining feedback loop like retries — needs a manual push to recover). Anti-patterns (Nygard + SRE): retry storms, unbounded queues, missing timeouts, shared-fate/tight coupling, the thundering herd, cache stampede/dogpile (+ fixes: request coalescing, probabilistic early expiration, locks), synchronized clients (no jitter), the 'health check death spiral', overload from a client bug. Recovery: shed load, disable retries, reduce fan-out, rolling restart, add capacity. Positive feedback loops as the root cause. A flowchart of a cascade is ideal. Cross-ref retries, load-shedding, circuit-breakers." },
  { slug: 'incident-response-and-command', name: 'Incident Response & Command', hints: "The operational discipline when things break. Incident lifecycle: detect -> triage/assess severity -> respond/mitigate -> resolve -> learn. SEVERITY levels (SEV1-5 / P0-P4 — what distinguishes them: customer impact, scope). The INCIDENT COMMAND SYSTEM (ICS, from firefighting -> Google/PagerDuty): ROLES — Incident Commander (coordinates, decides, doesn't fix), Communications Lead, Operations/Ops Lead (does the hands-on work), Scribe; why separating command from hands-on-work matters. MITIGATE BEFORE ROOT-CAUSE (stop the bleeding first — roll back, failover, shed load — diagnosis comes later). Communication (status page, stakeholder updates, cadence). Declaring an incident (err on the side of declaring). War room / bridge. The 'you build it you run it' model. MTTR breakdown (detect/ack/mitigate/resolve). Cross-ref on-call, postmortems, observability (detection)." },
  { slug: 'on-call-escalation-and-runbooks', name: 'On-Call, Escalation & Runbooks', hints: "Sustainable operations. ON-CALL models (follow-the-sun, primary/secondary, rotation length, handoff); healthy on-call (the SRE guidance: cap incident load — e.g. <=2 incidents per shift, time-in-lieu/comp, max % of time on ops). ESCALATION policies (auto-escalate if unacked in N min; primary -> secondary -> manager; escalate to service owners). PAGING hygiene (every page must be ACTIONABLE + URGENT + about a real user-impacting problem — else it's alert fatigue; ties to observability on-call-alert-fatigue). RUNBOOKS / playbooks (step-by-step for known failure modes; what makes a good runbook — specific, tested, links to dashboards; runbook per alert); the goal of making on-call boring. Toil from on-call. Alert -> runbook -> automate-the-runbook progression. Cross-ref observability (alerting, alert fatigue), toil-reduction, incident-response." },
  { slug: 'blameless-postmortems-and-learning', name: 'Blameless Postmortems & Learning', hints: "Learning from failure — the cultural core of SRE. BLAMELESS postmortem: focus on SYSTEMS and CONTRIBUTING FACTORS, not blaming individuals (people act rationally given their info + incentives; blame -> hiding -> less learning). What a postmortem contains: summary, impact (users/duration/revenue), timeline, root cause(s), what went well/badly/where we got lucky, ACTION ITEMS (owned, tracked, with due dates — the whole point). Postmortem triggers (when to write one — SEV threshold, data loss, repeated). Just Culture (Dekker) — the line between human error and reckless behavior. The Second Story / 'human error is a symptom not a cause'. Avoiding 'action item: be more careful' (non-actionable). Blameless != accountability-free. Follow-through on action items (the common failure). Near-miss analysis. Cross-ref RCA, incident-response." },
  { slug: 'root-cause-analysis-and-troubleshooting', name: 'Root-Cause Analysis & Troubleshooting', hints: "Systematic diagnosis. RCA techniques: 5 Whys (+ its limits — linear, can miss multiple causes, can stop too early), Fishbone/Ishikawa (categories: people/process/tech/environment), Fault Tree Analysis; the myth of THE single root cause (complex-systems failures have MULTIPLE contributing factors — Swiss cheese model of layered defenses failing together). TROUBLESHOOTING METHOD (SRE): form a hypothesis from symptoms, test it (bisect the system, check recent CHANGES first — most incidents follow a deploy/config change), narrow down, use the scientific method not random flailing. Signals to use (the four golden signals: latency/traffic/errors/saturation — cross-ref observability; RED/USE). Differential diagnosis. Correlation vs causation. Tools (logs/traces/metrics -> observability; distributed tracing to find the slow hop). Change-first heuristic. Cross-ref observability, postmortems, cascading-failures." },
  { slug: 'chaos-engineering-and-fault-injection', name: 'Chaos Engineering & Fault Injection', hints: "Proactively finding weaknesses. CHAOS ENGINEERING (Netflix): the discipline of experimenting on a system to build confidence it withstands turbulent conditions. The PRINCIPLES: (1) define STEADY STATE (a measurable normal — e.g. orders/sec), (2) HYPOTHESIZE it holds during a fault, (3) inject a real-world fault, (4) try to DISPROVE the hypothesis, (5) minimize BLAST RADIUS. Start in staging, then prod with guardrails; automated + continuous. Chaos Monkey / the Simian Army (Latency Monkey, Chaos Kong for region loss); GameDays (planned failure exercises). FAULT INJECTION types: kill instances, add latency, drop packets, fail a dependency, exhaust CPU/disk, clock skew. Prerequisites (good observability + ability to abort + not during an incident). Chaos != breaking things randomly (it's a controlled EXPERIMENT). Cross-ref DR (test failover), redundancy, observability (need it first)." },
  { slug: 'disaster-recovery-rpo-rto-strategies', name: 'Disaster Recovery: RPO, RTO & Strategies', hints: "Surviving a disaster (region loss, data corruption). RPO (Recovery Point Objective = max acceptable DATA LOSS, measured in time — RPO=1h means you can lose up to 1h of data -> drives backup/replication frequency) vs RTO (Recovery Time Objective = max acceptable DOWNTIME to restore -> drives failover architecture); they're independent and drive cost. The AWS DR STRATEGY SPECTRUM (cost vs RTO/RPO): Backup & Restore (cheap, hours RTO), Pilot Light (core minimal, replicate data, scale up on DR — lower RTO), Warm Standby (scaled-down full copy always running -> minutes), Multi-Site Active-Active (near-zero RTO/RPO, most expensive). Backups: 3-2-1 rule, test your restores (untested backup = no backup), immutable/offsite backups (ransomware), point-in-time recovery. Failover + failback + DR drills. Data corruption/logical failures (replication propagates them — need backups, not just replicas). Cross-ref system-design (aws-resilience-multiregion-dr), messaging-databases (replication)." },
  { slug: 'capacity-planning-and-load-management', name: 'Capacity Planning & Load Management', hints: "Having enough resources for demand. CAPACITY PLANNING: forecast demand (organic growth + events/launches/seasonality), provision with HEADROOM (N+1/N+2, don't run at 100%), the difference between provisioned and usable capacity. LOAD TESTING to find limits: load vs stress vs soak/endurance vs spike testing; find the knee/saturation point; COORDINATED OMISSION (a load-test measurement trap — your tool stops sending during a stall, hiding the real latency; cross-ref testing). Headroom + the queueing-theory reality (Little's Law: L = lambda*W; utilization near 100% -> latency explodes — the hockey-stick/M/M/1 curve, keep utilization moderate). Autoscaling (reactive vs predictive/scheduled; scale-up lag; why autoscaling isn't instant — provisioning time; scale on the right metric). Overprovisioning cost vs risk. Demand shaping (shed/queue/rate-limit). Cross-ref load-shedding, performance-engineering (future), testing (load)." },
  { slug: 'toil-reduction-and-operational-excellence', name: 'Toil Reduction & Operational Excellence', hints: "Making operations sustainable + scalable. TOIL (SRE definition): work that is manual, repetitive, automatable, tactical, devoid of enduring value, and scales linearly with service growth — NOT the same as 'overhead' (meetings) or one-off project work. Why toil is bad (no lasting value, scales with load, causes burnout, crowds out engineering). The SRE 50% cap (toil should be < 50% of an SRE's time; the rest = engineering to reduce toil). Measuring + tracking toil. AUTOMATION as the antidote (the automation hierarchy: no automation -> documented runbook -> scripted -> self-service tooling -> fully automated/self-healing); when NOT to automate (rare, risky, judgment-heavy). Operational excellence: error-budget-driven work prioritization, reducing operational load, the virtuous cycle (automate the runbook after you write it). Self-healing systems (auto-remediation with guardrails). Cross-ref on-call (toil source), devops-cicd (platform-engineering/IDP), reliability-fundamentals." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a staff-level Site Reliability Engineer and interview coach authoring study material for the topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / subtopics for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . Remember: interview-grade depth, concrete NUMBERS/formulas where they exist, always cover TRADE-OFFS and ANTI-PATTERNS, cross-reference (don't duplicate) observability/devops-cicd/system-design/security, and 40-60 MCQs weighted to mechanism + numbers + judgment/scenario.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer (staff SRE + interviewer) verifying reliability-engineering content for "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `Files: ${DIR}/${t.slug}/concepts.md and questions.yaml . Read BOTH. Check and FIX IN PLACE:\n` +
    `1) FACTUAL PRECISION (most important): every NUMBER and DEFINITION must be correct — nines-of-availability downtime figures (three-nines ~8.76h/yr, four-nines ~52.6min/yr, five-nines ~5.26min/yr), availability=MTBF/(MTBF+MTTR), error-budget=100%-SLO, RPO=data-loss vs RTO=downtime, circuit-breaker states (closed/open/half-open) and what each does, backoff+jitter math, Little's Law, the DR spectrum ordering (backup&restore<pilot-light<warm-standby<multi-site by cost/RTO), toil's 6-part definition, the four golden signals. Web-research anything uncertain and FIX it. A wrong number is the worst defect.\n` +
    `2) BOUNDARY/SCOPE: confirm the topic covers the RELIABILITY angle and CROSS-REFERENCES (does not duplicate) observability (telemetry/alerting mechanics), devops-cicd (pipeline/deploy), system-design (theory), security (rate-limit-as-abuse). Fix scope drift.\n` +
    `3) TRADE-OFFS + ANTI-PATTERNS present (this is a judgment domain): confirm the topic teaches when-to-use-what and the failure modes (retry storms, unbounded queues, deep-health-check death spiral, untested backups, etc.).\n` +
    `4) SCHEMA: valid YAML; keys topic/domain(reliability-ops)/topic_slug(${t.slug})/version/questions; 40-60 questions; ids (prefix '${t.slug}-', unique, 3-digit seq); difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based 'answer' in range; explanation; correct-option VARIED (rebalance if any index >40% or a guessable cycle — shuffle options, keep 'answer' correct). Quote any YAML option with a colon+space or leading brace.\n` +
    `5) Every 'ref' resolves to a real '## ' heading; Mermaid valid (no semicolons in sequenceDiagram messages; valid stateDiagram-v2/flowchart).\n` +
    `6) COVERAGE: every subtopic represented; MCQs weighted to mechanism/numbers/judgment, not trivia.\n\n` +
    `After fixing, return: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
