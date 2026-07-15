# Actuator, Observability, and Production Concerns

> **Framing note.** Spring **Actuator** is a **Spring Boot module** (`spring-boot-actuator` / `spring-boot-starter-actuator`), *not* part of the plain Spring Framework core. There is no "Actuator" in a raw `spring-context` application. However, the observability *primitives* it builds on — **Micrometer** (a standalone facade), and the **Observation API** shipped in **Spring Framework 6.x** (`io.micrometer.observation`, integrated via `spring-core`/`spring-context`) — do live at the framework layer. This note therefore covers Actuator as a Boot feature while being explicit about which pieces are pure framework versus Boot auto-configuration. Where APIs moved from `javax.*` to `jakarta.*` (Spring Framework 6 / Spring Boot 3 baseline on Jakarta EE 9+), that is called out.

---

## What Actuator Is and Why It Exists

**Actuator** is the Spring Boot subsystem that adds **production-ready monitoring and management endpoints** to an application with almost no code. Once `spring-boot-starter-actuator` is on the classpath, Boot auto-configures a set of **endpoints** that expose the internal state of the running app: health status, metrics, environment properties, the bean graph, log levels, thread dumps, HTTP mappings, and more.

Why it matters in production:

- **Observability** — answer "is the app up, and is it healthy?" (health), "how is it behaving?" (metrics), "how is it configured?" (env, configprops).
- **Operability** — change log levels at runtime, trigger a heap/thread dump, inspect scheduled tasks, all without a redeploy.
- **Orchestration integration** — Kubernetes/other platforms poll health (liveness/readiness) to decide whether to restart or route traffic to a pod.

Key mental model:

| Concept | What it is |
|---|---|
| **Endpoint** | A logical management operation (e.g. `health`, `metrics`, `loggers`). Identified by an **endpoint ID**. |
| **Exposure** | Whether an endpoint is reachable, and over which technology (HTTP web, JMX). |
| **Enablement** | Whether an endpoint bean exists at all. |
| **Web mapping** | The path an exposed endpoint is served at, under a base path (default `/actuator`). |

An endpoint can be **enabled but not exposed** (bean exists, not reachable over HTTP), or **exposed but disabled** (unreachable because it does not exist). Both `enabled` and `exposure` gates must pass for an HTTP request to succeed.

**Gotcha — enabled vs exposed at the bean level.** A disabled endpoint (`management.endpoint.<id>.enabled=false`) has **no endpoint bean at all**, so it cannot be secured, cached, extended, or discovered — it is as if it did not exist. An enabled-but-not-exposed endpoint's bean *does* exist (and is exposed over JMX subject to JMX exposure rules) but is filtered out of the web-mapping step. This matters for `@EndpointWebExtension` and for `EndpointRequest` matchers: a matcher for a disabled endpoint matches nothing. There is also a global switch `management.endpoints.enabled-by-default=false` that flips the default so that every endpoint is opt-in via its own `enabled=true`.

**Three technologies, three discovery paths.** Actuator builds a separate `EndpointsSupplier` per technology: `WebEndpointsSupplier`, `JmxEndpointsSupplier`, and (for controller endpoints) `ControllerEndpointsSupplier`. Each starts from the same `@Endpoint` beans but applies its own exposure filter and produces its own set of operations. This is why `@WebEndpoint` beans never appear over JMX and vice versa, and why the web and JMX exposure includes/excludes are independent properties.

By default, endpoints are served under the base path **`/actuator`**, e.g. `GET /actuator/health`. Actuator supports two technologies out of the box: **HTTP (web)** endpoints and **JMX** endpoints. In modern Boot, JMX exposure is disabled by default; web exposure defaults to only `health`.

Actuator is available for both Spring MVC (Servlet) and Spring WebFlux (reactive) stacks, and for a plain Jersey/JAX-RS setup.

---

## Key Endpoints health info metrics env beans loggers

The most frequently discussed built-in endpoints:

| Endpoint ID | Purpose | HTTP methods |
|---|---|---|
| `health` | Application health status (`UP`/`DOWN`/`OUT_OF_SERVICE`/`UNKNOWN`), aggregated from health indicators. | GET |
| `info` | Arbitrary application info (build version, git commit, custom `info.*` props). | GET |
| `metrics` | Micrometer metrics; list names, then drill into one with tags. | GET |
| `env` | `Environment` property sources and resolved values. | GET |
| `beans` | Full list of Spring beans in the `ApplicationContext`. | GET |
| `loggers` | View and **modify** log levels at runtime, per logger. | GET, POST |
| `configprops` | `@ConfigurationProperties` beans and their bound values. | GET |
| `mappings` | All `@RequestMapping` / router function paths. | GET |
| `threaddump` | JVM thread dump. | GET |
| `heapdump` | Downloads a heap dump file. | GET |
| `httpexchanges` | Recent HTTP request/response traces (opt-in repository bean). | GET |
| `shutdown` | Gracefully shuts down the app. **Disabled by default.** | POST |

### `/actuator/health`

Returns an aggregated status. Example (with details shown):

```json
{
  "status": "UP",
  "components": {
    "db":   { "status": "UP", "details": { "database": "PostgreSQL", "validationQuery": "isValid()" } },
    "diskSpace": { "status": "UP", "details": { "total": 500107862016, "free": 223755649024, "threshold": 10485760 } },
    "ping": { "status": "UP" }
  }
}
```

The **aggregate** status is derived from all contributing `HealthIndicator`s using a `StatusAggregator` (default ordering: `DOWN` > `OUT_OF_SERVICE` > `UP` > `UNKNOWN`, so any `DOWN` drags the aggregate to `DOWN`). Detail visibility is controlled by `management.endpoint.health.show-details` (`never` | `when-authorized` | `always`) and `show-components`.

### `/actuator/info`

Empty by default. Populated by `InfoContributor` beans. Common contributors: `env` (any `info.*` property), `build` (from `build-info.properties`), `git` (from `git.properties`), `java`, `os`.

### `/actuator/metrics`

`GET /actuator/metrics` lists metric names; `GET /actuator/metrics/{name}` shows the value and available tags; append `?tag=key:value` to filter/drill down. Example: `GET /actuator/metrics/http.server.requests?tag=status:500`.

### `/actuator/loggers`

`GET /actuator/loggers/com.example` shows the configured and effective level. `POST` with body `{"configuredLevel":"DEBUG"}` changes it live — no restart. Sending `{"configuredLevel":null}` resets to the inherited level. This is one of the most valued operational features.

### `/actuator/env` and `/actuator/beans`

`env` shows the layered `PropertySource`s of the Spring `Environment` (system props, env vars, config files, etc.); sensitive values are sanitized by default. `beans` dumps every bean, its type, scope, and dependencies — useful for debugging wiring.

### Value sanitization on env, configprops, quartz

Data from `/env`, `/configprops`, and `/quartz` can leak secrets, so in Spring Boot 3.x **all values are fully sanitized (`******`) by default**. A value is shown unsanitized only when **both** conditions hold: (1) the per-endpoint `management.endpoint.<id>.show-values` is set to something other than `never` (`always` or `when-authorized`), **and** (2) no custom `SanitizingFunction` bean decides to sanitize it. `when-authorized` additionally requires the caller to be authenticated and to hold the roles listed in `management.endpoint.<id>.roles` (default: any authenticated user). This is a behavioral change from older Boot, where key-name heuristics (`password`, `secret`, `key`, `token`, `.*credentials.*`, `vcap_services`, `sun.java.command`) drove sanitization and values were otherwise visible. To restore key-based masking you now register a `SanitizingFunction` bean.

### Endpoint response caching

Actuator **automatically caches the response of read operations that take no parameters** for a configurable TTL: `management.endpoint.<id>.cache.time-to-live=10s`. This is why two rapid `GET /actuator/health` calls can return an identical body even if an indicator's underlying state changed in between — the cache short-circuits re-invocation. Operations that accept a `@Selector`, a query parameter, a `Principal`, or a `SecurityContext` are considered parameterized and are **never cached**. Caching is per-endpoint and independent of the HTTP layer's own caching headers.

---

## Writing Custom Endpoints

Beyond `HealthIndicator`/`InfoContributor`, Actuator lets you define entirely new management operations with a **technology-agnostic** programming model. A `@Bean` annotated with `@Endpoint(id = "features")` whose methods carry `@ReadOperation`, `@WriteOperation`, or `@DeleteOperation` is exposed over **both** JMX and (in a web app) HTTP, without you touching MVC/WebFlux/JMX APIs directly.

```java
@Component
@Endpoint(id = "features")            // -> /actuator/features and a JMX MBean
public class FeatureTogglesEndpoint {

    private final Map<String, Boolean> toggles = new ConcurrentHashMap<>();

    @ReadOperation                     // HTTP GET  /actuator/features
    public Map<String, Boolean> all() { return toggles; }

    @ReadOperation                     // HTTP GET  /actuator/features/{name}
    public Boolean one(@Selector String name) { return toggles.get(name); }

    @WriteOperation                    // HTTP POST /actuator/features/{name}
    public void enable(@Selector String name, boolean enabled) { toggles.put(name, enabled); }

    @DeleteOperation                   // HTTP DELETE /actuator/features/{name}
    public void delete(@Selector String name) { toggles.remove(name); }
}
```

Rules and traps that senior candidates are expected to know:

- **Operation → HTTP verb:** `@ReadOperation`→GET, `@WriteOperation`→POST, `@DeleteOperation`→DELETE. A read returning `null` yields **404**; a write/delete returning `null` yields **204**; a missing required parameter yields **400**.
- **Parameters are required by default.** On the Spring Framework 6 / Spring Boot 3 baseline you make one optional with Spring's `@Nullable` (`org.springframework.lang.Nullable`), or via Kotlin null-safety — otherwise a missing value is a 400, not a null injection. (Spring Framework 7 / Boot 4 later switched this to JSpecify's `org.jspecify.annotations.Nullable`.)
- **Only simple types bind.** Each root JSON property maps to a *separate* simple-typed parameter; you cannot bind a whole custom object as one parameter. Conversion uses `ApplicationConversionService` plus `Converter` beans annotated `@EndpointConverter`.
- **`-parameters` compilation is mandatory.** Parameter names are resolved reflectively; without `-parameters` (provided automatically by the Boot Gradle/Maven tooling) the binding of body/query values to names fails.
- **`@Selector`** turns a parameter into a path variable; `@Selector(Match = ALL_REMAINING)` (bound to `String[]`) captures the rest of the path.
- **Technology-restricted variants:** `@WebEndpoint` (HTTP only), `@JmxEndpoint` (JMX only). To *augment an existing* endpoint per-technology use `@EndpointWebExtension`/`@EndpointJmxExtension` — a given endpoint may have **at most one extension of each type** (the health endpoint uses a web extension to map status to HTTP codes, for instance).
- **Security context injection:** a web operation can take a `Principal` (usually `@Nullable`) or a `SecurityContext` parameter and call `isUserInRole(...)` to vary behavior for authorized callers. Injecting these makes the operation parameterized, so it is not cached.
- **Escape hatch:** `@ServletEndpoint`/`@ControllerEndpoint`/`@RestControllerEndpoint` give raw web-framework access but forfeit JMX and cross-framework portability (and are deprecated in favor of `@Endpoint` + `@EndpointWebExtension` where possible).

---

## Exposing and Securing Endpoints

### Enablement vs exposure

- **Enablement** (`management.endpoint.<id>.enabled`) controls whether the endpoint **bean exists**. Most are enabled by default; `shutdown` is disabled.
- **Exposure** (`management.endpoints.web.exposure.include` / `.exclude`) controls whether an enabled endpoint is **reachable over the web**.

Defaults (Boot 2.x/3.x): over **HTTP**, only **`health`** is exposed. Over **JMX**, nothing is exposed by default (older Boot 2.0 exposed all over JMX). To expose more:

```properties
# Expose specific endpoints
management.endpoints.web.exposure.include=health,info,metrics,loggers

# Expose everything (careful in prod)
management.endpoints.web.exposure.include=*

# Include all but exclude a couple
management.endpoints.web.exposure.include=*
management.endpoints.web.exposure.exclude=env,beans
```

`exclude` takes precedence over `include`. `*` must often be quoted in YAML: `include: "*"`.

### Changing the base path and port

```properties
management.endpoints.web.base-path=/manage      # /manage/health instead of /actuator/health
management.server.port=9001                      # serve actuator on a separate port (isolation)
management.endpoints.web.path-mapping.health=healthcheck   # rename a single endpoint path
```

Serving management endpoints on a **separate port** (`management.server.port`) is a common hardening technique: the management port is bound only to an internal network / not exposed via the public load balancer.

### Securing endpoints

Actuator does **not** secure endpoints by itself — you add **Spring Security**. Actuator provides a request matcher, `EndpointRequest`, to target endpoints in a `SecurityFilterChain`:

```java
@Bean
SecurityFilterChain actuatorSecurity(HttpSecurity http) throws Exception {
    http
      .securityMatcher(EndpointRequest.toAnyEndpoint())          // all actuator endpoints
      .authorizeHttpRequests(reg -> reg
          .requestMatchers(EndpointRequest.to("health", "info")).permitAll()  // public
          .anyRequest().hasRole("ACTUATOR"))                     // rest need a role
      .httpBasic(withDefaults());
    return http.build();
}
```

`EndpointRequest.toAnyEndpoint()` matches all endpoints (respecting the base path even if you customized it); `EndpointRequest.to(...)` targets specific IDs; `EndpointRequest.toAnyEndpoint().excluding("health")` leaves health open.

Security best practices: expose the minimum set, keep `health` details `never`/`when-authorized`, require auth for `env`/`beans`/`configprops`/`threaddump`/`heapdump` (they leak internals), never expose `shutdown` publicly, and prefer a separate management port behind the firewall.

`sensitive` (Boot 1.x) is gone; the current model is enablement + exposure + Spring Security.

---

## Custom Health Indicators

The aggregate `/health` status is composed of **`HealthIndicator`** beans. Boot auto-configures many (`DataSourceHealthIndicator`, `DiskSpaceHealthIndicator`, `RedisHealthIndicator`, `MongoHealthIndicator`, etc.). You add your own by implementing the `HealthIndicator` interface (from `org.springframework.boot.actuate.health`):

```java
@Component
public class DownstreamServiceHealthIndicator implements HealthIndicator {

    private final PaymentClient client;

    DownstreamServiceHealthIndicator(PaymentClient client) { this.client = client; }

    @Override
    public Health health() {
        try {
            client.ping();                     // cheap liveness call to the dependency
            return Health.up()
                    .withDetail("service", "payments")
                    .build();
        } catch (Exception ex) {
            return Health.down(ex)             // includes exception message in details
                    .withDetail("service", "payments")
                    .build();
        }
    }
}
```

Rules and details:

- **Bean naming → component name.** A bean named `downstreamServiceHealthIndicator` appears under the component key `downstreamService` (the `HealthIndicator` suffix is stripped).
- **`Health` builder** offers `up()`, `down()`, `outOfService()`, `unknown()`, `status(...)`, `.withDetail(...)`, `.withException(...)`.
- **Reactive stack:** implement `ReactiveHealthIndicator` returning `Mono<Health>` so the check does not block event-loop threads.
- **Custom status → HTTP code mapping.** You can define custom `Status` values and map them to HTTP codes via `management.endpoint.health.status.http-mapping.*`; ordering via `management.endpoint.health.status.order`.
- **Grouping.** `management.endpoint.health.group.<name>.include=...` creates health groups (e.g. a `readiness` group of only the checks that must pass before receiving traffic), served at `/actuator/health/<name>`.
- **`AbstractHealthIndicator`** provides a `doHealthCheck(Health.Builder)` template that catches exceptions for you.

### HealthContributor, hierarchy, and the registry

The type hierarchy is broader than just `HealthIndicator`. The root marker is **`HealthContributor`**; `HealthIndicator` is the leaf variant and **`CompositeHealthContributor`** is a named tree of children (this is how, e.g., a single `db` component can nest multiple datasource checks). At runtime all contributors are collected into a **`HealthContributorRegistry`** (reactive stack: `ReactiveHealthContributorRegistry`), which supports **registering and unregistering contributors dynamically at runtime** — a rarely-used but powerful hook for plugins that appear after startup. The reactive and blocking worlds are bridged automatically: a blocking `HealthIndicator` is adapted so it runs on a bounded-elastic scheduler when queried from the reactive endpoint, and a `ReactiveHealthIndicator` is `.block()`-ed when queried from the Servlet endpoint.

### Slow indicators, timeouts, and thread-safety

A `HealthIndicator.health()` call is invoked **synchronously on the request thread** each time `/health` is hit (subject to the endpoint cache TTL above). There is no built-in per-indicator timeout, so a hanging downstream `client.ping()` will hang the health request and can pin request threads — a classic cause of a health-check-induced outage. Mitigations: give the client a hard connect/read timeout, run the check in the reactive stack with `.timeout(...)`, or cache the result yourself. Indicators must also be **thread-safe**: multiple probes (liveness, readiness, k8s, load balancer) can call the same singleton indicator concurrently.

### Grouping mechanics and per-group overrides

A health group is more than a filtered view: each group can override `show-details`, `show-components`, its own `StatusAggregator`, its own `HttpCodeStatusMapper`, and even additional-path exposure. For example a group can be mapped onto the **main server port** with `management.endpoint.health.group.readiness.additional-path=server:/readyz`, so a load balancer that cannot reach the management port still gets a readiness signal. Includes use the **contributor name** (`db`, `readinessState`), and `*` includes everything with `exclude` taking precedence — mirroring exposure semantics.

---

## Micrometer as the Metrics Facade

**Micrometer** is a **vendor-neutral application metrics facade** — "SLF4J for metrics." Your code records metrics against Micrometer's API (`MeterRegistry`), and Micrometer **exports** them to whatever monitoring backend you configure (Prometheus, Datadog, CloudWatch, New Relic, Graphite, InfluxDB, OTLP, etc.) by adding the matching registry dependency. Actuator's `/metrics` endpoint and its metrics auto-configuration are built on Micrometer.

Meter types:

| Meter | Use for |
|---|---|
| **Counter** | Monotonically increasing count (requests served, errors). |
| **Gauge** | Instantaneous value that can go up/down (queue size, cache entries, active sessions). |
| **Timer** | Duration + count of short events (request latency). |
| **DistributionSummary** | Distribution of values (payload sizes). |
| **LongTaskTimer** | Duration of long-running in-flight tasks. |
| **FunctionCounter / FunctionTimer** | Track a value from an external monotonic source. |

Recording metrics:

```java
@Service
public class OrderService {
    private final Counter ordersPlaced;
    private final Timer   checkoutTimer;

    public OrderService(MeterRegistry registry) {
        this.ordersPlaced  = registry.counter("orders.placed", "channel", "web");
        this.checkoutTimer = registry.timer("orders.checkout");
    }

    public void placeOrder(Order o) {
        checkoutTimer.record(() -> doCheckout(o));   // times the lambda
        ordersPlaced.increment();
    }
}
```

Key concepts:

- **Dimensional metrics via tags.** Metrics carry **tags** (key/value dimensions) — e.g. `http.server.requests{method=GET,status=200,uri=/orders}`. Backends slice/aggregate by tag. Keep tag cardinality bounded (never tag by user id / raw URL with path variables).
- **`MeterRegistry`** is the central interface. `SimpleMeterRegistry` holds values in memory (default when no backend is configured); a `CompositeMeterRegistry` fans out to several; Actuator registers `Metrics.globalRegistry`.
- **`@Timed`** annotation (with a `TimedAspect` bean) times a method automatically.
- **`MeterBinder`** beans contribute pre-built metric sets (JVM memory/GC/threads, system CPU, logback events, Tomcat, HikariCP, etc.). Boot auto-registers many.
- **`MeterFilter`** lets you rename, add common tags, deny, or configure distribution statistics (percentiles, histograms/SLOs) globally.
- **Naming convention:** use lowercase, dot-separated names (`orders.placed`); Micrometer translates to each backend's convention (Prometheus → `orders_placed_total`).

Prometheus example: add `micrometer-registry-prometheus`, expose the `prometheus` endpoint, and scrape `GET /actuator/prometheus`.

### Meter identity, registration, and the gauge-reference trap

A meter's identity is its **name plus its full set of tags**. Calling `registry.counter("orders.placed", "channel", "web")` twice returns the **same** counter; calling it with a different tag value creates a *new* time series. Registration is idempotent and thread-safe, but a **conflicting registration** — same name+tags but a different meter *type*, or an inconsistent set of tag keys for the same name — throws (or is dropped depending on config) because Prometheus and most backends cannot represent a name with varying label sets.

The most infamous trap is **gauge garbage collection**. `Gauge.builder("cache.size", myCache, Cache::size)` registers a gauge that holds only a **weak reference** to the observed object. If nothing else keeps `myCache` strongly reachable, it is collected and the gauge reports `NaN`/disappears. Likewise, `registry.gauge("queue.size", queue, Queue::size)` returns the *object you passed*, not a meter handle — a common surprise. Always keep a strong reference to the measured object.

### MeterFilter ordering and MeterBinder timing

`MeterFilter`s form an ordered chain applied at **registration time**, in the order they were added to the registry; the first filter to `deny`/`accept`/transform an id wins for that decision. Boot registers common-tag and property-driven filters early. Because filters run when a meter is *created*, a filter added after a meter already exists does **not** retroactively affect it — ordering and timing both matter. `MeterBinder.bindTo(registry)` is invoked once per registry; with a `CompositeMeterRegistry`, binders and filters are applied to the composite and propagated to each delegate as delegates are added.

### Timer internals: client-side percentiles vs histograms

`Timer` can publish (a) **pre-computed percentiles** via `publishPercentiles(0.95, 0.99)` — these are computed **in-process** and are **not aggregatable across instances** (you cannot average two hosts' p99s); or (b) a **percentile histogram** (`publishPercentileHistogram()`) that ships bucket counts, which the backend (e.g. Prometheus `histogram_quantile`) aggregates correctly across instances. For SLOs, `serviceLevelObjectives(...)` adds explicit buckets. Confusing client-side percentiles with server-side histogram quantiles is a frequent senior-level mistake.

> **Framework vs Boot:** Micrometer is an independent library and works without Spring at all. Spring Boot's contribution is **auto-configuring** the registry, common tags, and the many `MeterBinder`s, plus wiring `/actuator/metrics`.

---

## Liveness and Readiness Probes

For orchestrated environments (Kubernetes), Boot exposes **application availability** as two distinct signals, backed by the framework-level `ApplicationAvailability` abstraction:

| Probe | Question it answers | On failure the platform... |
|---|---|---|
| **Liveness** | Is the app's internal state broken beyond recovery? | **Restarts** the pod/container. |
| **Readiness** | Is the app ready to accept traffic *right now*? | **Stops routing traffic** (removes from load balancer) but does **not** restart. |

Boot models these as `LivenessState` (`CORRECT` / `BROKEN`) and `ReadinessState` (`ACCEPTING_TRAFFIC` / `REFUSING_TRAFFIC`), published as `AvailabilityChangeEvent`s on the `ApplicationEventPublisher`. Your code can listen for them or update readiness (e.g., refuse traffic while warming a cache):

```java
@Component
class Warmup {
    private final ApplicationEventPublisher publisher;
    Warmup(ApplicationEventPublisher publisher) { this.publisher = publisher; }

    void onWarmComplete() {
        AvailabilityChangeEvent.publish(publisher, this, ReadinessState.ACCEPTING_TRAFFIC);
    }
}
```

Exposure as HTTP health groups:

- Auto-enabled when running on Kubernetes (or force with `management.endpoint.health.probes.enabled=true`).
- Served at **`/actuator/health/liveness`** and **`/actuator/health/readiness`** — these are pre-defined **health groups**.
- The `liveness` group intentionally includes only the `livenessState`; it must **not** depend on external systems (a flaky DB should not cause a restart loop). The `readiness` group includes `readinessState` plus checks that gate traffic.
- **Graceful shutdown** (`server.shutdown=graceful`) flips readiness to `REFUSING_TRAFFIC` first, letting in-flight requests drain before the server stops.

Common trap: putting an external dependency check in the **liveness** probe. If that dependency blips, Kubernetes restarts the pod repeatedly, making an outage worse. External-dependency checks belong in **readiness** (or a separate group), not liveness.

---

## Logging and Observability Basics

**Observability** = the three "pillars": **metrics** (Micrometer), **logs**, and **distributed traces** — plus the newer unifying **Observation API**.

### Logging

- Spring Boot uses **SLF4J** as the logging facade and **Logback** as the default implementation (Log4j2 and JUL are supported alternatives). Plain Spring Framework itself uses `spring-jcl` (a thin Jakarta Commons Logging bridge) so it can route through whatever SLF4J backend is present.
- Runtime level changes via the **`loggers` actuator endpoint** (`POST /actuator/loggers/<name>` with `{"configuredLevel":"DEBUG"}`) — no redeploy.
- Levels: `TRACE < DEBUG < INFO < WARN < ERROR`; `OFF` disables. Group loggers with `logging.group.*`.
- Production practice: structured (JSON) logging, correlation IDs, and shipping to a central store (ELK / CloudWatch / etc.).

### Tracing and correlation

- **Micrometer Tracing** (successor to Spring Cloud Sleuth) generates and propagates **trace IDs and span IDs** across service hops, with bridges to **OpenTelemetry (OTel)** or Brave/Zipkin. Trace/span IDs are placed in the **MDC** so they appear in every log line, letting you correlate logs across services for one request.
- **Micrometer Tracing is a facade, not an implementation.** You must add exactly one bridge — `micrometer-tracing-bridge-otel` **or** `micrometer-tracing-bridge-brave` — plus a reporter/exporter (`opentelemetry-exporter-zipkin`, `zipkin-reporter-brave`, OTLP, etc.). Putting *both* bridges on the classpath is a configuration error.
- **Sampling is a probability, and it is propagated.** `management.tracing.sampling.probability` (default `0.1` = 10%) decides whether a trace is *recorded/exported*. The sampling decision is carried in the propagated context, so a downstream service honors the upstream decision (all-or-nothing per trace) rather than sampling independently. Trace/span **IDs are always generated and always in the MDC** even for unsampled requests — only export is suppressed. Confusing "no trace ID in logs" with "sampling turned it off" is a common misdiagnosis: unsampled requests still log IDs.
- **Propagation format matters.** OTel bridge defaults to W3C `traceparent`; Brave historically used B3. A format mismatch between two services silently breaks trace continuity (each hop starts a fresh trace) even though each service works in isolation — configure `management.tracing.propagation.type` consistently across the fleet.

### The Observation API (Spring Framework 6 / Micrometer)

- **Micrometer Observation** (`io.micrometer.observation`) is a single API that produces **both** metrics **and** traces (and can trigger logs) from **one instrumentation point** — "instrument once, get timers + spans." Spring Framework 6.x integrates it across the stack (web client/server, messaging, etc.).

```java
Observation.createNotStarted("orders.checkout", registry)
    .lowCardinalityKeyValue("channel", "web")   // becomes a metric tag + span tag
    .observe(() -> doCheckout(order));           // records timer AND span
```

- **Low- vs high-cardinality key values:** *low*-cardinality keys become **metric tags** (bounded values → safe to aggregate); *high*-cardinality keys (e.g. an order id) are attached only to the **trace/span**, never the metric, to avoid metric cardinality explosions.
- This API lives at the **framework layer** (Micrometer + Spring Framework 6), while Actuator/Boot supplies the auto-configuration (`ObservationRegistry`, `ObservationHandler`s, exporters).

### Observation lifecycle, handlers, and scopes

An `Observation` moves through a defined lifecycle, and the pieces that plug in are worth knowing precisely:

1. **Creation** against an `ObservationRegistry` with a mutable `Observation.Context`. Registered **`ObservationPredicate`**s decide whether a real observation or a **no-op** is produced (this is how you globally suppress noisy observations — e.g. actuator's own endpoints). A **no-op observation still lets `.observe()` run your code**, it just records nothing.
2. **`start()`** invokes every applicable handler's `onStart`.
3. **`openScope()`** makes the observation "current" on the thread — this is the step that populates trace context / **MDC** so log correlation works. Forgetting to open a scope (e.g. hand-rolling `start()`/`stop()` without a try-with-resources scope, instead of using `.observe(...)`) means the span exists but nested code and logs are **not** correlated to it. Scopes are nestable and must be closed on the same thread.
4. **`event(...)`/`error(...)`** signal annotations/exceptions during execution.
5. **`stop()`** runs all **`ObservationFilter`**s *first* (they can mutate the context, add/remove key-values), *then* the handlers' `onStop`.

An **`ObservationHandler`** implements `onStart`, `onStop`, `onError`, `onEvent`, `onScopeOpened`/`onScopeClosed`, and crucially **`supportsContext(Context)`** — which lets a handler opt into only the context types it understands. Boot registers a **metrics** handler (`DefaultMeterObservationHandler`) and, when tracing is present, **tracing** handlers; each ignores contexts it does not support. An **`ObservationConvention`** centralizes naming/key-values with precedence: an explicitly-passed custom convention > a matching `GlobalObservationConvention` > the default convention.

**Gotcha — no handlers, no output.** An `ObservationRegistry` with *zero* registered `ObservationHandler`s records **nothing** even though `.observe()` executes your code and predicates run. Metrics appear only because a meter handler is registered; spans appear only because a tracing handler is registered. This is why adding Micrometer Tracing on the classpath (so Boot registers the tracing handler) is what turns existing observations into spans without changing instrumentation.

Signals summary:

| Pillar | Question | Spring/Micrometer piece |
|---|---|---|
| Metrics | How much / how fast / how many? (aggregate) | Micrometer `MeterRegistry` |
| Logs | What happened, in detail, for this event? | SLF4J + Logback, `loggers` endpoint |
| Traces | Where did the time go across services? | Micrometer Tracing + OTel/Zipkin |
| Observation | One instrumentation → metrics + traces | Micrometer Observation API (Spring 6) |

---

## Common follow-up questions

1. **Is Actuator part of the Spring Framework or Spring Boot?** Spring Boot — it is auto-configured by `spring-boot-starter-actuator`. Plain `spring-context` apps have no Actuator. Only the observability primitives (Micrometer, the Observation API) sit at the framework layer.
2. **What is exposed by default over HTTP?** Only `/actuator/health`. You opt others in via `management.endpoints.web.exposure.include`.
3. **Difference between enabling and exposing an endpoint?** Enabling controls whether the endpoint bean exists; exposing controls whether it is reachable over web/JMX. Both must pass.
4. **How do you secure Actuator?** With Spring Security using `EndpointRequest` matchers; there is no built-in `sensitive` flag anymore. Prefer a separate management port and minimal exposure.
5. **How does the aggregate health status get computed?** A `StatusAggregator` combines all `HealthIndicator` results; by default any `DOWN` makes the whole thing `DOWN`.
6. **Why put Micrometer between the app and Prometheus?** It is a vendor-neutral facade — swap backends by changing a dependency, without touching instrumentation code.
7. **Counter vs Gauge vs Timer?** Counter = monotonic count; Gauge = current up/down value; Timer = duration + count of short events.
8. **Liveness vs readiness — what happens on failure?** Liveness failure → restart; readiness failure → stop routing traffic (no restart). Never put external dependencies in liveness.
9. **How do you change a log level without redeploying?** `POST /actuator/loggers/<logger>` with `{"configuredLevel":"DEBUG"}`.
10. **What is the Observation API and how does it differ from just using Micrometer meters?** It is a single instrumentation point that yields both metrics and traces; low-cardinality keys become metric tags, high-cardinality keys go only to spans.
11. **What replaced Spring Cloud Sleuth?** Micrometer Tracing (with OpenTelemetry/Brave bridges).

## References

- Spring Boot Reference — Actuator / Production-ready features: https://docs.spring.io/spring-boot/reference/actuator/index.html
- Spring Boot Actuator — Endpoints: https://docs.spring.io/spring-boot/reference/actuator/endpoints.html
- Spring Boot Actuator — Metrics (Micrometer): https://docs.spring.io/spring-boot/reference/actuator/metrics.html
- Micrometer documentation: https://docs.micrometer.io/micrometer/reference/
- Micrometer Observation / Tracing: https://docs.micrometer.io/micrometer/reference/observation.html
- Spring Framework 6 — Observability: https://docs.spring.io/spring-framework/reference/integration/observability.html
- Kubernetes probes and Spring Boot availability: https://docs.spring.io/spring-boot/reference/features/spring-application.html#features.spring-application.application-availability
