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

**Advanced — health groups:** You can group indicators:

```properties
management.endpoint.health.group.custom.include=db,diskSpace
management.endpoint.health.group.custom.show-details=always
```

Accessible at `/actuator/health/custom`. Groups are the mechanism behind liveness/readiness. You can also configure per-group status mapping and `additional-path` to expose a group on the main server port.

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

**Advanced — CompositeMeterRegistry & common tags:** Multiple registries are combined into a `CompositeMeterRegistry`; a meter is published to all of them. Add common tags to every metric via a `MeterRegistryCustomizer`:

```java
@Bean
MeterRegistryCustomizer<MeterRegistry> commonTags(
        @Value("${spring.application.name}") String app) {
    return registry -> registry.config().commonTags("application", app, "region", "us-east-1");
}
```

Spring Boot auto-configures many binders: JVM (memory, GC, threads), system (CPU), Logback, Tomcat, HikariCP, HTTP client/server. `http.server.requests` (a `Timer`) is auto-instrumented for every MVC/WebFlux endpoint.

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
| **Undertow** | No | High-performance, non-blocking, low memory (JBoss) — no longer maintained by Red Hat as of 2024 but still supported by Boot |

**Intermediate — WebFlux:** For reactive `spring-boot-starter-webflux`, the default embedded server is **Netty** (Reactor Netty), not Tomcat. Tomcat/Jetty/Undertow can also run WebFlux (on their non-blocking connectors), but Netty is the reactive default.

**Advanced — customization:** Configure via `server.*` properties (`server.port`, `server.tomcat.threads.max`, `server.tomcat.accept-count`, `server.tomcat.max-connections`, `server.compression.enabled`). For programmatic tuning implement `WebServerFactoryCustomizer<TomcatServletWebServerFactory>`. `server.port=0` picks a random free port (useful in tests; read it via `@LocalServerPort`). `server.port=-1` disables HTTP entirely.

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

---

## MDC and correlation IDs

**Beginner:** MDC (Mapped Diagnostic Context) is SLF4J/Logback's per-thread key/value map that gets injected into every log line, so you can tag logs with a request/correlation ID and grep all logs for one request.

**Intermediate — with Micrometer Tracing:** When tracing is on, Boot 3 automatically puts `traceId` and `spanId` into the MDC and the default log pattern includes them:

```
%5p [${spring.application.name:},%X{traceId:-},%X{spanId:-}]
```

So every log line for a request shows its trace/span IDs — you can jump from logs to the trace in Zipkin/Jaeger and back.

**Advanced:** You can add your own correlation ID via a servlet `Filter` that reads an incoming header (or generates a UUID) and calls `MDC.put("correlationId", id)` — always `MDC.remove`/`clear` in a `finally` to avoid leaking values onto pooled threads. For async/reactive, plain `ThreadLocal` MDC does not propagate automatically; use `TaskDecorator` (for `@Async`/executors) or Micrometer context-propagation `ThreadLocalAccessor` / Reactor's `Hooks.enableAutomaticContextPropagation()` to carry MDC across threads.

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

---

## Common follow-up questions

- **Why does `/actuator/metrics` not return Prometheus text?** `/metrics` is Micrometer's own JSON navigation endpoint. Prometheus scrapes the separate `/actuator/prometheus` endpoint, which only exists when `micrometer-registry-prometheus` is on the classpath.
- **What's the difference between enabling and exposing an endpoint?** Enabling controls whether the endpoint bean/feature exists; exposing controls whether an enabled endpoint is reachable over HTTP/JMX. `shutdown` is disabled by default and must be both enabled and exposed.
- **Liveness vs readiness — which should check the database?** Readiness may check external deps (so traffic stops when they're down); liveness should NOT, or a transient DB outage will trigger pod restarts across the fleet.
- **Sleuth vs Micrometer Tracing?** Sleuth was removed in Boot 3; use Micrometer Tracing with a Brave or OTel bridge. Auto-config lives under `management.tracing.*` and `management.zipkin.*`.
- **Default sampling rate for traces?** 0.1 (10%). Set `management.tracing.sampling.probability=1.0` to capture all.
- **How do I change a log level without redeploying?** `POST /actuator/loggers/{name}` with `{"configuredLevel":"DEBUG"}`.
- **Which server does WebFlux use by default?** Netty (Reactor Netty), not Tomcat.
- **How does graceful shutdown avoid 500s during deploys?** New connections are refused, in-flight requests finish within `spring.lifecycle.timeout-per-shutdown-phase`, and readiness flips to REFUSING_TRAFFIC so the LB drains the pod.
- **Why is my gauge reporting NaN?** Micrometer holds a weak reference to the gauged object; if it's GC'd (no strong reference), the gauge reports NaN.
- **What's a dangerous metric-tag mistake?** High-cardinality tags (user IDs, raw URLs) create unbounded time series and can OOM the registry/backend.

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
