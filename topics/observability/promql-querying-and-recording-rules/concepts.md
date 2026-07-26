# PromQL Querying & Recording Rules

PromQL (Prometheus Query Language) is the read-side of Prometheus: a functional expression
language that operates over the dimensional time-series data model (metric name + key/value
labels) that the scrape side produces. This topic covers how PromQL actually evaluates —
instant vs range vectors, selectors and matchers, the rate/increase/irate family and why
they exist, aggregation, `histogram_quantile()`, the `offset` and `@` modifiers, subqueries,
vector matching (one-to-one and many-to-one joins), and **recording rules** that precompute
expensive expressions on a schedule. Throughout, the emphasis is on the semantics an
interviewer probes and the classic mistakes (avg-of-averages, `rate()` on a gauge,
missing `+Inf` bucket).

This is the **Observability** domain. The scrape loop, TSDB, service discovery and staleness
*mechanics* live in `prometheus-architecture-and-scraping`; alert routing/grouping lives in
`alerting-rules-and-alertmanager`; the design-level "where monitoring fits" is
`system-design/observability-monitoring-reliability`. Here we own **how you query the data**.

> [!KEY-TAKEAWAY]
> PromQL has four value types: **instant vector** (one sample per series at one instant),
> **range vector** (a window of samples per series, only produced by `metric[5m]`),
> **scalar**, and **string**. Most functions take one and return the other. `rate()`
> turns a *range vector of a counter* into an *instant vector* of per-second rate.
> Aggregations (`sum`, `avg`, ... `by`/`without`) collapse instant vectors. Recording
> rules precompute all of this on the evaluation interval and store the result as a new
> series named `level:metric:operation`.

---

## Instant vectors vs range vectors

PromQL distinguishes two vector types, and confusing them is the single most common
beginner error.

- An **instant vector** is a set of time series where each series contributes **exactly
  one sample** at the query's evaluation instant `t`. Writing a bare selector like
  `http_requests_total` yields an instant vector. For each matching series, Prometheus
  returns the most recent sample at-or-before `t` (within the staleness lookback, default
  5m).
- A **range vector** is a set of time series where each series contributes a **slice of
  samples over a time window**. You produce one *only* with a range selector:
  `http_requests_total[5m]`. A range vector has no single value — it is a matrix of raw
  samples — so you cannot graph it directly or do arithmetic on it. You must feed it to a
  function that consumes a range vector (`rate`, `increase`, `avg_over_time`, ...) which
  returns an instant vector.

```promql
http_requests_total              # instant vector: 1 value/series now
http_requests_total[5m]          # range vector: ~last 5 min of raw samples/series
rate(http_requests_total[5m])    # instant vector again (per-sec rate over the window)
```

> [!WARNING]
> `http_requests_total[5m]` on its own is **not** graphable and will error in most panel
> contexts ("invalid expression type range vector"). A range vector is only an *input* to
> a range-vector function. Likewise you cannot apply `rate()` to an instant vector —
> `rate(http_requests_total)` is a type error.

**Range query vs instant query (evaluation, not value type).** Separately from value types,
the HTTP API has two endpoints: `/query` (instant query — evaluate the expression once at a
single `time`) and `/query_range` (range query — evaluate the *same* expression repeatedly
at every `step` between `start` and `end`, which is what a Grafana time-series panel does).
A range *query* over an expression that returns an instant *vector* is how you plot a line.

---

## Selectors and label matchers

A time series is selected by an optional metric name plus zero or more label matchers in
`{}`. There are four matcher operators:

| Matcher | Meaning | Example |
|---|---|---|
| `=` | label equals exactly | `{job="api"}` |
| `!=` | label not equal | `{job!="api"}` |
| `=~` | label matches regex (fully anchored) | `{job=~"api|web"}` |
| `!~` | label does not match regex | `{status!~"2.."}` |

Key rules and gotchas:

- **Regexes are fully anchored (RE2).** `status=~"2.."` is implicitly `^2..$` — it does
  **not** substring-match. Use `.*` for partial matches: `path=~".*/users.*"`.
- The metric name is itself the label `__name__`, so `http_requests_total` is sugar for
  `{__name__="http_requests_total"}`. You can match names by regex:
  `{__name__=~"http_.*"}`.
- A selector must match **at least one non-empty matcher** — `{}` or a query that could
  match every series (e.g. `{__name__=~".+"}`) is rejected/expensive by design.
- `=~""` (empty regex) matches series that **don't have** that label at all, which is a
  handy way to select "series missing label X".

```promql
http_requests_total{job="api", method="GET", status=~"5.."}   # 5xx GETs on the api job
node_cpu_seconds_total{mode!="idle"}                          # everything but idle
```

---

## rate() vs irate() vs increase()

These three consume a **range vector of a counter** and are the heart of PromQL. A
*counter* is a monotonically increasing value (requests served, bytes sent); its raw value
is meaningless (it depends on process start time), so you always look at how fast it grows.

- **`rate(v[w])`** — average **per-second** rate of increase over the window `w`. It is
  the workhorse for graphing/alerting on counters. It automatically handles **counter
  resets** (if the value drops, e.g. process restart, it treats the drop as a reset and
  adds the pre-reset increase) and **extrapolates** to the window edges.
- **`increase(v[w])`** — total increase over the window (not per-second). It is exactly
  `rate(v[w]) * <window seconds>`, same reset handling and extrapolation. Use it for
  "how many events in the last hour": `increase(errors_total[1h])`.
- **`irate(v[w])`** — *instant* rate using only the **last two samples** in the window. It
  is highly responsive to fast changes (good for volatile, high-resolution graphs) but
  **spiky**; it ignores everything but the final two points, so on a wide step it can miss
  activity. Use `rate` for alerting/slow-moving dashboards, `irate` only for fast-moving
  graphs at high resolution.

```promql
rate(http_requests_total[5m])       # smooth avg req/s over 5m
increase(http_requests_total[1h])   # total requests in the last hour
irate(http_requests_total[1m])      # spiky, based on final 2 samples
```

> [!WARNING]
> **Never apply `rate`/`irate`/`increase` to a gauge.** They assume monotonicity and will
> misinterpret every legitimate decrease as a counter reset, inflating the result. For a
> gauge's rate of change use `deriv()` (least-squares slope) or `delta()`. Conversely,
> `delta()`/`deriv()` on a counter is wrong because they don't handle resets.

**Extrapolation subtlety.** `rate`/`increase` extrapolate to the exact window boundaries,
so `increase()` of an integer counter can return **non-integer** values (e.g. 3.4). This
is expected and correct — it's estimating the true count at the window edges, not counting
raw deltas.

**Worked example — extrapolation step by step.** Counter scraped every 15s; you evaluate
a **60s** window at `t=60s`. The samples that fall inside `(0s, 60s]` are:

| t (s) | 5 | 20 | 35 | 50 |
|---|---|---|---|---|
| value | 100 | 112 | 120 | 135 |

- Observed delta between the first and last in-window samples: `135 − 100 = 35`, spanning
  `50 − 5 = 45s` (the *sampled interval*).
- Average gap between samples: `45s / (4 − 1) = 15s`.
- `rate` extrapolates that 45s of coverage out to the full 60s window. Gap to the start
  edge is `5 − 0 = 5s`; gap to the end edge is `60 − 50 = 10s`. Both are under the
  ~16.5s threshold (≈1.1× the average gap), so both get added: extrapolated interval
  `= 45 + 5 + 10 = 60s`, giving factor `60 / 45 = 1.333`.
- `increase = 35 × 1.333 = 46.67` — a **non-integer** even though the counter only takes
  integer values. That is the "increase() returns 3.4" surprise, and it is correct.
- `rate = 46.67 / 60s = 0.778 req/s`.

**Worked example — a reset mid-window.** Now the process restarts inside the window, so the
samples are `100, 120, 135, 4, 18`. Naive last − first = `18 − 100 = −82` — nonsensically
negative. `rate` detects the drop `135 → 4`, treats it as a reset, and adds the pre-reset
value back: `−82 + 135 = 53`. That equals the real work done — `(135 − 100) = 35` before the
restart plus `(18 − 0) = 18` after it — and it never goes negative. (Boundary extrapolation
then applies on top, exactly as in the first example.)

**Sizing the window.** The range `w` should be **at least 2× the scrape interval** (the
common rule of thumb is ≥ 4×) so every evaluation window contains at least two samples;
otherwise `rate` returns nothing or is very noisy. A 5m window on a 15s scrape is a safe,
common default. The trade-off is **detection latency vs smoothness**: a wider window
suppresses noise but a spike must persist longer to move the windowed average, so it fires
later. In an alerting rule the total time-to-fire ≈ the range window **plus** the rule's
`for:` duration, so both add lag — size them together.

---

## Aggregation operators and grouping (by / without)

Aggregation operators collapse an instant vector across a dimension. The core operators:
`sum`, `avg`, `min`, `max`, `count`, `count_values`, `stddev`, `stdvar`, `topk`, `bottomk`,
`quantile`, `group`.

By default an aggregation collapses **all** labels into a single series. You control
grouping with two mutually exclusive clauses:

- **`by (labels)`** — keep *only* the listed labels; aggregate away everything else.
- **`without (labels)`** — drop the listed labels; keep everything else.

```promql
sum(rate(http_requests_total[5m])) by (job)        # total req/s per job
sum(rate(http_requests_total[5m])) without (instance)  # collapse instances, keep rest
avg(node_memory_MemFree_bytes) by (datacenter)
topk(5, sum(rate(http_requests_total[5m])) by (path))  # 5 busiest paths
```

> [!WARNING]
> **Avg-of-averages is a classic trap.** `avg(rate(...))` across instances or over time
> is *not* the true fleet average unless every group carries equal weight. To get a real
> ratio, aggregate numerator and denominator separately, then divide:
> `sum(rate(errors[5m])) / sum(rate(total[5m]))`. Similarly, you cannot average
> pre-computed percentiles across instances — average of p99s is meaningless.

**Worked example — why avg-of-averages lies.** Two instances over the same window:

| instance | requests | errors | per-instance error ratio |
|---|---|---|---|
| A | 1000 | 100 | 100/1000 = **10%** |
| B | 10 | 5 | 5/10 = **50%** |

- **Wrong** (`avg` of the per-instance ratios): `(10% + 50%) / 2 = 30%`. Each instance
  votes equally, so tiny instance B drags the number up as hard as busy instance A.
- **Right** (`sum(errors)/sum(requests)`): `(100 + 5) / (1000 + 10) = 105 / 1010 = 10.4%`.
  Now every *request* votes equally, which is what "the error rate" actually means.

The two answers — **30% vs 10.4%** — differ by ~3× purely from the weighting bug. In an SLO
alert, the avg-of-averages version would page you for a fleet that is almost entirely
healthy.

**`topk`/`bottomk` return the series themselves** (with their labels), not a scalar, and
they select per evaluation timestamp — so on a range query the "top 5" set can change
between steps, which surprises people building fixed legends.

---

## histogram_quantile() over _bucket and the le label

Latency and size distributions are the reason histograms exist. A **classic Prometheus
histogram** exposes several series from one metric:

- `<name>_bucket{le="<upper bound>"}` — a **cumulative** counter: count of observations ≤
  that bound. Buckets are cumulative, so `le="0.5"` includes everything in `le="0.1"`.
- `<name>_sum` — running sum of all observed values.
- `<name>_count` — total number of observations (equals the `+Inf` bucket).

`histogram_quantile(φ, b)` estimates the φ-quantile (0 ≤ φ ≤ 1) from the bucket instant
vector. Because you almost always want a quantile of a *rate* over a window (not since
process start), the idiomatic form wraps `rate()` and aggregates buckets with `by (le)`:

```promql
histogram_quantile(
  0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
)
```

Critical rules:

- **The `le` label must be preserved.** `histogram_quantile` needs all buckets grouped by
  `le`; if you `sum ... by (job)` and drop `le`, it returns nothing/garbage. Always include
  `le` (and any dimension you're slicing by) in the `by` clause.
- **A `+Inf` bucket is required.** It represents "all observations" (= `_count`). Without
  it, `histogram_quantile` can't anchor the top of the distribution.
- **Linear interpolation within the bucket.** The result is estimated by interpolating
  *inside* the bucket the quantile falls into, so **accuracy is bounded by bucket layout**.
  If p99 lands in a bucket spanning 1s–10s, the estimate is rough. You must choose bucket
  boundaries to match the SLO you care about.

**Worked example — computing p95 by hand.** Cumulative bucket counts at one instant:

| `le` | 0.1 | 0.5 | 1 | +Inf |
|---|---|---|---|---|
| cumulative count | 0 | 80 | 90 | 100 |

- Total observations = the `+Inf` bucket = **100**. The p95 rank is `0.95 × 100 = 95`
  observations.
- Which bucket does rank 95 fall in? Cumulative reaches 90 at `le=1` and 100 at `le=+Inf`,
  so the 95th observation lies **between `le=1` and `le=+Inf`**.
- `histogram_quantile` interpolates linearly across `[lower, upper]`, but the top bucket's
  upper bound is `+Inf`. Prometheus cannot interpolate against infinity, so it **clamps the
  estimate to the highest finite bound** — it returns **1s (the `le=1` boundary)**. This is
  the classic "your p95 is pinned to the last real bucket" symptom: with only 90 of 100
  observations under 1s, the true p95 could be anywhere above 1s, and the layout simply
  cannot express it.
- **Fix the layout, then re-derive.** Add a `le=2` bucket and suppose it now reads:
  `le=1 → 90`, `le=2 → 98`, `le=+Inf → 100`. Rank 95 now sits between `le=1` (cum 90) and
  `le=2` (cum 98). Interpolate:

  `estimate = lower + (upper − lower) × (rank − count_below) / (count_in_bucket)`
  `        = 1 + (2 − 1) × (95 − 90) / (98 − 90)`
  `        = 1 + 1 × 5/8 = 1.625 s`.

  That is why "accuracy is bounded by bucket layout": the same data yields "≥1s, can't say"
  vs a concrete **1.625s** purely from where you placed the boundaries.
- **Quantiles are not aggregable, but histograms are.** You can `sum` bucket counters
  across instances and *then* compute the quantile — that's correct. You cannot average
  the resulting quantiles. This aggregatability is histograms' big win over Summaries
  (which compute quantiles client-side and cannot be combined).

**Native (exponential) histograms.** Newer Prometheus supports *native histograms* — a
single series with dynamically-sized exponential buckets, far higher resolution and lower
cardinality than the classic one-series-per-bucket scheme. `histogram_quantile()` works on
them too, plus dedicated functions like `histogram_count`, `histogram_sum`, and
`histogram_fraction`. They are the modern direction but still stabilizing.

---

## offset and the @ modifier

Both modifiers change *which point in time* a selector is evaluated at.

- **`offset <duration>`** shifts a selector **into the past relative to the evaluation
  time**. `http_requests_total offset 1h` gives the value one hour before now. It's used
  for week-over-week / hour-over-hour comparisons.
- **`@ <timestamp>`** (added in Prometheus 2.25) pins a selector to a **fixed absolute
  Unix timestamp**, regardless of the query's evaluation time. `@ start()` and `@ end()`
  (2.26) resolve to the range query's start/end. This is what makes "compare current rate
  to the rate at a fixed reference point" possible.

```promql
# how much did traffic grow vs one hour ago?
rate(http_requests_total[5m]) - rate(http_requests_total[5m] offset 1h)

# value pinned to a fixed instant (unix seconds)
http_requests_total @ 1609746000

# max over the whole graphed range, held constant across all steps
max_over_time(rate(http_requests_total[5m])[1h:] @ end())
```

> [!TIP]
> `offset` and `@` can be **combined**, and `offset` may be **negative** to look into the
> future relative to `@` (e.g. `@ end() offset -10m`). The modifier attaches to the
> *selector/subquery*, not the whole expression — `rate(x[5m] offset 1h)` offsets the
> range vector, not the `rate`.

---

## Subqueries

A **subquery** (added in Prometheus 2.7) lets you run a range-vector function over the
*result of an instant-vector expression*, evaluated at a chosen resolution — effectively
"turn any instant-vector expression into a range vector on the fly." Syntax:

```
<instant_query>[<range>:<resolution>]
```

The `resolution` (step) is optional; it defaults to the global evaluation interval.

```promql
# max 5m-request-rate observed over the last hour, sampled every 1m
max_over_time( rate(http_requests_total[5m])[1h:1m] )

# was the rate ever above 100 in the last 30m?
max_over_time( sum(rate(http_requests_total[5m]))[30m:] ) > 100
```

> [!WARNING]
> Subqueries are convenient but **expensive** — they evaluate the inner expression at every
> resolution step. Do not use them where a plain range vector suffices, and never leave a
> subquery in a hot alerting rule if a **recording rule** could precompute the inner series.
> Nesting subqueries multiplies the cost.

---

## Vector matching: one-to-one, on/ignoring, group_left/group_right

Binary operators (`+ - * / % ^`, comparisons, and `and`/`or`/`unless`) between two instant
vectors match series by their **label sets**.

- **One-to-one (default):** each series on the left matches the *one* series on the right
  with an identical label set. Unmatched series on either side are dropped from the result.
- **`on (labels)` / `ignoring (labels)`:** restrict which labels are used for matching.
  `on` matches using only the listed labels; `ignoring` matches on all labels except those.
  This is how you divide two metrics that share only some labels.

```promql
# error ratio per path — both sides share (job, path) but differ elsewhere
sum(rate(errors_total[5m]))   by (job, path)
/ on (job, path)
sum(rate(requests_total[5m])) by (job, path)
```

**Many-to-one / one-to-many** matching is needed when several series on one side map to a
single series on the other (the classic case: joining a metric against an `info` metric or
a small lookup table). Use **`group_left`** (right side has the "one") or **`group_right`**
(left side has the "one"):

```promql
# attach the "version" label from a per-instance info metric onto per-path rates
sum(rate(http_requests_total[5m])) by (instance, path)
* on (instance) group_left(version)
node_build_info
```

**Worked example — what group_left copies.** Suppose the left side (the "many") has three
per-`(instance, path)` series and the right side (the "one") has a single info series per
instance:

```
LEFT  (many):  {instance="i-1", path="/a"}  = 5
               {instance="i-1", path="/b"}  = 3
               {instance="i-1", path="/c"}  = 8
RIGHT (one) :  node_build_info{instance="i-1", version="1.4.2"} = 1
```

Matching is `on (instance)`, so all three left series match the one right series — that's
the many-to-one that forces `group_left`. The result keeps the **left** side's identity
(`instance` + `path`) and copies only the label named in `group_left(version)` from the
right:

```
RESULT:  {instance="i-1", path="/a", version="1.4.2"} = 5
         {instance="i-1", path="/b", version="1.4.2"} = 3
         {instance="i-1", path="/c", version="1.4.2"} = 8
```

Three series in, three series out — none collapsed — each now decorated with `version`.
(Multiplying by `node_build_info = 1` leaves the value unchanged; the join exists purely to
attach the label.) Without `group_left` this errors with "many-to-one matching must be
explicit."

Rules and gotchas:

- Plain matching **fails** if the match is not strictly one-to-one — you get
  "multiple matches for labels: many-to-one matching must be explicit" — which is
  Prometheus forcing you to declare intent with `group_left`/`group_right`.
- With `group_left`, the **left** vector is the "many" (higher-cardinality) side and keeps
  its own label set, which defines each result series' identity. The labels listed in
  `group_left(version)` are the **extra labels copied from the "one" (right) side** onto
  each result series. `group_right` mirrors this exactly: the **right** vector is the "many"
  side, and `group_right(...)` copies the listed labels from the "one" (left) side.
- `and`/`or`/`unless` are **set operators** (filter, don't do arithmetic): `and` keeps
  left series that have a match on the right; `unless` keeps left series with **no** match;
  `or` unions. They also honor `on`/`ignoring`.

---

## Recording rules and the level:metric:operation naming convention

A **recording rule** precomputes a PromQL expression on the rule group's evaluation
interval and saves the result as a **new time series**. Two big reasons:

1. **Performance/cost.** Dashboards and alerts that re-run an expensive aggregation
   (histograms, big `sum by`, subqueries) every refresh are slow and load the server.
   Compute once, read cheaply many times.
2. **Reuse & correctness.** Alerts should fire on the *same* number a dashboard shows;
   both referencing one recorded series guarantees consistency.

```yaml
groups:
  - name: http_slo.rules
    interval: 30s
    rules:
      - record: job:http_requests:rate5m
        expr: sum(rate(http_requests_total[5m])) by (job)
      - record: job:http_request_errors:ratio_rate5m
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m])) by (job)
          /
          sum(rate(http_requests_total[5m])) by (job)
```

**Naming convention: `level:metric:operations`** (colon-separated), from the Prometheus
docs:

- **level** — the aggregation dimension(s) the result is grouped by (e.g. `job`,
  `instance:node`).
- **metric** — the source metric name (keep it recognizable).
- **operations** — the operations applied, most recent last (e.g. `rate5m`, `sum`).

So `job:http_requests:rate5m` reads as "per-job, of http_requests, a 5-minute rate."
Colons are reserved for recording rules **by convention** — Prometheus's own metrics never
contain colons, so a colon in a name signals "this is derived."

Key operational facts:

- **Rules within one group run sequentially, in order**, so a later rule can safely build
  on an earlier rule's recorded series. Different groups run **independently/in parallel**.
- If a rule's expression errors or returns empty, the recorded series simply isn't written
  for that interval (it goes stale) — it won't crash the group.
- Recording-rule evaluation is subject to the same **staleness** and lookback semantics as
  any query.

> [!INTERVIEW]
> A strong answer connects the three ideas: recording rules make expensive queries cheap
> **and** guarantee alerts and dashboards agree on one number, and the `level:metric:op`
> naming makes the derived series self-documenting. Bonus points for "rules in a group run
> in order, so chained aggregations work; use separate groups for independent pipelines."

---

## Staleness, counter resets, and common pitfalls

**Staleness.** When a series stops being reported (target down, series disappears),
Prometheus does not return its last value forever. On an ordinary lookback it will return
the most recent sample within the **staleness lookback window (default 5m)**; beyond that
the series is considered stale and disappears from instant-query results. Since Prometheus
2.0, the scrape/rules layer also inserts explicit **stale markers** (a special NaN) when a
target disappears or a series is no longer scraped, so the series goes stale on the *next*
evaluation rather than lingering up to 5m. This is why a metric can vanish from a graph the
moment a pod dies rather than flat-lining.

**Counter resets.** A counter resets to 0 on process restart. `rate`/`increase`/`irate`
detect a decrease and treat it as a reset, adding the pre-reset portion so the rate stays
correct across restarts. The helper `resets(v[w])` counts how many resets occurred in the
window (useful to spot crash-looping). Never compute counter deltas by hand
(`counter - counter offset 5m`) — it goes negative on every restart.

**Frequently-tested mistakes, collected:**

| Mistake | Why it's wrong | Fix |
|---|---|---|
| `rate()` on a gauge | Assumes monotonic; treats drops as resets | `deriv()`/`delta()` |
| `avg(rate(...))` for a ratio | Avg-of-averages ignores weight | `sum(num)/sum(den)` |
| Averaging p99s across instances | Percentiles aren't linearly combinable | `histogram_quantile` over summed buckets |
| Dropping `le` before `histogram_quantile` | Function needs per-`le` buckets | keep `le` in `by(...)` |
| `rate(x[1m])` on 60s scrape | < 2 samples per window → empty/noisy | window ≥ 4× scrape interval |
| Graphing a bare `x[5m]` | Range vector isn't graphable | wrap in `rate`/`*_over_time` |
| Substring hope with `=~"200"` | Regex is fully anchored | `=~".*200.*"` |
| Deltas by hand across restarts | Ignores counter resets → negatives | `increase()`/`rate()` |

---

## Common follow-up questions

- **Why does `increase()` return a non-integer like 3.4?** Because `rate`/`increase`
  extrapolate to the exact window boundaries; the value estimates the true increase at the
  edges, it doesn't count raw deltas.
- **`rate` vs `irate` — when each?** `rate` for alerts and slow dashboards (smooth, uses
  the whole window). `irate` for high-resolution volatile graphs (uses only the last two
  samples, spiky). Alerting on `irate` is discouraged — it's too jumpy.
- **How wide should the range window be?** At least 2×, ideally ≥ 4× the scrape interval,
  so every window has enough samples. Wider = smoother but laggier.
- **Why can't I just average percentiles across pods?** Percentiles aren't linearly
  combinable. Sum the histogram *buckets* first, then `histogram_quantile`. This is also
  why histograms beat client-side summaries for aggregation.
- **When do I need `group_left`?** When many series on one side map to one series on the
  other (joining against an `info`/lookup metric). Prometheus forces you to make
  many-to-one explicit.
- **Recording rule vs alerting rule?** A recording rule *stores a new series*; an alerting
  rule *evaluates a condition* and fires to Alertmanager when it's true (for `for`
  duration). They live in the same rule files but do different jobs.
- **What does the `@` modifier buy over `offset`?** `offset` is relative to eval time; `@`
  pins to an absolute timestamp (or `start()`/`end()`), so you can compare against a fixed
  reference that doesn't move as the query window slides.

---

## References

- Prometheus docs — Querying basics (data types, selectors, matchers):
  <https://prometheus.io/docs/prometheus/latest/querying/basics/>
- Prometheus docs — Query functions (`rate`, `irate`, `increase`, `histogram_quantile`,
  `resets`, `deriv`, `delta`): <https://prometheus.io/docs/prometheus/latest/querying/functions/>
- Prometheus docs — Operators (aggregation, vector matching, `on`/`ignoring`,
  `group_left`/`group_right`): <https://prometheus.io/docs/prometheus/latest/querying/operators/>
- Prometheus docs — Subqueries and the `@` modifier:
  <https://prometheus.io/docs/prometheus/latest/querying/basics/#subquery> and
  <https://prometheus.io/blog/2021/02/18/introducing-the-at-modifier/>
- Prometheus docs — Recording rules & naming convention:
  <https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/> and
  <https://prometheus.io/docs/practices/rules/>
- Prometheus docs — Histograms and native/exponential histograms:
  <https://prometheus.io/docs/practices/histograms/> and
  <https://prometheus.io/docs/concepts/metric_types/#histogram>
- Prometheus docs — Staleness:
  <https://prometheus.io/docs/prometheus/latest/querying/basics/#staleness>
- Robust Perception blog (Brian Brazil) — `rate()` then `sum()`, avg-of-averages, counter
  handling: <https://www.robustperception.io/>
