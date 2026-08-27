# Actuator, Monitoring & Embedded Servers

Spring Boot Actuator turns your application into a production-observable system: health, metrics, environment, mappings, loggers, thread dumps and more are exposed over HTTP or JMX. Combined with Micrometer (metrics facade), Micrometer Tracing (distributed tracing), and the embedded server (Tomcat/Jetty/Undertow) that runs inside the fat JAR, these features are what make Spring Boot "production-ready." This topic covers the endpoints, how to expose and secure them, custom health indicators, Kubernetes liveness/readiness probes, meter registries, Prometheus/Grafana, custom metrics, embedded server internals and switching, graceful shutdown, distributed tracing, MDC/correlation IDs, and logging.

---

## Actuator purpose and setup

**Beginner:** Spring Boot Actuator is a module (`spring-boot-starter-actuator`) that adds *production-ready* features — monitoring, metrics, health checks, auditing, and management endpoints — with almost no code. It answers operational questions like "is the app alive?", "what's my heap usage?", "which beans are loaded?", "what config is active?" without you writing that plumbing.

Add the dependency:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

**Why it matters:** In production you need observability for SRE/DevOps, load balancers, and orchestrators (Kubernetes). Actuator provides standardized endpoints that tooling (Prometheus, Grafana, K8s probes, Spring Boot Admin) understands.

**Intermediate:** Endpoints come in two flavors of exposure — **HTTP** (via a web server) and **JMX**. By default in Spring Boot 3.x, only `health` is exposed over HTTP; `shutdown` is *disabled* entirely; and JMX exposure is off by default (was on in older versions). Endpoints have three properties: whether they are **enabled** (the bean/feature exists) and whether they are **exposed** over web/JMX. An endpoint can be enabled but not exposed.

**Advanced:** Actuator endpoints are discovered via `@Endpoint` (technology-agnostic), `@WebEndpoint` (web only), and `@JmxEndpoint` (JMX only), with operations annotated `@ReadOperation` (GET), `@WriteOperation` (POST), `@DeleteOperation` (DELETE). The `@ReadOperation` returning `null` yields HTTP 404. Endpoints are served under the base path `/actuator` by default (configurable via `management.endpoints.web.base-path`).

**Expert — operation return semantics and `@Selector`:** The status codes are asymmetric between read and write operations, which trips people up:
- `@ReadOperation` returning a value → 200; returning `null` → **404**.
- `@WriteOperation`/`@DeleteOperation` returning a value → 200; returning `null`/void → **204 No Content** (NOT 404).
- A missing or unconvertible **required** parameter → **400 Bad Request**. Operation parameters are required by default; make them optional with `@Nullable` (JSpecify) or Kotlin nullability.

`@Selector` on an operation parameter turns it into a path variable (`GET /actuator/loggers/{name}` is `@ReadOperation` with a `@Selector String name`). `@Selector(Match=ALL_REMAINING)` on the last parameter captures every remaining path segment into a `String[]`-compatible type.

**Expert — endpoint response caching:** Actuator **automatically caches responses to read operations that take no parameters** (parameter-less `@ReadOperation`s). This is why repeatedly hitting `/actuator/health` (no selector) can serve a cached result, but `/actuator/health/{group}` or `/actuator/loggers/{name}` (parameterized) is never cached. TTL is configurable per endpoint: `management.endpoint.<id>.cache.time-to-live=10s`. This caching is a common "why didn't my custom parameter-less endpoint re-run?" gotcha.

**Expert — the discovery page:** A discovery page (a JSON document of `_links` to every exposed endpoint) is served at the base path root (`/actuator`). It moves automatically to the root of a custom management context path, and is **disabled** when the management base path is `/` (to avoid clashing with application mappings). Disable it with `management.endpoints.web.discovery.enabled=false`.

---

## Key endpoints overview

The most interview-relevant built-in endpoints (all under `/actuator` by default):

| Endpoint | Purpose | Default enabled | Default web-exposed (3.x) |
|---|---|---|---|
| `/health` | App and component health (DB, disk, etc.) | yes | **yes** |
| `/info` | Arbitrary app info (build, git) | yes | no |
| `/metrics` | Micrometer metrics (drill by name) | yes | no |
| `/prometheus` | Metrics in Prometheus scrape format | yes (needs registry) | no |
| `/env` | `Environment` property sources | yes | no |
| `/beans` | All Spring beans in the context | yes | no |
| `/mappings` | All `@RequestMapping` paths | yes | no |
| `/loggers` | View/modify log levels at runtime | yes | no |
| `/threaddump` | JVM thread dump | yes | no |
| `/heapdump` | Downloads a heap dump (hprof) | yes | no |
| `/conditions` | Autoconfiguration condition report | yes | no |
| `/configprops` | `@ConfigurationProperties` beans | yes | no |
| `/scheduledtasks` | Scheduled tasks | yes | no |
| `/shutdown` | Gracefully shuts down the app | **no** | no |
| `/caches`, `/sessions`, `/flyway`, `/liquibase`, `/quartz`, `/startup` | Various | yes | no |

Key trap: `/metrics` is NOT Prometheus format. `/metrics` returns a JSON list of meter names; `/metrics/{name}` drills into one meter. Prometheus scraping uses `/actuator/prometheus`.

**Advanced — enabled vs exposed vs available vs access (the four-way distinction):** Since Spring Boot 3.4 the per-endpoint `enabled` boolean and `enabled-by-default` are **deprecated** in favor of a three-valued **access** model:
- `management.endpoint.<id>.access = none | read-only | unrestricted` (replaces `enabled=false/true`).
- `management.endpoints.access.default` (replaces `enabled-by-default`).
- `management.endpoints.access.max-permitted` — an application-wide **ceiling** that overrides both the default and any individual endpoint's `access`. Setting it to `none` disables everything regardless of other settings; `read-only` caps everything at read.

An endpoint is **available** only when access is permitted AND it is exposed. Crucially, `access=none` **removes the endpoint bean from the context entirely** (stronger than un-exposing) — if you only want to hide it from HTTP while keeping the bean, use exposure `exclude` instead. By default all endpoints have unrestricted access **except `shutdown` and `heapdump`**.

**Advanced — CORS:** Actuator has its own CORS config independent of the app: it is disabled until you set `management.endpoints.web.cors.allowed-origins` (plus `allowed-methods`, etc.). This matters for browser-based dashboards hitting actuator from another origin.

---

## /health endpoint and health details

**Beginner:** `/actuator/health` returns overall status: `UP`, `DOWN`, `OUT_OF_SERVICE`, or `UNKNOWN`. Aggregated from registered `HealthIndicator`s (db, disk space, ping, etc.).

**Intermediate — showing details:** By default only aggregate status is shown. Control component detail with:

```properties
management.endpoint.health.show-details=always   # never | when-authorized | always
management.endpoint.health.show-components=always
```

The default is `never` (only the aggregate status is shown). `when-authorized` shows component details only to authorized users — those in the roles configured via `management.endpoint.health.roles` (or, if no roles are configured, any authenticated user); `always` shows details to everyone.

**Status ordering / aggregation:** Overall status is the "worst" among indicators using the `StatusAggregator` ordering: `DOWN > OUT_OF_SERVICE > UP > UNKNOWN`. `HttpCodeStatusMapper` maps status to HTTP codes: `DOWN`/`OUT_OF_SERVICE` → 503, `UP` → 200.

*Worked example — the two response shapes.* With the default `show-details=never`, `GET /actuator/health` returns only the aggregate:

```json
{ "status": "UP" }
```

Flip `management.endpoint.health.show-details=always` and the same request expands into the per-component tree the indicators produced (the `downstream` block is the custom `HealthIndicator` shown later):

```json
{
  "status": "UP",
  "components": {
    "db":        { "status": "UP", "details": { "database": "PostgreSQL", "validationQuery": "isValid()" } },
    "diskSpace": { "status": "UP", "details": { "total": 500107862016, "free": 218461237248, "threshold": 10485760, "exists": true } },
    "downstream":{ "status": "UP", "details": { "latencyMs": 12 } }
  }
}
```

The aggregate flips to `DOWN` (and HTTP 503) the moment **any** component reports `DOWN` — e.g. if `db` goes down, `status` becomes `DOWN` even though `diskSpace` and `downstream` are still `UP`, because the aggregator takes the worst.

**Advanced — health groups:** You can group indicators:

```properties
management.endpoint.health.group.custom.include=db,diskSpace
management.endpoint.health.group.custom.show-details=always
```

Accessible at `/actuator/health/custom`. Groups are the mechanism behind liveness/readiness. You can also configure per-group status mapping and `additional-path` to expose a group on the main server port.

**Expert — health caching and slow indicators:** The `/health` response (parameter-less read) is subject to actuator's response cache and can be tuned via `management.endpoint.health.cache.time-to-live`. Because all indicators are invoked **serially on the request thread by default**, one slow indicator (e.g. a DB check with a long socket timeout) stalls the whole `/health` response — which can cascade: a Kubernetes readiness probe times out, the pod is pulled from the load balancer, latency spikes elsewhere. Mitigations: keep checks fast, set tight JDBC/HTTP timeouts inside indicators, or move an expensive check out of the readiness group. The `DataSourceHealthIndicator` runs a validation query (`SELECT 1` style, or the driver's `isValid`); if that query blocks, `/health` blocks.

**Expert — `additional-path` and per-group HTTP mapping:** `management.endpoint.health.group.readiness.additional-path=server:/readyz` exposes the readiness group on the **main application port** (not just the management port) at `/readyz` — useful when the management port is firewalled off from the K8s kubelet but probes must hit the app port. Each group can override `show-details`, `show-components`, its own `StatusAggregator`, and its own `HttpCodeStatusMapper` (`management.endpoint.health.group.<name>.status.http-mapping.DOWN=...`).

**Expert — custom status severity:** If you introduce a custom status string (e.g. `"FROZEN"`), the default `SimpleStatusAggregator` sorts any code **not** in its known order (`DOWN > OUT_OF_SERVICE > UP > UNKNOWN`) **after** the known ones — i.e. as **least severe of all**. Concretely: given components `{db: UP, cache: FROZEN}`, the aggregate is still **UP**, because `FROZEN` ranks below `UNKNOWN` and cannot outrank `UP`. So by default a custom status will **never** pull the aggregate down, and it maps to **HTTP 200** (unknown codes default to 200, not 503). To make `FROZEN` actually count, register it in `management.endpoint.health.status.order` (or a `StatusAggregator` bean) at the right severity, and add `management.endpoint.health.status.http-mapping.FROZEN=503` so it returns a failing code.

---

## Custom health indicators

**Beginner:** Implement `HealthIndicator` to add a component-specific check. The bean name (minus the `HealthIndicator` suffix) becomes the component key.

```java
@Component
public class DownstreamHealthIndicator implements HealthIndicator {
    private final PingClient client;
    DownstreamHealthIndicator(PingClient client) { this.client = client; }

    @Override
    public Health health() {
        try {
            long ms = client.ping();
            return Health.up().withDetail("latencyMs", ms).build();
        } catch (Exception ex) {
            return Health.down(ex).withDetail("error", ex.getMessage()).build();
        }
    }
}
```

This appears as `downstream` under `components` in `/actuator/health`.

**Intermediate:** For reactive apps implement `ReactiveHealthIndicator` (returns `Mono<Health>`). To signal a fatal-but-not-fully-down state use `Health.status("OUT_OF_SERVICE")`. Custom status strings need a `StatusAggregator`/`HttpCodeStatusMapper` if they should influence overall status or HTTP code.

**Advanced — `AbstractHealthIndicator`:** Extend it and implement `doHealthCheck(Health.Builder)` to get built-in exception handling. Auto-configured indicators (`DataSourceHealthIndicator`, `DiskSpaceHealthIndicator`, `RedisHealthIndicator`, etc.) can be toggled with `management.health.<name>.enabled=false`. Note `management.health.defaults.enabled=false` disables all auto-configured indicators. A slow health indicator can make `/health` slow — keep checks fast or cache; a hanging DB check can cascade into failing K8s probes.

**Expert — `HealthContributor` vs `HealthIndicator`, and composites:** `HealthIndicator` is a leaf. `CompositeHealthContributor` lets one bean contribute a tree of named children (e.g. one "downstreams" contributor exposing per-dependency sub-checks). Both implement the marker `HealthContributor`. In reactive apps the parallel hierarchy is `ReactiveHealthContributor` / `ReactiveHealthIndicator` / `CompositeReactiveHealthContributor`; a blocking `HealthIndicator` used in a WebFlux app is adapted but runs on a bounded elastic scheduler.

**Expert — exception handling and detail leakage:** If a `HealthIndicator.health()` throws, the bean is reported `DOWN` and the exception message/type may be surfaced under `details` (respecting `show-details`). `AbstractHealthIndicator` catches the exception for you and calls `builder.down(ex)`. Note that `Health.down(ex)` includes the exception class + message in details, so a raw exception can leak internal info (SQL, hostnames) when `show-details=always` — sanitize what you put in details for publicly reachable health endpoints.

**Expert — `SlowIndicator` ordering & registry vs bean name:** The component key derives from the **bean name** (suffix `HealthIndicator`/`HealthContributor` stripped, first letter lowercased). If you register the bean under a different name (e.g. `@Bean("paymentsCheck")`), the key becomes `paymentsCheck`, not the class-derived name — a subtle gotcha when a health-group `include` references the wrong key and silently contributes nothing (unknown includes are ignored, not errors).

---

## Liveness and readiness probes

**Beginner:** Kubernetes uses two probes: **liveness** ("is the app broken and should be restarted?") and **readiness** ("can the app receive traffic right now?"). Spring Boot exposes these as `ApplicationAvailability` state and Actuator health groups.

**Intermediate:** Availability state:
- **Liveness** → `LivenessState.CORRECT` / `BROKEN`. If `BROKEN`, K8s restarts the pod. Should NOT depend on external systems (a down DB should not restart your pod).
- **Readiness** → `ReadinessState.ACCEPTING_TRAFFIC` / `REFUSING_TRAFFIC`. Controls whether the pod is added to the Service load balancer. May check external dependencies.

Probes are auto-enabled when running on Kubernetes (detected via env) or explicitly:

```properties
management.endpoint.health.probes.enabled=true
```

Endpoints: `/actuator/health/liveness` and `/actuator/health/readiness`.

**Advanced:** Update state programmatically by publishing `AvailabilityChangeEvent`:

```java
@Component
class StateManager {
    private final ApplicationEventPublisher publisher;
    StateManager(ApplicationEventPublisher p) { this.publisher = p; }

    void goDown() {
        AvailabilityChangeEvent.publish(publisher, this, ReadinessState.REFUSING_TRAFFIC);
    }
}
```

During graceful shutdown, Spring Boot automatically flips readiness to `REFUSING_TRAFFIC` so the load balancer drains the pod before shutdown completes. Liveness/readiness are backed by `LivenessStateHealthIndicator` and `ReadinessStateHealthIndicator`, mapped into the `liveness`/`readiness` health groups.

**Expert — probe group contents and the startup gap:** When probes are enabled, `liveness` maps only to `livenessState` and `readiness` maps to `readinessState` **plus any `readinessState`-adjacent indicators you add**. Critically, by default the DB/disk indicators are NOT in the liveness group — that is intentional (liveness must not restart on external outages). If you naively add `db` to the liveness group you reintroduce the "DB down → whole fleet restarts" anti-pattern. A separate `startup` probe (Kubernetes `startupProbe`) is often pointed at readiness or a dedicated group to cover slow-starting apps before liveness kicks in.

**Expert — event timing and self-healing:** `LivenessState.BROKEN` and `ReadinessState.REFUSING_TRAFFIC` are just in-memory availability state; publishing an `AvailabilityChangeEvent` to flip back to `CORRECT`/`ACCEPTING_TRAFFIC` is legitimate and lets an app self-heal readiness (e.g. after a downstream recovers) without a restart. But once liveness reports `BROKEN` and K8s restarts the pod, in-app recovery is moot — so reserve `BROKEN` for truly unrecoverable states (deadlock, unrecoverable OOM signal), not transient issues.

**Expert — HTTP codes probes return:** `/actuator/health/liveness` returns 200 for `CORRECT` and 503 for `BROKEN`; `/actuator/health/readiness` returns 200 for `ACCEPTING_TRAFFIC` and 503 for `REFUSING_TRAFFIC`. Kubernetes treats any non-2xx/3xx (or connection failure) as probe failure. Because readiness returns 503 during graceful shutdown, the kubelet stops sending traffic even before the endpoint slice update propagates.

---

## Exposing and securing endpoints

**Beginner:** Control which endpoints are reachable over HTTP:

```properties
management.endpoints.web.exposure.include=health,info,metrics,prometheus
management.endpoints.web.exposure.exclude=env,beans
# expose everything (dev only!)
management.endpoints.web.exposure.include=*
```

`exclude` wins over `include`. JMX exposure uses `management.endpoints.jmx.exposure.*`.

**Intermediate — enable vs expose:** Different knobs:
- `management.endpoint.<id>.enabled=true|false` — whether the endpoint bean exists.
- `management.endpoints.web.exposure.include/exclude` — whether an enabled endpoint is reachable over HTTP.
`shutdown` is disabled by default; enable with `management.endpoint.shutdown.enabled=true` AND expose it.

**Separate management port and base path:**

```properties
management.server.port=9090          # separate port from app (8080)
management.server.address=127.0.0.1  # bind mgmt to loopback only
management.endpoints.web.base-path=/manage      # default /actuator
management.endpoints.web.path-mapping.health=healthcheck
```

Running actuator on a separate, firewalled port is a common hardening pattern.

**Advanced — securing with Spring Security:** With Spring Security on the classpath, secure actuator using `EndpointRequest`:

```java
@Bean
SecurityFilterChain actuatorSecurity(HttpSecurity http) throws Exception {
    http.securityMatcher(EndpointRequest.toAnyEndpoint())
        .authorizeHttpRequests(auth -> auth
            .requestMatchers(EndpointRequest.to(HealthEndpoint.class, InfoEndpoint.class)).permitAll()
            .anyRequest().hasRole("ACTUATOR"))
        .httpBasic(Customizer.withDefaults());
    return http.build();
}
```

`EndpointRequest.toAnyEndpoint()` matches all actuator endpoints regardless of base path. Exposing `env`, `beans`, `configprops`, `heapdump`, or `threaddump` publicly leaks secrets and internals — always secure or exclude them. In Spring Boot 3.x, `env`/`configprops` values are **fully sanitized by default** (`show-values` defaults to `never`, so every value is masked as `******`). `management.endpoint.env.show-values` / `configprops.show-values` (never | always | when-authorized) control whether real values are shown; even when set to `always`/`when-authorized`, keys matching sensitive patterns (`password`, `secret`, `key`, `token`, credentials, `vcap_services`, etc., via `SanitizingFunction`) remain masked.

**Expert — separate management port changes the security context:** When `management.server.port` differs from `server.port`, the management endpoints run in a **separate `WebServerApplicationContext` (a child context)** with its own Tomcat/Jetty connector. Consequences: (1) `EndpointRequest.toAnyEndpoint()` still works, but a `SecurityFilterChain` you define may only apply to the main context unless placed appropriately; (2) servlet `Filter`s/`interceptor`s registered for the main port do NOT run for management requests; (3) `@LocalManagementPort` (not `@LocalServerPort`) injects the actuator port in tests. Binding `management.server.address=127.0.0.1` restricts actuator to loopback so only node-local agents (a sidecar, the kubelet via hostNetwork, a scraper) can reach it.

**Expert — `EndpointRequest` matcher pitfalls:** `EndpointRequest.to(...)` targets specific endpoints; `EndpointRequest.toAnyEndpoint()` targets all but you can chain `.excluding(...)`. A frequent mistake: writing `securityMatcher("/actuator/**")` breaks the moment someone changes `management.endpoints.web.base-path`, and it also fails to match the discovery page or a separate management port — `EndpointRequest` is base-path- and port-aware and should be preferred. Another trap: with a separate management port, `PathRequest`/`EndpointRequest` still resolve correctly, but ordering of multiple `SecurityFilterChain` beans (`@Order`) determines which one wins for a given request — the actuator chain must be ordered before the catch-all app chain.

**Expert — sanitization is post-resolution:** `/env` masking happens on the **serialized value**, but the `POST /actuator/env` write operation (when `management.endpoint.env.post.enabled=true`) can still inject values into a `MapPropertySource` at the top of precedence — a write-access foothold. This is why `env` should be `read-only` access (the default) and write access gated behind auth. Also, `show-values=when-authorized` uses the same role config as health (`management.endpoint.env.roles`), and falls back to "any authenticated user" if no roles are set.

---

## /info, /env, /beans, /mappings

**`/info`:** Populated by `InfoContributor` beans. Common contributors:
- `env` — anything under `info.*` in properties (disabled by default in 3.x; enable `management.info.env.enabled=true`).
- `build` — from `META-INF/build-info.properties` (generated by the Maven/Gradle plugin's `build-info` goal).
- `git` — from `git.properties` (generated by `git-commit-id` plugin); `management.info.git.mode=full` for all fields.
- `java`, `os`, `process` info contributors (enable via `management.info.java.enabled=true`, etc.).

**`/env`:** Shows the `Environment`'s `PropertySource`s in precedence order (command-line args, OS env, application.properties, etc.). `POST /actuator/env` can set properties at runtime when `management.endpoint.env.post.enabled=true`. Sensitive values sanitized.

**`/beans`:** Lists every bean: name, type, scope, dependencies, resource. Great for debugging "which bean got created / why is there a duplicate."

**`/mappings`:** All request mappings — `@RequestMapping` handlers, servlet filters, and actuator endpoints — with their conditions (paths, methods, produces/consumes). Invaluable for "why is my endpoint 404-ing / which handler matches this URL."

**Expert — `InfoContributor` ordering and custom contributors:** `/info` aggregates all `InfoContributor` beans into one JSON object; contributors are invoked in `@Order` order and later ones can overwrite keys written by earlier ones. Write a custom one by implementing `InfoContributor.contribute(Info.Builder builder)`. The `build` contributor requires `META-INF/build-info.properties` (Maven `spring-boot-maven-plugin` `build-info` goal / Gradle `springBoot { buildInfo() }`); if that file is absent the contributor simply produces nothing (no error) — a common "why is build info empty in my IDE run?" (the goal didn't run).

**Expert — `/env` precedence resolution vs display:** `/env` shows sources in precedence order, but the **effective** value of a property is the one from the **highest-precedence** source that defines it — `/env/{propertyName}` shows the resolved value plus every source that contributes a value, which is the definitive tool for "why is this property not the value I set?" debugging (e.g. an env var overriding your `application.yml`). Relaxed binding means `MY_PROP`, `my.prop`, `my-prop` may all map to the same property; `/env` reflects the canonical resolution.

---

## /loggers runtime log level

**Beginner:** `/actuator/loggers` shows configured and effective log levels; `/actuator/loggers/{name}` shows one logger.

**Intermediate — change level at runtime without restart:**

```
POST /actuator/loggers/com.myapp.service
Content-Type: application/json

{ "configuredLevel": "DEBUG" }
```

Sending `{"configuredLevel": null}` resets the logger to inherit from its parent. This is the go-to for turning on DEBUG in production to diagnose an incident, then turning it off — no redeploy.

**Advanced:** Works with Logback, Log4j2, and JUL through Spring Boot's `LoggingSystem` abstraction. Levels: `TRACE, DEBUG, INFO, WARN, ERROR, FATAL, OFF`. There's also a `group` concept (`management.endpoint.loggers` and logging groups like `logging.group.sql=org.hibernate.SQL,...`) so you can flip several loggers at once via `/actuator/loggers/sql`.

**Expert — configured vs effective level, and write access:** `GET /actuator/loggers/{name}` returns both `configuredLevel` (explicitly set on that logger, may be null) and `effectiveLevel` (what it resolves to after inheritance). Changing a level via `POST` is a **write operation** — it therefore requires the `loggers` endpoint to have `unrestricted` access (or `read-only` will reject the POST with 405/403). This is a common "I exposed loggers but can't change levels" trap: exposure is not enough; access must permit writes. Runtime changes are **not persisted** — a restart reverts to the level in properties/`logback-spring.xml`.

**Expert — the NONE sentinel and log4shell-era hardening:** Two built-in logging systems that don't support level changes report the special value `null`/`NONE`. Also note the loggers endpoint is a prime tool during incident response (flip a package to DEBUG, capture, flip back to null), but on a shared/public actuator it is a foot-gun: an attacker toggling `ROOT` to `TRACE` can cause log-volume DoS and leak sensitive payloads. Keep it behind auth.

---

## /threaddump and /heapdump

**`/threaddump`:** Returns a JVM thread dump (JSON by default; `Accept: text/plain` gives a classic `jstack`-style dump). Use it to diagnose deadlocks, thread starvation, or a hung request without shell access to the box.

**`/heapdump`:** Streams a binary `hprof` heap dump for offline analysis (Eclipse MAT, VisualVM) — used for memory leak investigation. It's large and pauses the JVM; treat as sensitive (contains all heap data, including secrets) and never expose publicly. Both endpoints must be secured.

---

## Micrometer and meter registries

**Beginner:** Micrometer is a **vendor-neutral metrics facade** ("SLF4J for metrics"). You instrument code against Micrometer's API, and a **`MeterRegistry`** implementation ships those metrics to a specific backend (Prometheus, Datadog, CloudWatch, New Relic, Graphite, JMX, etc.). Spring Boot auto-configures a `MeterRegistry` and wires Micrometer into Actuator's `/metrics`.

**Meter types:**
- **Counter** — monotonically increasing count (requests served).
- **Gauge** — an instantaneous value that can go up/down (queue size, cache entries).
- **Timer** — records duration + count (latency); produces count, total, max, and optionally percentiles/histograms.
- **DistributionSummary** — distribution of non-time values (payload sizes).
- **LongTaskTimer** — measures still-running long tasks.

**Intermediate — dimensional tags:** Micrometer is dimensional: meters have a name plus key/value **tags** (e.g. `http.server.requests{uri="/orders",status="200",method="GET"}`). Beware **high-cardinality tags** (user IDs, raw URLs with IDs) — they explode the number of time series and can OOM the registry/backend. Use URI templates (`/orders/{id}`), not actual IDs.

*Worked example — why cardinality is catastrophic (do the multiplication):* the number of time series for ONE meter is the **product** of its tag values, because each distinct combination is its own series. Say `http.server.requests` carries `{uri, status, method}`. If you leak raw IDs into `uri`, a modest 500 distinct URLs (`/orders/1`, `/orders/2`, …) × 8 observed statuses × 4 methods = **500 × 8 × 4 = 16,000 series** for that single metric. Now template the path — `/orders/{id}` collapses those 500 URLs into one route; with ~5 route templates × 4 realistic statuses × 2 methods you get **5 × 4 × 2 = 40 series**. Same traffic, **400× fewer** series. This is why the safety valve `management.metrics.web.server.max-uri-tags` defaults to **100**: the templated design sits comfortably under it (40), while the raw-ID design blows past 100 almost immediately, trips the deny `MeterFilter`, and starts dropping meters with a WARN — the registry's last line of defense before the 16,000-series OOM.

**Advanced — CompositeMeterRegistry & common tags:** Multiple registries are combined into a `CompositeMeterRegistry`; a meter is published to all of them. Add common tags to every metric via a `MeterRegistryCustomizer`:

```java
@Bean
MeterRegistryCustomizer<MeterRegistry> commonTags(
        @Value("${spring.application.name}") String app) {
    return registry -> registry.config().commonTags("application", app, "region", "us-east-1");
}
```

Spring Boot auto-configures many binders: JVM (memory, GC, threads), system (CPU), Logback, Tomcat, HikariCP, HTTP client/server. `http.server.requests` (a `Timer`) is auto-instrumented for every MVC/WebFlux endpoint.

**Expert — `MeterFilter` is the control plane, and the global registry trap:** A `MeterFilter` bean can deny/accept meters, rename tags, map IDs, or cap cardinality. All `MeterFilter` beans are auto-bound to Spring's managed `MeterRegistry`. Critically: instrument via the **injected** `MeterRegistry`, NOT the static `io.micrometer.core.instrument.Metrics.globalRegistry` — the global registry is separate from Spring's and won't pick up your `MeterFilter`s, common tags, or the Prometheus registry, so those metrics silently never get exported. `MeterFilter` order matters: filters run in registration order and the first `deny()`/`accept()` decision wins.

**Expert — `http.server.requests` URI tagging rules:** The `uri` tag uses the **route template before variable substitution** (`/orders/{id}`, not `/orders/42`), which is what bounds cardinality. Special values: request to app root → `root`; unmatched path (404) → `NOT_FOUND`; 3xx → `REDIRECTION`; no resolvable template → `UNKNOWN`. If a controller reads the raw path or uses regex mappings that don't yield a template, you can still get high-cardinality `uri` values. A safety valve exists: `management.metrics.web.server.max-uri-tags` (default 100) — once exceeded, a **deny `MeterFilter` is installed and further `http.server.requests` meters are dropped with a WARN log**. Bumping the limit without fixing the missing template just delays the OOM.

**Expert — registration idempotency and meter identity:** A meter's identity is name + tag set. `registry.counter("x", "k", "v")` and `Counter.builder("x").tag("k","v").register(registry)` return the **same cached meter** for the same identity — repeated calls are cheap and safe. But registering the *same name* with a **different set of tag keys** than an existing meter throws or produces a distinct series depending on registry; Prometheus in particular rejects the same metric name with inconsistent label key sets. Keep the tag key set stable for a given meter name.

---

## Prometheus and Grafana

**Beginner:** Prometheus is a pull-based time-series database that **scrapes** an HTTP endpoint periodically. Grafana is the dashboard/visualization layer that queries Prometheus (via PromQL).

**Setup:** Add the registry and expose the endpoint:

```xml
<dependency>
  <groupId>io.micrometer</groupId>
  <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

```properties
management.endpoints.web.exposure.include=health,prometheus
```

Prometheus scrapes `GET /actuator/prometheus`, which returns text like:

```
# HELP http_server_requests_seconds
# TYPE http_server_requests_seconds summary
http_server_requests_seconds_count{uri="/orders",status="200"} 42.0
http_server_requests_seconds_sum{uri="/orders",status="200"} 3.1
jvm_memory_used_bytes{area="heap",id="G1 Eden Space"} 1.2E7
```

**Intermediate — naming convention:** Micrometer meter names use dots (`http.server.requests`); the Prometheus registry translates them to snake_case with base-unit suffixes (`http_server_requests_seconds`). Tags become Prometheus labels.

**Advanced:**
- **Histograms & percentiles:** enable server-side percentiles or client-side histogram buckets so Grafana/PromQL can compute quantiles across instances:
  ```properties
  management.metrics.distribution.percentiles-histogram.http.server.requests=true
  management.metrics.distribution.slo.http.server.requests=50ms,100ms,200ms
  ```
  Prefer `percentiles-histogram` (bucket-based, aggregatable across instances via `histogram_quantile()`) over pre-computed `percentiles` (not aggregatable).
- **Push vs pull:** Prometheus is pull-based; for short-lived jobs use the **Pushgateway** (`micrometer-registry-prometheus` supports it) or **OpenTelemetry** push. In Spring Boot 3.2+, `PrometheusExemplars` can attach trace IDs (exemplars) to metrics for metric-to-trace correlation.

**Expert — counter vs histogram vs summary semantics on the wire:** A Micrometer `Timer` with `percentiles-histogram=true` publishes Prometheus **histogram** buckets (`_bucket{le="..."}` cumulative counts) plus `_count` and `_sum`; `histogram_quantile(0.99, sum(rate(..._bucket[5m])) by (le))` computes a fleet-wide p99. `slo`/`service-level-objectives` **add specific bucket boundaries** (`le` values) so you can query "fraction under 100ms" precisely. Pre-computed `percentiles` publish separate `{quantile="0.99"}` time series that are **not aggregatable** — averaging two instances' p99s is statistically meaningless. So: cross-instance quantiles ⇒ histogram/SLO buckets; single-instance quick view ⇒ percentiles.

*Worked example — why you can't average p99s, and how buckets fix it.* Two instances, buckets at `le=100ms` and `le=1000ms` (cumulative `_bucket` counts, plus the implicit `+Inf` = total):

| | count ≤100ms | count ≤1000ms | total (+Inf) |
|---|---|---|---|
| Instance A (busy) | 9900 | 10000 | 10000 |
| Instance B (idle) | 91 | 100 | 100 |
| **Sum (fleet)** | **9991** | **10100** | **10100** |

Per-instance p99s: A's 99th-percentile rank is `0.99 × 10000 = 9900`, which lands exactly on the `≤100ms` bucket edge, so **A p99 = 100ms**. B's rank is `0.99 × 100 = 99`, which falls in the `(100, 1000]` bucket; linear interpolation gives `100 + (99−91)/(100−91) × 900 ≈ 900ms`, so **B p99 = 900ms**.

Naively averaging the two dashboards' numbers: `(100 + 900) / 2 = 500ms`. But the *true* fleet p99 comes from summing the buckets and running `histogram_quantile`: rank `= 0.99 × 10100 = 9999`, which sits in the merged `(100, 1000]` bucket, interpolating to `100 + (9999−9991)/(10100−9991) × 900 ≈ 166ms`. The real answer (**166ms**) is 3× smaller than the average (500ms) — because A serves 100× more traffic than B, the fleet tail is dominated by A's fast requests, and averaging silently gave B's tiny 100-request sample equal weight. That volume-weighting is *impossible* to recover from pre-computed `{quantile="0.99"}` series; it falls out for free from summing `_bucket` counts. This is the whole reason to prefer `percentiles-histogram` over `percentiles` when you aggregate across instances.

**Expert — scrape staleness and counter resets:** Prometheus derives rates from monotonic counters; on app restart a counter resets to 0 and Prometheus's `rate()` handles the reset via its counter-reset detection — but if you export a **gauge** where a counter belongs, resets silently corrupt rates. Also, the Prometheus registry is **cumulative** (values accumulate across scrapes and only reset on JVM restart), unlike step-based registries (e.g. some SaaS registries publish per-step deltas); mixing mental models causes "my counter looks too high" confusion. `management.prometheus.metrics.export.step` should generally be left alone for pull-based Prometheus.

**Expert — exemplars require the OTel-style trace context:** Exemplars attach a `traceID` label to a bucket sample so Grafana can jump metric→trace. They need a tracer on the classpath and OpenMetrics exposition format (`Accept: application/openmetrics-text`), and Prometheus must be configured with exemplar storage enabled. Without OpenMetrics negotiation the exemplars are dropped even though the timers carry them.

---

## Custom metrics

**Beginner — inject `MeterRegistry`:**

```java
@Service
class OrderService {
    private final Counter ordersPlaced;
    private final Timer checkoutTimer;

    OrderService(MeterRegistry registry) {
        this.ordersPlaced = Counter.builder("orders.placed")
            .tag("channel", "web").register(registry);
        this.checkoutTimer = registry.timer("orders.checkout.duration");
    }

    void place(Order o) {
        checkoutTimer.record(() -> doCheckout(o));
        ordersPlaced.increment();
    }
}
```

**Intermediate — gauges & annotations:**
- Gauge tracks a live object: `Gauge.builder("queue.size", queue, Queue::size).register(registry);` — Micrometer holds a **weak reference**; keep a strong reference to the measured object or the gauge reports NaN.
- `@Timed` on a controller/method (needs `TimedAspect` bean) and `@Counted` (needs `CountedAspect`) provide declarative metrics.

**Advanced:** Don't cache the `Counter`/`Timer` incorrectly across dynamic tags — building a meter per request with a unique tag value is high cardinality. Use `registry.counter(name, tags)` which is idempotent per unique name+tags (registry caches meters). `@Timed(histogram = true, percentiles = {0.95, 0.99})` configures distribution stats. To measure the JVM or a third-party object, register a `MeterBinder`.

**Expert — `Timer` recording pitfalls:** `timer.record(Runnable)` and `timer.record(() -> ...)` measure wall-clock around the lambda; for manual timing use `Timer.start(registry)` + `sample.stop(timer)`, and note the timer you stop against can carry tags decided *after* the operation (e.g. tag by outcome/exception). A classic bug: creating the `Timer` outside but resolving dynamic tags inside a per-request builder — that re-creates a distinct series per request. For measuring exceptions, prefer `@Timed` which auto-adds an `exception` tag, or record in a `finally` with an outcome tag. `LongTaskTimer` (`@Timed(longTask=true)`, which **requires a different metric name** than the short-task timer) reports the duration of *in-flight* executions — use it for batch/long jobs where you want to see "how long has the current run been going," which a normal `Timer` (records only on completion) cannot show.

**Expert — gauge strong-reference and thread-safety:** `Gauge.builder(name, obj, fn)` holds a **weak reference** to `obj`; if `obj` is GC'd the gauge reports `NaN`. The sampling function `fn` is invoked by the **registry's publishing thread** (or on scrape for Prometheus), not your thread — so it must be thread-safe and fast/non-blocking (never do I/O in a gauge function; a blocking gauge stalls the scrape). Prefer gauging a stable, long-lived object (a collection, an `AtomicInteger`) you keep a field reference to. `registry.gauge(name, obj, fn)` returns the *object*, not the gauge, which surprises people expecting a handle.

**Expert — `@Timed`/`@Counted` proxying rules:** These annotations work via `TimedAspect`/`CountedAspect` (Spring AOP). They only fire on **Spring-managed beans invoked through the proxy** — self-invocation (a method in the same class calling another `@Timed` method) bypasses the proxy and is NOT timed, exactly like `@Transactional`/`@Async`. Private and final methods also can't be advised with the default JDK/CGLIB proxying.

---

## Embedded servers: Tomcat, Jetty, Undertow

**Beginner:** Spring Boot ships an **embedded servlet container** inside the JAR — no external app server needed. `java -jar app.jar` boots the container programmatically. **Tomcat is the default** (via `spring-boot-starter-web`).

**Switching servers:** Exclude Tomcat and add the alternative starter:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-web</artifactId>
  <exclusions>
    <exclusion>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-tomcat</artifactId>
    </exclusion>
  </exclusions>
</dependency>
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-undertow</artifactId>  <!-- or -jetty -->
</dependency>
```

**Comparison:**

| Server | Default | Notes |
|---|---|---|
| **Tomcat** | Yes (spring-boot-starter-web) | Most widely used, mature, best-documented |
| **Jetty** | No | Lightweight, good for many long-lived connections/WebSockets |
| **Undertow** | No | High-performance, non-blocking, low memory (JBoss/Red Hat) — still actively maintained and supported by Boot |

**Intermediate — WebFlux:** For reactive `spring-boot-starter-webflux`, the default embedded server is **Netty** (Reactor Netty), not Tomcat. Tomcat/Jetty/Undertow can also run WebFlux (on their non-blocking connectors), but Netty is the reactive default.

**Advanced — customization:** Configure via `server.*` properties (`server.port`, `server.tomcat.threads.max`, `server.tomcat.accept-count`, `server.tomcat.max-connections`, `server.compression.enabled`). For programmatic tuning implement `WebServerFactoryCustomizer<TomcatServletWebServerFactory>`. `server.port=0` picks a random free port (useful in tests; read it via `@LocalServerPort`). `server.port=-1` disables HTTP entirely.

**Expert — the Tomcat connection pipeline (acceptor → poller → worker):** Requests flow acceptor thread → `acceptCount` OS backlog queue → NIO poller → worker thread pool (`server.tomcat.threads.max`, default 200). Once all `max` worker threads are busy, new connections queue in the `max-connections` (default 8192) NIO layer, and beyond that the OS `accept-count` (default 100) backlog; excess connections are refused. A common production incident: thread pool exhausted by slow downstream calls → requests queue → latency climbs → readiness may still say UP because the pool isn't "down." Tune `threads.max`, add timeouts, and consider `server.tomcat.max-keep-alive-requests`. Virtual threads (`spring.threads.virtual.enabled=true`, Java 21+) change this model: each request gets a virtual thread, sidestepping platform-thread pool limits for blocking I/O.

*Worked example — thread-pool capacity by Little's Law (numbers in → req/s out):* for a blocking (thread-per-request) server, sustainable throughput ≈ `threads ÷ mean_service_time`. Start healthy: 200 worker threads, each request spends a mean **500 ms (0.5 s)** blocked on a downstream call ⇒ capacity ≈ `200 / 0.5 = 400 req/s`. Now the dependency degrades to **2 s** per call. Recompute: `200 / 2 = 100 req/s` — capacity has collapsed to a **quarter** while offered load is unchanged. At, say, 400 req/s still arriving but only 100/s draining, the surplus 300/s piles up: all 200 worker threads sit blocked, the next connections fill the `max-connections=8192` NIO queue, then the `accept-count=100` OS backlog, and everything past that is **refused (connection reset)**. Meanwhile `/health` still says UP — the pool is *saturated*, not *down* — which is exactly why the incident hides from readiness. The fix falls straight out of the formula: cap the blast radius with a **downstream timeout** (a 500 ms read timeout keeps mean service time bounded so one slow dependency can't pin all 200 threads), and only then consider raising `threads.max`. Note raising threads alone is a trap: 2000 threads at 2 s still only buys `2000/2 = 1000 req/s` while multiplying context-switch and memory cost — the timeout attacks the numerator's real problem.

**Expert — Loom / virtual threads:** With `spring.threads.virtual.enabled=true` on Boot 3.2+/Java 21, Tomcat's request-handling uses a virtual-thread-per-request executor, and `@Async`/scheduled executors also switch to virtual threads. Caveat: `synchronized` blocks around blocking I/O **pin** the carrier thread (pre-JDK 24), undermining scalability; prefer `ReentrantLock`. Thread-pool metrics (`tomcat.threads.busy`) become less meaningful under virtual threads.

**Expert — Jetty/Undertow differences that matter:** Undertow uses XNIO worker/IO threads (`server.undertow.threads.io` / `worker`) rather than a single pool; Jetty uses a `QueuedThreadPool`. Undertow does **not** support `server.compression` the same way and has historically had different WebSocket wiring. Undertow remains actively maintained (Red Hat) and supported by Boot; Tomcat is still the most common default choice.

---

## Embedded Tomcat startup flow

**Beginner:** With `spring-boot-starter-web` on the classpath, `SpringApplication.run` creates a `ServletWebServerApplicationContext` (specifically `AnnotationConfigServletWebServerApplicationContext`) instead of a plain context, and that context starts an embedded web server.

**Intermediate — the flow:**
1. `SpringApplication.run()` deduces the app type (`SERVLET` / `REACTIVE` / `NONE`) from classpath.
2. It creates a `ServletWebServerApplicationContext`.
3. Auto-configuration (`ServletWebServerFactoryAutoConfiguration`) contributes a `ServletWebServerFactory` bean — `TomcatServletWebServerFactory` by default (or Jetty/Undertow).
4. During `refresh()`, the context's `onRefresh()` calls `createWebServer()`, which uses the factory to create and **start** the embedded Tomcat (binds the port).
5. `DispatcherServlet` is registered (via `DispatcherServletAutoConfiguration` + a `ServletRegistrationBean`).
6. After refresh, a `WebServerStartStopLifecycle` finalizes startup and publishes `ServletWebServerInitializedEvent` / `ApplicationReadyEvent`.

**Advanced — gotchas:** The web server binds the port *during* context refresh (`onRefresh`), so if bean creation later fails the port may briefly bind then release. `ServletContextInitializer` beans (including `ServletRegistrationBean`, `FilterRegistrationBean`) are the Boot mechanism replacing `web.xml`. There is no `web.xml`; the `DispatcherServlet` is mapped to `/` by default. In a traditional WAR deployment you instead extend `SpringBootServletInitializer` and set packaging to `war`, and the *external* container starts, not the embedded one.

**Expert — create vs start split and `WebServerStartStopLifecycle`:** Subtle but important: `onRefresh()` → `createWebServer()` **creates** the `WebServer` and, for Tomcat, actually **binds and starts the connector** early (Tomcat starts its protocol handler on creation). The port is then listening even though bean initialization is still finishing. The final "graceful" start (marking the server ready to serve, and the phase where graceful shutdown hooks live) is driven by `WebServerStartStopLifecycle` at the **`SmartLifecycle` phase** near `Integer.MAX_VALUE`, after the context is fully refreshed. This ordering is why `ApplicationReadyEvent` fires after the server is accepting traffic, and why a bean failing late in refresh can leave a briefly-bound port.

**Expert — `ApplicationContextInitializedEvent` vs `WebServerInitializedEvent` vs `ApplicationReadyEvent`:** `ServletWebServerInitializedEvent` (has the actual port) fires when the server is initialized; `ApplicationReadyEvent` fires after all `CommandLineRunner`/`ApplicationRunner` beans complete. To read the real bound port programmatically use `@EventListener(WebServerInitializedEvent.class)` and `event.getWebServer().getPort()`, or `@LocalServerPort` in tests — reading `server.port` from the `Environment` returns `0` when configured as random.

**Expert — filter/servlet registration ordering:** `FilterRegistrationBean.setOrder(...)` controls filter chain order; `@Order`/`Ordered` on a raw `@Component Filter` is also honored via Boot's registration. A filter registered as both a `@Bean Filter` and wrapped in a `FilterRegistrationBean` can be **registered twice** (double execution) — a real gotcha; use `registration.setEnabled(false)` on the auto-registration or don't expose it as a bean directly. `DelegatingFilterProxy` (Spring Security's `springSecurityFilterChain`) sits at a low order to run early.

---

## Graceful shutdown

**Beginner:** Graceful shutdown lets in-flight requests finish before the server stops accepting new ones, avoiding dropped requests during a deploy/scale-down.

```properties
server.shutdown=graceful               # default is 'immediate'
spring.lifecycle.timeout-per-shutdown-phase=30s
```

**Intermediate — how it works:** On SIGTERM (or context close), Spring Boot:
1. Stops accepting new connections at the web server (Tomcat/Jetty/Undertow/Netty all supported).
2. Waits up to the timeout for active requests to complete.
3. New requests during the grace period get a 503 (or connection refused, depending on server).
4. Then the context closes and beans are destroyed.

Readiness state automatically flips to `REFUSING_TRAFFIC` at shutdown start, so the load balancer stops routing.

**Advanced:** Graceful shutdown requires the JVM to actually receive SIGTERM (not SIGKILL) and enough `terminationGracePeriodSeconds` in K8s (must exceed the shutdown timeout). `@PreDestroy` and `DisposableBean.destroy()` run during context close *after* the grace period. Beware `kill -9` / short K8s grace periods that cut the drain short. The `/actuator/shutdown` endpoint (POST, disabled by default) triggers a full application shutdown — different from graceful request draining; it's rarely enabled in prod.

**Expert — the SmartLifecycle phase ordering during shutdown:** Graceful shutdown is driven by `SmartLifecycle` phases run in **reverse** on stop. The web server's lifecycle (`WebServerGracefulShutdownLifecycle`, phase `SmartLifecycle.DEFAULT_PHASE - 1024` region, i.e. very high) stops **first** — it stops accepting new connections and waits (up to `spring.lifecycle.timeout-per-shutdown-phase`, default 30s, applied **per phase**) for in-flight requests. Only after that do lower-phase beans stop and `@PreDestroy`/`DisposableBean` run. So the drain window is bounded by the timeout of the web-server phase, and beans like DB connection pools are torn down **after** requests drain — the correct order.

**Expert — the K8s race and preStop hook:** Even with graceful shutdown, there's a race: when a pod is deleted, K8s simultaneously (a) sends SIGTERM and (b) removes the pod from Endpoints/EndpointSlices. Endpoint removal propagates asynchronously to kube-proxy/ingress, so for a brief window the pod may receive new traffic **after** it started refusing (503) — causing errors. The standard fix is a `preStop` hook with a small `sleep` (e.g. 5–10s) so the pod keeps serving during propagation before the app begins its drain; and ensure `terminationGracePeriodSeconds > preStop sleep + shutdown timeout`. Boot flips readiness to REFUSING_TRAFFIC on SIGTERM which helps, but the LB-propagation race is a K8s-level concern Boot alone can't close.

**Expert — what "immediate" vs "graceful" actually change:** With the default `server.shutdown=immediate`, the connector is closed abruptly and in-flight requests may be cut (client sees connection reset). `graceful` inserts the wait phase. Note graceful shutdown covers HTTP request draining only — it does NOT wait for `@Async` tasks, `@Scheduled` jobs, or message-listener containers unless those are separately configured (e.g. `spring.task.execution.shutdown.await-termination=true`, container `setShutdownTimeout`). A common bug: expecting graceful shutdown to drain a Kafka/JMS consumer — it won't unless the listener container's own shutdown is configured.

---

## Distributed tracing (Micrometer Tracing, OpenTelemetry, Zipkin/Jaeger)

**Beginner:** Distributed tracing follows a single request across multiple services. A **trace** has a `traceId`; each hop/operation is a **span** with a `spanId`. Correlating them shows end-to-end latency and where time is spent.

**Spring Boot 3.x — Micrometer Tracing:** Spring Cloud Sleuth is **gone** in Boot 3; its successor is **Micrometer Tracing** (`micrometer-tracing`), which is a facade over a **bridge**:
- `micrometer-tracing-bridge-brave` (Brave/Zipkin) — OR —
- `micrometer-tracing-bridge-otel` (OpenTelemetry).

You pick exactly one bridge. Then add a reporter/exporter:
- Zipkin: `zipkin-reporter-brave` (Brave) or `opentelemetry-exporter-zipkin` (OTel).
- OTLP (to Jaeger/OTel Collector): `opentelemetry-exporter-otlp`.

```properties
management.tracing.sampling.probability=1.0    # sample 100% (default 0.1 = 10%)
management.zipkin.tracing.endpoint=http://localhost:9411/api/v2/spans
```

**Intermediate — Observation API:** In Boot 3, tracing and metrics are unified under the **Micrometer Observation API**. A single `Observation` produces both a timer metric and a span. `@Observed` (with an `ObservedAspect` bean) or `ObservationRegistry` creates observations. Auto-instrumentation covers incoming HTTP (`http.server.requests`), `RestTemplate`/`WebClient`, and more when they use the shared `ObservationRegistry`.

**Advanced:**
- **Sampling** defaults to 0.1 (10%) — a common "why are my traces missing?" gotcha. Set to 1.0 in dev.
- **Context propagation:** trace context is carried across HTTP via W3C `traceparent` header (OTel default) or B3 headers (Brave/Zipkin default). Across threads use Micrometer's `ContextPropagation` / `ContextSnapshot` (or `ThreadLocalAccessor`) so trace + MDC survive thread hops in async/reactive code.
- **Jaeger** now natively ingests OTLP, so the OTel bridge + OTLP exporter is the modern path; Zipkin uses the Brave bridge or the OTel Zipkin exporter.

**Expert — two bridges on the classpath = broken:** You must have **exactly one** tracing bridge. If both `micrometer-tracing-bridge-brave` and `micrometer-tracing-bridge-otel` are present, auto-configuration produces two `Tracer` beans and startup fails or tracing behaves unpredictably — a frequent "it worked then I added a dependency" incident. Similarly, the propagation format must match across services: Brave defaults to B3, OTel to W3C `traceparent`; a Brave service calling an OTel service without configuring shared propagation drops the trace at the boundary (new trace starts). Configure `management.tracing.propagation.type` to align them.

**Expert — sampling is head-based and per-trace, not per-span:** `management.tracing.sampling.probability` is a **head sampler** decision made at the root span and propagated via the `sampled` flag in `traceparent`/B3 — all downstream services honor the upstream decision, so you can't "sample more" downstream. This means partial traces are rare but also that a low probability at the edge silently drops entire traces for downstream teams. For always-on capture in specific flows, use a custom `Sampler`/`SamplerFunction` or bump probability to 1.0. Sampling affects **spans/traces exported**, not the metric side of an `Observation` — the timer is always recorded even when the span is not sampled.

> [!INTERVIEW]
> **"Why not just sample 100% in prod, and how do you still keep every error trace at 10%?"** Head sampling is decided at the edge *before* the request runs, so it's cheap (no buffering) but **blind** — at `probability=0.1` you keep a random 10% and silently discard 90%, including 90% of your error and slow traces, exactly the ones you want during an incident. You don't run 100% because trace volume ≈ QPS: at 10k req/s, 100% sampling is 10k traces/s of span export, storage, and egress, and it creates exporter backpressure that can stall the app. The senior answer is **tail-based sampling**: buffer complete traces in the **OTel Collector** (out of process, not in-app) and decide *after* seeing the outcome — keep 100% of error/slow traces and, say, 5% of the successful ones. You pay for the Collector's memory/buffering instead of the app's, and you keep the signal (errors) while shedding the noise (fast successes). Head sampling can't do this because the keep/drop decision is already frozen in `traceparent` before the error happens.

**Expert — Observation lifecycle and `ObservationHandler`:** An `Observation` has `start()` → `openScope()` (binds ThreadLocal context, e.g. MDC/trace) → `close()` scope → `stop()`. `ObservationHandler`s (metrics handler, tracing handler) hook these events. If you manually create observations, forgetting `openScope()`/scope close means the span won't be current and child spans/log correlation break. `@Observed` (needs `ObservedAspect` bean) manages the lifecycle for you but is subject to the same AOP self-invocation limitation as `@Timed`.

---

## MDC and correlation IDs

**Beginner:** MDC (Mapped Diagnostic Context) is SLF4J/Logback's per-thread key/value map that gets injected into every log line, so you can tag logs with a request/correlation ID and grep all logs for one request.

**Intermediate — with Micrometer Tracing:** When tracing is on, Boot 3 automatically puts `traceId` and `spanId` into the MDC and the default log pattern includes them:

```
%5p [${spring.application.name:},%X{traceId:-},%X{spanId:-}]
```

So every log line for a request shows its trace/span IDs — you can jump from logs to the trace in Zipkin/Jaeger and back.

**Advanced:** You can add your own correlation ID via a servlet `Filter` that reads an incoming header (or generates a UUID) and calls `MDC.put("correlationId", id)` — always `MDC.remove`/`clear` in a `finally` to avoid leaking values onto pooled threads. For async/reactive, plain `ThreadLocal` MDC does not propagate automatically; use `TaskDecorator` (for `@Async`/executors) or Micrometer context-propagation `ThreadLocalAccessor` / Reactor's `Hooks.enableAutomaticContextPropagation()` to carry MDC across threads.

**Expert — why reactive MDC breaks and the correct fix:** In WebFlux a single request hops across event-loop threads, so `ThreadLocal`-backed MDC set at the start is empty by the time a downstream operator logs. The Boot 3 fix is Micrometer **context-propagation**: register `ThreadLocalAccessor`s (Boot auto-registers ones for trace context), store values in the Reactor `Context`, and enable `Hooks.enableAutomaticContextPropagation()` so the framework restores ThreadLocals around each operator on each thread. Manually calling `MDC.put` in a reactive chain is an anti-pattern — it "works" only if the very next operator runs on the same thread. For `@Async`/`ThreadPoolTaskExecutor`, wrap with a `TaskDecorator` that snapshots the parent MDC (`MDC.getCopyOfContextMap()`) and restores it in the worker, clearing in `finally`.

**Expert — trace-context MDC keys and the accessor ordering:** Boot puts `traceId`/`spanId` into MDC via a `ThreadLocalAccessor` tied to the tracer, not by manual `MDC.put`. If you clear the entire MDC in a filter's `finally` (`MDC.clear()`) you can wipe trace keys mid-request if ordering is wrong; prefer `MDC.remove("yourKey")` for keys you own rather than a blanket clear. Under virtual threads, `ThreadLocal`/MDC still works per-virtual-thread, but very large numbers of virtual threads each holding an MDC map can add memory pressure — keep MDC entries small.

---

## Logging: SLF4J, Logback, Log4j2

**Beginner:** SLF4J is the logging **facade** (API you code against); the **implementation** does the actual work. Spring Boot's default implementation is **Logback** (via `spring-boot-starter-logging`, pulled in by every starter). Boot preconfigures console + optional file appenders and a sensible default pattern.

**Configuration basics:**
```properties
logging.level.root=INFO
logging.level.org.springframework.web=DEBUG
logging.file.name=app.log          # or logging.file.path
logging.pattern.console=...
```

**Intermediate — switching to Log4j2:** Exclude the default logging starter and add Log4j2:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-web</artifactId>
  <exclusions>
    <exclusion>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-logging</artifactId>
    </exclusion>
  </exclusions>
</dependency>
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-log4j2</artifactId>
</dependency>
```

Config file conventions: `logback-spring.xml` (Logback) or `log4j2-spring.xml` (Log4j2). Prefer the `-spring` variants — they let Spring process them (enabling `<springProfile>` and `<springProperty>`); plain `logback.xml` is loaded too early by the logging system for Spring extensions to work.

**Advanced:**
- Boot routes JUL, Log4j, and Apache Commons Logging into SLF4J via bridge jars so libraries using other APIs still log through your chosen backend.
- Log4j2 with the disruptor (async logger) can outperform Logback under heavy load; Logback also has `AsyncAppender`.
- **Log4Shell (CVE-2021-44228):** applied to Log4j2 ≤ 2.14 (JNDI lookup RCE) — not Logback or SLF4J; a frequent trivia trap. Fixed in Log4j2 2.17+.
- For JSON/structured logging, Spring Boot 3.4+ has built-in support (`logging.structured.format.console=ecs|logstash|gelf`); earlier versions used `logstash-logback-encoder`.

**Expert — logging initialization timing:** The `LoggingSystem` is initialized very early — before the `ApplicationContext` refreshes — by `LoggingApplicationListener` reacting to `ApplicationEnvironmentPreparedEvent`. This is why `logback.xml` (loaded directly by Logback's own init) can't see `<springProfile>`/`<springProperty>`: those need Spring, and by the time Spring could process them plain `logback.xml` is already applied. `logback-spring.xml` defers to Spring's initializer. It's also why logging config can't reference beans and why very early log output uses defaults until the system is configured.

**Expert — bridges and classpath conflicts:** Boot routes JUL (via `jul-to-slf4j`), log4j 1.x, and JCL into SLF4J. A classic trap is having **both** a real logging backend and a leftover bridge that points the other way (e.g. `slf4j-log4j12` alongside Logback), causing `SLF4J: Class path contains multiple SLF4J bindings` or `StackOverflowError` from a bridge loop (`jcl-over-slf4j` + `commons-logging`). Exclude conflicting bindings. When switching to Log4j2, you must exclude `spring-boot-starter-logging` **everywhere it's transitively pulled**, or Logback stays on the classpath and SLF4J may bind to it instead.

**Expert — async logging semantics and loss:** Logback `AsyncAppender` and Log4j2's disruptor-based async loggers decouple the app thread from I/O, but on a hard crash / `kill -9` the in-flight ring buffer/queue is **lost** (not flushed) — a reason to keep audit/security logs synchronous. Logback `AsyncAppender` also **drops** events below a threshold when the queue is 80% full by default (`discardingThreshold`) — TRACE/DEBUG/INFO can silently vanish under load unless you set `neverBlock`/`discardingThreshold=0`. This "where did my logs go under load?" behavior is a senior-level gotcha.

---

## Common follow-up questions

- Why does `/actuator/metrics` not return Prometheus text? `/metrics` is Micrometer's own JSON navigation endpoint. Prometheus scrapes the separate `/actuator/prometheus` endpoint, which only exists when `micrometer-registry-prometheus` is on the classpath.
- What's the difference between enabling and exposing an endpoint? Enabling controls whether the endpoint bean/feature exists; exposing controls whether an enabled endpoint is reachable over HTTP/JMX. `shutdown` is disabled by default and must be both enabled and exposed.
- Liveness vs readiness — which should check the database? Readiness may check external deps (so traffic stops when they're down); liveness should NOT, or a transient DB outage will trigger pod restarts across the fleet.
- Sleuth vs Micrometer Tracing? Sleuth was removed in Boot 3; use Micrometer Tracing with a Brave or OTel bridge. Auto-config lives under `management.tracing.*` and `management.zipkin.*`.
- Default sampling rate for traces? 0.1 (10%). Set `management.tracing.sampling.probability=1.0` to capture all.
- How do I change a log level without redeploying? `POST /actuator/loggers/{name}` with `{"configuredLevel":"DEBUG"}`.
- Which server does WebFlux use by default? Netty (Reactor Netty), not Tomcat.
- How does graceful shutdown avoid 500s during deploys? New connections are refused, in-flight requests finish within `spring.lifecycle.timeout-per-shutdown-phase`, and readiness flips to REFUSING_TRAFFIC so the LB drains the pod.
- Why is my gauge reporting NaN? Micrometer holds a weak reference to the gauged object; if it's GC'd (no strong reference), the gauge reports NaN.
- What's a dangerous metric-tag mistake? High-cardinality tags (user IDs, raw URLs) create unbounded time series and can OOM the registry/backend.

## References

- Spring Boot Reference — Actuator: https://docs.spring.io/spring-boot/reference/actuator/index.html
- Spring Boot Actuator Endpoints: https://docs.spring.io/spring-boot/reference/actuator/endpoints.html
- Spring Boot — Metrics (Micrometer): https://docs.spring.io/spring-boot/reference/actuator/metrics.html
- Spring Boot — Tracing: https://docs.spring.io/spring-boot/reference/actuator/tracing.html
- Spring Boot — Kubernetes Probes: https://docs.spring.io/spring-boot/reference/actuator/endpoints.html#actuator.endpoints.kubernetes-probes
- Spring Boot — Embedded Web Servers: https://docs.spring.io/spring-boot/reference/web/servlet.html#web.servlet.embedded-container
- Spring Boot — Graceful Shutdown: https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html
- Spring Boot — Logging: https://docs.spring.io/spring-boot/reference/features/logging.html
- Micrometer docs: https://micrometer.io/docs
- Micrometer Tracing: https://docs.micrometer.io/tracing/reference/
- Baeldung — Spring Boot Actuator: https://www.baeldung.com/spring-boot-actuator
- Baeldung — Micrometer & Prometheus: https://www.baeldung.com/micrometer
- Baeldung — Spring Boot 3 Tracing: https://www.baeldung.com/spring-boot-3-observability
