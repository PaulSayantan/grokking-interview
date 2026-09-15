export const meta = {
  name: 'observability-authoring',
  description: 'Author interview-grade concepts.md + a 40-60 MCQ questions.yaml for all 17 Observability topics, then verify each for factual accuracy and schema compliance',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact-check + schema-check each topic, fix in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/observability`

const SCOPE_NOTE = `
DOMAIN SCOPE — "Observability" for BACKEND + SENIOR developer interviews. Teach the observability
signals, mechanics, and toolchain concretely. Vendor/tool grounding is EXPECTED here (unlike the
system-design overview): OpenTelemetry, Prometheus, Grafana, Jaeger, Micrometer, Alertmanager,
ELK/Loki, eBPF — teach how they actually work (data models, wire formats, query languages, scrape
vs push). Keep principles framework-neutral first, then the tool specifics.

BOUNDARY vs already-authored / upcoming domains (cross-reference, don't duplicate):
- system-design/observability-monitoring-reliability is the DESIGN-LEVEL overview (where
  monitoring fits in an architecture). THIS domain owns the hands-on toolchain + signal mechanics.
- The UPCOMING reliability-and-operations domain will own the incident/on-call PROCESS
  (incident command, postmortems, runbooks, DORA). Here, keep on-call/alert-fatigue at the
  SIGNAL-QUALITY level (what makes an alert actionable, symptom vs cause, routing) and point to
  reliability-ops for the human process.
- The UPCOMING performance-engineering domain owns profiling/flame-graphs as a perf skill. Here,
  APM/eBPF/continuous-profiling is the OBSERVABILITY angle (always-on production profiling as a
  signal); cross-reference, don't deep-dive flame-graph reading technique.
- Distributed tracing here = the observability mechanics (spans, context propagation, sampling).
  Distributed-systems clocks/consensus stay in system-design.

Ground claims in authoritative sources: OpenTelemetry spec (signals, semantic conventions, W3C
Trace Context traceparent/tracestate, OTLP), Prometheus docs (data model, exposition format, PromQL,
histograms incl. native/exponential, remote-write), Grafana docs, Jaeger docs, Micrometer docs, the
Google SRE books (SLI/SLO/error budgets, four golden signals, multi-window multi-burn-rate alerting),
Brendan Gregg (USE method), the RED method (Tom Wilkie). Verify specifics via web research (PromQL
rate() vs irate(), histogram_quantile, sampling head vs tail, cardinality).
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md — the study/answer content:
   - Begins with a single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (these are the MCQ anchor targets — keep them stable).
   - Interview-grade answers, LAYERED: beginner definition + why it matters -> intermediate
     trade-offs/comparisons -> advanced internals/gotchas the interviewer probes.
   - Concrete examples: PromQL snippets, an OTLP/trace-context example, a metric-exposition sample,
     an SLO/error-budget calculation, comparison tables. Tool-grounded but concept-first.
   - If a diagram helps (trace waterfall, context propagation across services, scrape vs push,
     telemetry pipeline, burn-rate alerting), use a \`\`\`mermaid fenced block (flowchart/
     sequenceDiagram). NO ASCII-art. Keep code/PromQL/config in normal fenced blocks.
   - End with a "## Common follow-up questions" section and a "## References" section.
   - Factual accuracy is critical (PromQL semantics, SLO math, sampling, cardinality).

2) questions.yaml — the MCQ bank. Top-level keys:
     topic: "<Topic Name>"        # matches the concepts.md H1
     domain: observability
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001     # globally unique within the file, zero-padded 3-digit seq
         difficulty: beginner      # one of: beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options:
           - "<option 0>"
           - "<option 1>"
           - "<option 2>"
           - "<option 3>"
         answer: 2                 # 0-BASED index of the correct option
         explanation: |
           <why the correct answer is right; teach the concept>
         ref: "concepts.md#<anchor>"   # deep-link to a concepts.md H2 (GitHub slug rules)

   RULES:
   - Produce 40-60 questions (minimum 40). Cover EVERY subtopic with several questions each.
   - 3-5 options per question, EXACTLY ONE correct. 'answer' is 0-based.
   - VARY the correct option's position across the file (do not cluster on one index; avoid a
     trivially-guessable repeating pattern).
   - Mixed difficulty (mostly beginner/intermediate with some advanced; Pass 1 — don't over-index on expert).
   - INCLUDE scenario-style questions ("given this PromQL / this trace / this alert rule / this
     error budget, what's true / what's wrong / which fixes it?"). Distractors plausible but wrong
     for a real reason.
   - No "all of the above" / "none of the above".
   - Every 'ref' anchor MUST resolve to an actual "## " heading in concepts.md.
   - id prefix MUST equal the topic-slug.

Use the Write tool to create both files. Do your own web research to ensure correctness.
Return a one-line summary: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'observability-fundamentals-and-three-pillars', name: 'Observability Fundamentals & the Three Pillars', hints: "monitoring vs observability (known-unknowns vs unknown-unknowns); the three pillars (metrics/logs/traces) + why they're necessary-not-sufficient; observability 2.0 / wide structured events / high-cardinality; control theory origin (observability = infer internal state from outputs); the four golden signals (latency/traffic/errors/saturation), RED (rate/errors/duration), USE (utilization/saturation/errors); white-box vs black-box monitoring; cardinality & dimensionality intro; SLI/SLO/SLA overview; telemetry signal correlation (exemplars linking metrics->traces)." },
  { slug: 'metric-types-and-dimensional-data-model', name: 'Metric Types & the Dimensional Data Model', hints: "metric types — counter, gauge, histogram, summary — semantics & when to use each; the dimensional model (metric name + labels/tags = time series); why every unique label combo is a distinct series (cardinality); histograms vs summaries (client-side quantiles vs server-side aggregatable buckets), Prometheus native/exponential histograms; rate of a counter; cumulative vs delta temporality (Prometheus cumulative vs OTel delta); counter resets & rate() handling; aggregation across dimensions; naming conventions & base units." },
  { slug: 'structured-logging-and-log-levels', name: 'Structured Logging & Log Levels', hints: "unstructured vs STRUCTURED logging (JSON/key-value, machine-parseable); log levels (TRACE/DEBUG/INFO/WARN/ERROR) & when to use each; correlation/trace IDs in logs (MDC, linking logs to traces); what to log / what NOT to log (PII, secrets, tokens) & redaction; contextual fields; sampling logs; canonical log lines (one wide event per request); logging performance (async appenders, don't log in hot loops); log-vs-metric-vs-trace choice; SLF4J/Logback/Log4j2 as examples; the 'logs are expensive' reality." },
  { slug: 'log-aggregation-and-analysis', name: 'Log Aggregation & Analysis (ELK / Loki)', hints: "centralized logging pipeline (ship->parse->index->store->query); ELK/Elastic Stack (Beats/Logstash ingest, Elasticsearch inverted index, Kibana); Grafana Loki (label-based indexing, does NOT full-text index — indexes labels only, stores compressed chunks; LogQL); Fluentd/Fluent Bit/Vector as collectors/forwarders; parsing (grok, JSON); index vs label cardinality cost; retention & tiering (hot/warm/cold); log-based metrics; ELK vs Loki trade-off (full-text index cost vs cheap label index); structured logs make aggregation cheap." },
  { slug: 'distributed-tracing-concepts-and-context-propagation', name: 'Distributed Tracing Concepts & Context Propagation', hints: "trace/span/span-context model; parent-child & span links; trace as a DAG/waterfall; context propagation IN-process (thread-local/context) and CROSS-process via headers; W3C Trace Context (traceparent: version-trace_id-span_id-flags; tracestate); B3 (Zipkin) headers & baggage; instrumentation points; how a trace gets stitched across services; sampling decision propagation (sampled flag); clock skew across spans; async/messaging context propagation; why tracing reveals latency breakdown & service dependencies." },
  { slug: 'opentelemetry-signals-and-instrumentation', name: 'OpenTelemetry Signals & Instrumentation', hints: "OTel as vendor-neutral standard (merge of OpenTracing+OpenCensus); the signals (traces, metrics, logs, + profiling emerging); API vs SDK separation; auto vs manual instrumentation (agents/bytecode vs explicit spans); semantic conventions (why standardized attribute names matter); Resource (service.name etc.); OTLP protocol (gRPC/HTTP, the wire format); exporters; propagators; context & baggage; the Collector's role (receive/process/export); instrumentation libraries; spec stability per signal; migrating from vendor SDKs." },
  { slug: 'opentelemetry-collector-and-pipelines', name: 'OpenTelemetry Collector & Telemetry Pipelines', hints: "the Collector architecture — receivers, processors, exporters, connectors; pipelines per signal; agent (sidecar/daemonset) vs gateway deployment; batching, memory_limiter, retry/queue; tail-based sampling in the collector (needs full trace -> gateway with load-balancing exporter by trace ID); attribute/resource processors (redaction, enrichment); filtering & transform (OTTL); fan-out to multiple backends; why a collector (decouple app from backend, reduce egress, central policy); scaling the collector; OTLP in/out." },
  { slug: 'instrumentation-with-micrometer-and-metrics-libraries', name: 'Instrumentation with Micrometer & Metrics Libraries', hints: "Micrometer as a metrics facade (SLF4J-for-metrics) with registry backends (Prometheus, OTLP, etc.); meter types (Counter, Gauge, Timer, DistributionSummary, LongTaskTimer); Timer & histogram/percentile config (client-side percentiles vs server-side histogram buckets, publishPercentileHistogram, SLOs boundaries); tags/dimensions & the meter naming convention; common tags; base units; MeterBinder & auto-instrumentation (JVM/system metrics); Spring Boot Actuator + Micrometer integration (pointer); avoiding high-cardinality tags; the @Timed annotation." },
  { slug: 'prometheus-architecture-and-scraping', name: 'Prometheus Architecture & Scraping', hints: "pull/scrape model (why pull over push) & /metrics endpoint exposition format; service discovery (k8s/consul/file_sd) & relabeling (relabel_configs vs metric_relabel_configs); the TSDB (head block, WAL, 2h blocks, compaction, retention); scrape_interval/timeout & staleness; targets/jobs/instances; the Pushgateway (for batch jobs — and why NOT for general use); federation & remote_write/remote_read (long-term storage: Thanos/Cortex/Mimir); labels added at scrape (job/instance); high availability (run 2 identical); why Prometheus is single-node & how remote storage scales it." },
  { slug: 'promql-querying-and-recording-rules', name: 'PromQL Querying & Recording Rules', hints: "instant vs range vectors; selectors & label matchers (=,!=,=~,!~); rate() vs irate() vs increase() (and why rate on a counter, extrapolation, why not on gauges); aggregation operators (sum/avg/max by/without) & the grouping; histogram_quantile() over _bucket + le label; offset & @ modifier; subqueries; vector matching (on/ignoring, group_left/group_right for many-to-one); recording rules (precompute expensive queries) & naming convention (level:metric:operation); avoiding staleness/counter-reset pitfalls; common mistakes (avg of averages, rate of a gauge)." },
  { slug: 'jaeger-and-distributed-trace-analysis', name: 'Jaeger & Distributed Trace Analysis', hints: "Jaeger architecture (agent/collector/query/UI, storage backends Cassandra/Elasticsearch); trace ingestion (OTLP now); reading a trace waterfall — critical path, span duration vs self-time, gaps (network/queueing vs work); identifying latency bottlenecks, N+1 calls, serial vs parallel spans; span tags/logs/events; service dependency graph; trace comparison; sampling's effect on what you can find; root-cause via traces (which service/span owns the latency); correlating traces with logs/metrics (trace ID)." },
  { slug: 'dashboards-and-visualization-with-grafana', name: 'Dashboards & Visualization with Grafana', hints: "Grafana as multi-source viz; data sources (Prometheus/Loki/Tempo/etc.); panels & visualization types; template variables (dynamic dashboards); the RED/USE dashboard patterns; dashboard design principles (most-important-at-top, consistent time range, avoid clutter, link drill-downs); annotations; alerting in Grafana (unified alerting) vs Alertmanager; exemplars (jump metric->trace); mixed data sources; dashboards-as-code (provisioning/JSON); avoiding vanity metrics; what makes a good on-call dashboard." },
  { slug: 'alerting-rules-and-alertmanager', name: 'Alerting Rules & Alertmanager', hints: "Prometheus alerting rules (expr, for: duration to avoid flapping, labels/annotations); the split: Prometheus evaluates -> Alertmanager routes; Alertmanager grouping (group_by/group_wait/group_interval), inhibition (suppress downstream when upstream fires), silences, routing tree & receivers (PagerDuty/Slack/email), repeat_interval; deduplication across HA Prometheus pairs; severity levels; alert design (alert on symptoms not causes); avoiding alert storms; pending vs firing states; runbook links in annotations." },
  { slug: 'slo-based-alerting-and-error-budgets', name: 'SLO-Based Alerting & Error Budgets', hints: "SLI (a good ratio: good events/valid events) vs SLO (target) vs SLA (contract w/ penalty); error budget = 1 - SLO & budget = allowed unreliability; the availability math (99.9% = 43.2 min/month); MULTI-WINDOW MULTI-BURN-RATE alerting (fast-burn page vs slow-burn ticket, why single-threshold alerts are bad — either too noisy or too slow); burn rate = how fast you consume budget; choosing SLIs (latency threshold, availability); error-budget policy (freeze features when exhausted); the Google SRE workbook approach; request-based vs windows-based SLO; alerting on budget burn, not raw thresholds." },
  { slug: 'on-call-alert-fatigue-and-actionable-signals', name: 'On-Call, Alert Fatigue & Actionable Signals', hints: "what makes an alert ACTIONABLE (urgent + actionable + human-required, else it's noise); symptom-based vs cause-based alerting; alert fatigue causes & cost (missed real alerts, burnout); tuning: delete/aggregate/route non-actionable alerts; page vs ticket vs log-only; every page must have a runbook; signal-to-noise; alert review/retro; the 'every alert wakes a human at 3am' test; escalation basics (pointer to reliability-ops for full incident process); toil from alerts; SLO-based paging reduces noise." },
  { slug: 'sampling-cardinality-and-telemetry-cost-management', name: 'Sampling, Cardinality & Telemetry Cost Management', hints: "the cost driver: CARDINALITY (unique label combinations) & the cardinality explosion (user_id/request_id as labels = disaster); head-based vs TAIL-based sampling (head=decide at start, cheap, may miss errors; tail=decide after full trace seen, keeps errors/slow, needs buffering); probabilistic vs rate-limiting vs adaptive sampling; log sampling; metric cardinality limits & why high-cardinality belongs in traces/wide-events not metric labels; drop/aggregate at the collector; retention/downsampling for cost; exemplars as a cheap metric->trace bridge; the observability cost problem at scale." },
  { slug: 'apm-ebpf-and-continuous-profiling', name: 'APM, eBPF & Continuous Profiling', hints: "APM (application performance monitoring) — auto-instrumented traces+metrics+errors (Datadog/New Relic/Dynatrace/Elastic APM), the vendor-agent model; eBPF — kernel-level, zero-code instrumentation (in-kernel programs safely observe syscalls/network/CPU without app changes), used for auto-instrumentation, network observability (Cilium/Pixie), profiling; continuous profiling — always-on low-overhead CPU/memory profiles in production (Parca/Pyroscope/pprof, flame graphs as a signal); when eBPF beats SDK instrumentation & its limits; profiling as the '4th pillar'; cross-reference performance-engineering for flame-graph reading technique." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior backend/SRE engineer and interview coach authoring interview-grade study material for the Observability topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / frequently-asked subtopics to cover for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . This is Pass 1 — aim for 40-60 solid MCQs.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer verifying interview content for the Observability topic "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `The files are at ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml . Read BOTH.\n\n` +
    `Check and FIX IN PLACE (using Edit/Write) any of:\n` +
    `1) FACTUAL ERRORS in concepts.md or in MCQ answers/explanations. Web-research anything uncertain — PromQL semantics (rate vs irate vs increase, histogram_quantile + le, group_left, avg-of-avg pitfall), metric-type semantics (counter/gauge/histogram/summary, cumulative vs delta temporality), W3C Trace Context traceparent format, head vs tail sampling, error-budget/burn-rate math (99.9% = 43.2 min/month), Loki indexes labels not full text, Prometheus pull model & TSDB. A wrong 'answer' index or wrong PromQL/SLO-math claim is the WORST defect — fix it.\n` +
    `2) SCOPE DRIFT: keep it observability toolchain + signal mechanics. If it re-teaches the system-design monitoring overview, or the incident/on-call human PROCESS (that's the upcoming reliability-ops domain), or deep flame-graph reading technique (performance-engineering), trim to a pointer.\n` +
    `3) SCHEMA violations in questions.yaml: valid YAML; top-level keys topic/domain(observability)/topic_slug(${t.slug})/version/questions; each question has id (prefix '${t.slug}-', unique, 3-digit seq), difficulty in {beginner,intermediate,advanced,expert}, question, 3-5 options, 0-based 'answer' in range, explanation; ids unique; correct-option position VARIED (rebalance if any index >40% OR if a trivially-guessable repeating cycle).\n` +
    `4) Every 'ref: concepts.md#anchor' must resolve to an actual '## ' heading (GitHub slug rules). Any Mermaid blocks must be valid.\n` +
    `5) COVERAGE: at least 40 questions, every subtopic represented, mixed difficulty, some scenario-style (PromQL/trace/alert/error-budget) questions present. Add if thin.\n\n` +
    `After fixing, return a one-line verdict: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
