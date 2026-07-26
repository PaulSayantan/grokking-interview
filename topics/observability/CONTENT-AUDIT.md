# observability — Content Audit

**Executive summary.** The observability domain is in strong shape: across all 17 subtopics the writing is intuition-first, senior-depth, and interview-shaped, with average clarity **4.82/5** and depth **4.35/5**. No subtopic is flagged **high** refine-priority; **15 are medium** and **2 are low** (`distributed-tracing-concepts-and-context-propagation`, `observability-fundamentals-and-three-pillars`, both nearly publication-ready). The single systemic weakness is the domain's own #2 priority — **worked examples** — which drags the average example score down to **3.29/5**. Nearly every file asserts a quantitative claim (histogram quantile interpolation, "you can't average p99", burn-rate firing, telemetry cost/capacity) in prose and then never traces it with numbers-in/numbers-out. Three files bottom out at example-score 2 (`promql`, `apm-ebpf-and-continuous-profiling`, `opentelemetry-collector-and-pipelines`) and are the clearest refinement targets. Secondary systemic themes: a handful of genuine technical inaccuracies (5 files), promised-but-missing sections (4 files), undefined jargon (5 files), and universally deferred web-verification of version-specific facts (all 17). Headline takeaway: this domain needs **injection of concrete numeric walkthroughs**, not rewrites — the conceptual scaffolding is already excellent.

## Scorecard

Sorted high-priority first (none), then lowest total (clarity+example+depth) first.

| Subtopic | Clarity | Examples | Depth | Priority | Verdict |
|---|---|---|---|---|---|
| promql-querying-and-recording-rules | 4 | 2 | 4 | medium | Gotcha-rich but hardest mechanics (rate extrapolation, histogram interpolation, group_left, avg-of-averages) never traced numerically |
| apm-ebpf-and-continuous-profiling | 5 | 2 | 4 | medium | Exceptionally clear on trade-offs but almost no numbers-in/numbers-out; sampling→CPU-time intuition never quantified |
| opentelemetry-collector-and-pipelines | 5 | 2 | 4 | medium | Great concepts; nearly every quantitative claim (batching, egress, tail-sampling sizing, memory_limiter) is prose-only |
| dashboards-and-visualization-with-grafana | 4 | 3 | 4 | medium | Signature "heatmap beats average" claim never shown with numbers; provisioning promised but no section |
| opentelemetry-signals-and-instrumentation | 4 | 3 | 4 | medium | Teaches the "why" well but temporality, exponential histograms, correlation lack worked walkthroughs; no code shown |
| prometheus-architecture-and-scraping | 5 | 3 | 4 | medium | Cardinality (its most-stressed concept) and capacity numbers asserted, never quantified |
| sampling-cardinality-and-telemetry-cost-management | 5 | 3 | 4 | medium | Promises an exemplars section and cost math it never delivers |
| structured-logging-and-log-levels | 5 | 3 | 4 | medium | Qualitatively deep; log-cost and sampling-reduction math stay abstract |
| metric-types-and-dimensional-data-model | 5 | 3 | 5 | medium | Senior-grade; quantile interpolation, avg-of-p99, exponential-bucket math all prose-only |
| jaeger-and-distributed-trace-analysis | 5 | 4 | 4 | medium | Headline moves (critical path, self-time) never walked numerically; clock-skew + parallel self-time gotchas missing |
| log-aggregation-and-analysis | 5 | 4 | 4 | medium | Central cost claims never grounded in numbers; multiline/PII/OpenSearch gaps |
| slo-based-alerting-and-error-budgets | 5 | 4 | 4 | medium | Clean math but rolling-vs-calendar window and how-to-set-a-target untouched; recording rule never shown |
| alerting-rules-and-alertmanager | 5 | 4 | 5 | medium | Excellent; missing dead-man's-switch/Watchdog and a fully-traced burn-rate example |
| instrumentation-with-micrometer-and-metrics-libraries | 5 | 4 | 5 | medium | Strong; "can't average p99 across instances" asserted but never shown numerically |
| on-call-alert-fatigue-and-actionable-signals | 5 | 4 | 5 | medium | Excellent; one misleading "self-scales to load" burn-rate claim conflates traffic with duration |
| distributed-tracing-concepts-and-context-propagation | 5 | 4 | 5 | low | Interview-grade; only consistent-probability sampling and clock-skew adjustment lack numeric walkthroughs |
| observability-fundamentals-and-three-pillars | 5 | 4 | 5 | low | Polished, learn-from-cold; minor dangling profiling thread and a numbers-free percentile point |

## Systemic issues

Clustered across subtopics, worst-impact first.

### 1. Missing numbers-in/numbers-out worked examples — **~15 of 17 files** (THE dominant theme)
This is the domain's declared #2 refinement priority and its biggest gap. The pattern is identical everywhere: the concept is explained well in prose, then the pivotal quantitative claim is asserted without a traced calculation. Sub-clusters:
- **Percentile / histogram_quantile interpolation never computed** — `metric-types` (has perfect bucket numbers `le=0.1:24054…` but never uses them), `prometheus-architecture`, `promql`, `micrometer`. Four files independently describe "linear interpolation within the bucket" and none show the arithmetic.
- **"You cannot average p99 across instances" asserted, never shown** — `micrometer`, `metric-types`, plus Grafana's "averages hide bimodality." Same fix everywhere: a two-instance (idle vs hammered) counterexample.
- **Burn-rate firing decision / the magic constant 14.4 not traced** — `alerting-rules`, `on-call`, `slo-based-alerting`. Formulas and threshold tables exist; no file plugs in an observed error ratio and resolves the comparison true/false, and 14.4's derivation is given as "the SRE Workbook says."
- **Telemetry cost / capacity back-of-envelope missing** — `log-aggregation` (whole thesis is cost, zero dollars/GB shown), `opentelemetry-collector`, `sampling-cardinality`, `structured-logging`, `prometheus` (no RAM/disk sizing rule). "Telemetry can cost more than the service" is never made concrete.
- **Counter-reset handling not traced** — `metric-types`, `prometheus-architecture`, `promql` all say rate() "detects and corrects resets" without a `100→150→(restart)→20` walkthrough.
- **Others**: CPU stack-sampling→time approximation (`apm-ebpf`), cumulative-vs-delta temporality on the wire (`otel-signals`), `$__rate_interval` resolution (`dashboards`), consistent-probability-sampling bit math (`distributed-tracing`).

### 2. Version-specific facts deferred for web verification — **all 17 files** (`needs_web_verification=true`)
Every file carries at least one factual claim flagged for a verification pass. Notable: Alertmanager repeat_interval rounding, W3C trace-flags bit definitions and tracestate length limits (`distributed-tracing`), Micrometer defaults + `@Timed` meta-annotations, Jaeger default sampling rate (0.001?), Loki bloom-filter GA status (`log-aggregation`), OTel Collector self-telemetry metric names (`otel-collector`), Prometheus/`@`-modifier/subquery version numbers (`promql`), zap sampler + tailsampling defaults (`sampling-cardinality`), Logback `discardingThreshold` (`structured-logging`), Kalman 1960 citation (`obs-fundamentals`), CNCF activity ranking (`otel-signals`).

### 3. Genuine technical inaccuracies (correctness, medium severity) — **5 files**
These are wrong-as-written and can mislead a candidate; they should be fixed regardless of priority:
- `on-call`: the "self-scales to load" bullet conflates traffic volume with duration — a sustained 5% error *ratio* is ~50× burn at any traffic level; what makes a blip cheap is short duration, not low traffic.
- `promql`: the `group_left(version)` explanation inverts which side labels are copied from (they come from the *right/one* side, not the many side).
- `jaeger`: self-time defined as duration minus the *sum* of child durations — only correct for serial children; parallel/overlapping children need the wall-clock *union*, else self-time can go negative.
- `grafana`: multi-value variable interpolation muddled/wrong — conflates default pipe-join `=~"a|b|c"` with `{{.}}` Go-template syntax.
- `otel-collector`: head sampling described as "in the SDK" only — the Collector's `probabilistic_sampler` processor also does head sampling.

### 4. Promised-but-missing sections / dangling threads — **4 files**
A concept is announced in the intro/takeaway and never delivered: `sampling-cardinality` (exemplars named as the star bridge concept in multiple places, no `## Exemplars` section), `dashboards` (provisioning / dashboards-as-code promised, left a stub), `observability-fundamentals` (continuous profiling promised in intro, never mentioned again), `slo-based-alerting` (recording rules like `job:slo_errors:ratio_rate1h` referenced repeatedly but never defined).

### 5. Undefined / unexpanded jargon on first use — **5 files**
`apm-ebpf` (BTF, off-CPU profiling), `micrometer` (HdrHistogram), `otel-signals` (exemplar — the linchpin of its correlation story, never defined), `structured-logging` (Grok), `log-aggregation` (implicit). Violates the repo's define-on-first-use bar.

### 6. Native/exponential histogram mechanism asserted, not explained — **3 files**
`metric-types`, `prometheus-architecture`, `otel-signals` all praise exponential/native histograms ("no bucket pre-selection," "storage-efficient") without the one-line mechanism (buckets defined by an exponential schema → fixed relative error). Reads as buzzword assertion.

### 7. Clock skew across hosts — **3 files, inconsistent coverage**
`distributed-tracing` explains it (but without numbers), while `jaeger` and `structured-logging` omit it entirely — despite it being a classic "why does this child start before its parent?" / "how do you order log lines from many hosts?" senior probe.

### 8. Scattered missing senior operational gotchas
Notable one-offs worth capturing: dead-man's-switch/Watchdog + `resolve_timeout` (`alerting`), PII redaction + multiline stack traces + OpenSearch/licensing (`log-aggregation`), `remote_write` WAL/back-pressure behavior (`prometheus`), tail-sampling ring resharding on rescale + spanmetrics cardinality (`otel-collector`), NaN burn-rate on low-traffic services + rolling-vs-calendar windows + how to pick the SLO target (`slo-based-alerting`), high-cardinality `label_values` dropdowns (`dashboards`).

### 9. Visual/diagram mismatches — **3 files**
`jaeger` teaches how to read a nested-bar waterfall but illustrates it with a message `sequenceDiagram`; `grafana` and `promql` describe layouts/interpolation that would land far better as a small diagram.

## High-priority subtopics

**No subtopic carries `refine_priority: high`** — the domain has no crisis files. However, the refinement bar weights worked examples heavily, and by that lens the effective top tier is the cluster scoring **example ≤ 2–3 with high-severity example gaps**. Treat these as the practical high-priority set.

### promql-querying-and-recording-rules (5/2/4 — worst total)
1. **[high] rate()/irate()/increase() extrapolation never traced** (`rate() vs irate() vs increase()`): the most-probed PromQL mechanic. Fix: trace samples `t=[0:100,15:112,30:120,45:135]` on a 15s scrape over a 60s window → show raw delta, extrapolation to the boundary (~0.78/s, `increase()`≈46.7 non-integer), then a second trace with a reset showing the pre-reset increment added back.
2. **[high] histogram_quantile interpolation never computed** (`histogram_quantile() over _bucket`): fix with worked buckets (`le=0.1:0, 0.5:80, 1:90, +Inf:100`, ask p95) using the interpolation formula `lower + (upper-lower)*((rank-count_below)/count_in_bucket)`.
3. **[medium, correctness] `group_left(version)` label-copy direction inverted**: rewrite so the left is the many side keeping its labels, and the listed label is copied from the *right (one)* side.
4. **[medium] join example is actually one-to-one** so it can't demonstrate the many-to-one error being taught; replace with a genuine many-to-one join and show before/after label sets.
5. **[medium] avg-of-averages trap argued only in prose**: add the 2-instance weighted example (10% of 1000 vs 50% of 10 → avg 30% wrong vs true 10.4%).

### apm-ebpf-and-continuous-profiling (5/2/4)
1. **[high] stack-sampling→CPU-time approximation never quantified**: fix with "1 CPU-second @ 100 Hz = 100 captures; `serializeJSON` in 60 → ~60% on-CPU; a 0.5ms function has ~5% catch probability."
2. **[high] no concrete produced span/RED-metric shown** for either agent-bytecode or eBPF instrumentation: add a `GET /checkout`→Postgres walkthrough (servlet→JDBC→outbound HTTP spans with durations) vs the eBPF RED line.
3. **[medium, jargon] off-CPU profiling and BTF undefined**: one-line each (off-CPU = time blocked/waiting, invisible to a CPU flame graph; BTF = BPF Type Format enabling CO-RE relocation).
4. **[medium, gotcha] storage/cardinality/cost of always-on fleet-wide profiling missing** for an observability-domain topic.

### opentelemetry-collector-and-pipelines (5/2/4)
1. **[high] batching + egress-reduction claims are pure prose**: add before/after (10k spans/s unbatched → ~1–2 req/s batched; ~5–10× gzip on batched OTLP; one GB/day × cross-region $/GB egress figure).
2. **[high] tail-sampling buffer sizing has no config or math**: add real values (`decision_wait: 10s, num_traces: 100000`) and the memory back-of-envelope (5k traces/s × 10s × 20 spans × 1KB ≈ ~1GB buffer).
3. **[medium, correctness] head sampling described as SDK-only** — add the Collector `probabilistic_sampler` path.
4. **[medium, depth] tier-2 resharding-on-rescale gotcha and spanmetrics cardinality explosion** both missing.
5. **[medium] `memory_limiter` soft/hard limits never configured** (`limit_mib`/`spike_limit_mib`) nor tied to `GOMEMLIMIT`.

### opentelemetry-signals-and-instrumentation (4/3/4)
1. **[high] cumulative vs delta temporality prose-only**: add the 4-row table (counts 100/150/175 → cumulative vs delta exports 100/50/25) and restart behavior.
2. **[high] exponential/native histograms asserted, not explained**: add the base-2 bucket intuition + 2–3 example boundaries at a given scale.
3. **[medium] cross-signal correlation — OTel's "differentiator" — never traced**: walk one `trace_id` across exemplar→trace waterfall→log line.
4. **[medium, jargon] "exemplar" never defined** despite being the linchpin of the correlation story.
5. **[medium] no instrumentation code shown at all** for the API/SDK/manual-span story.

### metric-types-and-dimensional-data-model (5/3/5)
1. **[high] histogram_quantile computation never shown** despite the file already containing ideal bucket numbers — plug them in (p95 rank 32858.6 → interpolate within [0.3,1.0] ≈ 0.35s).
2. **[medium] "can't average p99" not shown numerically**; **[medium] exponential-bucket `base=2**(2**-scale)` never instantiated** (scale=3 → ~1.0905, ~9% per bucket); **[low] counter-reset sequence not traced**.

*(Also carrying high-severity example gaps at example-score 3–4, next in line: `prometheus-architecture` (cardinality never quantified), `dashboards` (heatmap-vs-average + missing provisioning section), `sampling-cardinality` (missing exemplars section + cost math), `log-aggregation` (cost numbers), `structured-logging` (log-cost math), `jaeger` (worked trace + clock-skew/self-time), `slo-based-alerting` (rolling-vs-calendar + recording rule + traced scenario), `micrometer` (avg-p99 counterexample). See the scorecard for full ordering.)*

## Refinement plan

Recommended order of attack — front-load the highest-leverage, lowest-score files, and batch the cross-cutting themes so the same fix pattern is applied consistently.

1. **Fix the 5 correctness bugs first** (fast, high trust-impact, independent of everything else): `on-call` self-scaling claim, `promql` group_left direction, `jaeger` self-time union, `grafana` multi-value interpolation, `otel-collector` head-sampling-in-SDK. These are wrong-as-written.

2. **Worked-examples sweep — the main effort.** Attack in scorecard order, worst total first: `promql` → `apm-ebpf` → `opentelemetry-collector` → `dashboards` → `otel-signals` → `prometheus` → `sampling-cardinality` → `structured-logging` → `metric-types`, then the example-4 files (`jaeger`, `log-aggregation`, `slo`, `alerting`, `micrometer`, `on-call`). Reuse shared templates: **one** two-instance "you can't average p99" example (serves `micrometer`, `metric-types`), **one** histogram_quantile interpolation walkthrough (serves `metric-types`, `prometheus`, `promql`, `micrometer`), **one** burn-rate traced firing scenario + 14.4 derivation (serves `alerting`, `on-call`, `slo`), **one** counter-reset trace (serves `metric-types`, `prometheus`, `promql`), and a **cost/capacity back-of-envelope pattern** (serves `log-aggregation`, `otel-collector`, `sampling-cardinality`, `structured-logging`, `prometheus`).

3. **Fill the 4 promised-but-missing sections**: `sampling-cardinality` exemplars section (also closes the `otel-signals` "exemplar undefined" gap and the domain-wide correlation story), `dashboards` provisioning, `slo` recording-rules block, `observability-fundamentals` profiling thread.

4. **Jargon + native-histogram mechanism passes** (batched): expand BTF/off-CPU (`apm-ebpf`), HdrHistogram (`micrometer`), Grok (`structured-logging`), exemplar (`otel-signals`); add the one-line exponential-histogram schema explanation to `metric-types`/`prometheus`/`otel-signals`.

5. **Gotcha top-ups**: clock skew (`jaeger`, `structured-logging`), Watchdog/dead-man's-switch + resolve_timeout (`alerting`), PII/multiline/OpenSearch (`log-aggregation`), remote_write WAL (`prometheus`), rolling-vs-calendar + SLO-target-setting + NaN low-traffic (`slo`).

6. **Web-verification pass — LAST, covers all 17 files** (every file has `needs_web_verification: true`). Do this after content edits so version-specific numbers are confirmed once: Alertmanager rounding, W3C trace-flags/tracestate limits, Micrometer/`@Timed` defaults, Jaeger default sampling rate, Loki bloom-filter GA, OTel Collector metric names, Prometheus feature version numbers, zap/tailsampling defaults, Logback discardingThreshold, Kalman citation, CNCF ranking.

**Files read: 17 of 17. Missing/unreadable: 0.**
