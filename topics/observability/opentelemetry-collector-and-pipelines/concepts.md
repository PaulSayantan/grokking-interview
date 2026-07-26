# OpenTelemetry Collector & Telemetry Pipelines

The OpenTelemetry Collector is a vendor-neutral proxy/agent that **receives, processes, and
exports** telemetry (traces, metrics, logs). It sits between your instrumented applications and
your observability backends, giving you one place to enforce policy — batching, sampling,
redaction, enrichment, routing — without changing or redeploying application code. This topic
covers how the Collector is wired (receivers → processors → exporters, plus connectors and
extensions), how pipelines are organized per signal, the two canonical deployment shapes
(agent vs gateway), and the reliability/scaling mechanics interviewers probe.

> [!INTERVIEW]
> The single most common Collector question is *"why run a Collector at all instead of exporting
> straight to the backend?"* Have the four-word answer ready: **decouple, batch, enrich, control**
> (plus reduce egress and centralize secrets). The second most common is the tail-sampling
> gotcha: tail sampling needs the **whole** trace on **one** collector, which forces a
> trace-ID-aware load-balancing tier.

Related topics: `opentelemetry-signals-and-instrumentation` (the SDK/API side that *produces* the
OTLP the Collector consumes), `prometheus-architecture-and-scraping` (scrape model the Collector's
`prometheusreceiver` mirrors), and `sampling-cardinality-and-telemetry-cost-management` (the
cost/sampling policy the Collector enforces).

## Why run a Collector

Applications *can* export OTLP directly to a backend (SaaS or self-hosted). A Collector is an
optional but strongly recommended intermediary. The value:

- **Decouple app from backend.** The app only speaks OTLP to `localhost`/a known endpoint. You can
  swap backends, add a second backend, change sampling, or rotate credentials by editing Collector
  config — no app redeploy. This is the biggest architectural win: instrumentation lifecycle is
  decoupled from vendor/backend lifecycle.
- **Offload work from the app process.** Batching, retry, compression, and queueing happen in the
  Collector, not in the request-serving process, so a slow backend does not add latency or memory
  pressure to your service.
- **Reduce egress and cost.** Batch + compress once at the edge; drop/sample noisy data before it
  crosses a network/region boundary you pay for.
- **Central policy.** PII redaction, attribute enrichment (add `k8s.*`, `cloud.region`), filtering,
  and tail-based sampling are applied uniformly and are auditable in one config, instead of relying
  on every service getting it right.
- **Central secrets.** The backend API key lives in the Collector, not baked into every service.
- **Protocol/format translation.** Ingest Prometheus, Jaeger, Zipkin, StatsD, Fluent Forward, etc.,
  and normalize to OTLP; fan out to backends that speak different protocols.

> [!TIP]
> "Reduce egress" and "central secrets" are the answers that make you sound like you have run this
> in production. Direct-to-backend export is fine for a demo or a tiny service; at scale the
> Collector is table stakes.

**Worked example — what "reduce egress" is worth.** Take one service emitting **10,000 spans/s**,
each ~**1 KB** serialized OTLP protobuf → **10 MB/s** = 10 MB/s × 86,400 s = **864 GB/day** of raw
telemetry. If that crosses a region/backend boundary billed at **~$0.02/GB**, exporting it straight
from the SDK costs 864 × $0.02 = **$17.28/day ≈ $518/month** — just to move the bytes. Route it
through a Collector and stack the wins:

| Stage | Bytes/day | Cross-region cost/month |
|---|---|---|
| Direct SDK export (raw, no batch) | 864 GB | ~$518 |
| + `batch` and gzip (~8× on repeated span structure) | ~108 GB | ~$65 |
| + drop 90% via head/tail sampling | ~11 GB | ~$6.50 |

Same telemetry, **~80× cheaper egress**, and the app never paid the compression/retry CPU.

## Collector architecture: receivers, processors, exporters

The Collector is built from four component *kinds* plus **extensions**. Data flows left to right:

```mermaid
flowchart LR
  subgraph Pipeline [traces pipeline]
    R1[OTLP receiver] --> P1[memory_limiter]
    R2[Jaeger receiver] --> P1
    P1 --> P2[attributes / resource] --> P3[batch] --> FO(( fan-out ))
    FO --> E1[OTLP exporter → vendor A]
    FO --> E2[Zipkin exporter → vendor B]
  end
  EXT[[extensions: health_check, pprof, zpages]]
```

- **Receivers** — how data gets *in*. Push-based (they listen on a port, e.g. `otlp`, `jaeger`,
  `zipkin`, `fluentforward`) or pull-based (they scrape, e.g. `prometheus`, `hostmetrics`,
  `kubeletstats`). One receiver instance can feed multiple pipelines.
- **Processors** — run **in the order listed** in the pipeline. They transform, drop, enrich, or
  batch data. Each pipeline gets its **own** processor instances even if two pipelines reference the
  same config key, so ordering and state are per-pipeline.
- **Exporters** — how data gets *out* (`otlp`, `otlphttp`, `prometheusremotewrite`, `debug`,
  vendor exporters). The last processor fans out a copy of each item to **every** exporter in the
  pipeline.
- **Connectors** — a component that is an **exporter in one pipeline and a receiver in another**,
  linking pipelines together (see below).
- **Extensions** — capabilities that are *not* part of the data path: `health_check` (liveness),
  `pprof` (profiling), `zpages` (in-process debug pages), `basicauth`/`oauth2client` (auth),
  `file_storage` (persistent queue). They observe/support the Collector but never touch telemetry.

> [!WARNING]
> A receiver shared across pipelines is a single instance feeding a synchronous fan-out. If one
> pipeline's processor **blocks** (e.g. a full sending queue applying backpressure), the other
> pipelines on that receiver are blocked too. Isolate high-risk paths on separate receivers/ports
> if you need independence.

## Pipelines per signal

A **pipeline** is a named path `receivers → processors → exporters` for **one signal type**:
`traces`, `metrics`, or `logs`. Every component in a pipeline must support that signal — you cannot
put a metrics-only processor in a traces pipeline (the Collector errors at config load with
`ErrSignalNotSupported`). You can run **multiple pipelines of the same type** (e.g. `traces` and
`traces/tailsampled`) to apply different processing to different flows.

```yaml
service:
  extensions: [health_check, pprof]
  pipelines:
    traces:
      receivers:  [otlp]
      processors: [memory_limiter, batch]
      exporters:  [otlp/tempo]
    metrics:
      receivers:  [otlp, prometheus]
      processors: [memory_limiter, batch]
      exporters:  [prometheusremotewrite]
    logs:
      receivers:  [otlp]
      processors: [memory_limiter, batch]
      exporters:  [otlphttp/loki]
```

Note the `service::pipelines` block is what *activates* components — a receiver/processor/exporter
defined in config but not referenced by any pipeline is **not** instantiated.

## Receivers and OTLP in/out

The **OTLP receiver** is the canonical entry point. OTLP (OpenTelemetry Protocol) has two
transports:

- **gRPC** on port **4317** (`otlp` receiver `protocols: grpc`) — the default for SDK exporters;
  efficient, streaming, HTTP/2.
- **HTTP/protobuf** (and JSON) on port **4318** (`protocols: http`) — for environments where gRPC
  is awkward (browsers, some proxies).

OTLP is a protobuf schema (`ExportTraceServiceRequest`, etc.) carrying **Resource** (the entity
producing telemetry: `service.name`, `k8s.pod.name`), **Scope** (the instrumentation library), and
the signal data. The Collector both **receives** OTLP (from SDKs or upstream collectors) and
**exports** OTLP (to backends or a downstream gateway) — collectors chain naturally over OTLP.

Pull-based receivers invert control: `prometheusreceiver` scrapes `/metrics` endpoints on an
interval and can consume a Prometheus `scrape_config` almost verbatim, letting the Collector
replace a Prometheus server's scraping role and remote-write onward.

## Batching, memory_limiter, and ordering

Two processors appear in almost every production pipeline, and **their order matters**:

- **`memory_limiter`** — periodically checks the Collector's memory. At a **soft limit** it starts
  **refusing** incoming data (returning errors that apply backpressure to receivers/clients); above
  a **hard limit** it also forces Go GC. It is the Collector's OOM guardrail. Docs say put it
  **first** so backpressure reaches receivers before memory is already committed to batches.
- **`batch`** — groups telemetry into larger payloads by size (`send_batch_size`) and/or time
  (`timeout`, e.g. `200ms`). Batching drastically improves compression ratio and throughput and
  reduces the number of outbound requests. It should come **after** `memory_limiter` (and after
  sampling/filtering, so you do not batch data you are about to drop).

Recommended baseline order: `memory_limiter` → (sampling/filter/transform) → `attributes/resource`
→ `batch`. Put `batch` late so it batches the *final* shape of data.

**Worked example — how much batching actually buys you.** Same 10,000 spans/s. Un-batched, the
exporter opens roughly **one gRPC request per span** → **10,000 requests/s**, each carrying its own
HTTP/2 framing, and gzip on a single ~1 KB message barely compresses (the dictionary never fills).
Now add:

```yaml
processors:
  batch:
    send_batch_size: 8192      # flush when 8192 spans accumulate...
    timeout: 200ms             # ...or every 200ms, whichever comes first
```

At 10,000 spans/s the 200 ms timer fires first (10,000 × 0.2 = 2,000 spans < 8,192), so you flush
**~5 batches/s** — **10,000 → 5 requests/s, a 2,000× drop** in request count. And because the 2,000
spans in a batch share attribute *keys* (`http.method`, `service.name`, `k8s.pod.name` repeat over
and over), gzip's dictionary now has real redundancy to exploit and typically reaches **~5–10×**
compression, versus ~1× on the lone tiny messages. That single processor is where the 864 GB → ~108
GB egress line in the table above comes from.

**Worked example — sizing `memory_limiter`.** The soft limit is `limit_mib - spike_limit_mib`:

```yaml
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 4000          # hard limit
    spike_limit_mib: 800     # headroom for a single check-interval spike
    # → soft limit = 4000 - 800 = 3200 MiB
```

At ~**3,200 MiB** the limiter starts **refusing** data (backpressure to receivers); at **4,000 MiB**
it forces GC. Pair it with `GOMEMLIMIT` at ~80% of the hard limit — 0.8 × 4000 = **3,200 MiB** — so
the Go runtime GCs aggressively as you approach the ceiling instead of letting the heap sail past it.

> [!KEY-TAKEAWAY]
> `memory_limiter` first (protect the process), `batch` last (ship efficiently). Batching before
> dropping wastes CPU on data you discard; batching before `memory_limiter` means memory is already
> consumed before the guardrail can push back.

## Attribute, resource, and redaction processors

These enrich and sanitize telemetry centrally:

- **`resourceprocessor`** — modify **resource** attributes (the entity: service/host/pod). Common
  use: `insert`/`upsert` `deployment.environment=prod`, `cloud.region`.
- **`attributesprocessor`** — modify **span/metric/log** attributes: `insert`, `update`, `upsert`,
  `delete`, `hash`, `extract`. Common use: hash or delete PII (`user.email`), drop high-cardinality
  keys.
- **`redactionprocessor`** — allowlist-based scrubbing: keep only approved attribute keys and mask
  values matching patterns (credit cards, etc.). Stronger default-deny posture than `attributes`.
- **`k8sattributesprocessor`** — auto-enrich with Kubernetes metadata (`k8s.pod.name`,
  `k8s.namespace.name`, labels) by correlating source IP with the k8s API. This is why you often
  run the Collector as a DaemonSet agent — it can see the pod that sent the data.

Doing redaction/enrichment in the Collector means it is uniform and auditable, and PII can be
stripped **before** it ever leaves your trust boundary for a SaaS backend.

## Filtering and transform with OTTL

The **OpenTelemetry Transformation Language (OTTL)** is a small statement language used by the
`transformprocessor` and `filterprocessor` (and others) to manipulate telemetry by
path expressions and functions.

- **`filterprocessor`** — drop data matching a condition. Example: drop spans for health checks, or
  drop debug logs.
- **`transformprocessor`** — mutate data with OTTL statements: set/delete attributes, change
  severity, convert units, aggregate.

```yaml
processors:
  filter/health:
    error_mode: ignore
    traces:
      span:
        - 'attributes["http.route"] == "/healthz"'   # drop matching spans
  transform/pii:
    trace_statements:
      - context: span
        statements:
          - set(attributes["user.email"], "REDACTED") where attributes["user.email"] != nil
          - delete_key(attributes, "http.request.header.authorization")
```

OTTL contexts (`span`, `spanevent`, `metric`, `datapoint`, `log`, `resource`, `scope`) scope what
each statement can see and mutate. It is the modern, expressive replacement for many one-off
processors.

## Fan-out to multiple backends

Because the last processor sends a **copy to every exporter** in a pipeline, sending the same data
to two backends is trivial — list both exporters:

```yaml
service:
  pipelines:
    traces:
      receivers:  [otlp]
      processors: [batch]
      exporters:  [otlp/vendor-a, otlp/vendor-b, debug]
```

To send *different* data to different backends (e.g. all traces to A but only errors to B), use
**separate pipelines** with different processors, or a **routing connector**. Fan-out enables
migrations (dual-write to old + new backend), tee-ing to a cheap archive, and splitting by team.

## Connectors

A **connector** bridges two pipelines: it acts as an **exporter** at the end of one pipeline and a
**receiver** at the start of another. This lets you derive new telemetry or route between pipelines
without leaving the Collector. Key connectors:

- **`spanmetrics`** — consumes **traces**, produces **metrics** (RED metrics: request rate, error
  rate, duration histograms per service/operation). Exporter side sits in a traces pipeline;
  receiver side feeds a metrics pipeline. **Gotcha:** each `dimensions` entry becomes a metric
  **label**, and the series count is the *product* of label cardinalities. Keep dimensions bounded —
  `service.name` (50) × `operation` (20) × `status_code` (3) = **3,000 series**, fine. Add a raw
  `http.url` carrying path params or a `user.id` and cardinality explodes into the millions and
  melts your metrics backend. Normalize to `http.route` (`/users/{id}`) and never put unbounded
  attributes in `dimensions` (see `sampling-cardinality-and-telemetry-cost-management`).
- **`routing`** — reads an attribute and routes to different downstream pipelines (e.g. by tenant
  or `deployment.environment`).
- **`forward`** — plumbing to merge/split pipelines.
- **`count`** — counts spans/logs/metrics into a metric.

```mermaid
flowchart LR
  R[otlp receiver] --> Ptr[batch] --> SM{{spanmetrics connector}}
  SM -.exporter side.-> Btr[otlp → traces backend]
  SM ==receiver side==> Pm[metrics pipeline] --> Em[prometheusremotewrite]
```

```yaml
connectors:
  spanmetrics: {}
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlp/tempo, spanmetrics]     # connector as exporter
    metrics:
      receivers: [spanmetrics]                 # connector as receiver
      exporters: [prometheusremotewrite]
```

## Agent vs gateway deployment

There are two canonical deployment topologies, often combined:

| | **Agent** (collector) | **Gateway** (collector) |
|---|---|---|
| Location | Same host/node as the app — sidecar or DaemonSet | Standalone service, a horizontally-scaled pool behind a load balancer |
| Talks to | Local apps (localhost OTLP) | Agents or apps across the fleet |
| Strengths | Local enrichment (host/k8s metadata), offloads app, no network hop to collect | Central policy, aggregation, tail sampling, fewer backend connections/egress points |
| Scaling | Scales with nodes (one per node) | Scale independently of app fleet |

```mermaid
flowchart LR
  A1[app + agent] --> GW
  A2[app + agent] --> GW
  A3[app + agent] --> GW
  subgraph GW [gateway pool]
    G1[collector]
    G2[collector]
  end
  GW --> BE[(backend)]
```

Typical production shape: **agent (DaemonSet)** enriches with node/pod metadata and forwards OTLP
to a **gateway pool** that batches, samples, and exports to backends. The gateway gives you a
central control point and a small, stable set of backend connections.

> [!TIP]
> Agents are great at **local context** (k8s attributes, host metrics) the gateway can't see.
> Gateways are great at **global decisions** (tail sampling, quota, routing) an agent can't make
> alone. Use both; don't force one to do the other's job.

## Tail-based sampling in the Collector

Sampling comes in two flavors (see also `sampling-cardinality-and-telemetry-cost-management`):

- **Head sampling** — decide at the start of a trace, before you know the outcome (e.g. keep 10%).
  Usually done in the SDK, but the Collector can also head-sample via the `probabilistic_sampler`
  processor (useful when you don't control the SDK). Cheap, but you might discard the very trace
  that errored.
- **Tail sampling** — decide **after** the trace completes, so you can keep traces that are
  slow or errored and drop boring fast ones. Done in the Collector via the **`tail_sampling`
  processor** with policies (`status_code`, `latency`, `probabilistic`, `string_attribute`, ...).

The catch: to decide on a whole trace, **all spans of that trace must arrive at the same Collector
instance** that buffers them. In a horizontally-scaled gateway pool this is not automatic — spans
of one trace can hit different collectors. The solution is a **two-tier gateway**:

```mermaid
flowchart LR
  A[agents / apps] --> LB
  subgraph LB [tier 1: load-balancing collectors]
    L1[loadbalancing exporter]
    L2[loadbalancing exporter]
  end
  LB -->|route by traceID via consistent hash| TS
  subgraph TS [tier 2: tail-sampling collectors]
    T1[tail_sampling]
    T2[tail_sampling]
  end
  TS --> BE[(backend)]
```

Tier 1 runs the **`loadbalancing` exporter** with `routing_key: traceID`, which **consistently
hashes each trace ID to one tier-2 collector**, guaranteeing every span of a trace lands on the
same tail-sampling instance. Tier 2 runs `tail_sampling`. Because tail sampling **buffers spans
until the trace is complete** (a decision wait window), it costs memory and adds latency to the
export of that trace — size the buffer and window carefully.

```yaml
processors:
  tail_sampling:
    decision_wait: 10s                 # how long to buffer a trace before deciding
    num_traces: 100000                 # max traces held in memory at once
    expected_new_traces_per_sec: 5000  # hint for pre-allocating the buffer map
    policies:
      - name: keep-errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: keep-slow
        type: latency
        latency: { threshold_ms: 500 }
      - name: sample-rest
        type: probabilistic
        probabilistic: { sampling_percentage: 5 }
```

**Worked example — why it's memory-bound.** With **5,000 traces/s** arriving and a **10 s**
`decision_wait`, at steady state you are holding roughly 5,000 × 10 = **50,000 in-flight traces**
(so `num_traces: 100000` leaves 2× headroom). If an average trace is **20 spans × ~1 KB = ~20 KB**,
the sampling buffer alone needs 50,000 × 20 KB = **~1 GB** of RAM — before batches, queues, or the
`memory_limiter` overhead. Double `decision_wait` to 20 s and the buffer doubles to ~2 GB. This is
why you provision tail-sampling collectors on memory, not CPU, and why the `decision_wait` window is
a direct memory-vs-completeness knob.

> [!WARNING]
> On a tier-2 membership change (scale-up, scale-down, or a pod restart), the `loadbalancing`
> exporter's consistent-hash ring **reshards** — a slice of trace IDs remaps to different tier-2
> instances. Traces in flight during the reshuffle get **split** across the old and new owner, so
> they briefly hit the exact partial-decision failure the tier exists to prevent. Mitigate with
> slow/stable scaling, a stable resolver (e.g. headless-service DNS or k8s endpoint resolver), and
> accepting a small transient sampling error during rescales rather than autoscaling aggressively.

> [!WARNING]
> Running `tail_sampling` on a plain multi-replica gateway **without** a trace-ID load-balancing
> tier silently produces *broken/partial* sampling decisions, because each replica only sees a
> fragment of each trace. This is the classic tail-sampling interview trap.

## Reliability: queues, retries, and backpressure

Exporters ship with a **sending queue** and **retry** wrapper:

- **Sending queue** (`sending_queue`) — an in-memory (or, with the `file_storage` extension,
  **persistent**) buffer between the pipeline and the exporter. Decouples ingest from a slow/failing
  backend. When it fills, it applies **backpressure** (drops or blocks depending on config).
- **Retry** (`retry_on_failure`) — exponential backoff retry of failed export batches.
- **`memory_limiter`** — the upstream guardrail; when the queue backs up and memory climbs, the
  limiter refuses new data at the receiver, pushing backpressure to clients.

```yaml
exporters:
  otlp:
    endpoint: backend:4317
    sending_queue:
      enabled: true
      num_consumers: 10
      queue_size: 5000
      storage: file_storage      # persist across restarts (needs extension)
    retry_on_failure:
      enabled: true
      initial_interval: 5s
      max_elapsed_time: 300s
```

**Worked example — how long does the queue actually buffer?** `queue_size` counts **batches**
waiting to be exported (not individual spans; the unit has shifted across versions, so pin it to
your release). With `queue_size: 5000` and the `batch` processor flushing ~**5 batches/s** (from the
batching example above), a full queue holds 5000 ÷ 5 = **1,000 seconds ≈ 16.7 minutes** of backend
outage before it saturates and starts shedding. Want to ride out a 1-hour outage at that rate? You
need ~3,600 × 5 = **18,000** slots — and enough memory (or `file_storage` disk) to hold them.

The chain of defense against a backend outage: **retry** (transient) → **queue** (absorb) →
**persistent queue** (survive restart) → **memory_limiter** (protect the process) → **drop**
(last resort). A pure in-memory queue loses data on crash; use `file_storage` for durability — but
note it is **at-least-once**: after a crash, batches that were exported but not yet acked are
replayed on restart, so the backend can see **duplicates**. Say "at-least-once, dedupe downstream,"
not "exactly-once," when an interviewer probes durability.

## Scaling the Collector

- **Agents** scale automatically with nodes (one per host/DaemonSet); each handles only its node's
  load, so they rarely need tuning beyond memory limits.
- **Gateways** scale **horizontally** behind a load balancer — they are mostly stateless, *except*
  when they hold state (tail sampling buffers, `groupbytrace`). Stateful gateways require the
  trace-ID load-balancing tier so scaling doesn't split traces.
- Tune **`num_consumers`** (export concurrency), **`queue_size`**, batch size, and
  **`GOMEMLIMIT`** (set to ~80% of the hard memory limit) alongside `memory_limiter`.
- Watch the Collector's **own** telemetry: `otelcol_exporter_send_failed_spans`,
  `otelcol_processor_dropped_spans`, `otelcol_exporter_queue_size` vs `queue_capacity`,
  `otelcol_processor_refused_*` (memory_limiter refusals). Rising refused/dropped/queue-full
  metrics mean you are under-provisioned or the backend is slow. (These `otelcol_*` names are the
  classic Prometheus-style form; the Collector's internal telemetry has been migrating to
  OTLP-native names/format, so exact names/prefixes are **version-dependent** — check your release's
  internal-telemetry docs before you build alerts on a specific string.)

> [!KEY-TAKEAWAY]
> Stateless gateway components scale trivially; **stateful** ones (tail sampling, group-by-trace)
> force you to make traffic sticky by trace ID first. Always monitor the Collector itself —
> silent drops are the failure mode.

## Common follow-up questions

- **Q: Why not export directly from the SDK to the backend?** You can, but you lose central policy
  (sampling, redaction, routing), tie instrumentation to backend lifecycle, put batching/retry in
  the request path, and expose backend credentials in every service. Direct export is fine for
  small/demo setups; the Collector is the production default.
- **Q: What's the difference between a processor and a connector?** A processor stays within one
  pipeline and one signal. A connector links two pipelines — it's the exporter of one and the
  receiver of another — and can even change signal type (traces → metrics via `spanmetrics`).
- **Q: Where should `memory_limiter` and `batch` go?** `memory_limiter` first (so backpressure hits
  receivers before memory is committed), `batch` last (batch the final, post-sampling shape).
- **Q: Why can't I just add `tail_sampling` to my autoscaled gateway?** Because each replica sees
  only a fragment of each trace. You need a load-balancing tier routing by `traceID` so all spans of
  a trace reach one tail-sampling instance.
- **Q: Head vs tail sampling trade-off?** Head is cheap and stateless but blind to outcome (may drop
  the error). Tail is outcome-aware (keep errors/slow) but needs to buffer whole traces → memory,
  latency, and the load-balancing requirement.
- **Q: What happens to the tail-sampling tier when it scales up or down?** The `loadbalancing`
  exporter's consistent-hash ring reshards on membership change, so a fraction of in-flight traces
  briefly split across the old and new owner and produce partial decisions — the same failure the
  tier prevents at steady state. Scale slowly/stably, use a stable resolver, and accept a small
  transient error rather than autoscaling aggressively.
- **Q: How do I send telemetry to two backends?** List both exporters in one pipeline (fan-out
  copies to each). For *different* subsets per backend, use separate pipelines or a routing
  connector.
- **Q: Agent or gateway?** Both. Agent for local enrichment/offload (k8s metadata, host metrics);
  gateway for aggregation, central policy, and tail sampling. Agents forward OTLP to the gateway.
- **Q: How do I avoid data loss when the backend is down?** Enable `retry_on_failure` and a
  `sending_queue`; back the queue with the `file_storage` extension for persistence across
  restarts. Ultimately `memory_limiter` refuses and data drops if the outage outlasts the queue.
- **Q: Which port is OTLP on?** gRPC 4317, HTTP 4318.

## References

- OpenTelemetry — Collector Architecture: https://opentelemetry.io/docs/collector/architecture/
- OpenTelemetry — Collector Configuration (pipelines, service):
  https://opentelemetry.io/docs/collector/configuration/
- OpenTelemetry — Collector Deployment patterns (agent, gateway):
  https://opentelemetry.io/docs/collector/deployment/
- OpenTelemetry — Scaling the Collector: https://opentelemetry.io/docs/collector/scaling/
- Collector `memory_limiter` processor README:
  https://github.com/open-telemetry/opentelemetry-collector/tree/main/processor/memorylimiterprocessor
- Collector `batch` processor README:
  https://github.com/open-telemetry/opentelemetry-collector/tree/main/processor/batchprocessor
- `tail_sampling` processor (contrib):
  https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor
- `loadbalancing` exporter (contrib):
  https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/loadbalancingexporter
- `spanmetrics` connector (contrib):
  https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/connector/spanmetricsconnector
- OTTL (OpenTelemetry Transformation Language):
  https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/pkg/ottl
- OTLP specification: https://opentelemetry.io/docs/specs/otlp/
