# Reliability Engineering & Operations

16 topics. Study content and MCQs live in per-topic
subfolders. See the master taxonomy in `../../TOPICS.md`.

The discipline of running systems reliably in production: the resilience patterns that
keep a system up when its dependencies fail (retries, circuit breakers, bulkheads, load
shedding, graceful degradation), the operational lifecycle of incidents (response,
on-call, blameless postmortems, RCA), and the practices that make reliability a
first-class engineering goal (SLOs/error budgets, chaos engineering, disaster recovery,
capacity planning, toil reduction). Grounded in the Google SRE books, Nygard's *Release
It!*, and the AWS Well-Architected Reliability pillar.

Boundaries (cross-reference, don't duplicate): **observability** owns telemetry, SLO
*alerting* mechanics, and alert fatigue; **devops-cicd** owns the CI/CD pipeline, IaC, and
the DevOps-process framing of SRE; **system-design** owns the theoretical resilience
trade-offs and failure theory; **security** owns rate-limiting-as-abuse-prevention. This
domain owns the *operational practice* and *resilience-engineering patterns* — how you
actually keep a system reliable and respond when it isn't.

| Topic | Slug | Freq | Difficulty | Status |
|---|---|---|---|---|
| Reliability Fundamentals & Availability Math | `reliability-fundamentals-and-availability-math` | very-high | beginner | ✅ |
| SLOs, Error Budgets & the Reliability–Velocity Tradeoff | `slos-error-budgets-and-velocity-tradeoff` | very-high | intermediate | ✅ |
| Retries, Timeouts & Backoff | `retries-timeouts-and-backoff` | very-high | intermediate | ✅ |
| Circuit Breakers & Bulkheads | `circuit-breakers-and-bulkheads` | very-high | intermediate | ✅ |
| Load Shedding & Backpressure | `load-shedding-and-backpressure` | high | advanced | ✅ |
| Graceful Degradation & Fallbacks | `graceful-degradation-and-fallbacks` | high | intermediate | ✅ |
| Redundancy, Failover & Health Checks | `redundancy-failover-and-health-checks` | high | intermediate | ✅ |
| Cascading Failures & Resilience Anti-Patterns | `cascading-failures-and-antipatterns` | high | advanced | ✅ |
| Incident Response & Command | `incident-response-and-command` | very-high | intermediate | ✅ |
| On-Call, Escalation & Runbooks | `on-call-escalation-and-runbooks` | high | intermediate | ✅ |
| Blameless Postmortems & Learning | `blameless-postmortems-and-learning` | very-high | intermediate | ✅ |
| Root-Cause Analysis & Troubleshooting | `root-cause-analysis-and-troubleshooting` | high | advanced | ✅ |
| Chaos Engineering & Fault Injection | `chaos-engineering-and-fault-injection` | high | advanced | ✅ |
| Disaster Recovery: RPO, RTO & Strategies | `disaster-recovery-rpo-rto-strategies` | very-high | advanced | ✅ |
| Capacity Planning & Load Management | `capacity-planning-and-load-management` | high | advanced | ✅ |
| Toil Reduction & Operational Excellence | `toil-reduction-and-operational-excellence` | medium | intermediate | ✅ |

Status: ☐ not started · ◐ concepts done · ● concepts+MCQs · ✅ validated
