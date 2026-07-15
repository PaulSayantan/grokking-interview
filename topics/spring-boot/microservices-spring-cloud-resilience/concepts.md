# Microservices, Spring Cloud & Resilience

A practical, interview-focused tour of building distributed systems with Spring Boot and
Spring Cloud: the architectural trade-offs, the core infrastructure components (gateway,
discovery, config), the client-side patterns (load balancing, declarative clients), the
resilience toolbox (Resilience4j), observability (distributed tracing), and the data/consistency
patterns (saga, CQRS, event sourcing, idempotency).

> **Version note (Spring Boot 3.x / Spring Cloud 2022.x+):** Spring Boot 3 requires Java 17+
> and migrates from `javax.*` to `jakarta.*` namespaces. **Spring Cloud Sleuth is gone** —
> tracing moved to **Micrometer Tracing** + **Micrometer Observation API**. **Netflix Ribbon
> and Hystrix are removed/EOL** — replaced by **Spring Cloud LoadBalancer** and **Resilience4j**.
> Spring Cloud release trains are now named by year (e.g. `2023.0.x` "Leyton") rather than
> London-Tube names (Hoxton, etc.).

---

## Monolith vs Microservices Trade-offs

**Beginner definition.** A *monolith* packages all functionality into a single deployable
unit (one process, one build artifact, usually one database). *Microservices* decompose the
system into small, independently deployable services, each owning its data and communicating
over the network (REST, gRPC, messaging).

**Why it matters.** The choice drives your team topology, deployment cadence, failure modes,
and operational cost. Microservices are an *organizational* solution as much as a technical one
(Conway's Law: system structure mirrors team structure).

**Trade-offs table:**

| Dimension | Monolith | Microservices |
|---|---|---|
| Deployment | One unit, all-or-nothing | Independent per service |
| Scaling | Scale the whole app | Scale hot services only |
| Tech diversity | Usually one stack | Polyglot possible |
| Data | Single DB, ACID transactions, JOINs | DB-per-service, eventual consistency |
| Failure isolation | One bug can crash everything | Blast radius contained (if designed well) |
| Latency | In-process calls | Network hops, serialization |
| Testing | Simple, in-process | Needs contract/integration testing |
| Operational cost | Low | High (observability, CI/CD, infra) |
| Consistency | Easy (transactions) | Hard (sagas, idempotency) |

**Intermediate trade-offs.** Microservices trade *development-time simplicity* for
*run-time complexity*. You gain independent deployability and fault isolation but inherit the
[fallacies of distributed computing](https://en.wikipedia.org/wiki/Fallacies_of_distributed_computing)
(the network is NOT reliable, zero-latency, or infinitely bandwidth-rich). Cross-service
transactions require sagas; queries that were a SQL `JOIN` become API composition or CQRS
read models.

**Advanced gotchas.**
- **Distributed monolith** is the worst of both worlds: services that must be deployed together,
  share a database, or call each other synchronously in long chains. Signs: a change to one
  service forces coordinated releases of others.
- **Prefer starting with a modular monolith** ("modulith") and extract services along proven
  seams. Premature decomposition creates chatty services and painful data migrations.
- **Database-per-service is the defining constraint.** Sharing a database couples services at
  the schema level and destroys independent deployability.
- Right-sizing: a service should map to a *bounded context* (DDD), not to a single class or
  a single table.

---

## API Gateway (Spring Cloud Gateway)

**Beginner definition.** An API Gateway is a single entry point that sits in front of your
services and routes client requests to the right backend, handling cross-cutting concerns
(auth, rate limiting, CORS, TLS termination, request/response transformation) in one place.

**Spring Cloud Gateway (SCG)** is the modern, reactive gateway built on **Spring WebFlux /
Project Reactor / Netty** — it is non-blocking and replaced the older, servlet-based
**Spring Cloud Netflix Zuul 1** (which is in maintenance). SCG's model is
**Route = Predicate(s) + Filter(s) + URI**:

- **Predicate** — matches requests (path, host, method, header, query, time-based, weight).
- **Filter** — modifies request/response (add/remove headers, rewrite path, retry, circuit
  breaker, rate limiter). Filters can be *pre* or *post*.
- **URI** — the destination (a concrete URL or `lb://service-id` for discovery-backed
  load balancing).

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: orders
          uri: lb://order-service          # lb:// => Spring Cloud LoadBalancer
          predicates:
            - Path=/api/orders/**
          filters:
            - StripPrefix=1
            - name: CircuitBreaker
              args:
                name: ordersCB
                fallbackUri: forward:/fallback/orders
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 20
```

**Intermediate.** SCG's `RequestRateLimiter` uses a **Redis-backed token-bucket** by default
and needs a `KeyResolver` bean (e.g. by user, by API key, by IP). Because SCG is reactive,
blocking code inside custom filters will stall the event loop — never call blocking JDBC/REST
there.

**Advanced gotchas.**
- **Spring Cloud Gateway MVC / Server WebMVC** (newer) offers a *servlet-based* gateway for
  teams that want the gateway on a blocking stack — but classic SCG is reactive.
- **Gateway vs BFF (Backend-for-Frontend):** a single gateway is generic; a BFF is a gateway
  tailored to one client type (web, mobile). You can run multiple BFFs behind one edge.
- Don't put business logic in the gateway — keep it to routing and cross-cutting concerns,
  or it becomes a shared bottleneck and a distributed monolith hub.
- **Aggregation** (composing multiple downstream calls into one response) is best done in a
  BFF/composition service, not in generic gateway filters.

---

## Service Discovery (Eureka)

**Beginner definition.** In a dynamic environment instances come and go and get ephemeral IPs.
*Service discovery* lets a service find healthy instances of another service by logical name
instead of hard-coded host:port. **Netflix Eureka** is a discovery **server (registry)**;
clients **register** themselves and **fetch** the registry to locate peers.

**Client-side vs server-side discovery:**
- **Client-side** (Eureka + Spring Cloud LoadBalancer): the client fetches the instance list
  and picks one itself. No extra network hop.
- **Server-side** (AWS ELB, Kubernetes Service): a load balancer/router does the lookup;
  the client just calls a stable virtual address.

```java
@SpringBootApplication
@EnableEurekaServer   // on the registry app
public class RegistryApp { }

// clients: just add spring-cloud-starter-netflix-eureka-client;
// @EnableDiscoveryClient is optional/auto in modern Spring Cloud.
```

**Intermediate — how Eureka stays available.**
- Clients send **heartbeats** (default every 30s). If the server misses heartbeats
  (default eviction after 90s), it evicts the instance.
- Clients **cache** the registry locally (refresh default 30s) so they can keep routing even
  if the registry is briefly down.
- **Self-preservation mode:** if too many heartbeats are lost at once (likely a network
  partition, not mass instance death), Eureka *stops* evicting instances to avoid removing
  healthy ones — favoring availability. This can serve stale entries; it's a deliberate
  **AP** (over CP) choice in CAP terms.

**Advanced gotchas.**
- Registration is **eventually consistent** — a newly started instance may not be discoverable
  for tens of seconds due to heartbeat + cache refresh delays. Tune `leaseRenewalIntervalInSeconds`
  and client `registryFetchIntervalSeconds` for faster (but chattier) propagation.
- **On Kubernetes you often skip Eureka** and use the platform's DNS-based Service discovery;
  running Eureka *inside* k8s duplicates the platform's job.
- Alternatives: **Consul**, **Zookeeper**, **etcd**, **Nacos** — Spring Cloud has starters for
  Consul/Zookeeper. Eureka is AP; Zookeeper/etcd are CP.

---

## Distributed and Centralized Configuration (Spring Cloud Config and Bus)

**Beginner definition.** Instead of baking config into each service, **Spring Cloud Config
Server** externalizes it into a central store (usually a **Git** repo) and serves it over HTTP.
Services (Config **clients**) fetch their config at startup based on `{application}`, `{profile}`,
and `{label}` (git branch/tag).

```
GET /{application}/{profile}[/{label}]
e.g. /order-service/prod   ->  merges application.yml + order-service-prod.yml
```

**Intermediate.**
- **Property precedence:** more specific wins — service-specific + profile-specific overrides
  the shared `application.yml`. External config from the Config Server overrides the packaged
  `application.yml` in the client jar.
- **Secrets:** Config Server can encrypt values (`{cipher}...`) using a symmetric/asymmetric
  key, or integrate with **HashiCorp Vault** as a backend.
- **Import mechanism (Boot 2.4+):** clients use `spring.config.import=configserver:` rather
  than the legacy `bootstrap.yml` (which required `spring-cloud-starter-bootstrap`).

**Refreshing config without restart.**
- `@RefreshScope` beans are re-created on a `POST /actuator/refresh`, picking up new values.
- To refresh *many* instances at once, **Spring Cloud Bus** links them over a message broker
  (RabbitMQ/Kafka). A single `POST /actuator/busrefresh` broadcasts a `RefreshRemoteApplicationEvent`
  so every instance refreshes — this is the "push to all" pattern (often triggered by a Git
  webhook → `/monitor`).

**Advanced gotchas.**
- Only `@RefreshScope`/`@ConfigurationProperties` beans pick up changes; things bound once at
  startup (e.g. `@Value` in a singleton not in refresh scope, connection pool sizes, server
  port) generally do **not** change live.
- The Config Server is a **runtime dependency** — if it's down and a client restarts, the
  client can fail to boot. Use `spring.cloud.config.fail-fast` + retry, or a local fallback.
- Config drift and secrets in Git are common pitfalls; prefer Vault or encrypted values and
  audit the repo.

---

## Client-Side Load Balancing (Spring Cloud LoadBalancer)

**Beginner definition.** **Client-side load balancing** means the *calling* service holds the
list of target instances and chooses one per request (no dedicated LB hop). **Spring Cloud
LoadBalancer (SCL)** is the modern, reactive replacement for the now-removed **Netflix Ribbon**.

**How it's wired.** A `@LoadBalanced` `RestTemplate`/`WebClient`, or an OpenFeign client, uses
a logical service id (`http://order-service/...`). SCL resolves that id via the
`DiscoveryClient` (Eureka/Consul/etc.) to a list of `ServiceInstance`s and applies a
`ReactorServiceInstanceLoadBalancer`.

```java
@Bean
@LoadBalanced
RestTemplate restTemplate() { return new RestTemplate(); }

// usage: logical name resolved + balanced across instances
restTemplate.getForObject("http://order-service/orders/1", Order.class);
```

**Intermediate.**
- **Default algorithm is round-robin** (`RoundRobinLoadBalancer`). `RandomLoadBalancer` is also
  provided.
- **Client-side caching** of the instance list avoids a discovery lookup on every call
  (`CachingServiceInstanceListSupplier`), with periodic refresh.
- **Health checks / hints / zone-affinity** can be layered via `ServiceInstanceListSupplier`
  configuration (e.g. `health-check`, `same-zone` filtering).

**Advanced gotchas.**
- SCL vs server-side LB: client-side avoids an extra network hop and enables smart, per-request
  policies, but every client must embed the balancing logic and stay in sync with discovery.
- Configuration is **per-client** via a `@LoadBalancerClient(name="...", configuration=...)`
  class — beware defining a load-balancer `@Configuration` as a top-level `@Configuration`
  (it would be picked up globally); it should sit outside the main `@ComponentScan` and be
  referenced explicitly.
- SCL is reactive under the hood; when used with a blocking `RestTemplate` a blocking bridge
  is used.

---

## Declarative REST Clients (OpenFeign)

**Beginner definition.** **Spring Cloud OpenFeign** lets you call another service by declaring
a Java interface annotated with the endpoint mapping — Feign generates the HTTP client at
runtime. No boilerplate `RestTemplate` code.

```java
@FeignClient(name = "order-service", fallback = OrderFallback.class)
public interface OrderClient {
    @GetMapping("/orders/{id}")
    Order getOrder(@PathVariable Long id);
}
// enable with @EnableFeignClients on a config/app class
```

**Intermediate.**
- `name`/`value` is the **logical service id**, so Feign integrates with discovery + Spring
  Cloud LoadBalancer automatically (`url` can override for a fixed host).
- Feign uses Spring MVC contract annotations (`@GetMapping`, `@RequestParam`, `@RequestHeader`)
  — but they behave as *client* declarations, not server mappings.
- **Resilience:** wire Resilience4j so Feign calls get circuit breaking; `fallback`/
  `fallbackFactory` provide graceful degradation (fallbackFactory also gives you the cause).

**Advanced gotchas.**
- **Default Feign timeouts and no retry** trip people up. Feign's built-in `Retryer` is
  `Retryer.NEVER_RETRY` by default; connect/read timeouts are configurable per client.
- **Error decoding:** non-2xx responses throw `FeignException` by default; a custom
  `ErrorDecoder` maps status codes to domain exceptions.
- **Propagating headers** (auth token, trace id, correlation id) requires a
  `RequestInterceptor` — they are NOT forwarded automatically.
- Feign can run over Apache HttpClient/OkHttp for connection pooling instead of the default
  JDK `HttpURLConnection`.
- `@SpringQueryMap` binds a POJO to query params; `@PathVariable`/`@RequestParam` **require the
  explicit name** on interfaces (parameter-name inference is unreliable without `-parameters`).

---

## Resilience4j Circuit Breaker

**Beginner definition.** A **circuit breaker** protects a caller from a failing dependency:
when failures cross a threshold, the breaker **opens** and fails fast (or falls back) instead
of hammering a sick service and exhausting threads. **Resilience4j** is the lightweight,
functional-programming library that replaced the now-EOL **Netflix Hystrix**.

**The three main states:**

| State | Behavior | Transition |
|---|---|---|
| **CLOSED** | Calls pass through; failures counted in a sliding window | → OPEN when failure rate ≥ threshold |
| **OPEN** | Calls fail fast immediately (`CallNotPermittedException`) / fallback runs | → HALF_OPEN after `waitDurationInOpenState` |
| **HALF_OPEN** | A limited number of *trial* calls allowed | → CLOSED if they succeed, → OPEN if they fail |

Two extra optional states: **DISABLED** (always allow) and **FORCED_OPEN** (always block).

```yaml
resilience4j.circuitbreaker:
  instances:
    orderService:
      sliding-window-type: COUNT_BASED       # or TIME_BASED
      sliding-window-size: 10
      failure-rate-threshold: 50              # % failures to open
      slow-call-rate-threshold: 100
      slow-call-duration-threshold: 2s
      wait-duration-in-open-state: 10s
      permitted-number-of-calls-in-half-open-state: 3
      minimum-number-of-calls: 5              # need N calls before rate is computed
```

```java
@CircuitBreaker(name = "orderService", fallbackMethod = "fallback")
public Order getOrder(Long id) { return client.getOrder(id); }

public Order fallback(Long id, Throwable t) { return Order.cached(id); }
```

**Intermediate.**
- Resilience4j uses a **sliding window** (count- or time-based), not Hystrix's rolling bucket
  design. `minimumNumberOfCalls` prevents opening on a tiny sample.
- **Slow calls** also trip the breaker (`slowCallRateThreshold` + `slowCallDurationThreshold`),
  not just exceptions.
- Fallback method must have the **same signature plus a trailing `Throwable`/exception param**
  and matching return type. You can register `recordExceptions` / `ignoreExceptions`.

**Advanced gotchas.**
- Resilience4j is built on **decorators / functional interfaces** and is far lighter than
  Hystrix (no dedicated thread pool per command by default — it uses semaphore-style bulkhead;
  thread-pool bulkhead is a separate module).
- **Aspect ordering** matters when combining annotations. Default order (outer→inner):
  **Retry → CircuitBreaker → RateLimiter → TimeLimiter → Bulkhead**. So retry wraps the circuit
  breaker: a retried call that opens the breaker will see `CallNotPermittedException`.
- The breaker records the *result of the whole decorated call*; combine with TimeLimiter so a
  hung call counts as a failure rather than blocking forever.

---

## Resilience4j Retry, Rate Limiter, Bulkhead, Time Limiter

**Retry.** Automatically re-invokes on configured exceptions.
- Configure `maxAttempts` (includes the first call), `waitDuration`, and backoff
  (`enableExponentialBackoff`, `exponentialBackoffMultiplier`) plus optional jitter
  (`enableRandomizedWait`) to avoid a **retry storm / thundering herd**.
- **Only retry idempotent operations** — retrying a non-idempotent POST can double-charge.
- Retry `retryExceptions`/`ignoreExceptions` control what triggers a retry.

**Rate Limiter.** Caps the *rate* of calls (throughput throttling).
- Config: `limitForPeriod` (permits per cycle), `limitRefreshPeriod` (cycle length),
  `timeoutDuration` (how long a caller waits for a permit before `RequestNotPermitted`).
- Protects a downstream from being overwhelmed; different from bulkhead which caps *concurrency*.

**Bulkhead.** Limits **concurrent** calls so one slow dependency can't consume all threads
(named after ship compartments). Two flavors:
- **`SemaphoreBulkhead`** (default) — counts concurrent permits, no extra threads.
- **`ThreadPoolBulkhead`** — isolates calls in a bounded thread pool + queue (like Hystrix's
  thread isolation); enables true timeouts on blocking calls and returns a `CompletableFuture`.

**Time Limiter.** Caps how long an async call may run; cancels/times-out otherwise.
- Works on `CompletableFuture`/reactive types; `timeoutDuration`, `cancelRunningFuture`.
- Commonly paired with `ThreadPoolBulkhead` (a blocking call must run on another thread to be
  interruptible).

```yaml
resilience4j.retry.instances.orderService:
  max-attempts: 3
  wait-duration: 200ms
  enable-exponential-backoff: true
  exponential-backoff-multiplier: 2
resilience4j.ratelimiter.instances.orderService:
  limit-for-period: 100
  limit-refresh-period: 1s
  timeout-duration: 0
resilience4j.bulkhead.instances.orderService:      # semaphore
  max-concurrent-calls: 20
resilience4j.thread-pool-bulkhead.instances.orderService:
  core-thread-pool-size: 10
  max-thread-pool-size: 20
  queue-capacity: 50
resilience4j.timelimiter.instances.orderService:
  timeout-duration: 2s
```

**Advanced gotchas.**
- **Rate limiter vs bulkhead:** rate limiter bounds *calls per unit time*; bulkhead bounds
  *simultaneous in-flight calls*. A slow dependency saturates a bulkhead even at low request
  rate.
- **TimeLimiter needs async execution** — annotating a plain blocking method with
  `@TimeLimiter` alone won't interrupt it; you need a `CompletableFuture`/`ThreadPoolBulkhead`.
- Combining Retry + CircuitBreaker: retries happen *outside* the breaker by default, so failed
  retries feed the breaker's failure count.
- Every decorator emits **Micrometer metrics** and events for observability.

---

## Distributed Tracing (Sleuth and Micrometer Tracing)

**Beginner definition.** In a distributed system one user request fans out across many
services. **Distributed tracing** stitches those hops into a single **trace** made of **spans**
(each span = one unit of work) so you can see the end-to-end path and latency.

**Key terms.**
- **Trace ID** — one per end-to-end request, propagated across services.
- **Span ID** — one per operation; spans form a parent/child tree.
- **Context propagation** — trace/span ids travel in headers (**W3C `traceparent`** or legacy
  **B3** headers) so downstream services join the same trace.

**Spring Boot 2 vs 3.** Spring Boot 2 used **Spring Cloud Sleuth** (auto-instrumentation +
`Brave`/`Zipkin`). **Spring Boot 3 removed Sleuth**; tracing is now **Micrometer Tracing**
(a facade over Brave or OpenTelemetry) driven by the **Micrometer Observation API**. You add
`micrometer-tracing-bridge-brave` (or `-otel`) plus a reporter like `zipkin-reporter-brave`
or an OTLP exporter.

```
Boot 2:  spring-cloud-starter-sleuth  +  spring-cloud-sleuth-zipkin
Boot 3:  micrometer-tracing-bridge-brave  +  zipkin-reporter-brave
         (Observation API auto-instruments web, WebClient, scheduled, etc.)
```

**Intermediate.**
- Trace/span ids are injected into **MDC**, so log lines carry `[app,traceId,spanId]` — pair
  with a log aggregator (ELK/Loki) to jump from a trace to logs.
- **Sampling** controls overhead: `management.tracing.sampling.probability` (e.g. `0.1` = 10%).
  Sampling decision is made once and propagated so a trace is sampled consistently end-to-end.
- Backends: **Zipkin**, **Jaeger**, **Tempo**, any OTLP-compatible collector.

**Advanced gotchas.**
- Instrumenting *async* boundaries (`@Async`, thread pools, messaging) requires context
  propagation; Micrometer's `ContextSnapshot`/`ContextPropagation` handles wrapping executors.
- The **Observation API** unifies metrics + tracing + logging from one instrumentation point —
  one `Observation` produces a timer *and* a span.
- Manual spans: inject `Tracer` (Micrometer) or `ObservationRegistry` and wrap custom work; on
  Sleuth you used `Tracer`/`@NewSpan`.

---

## Saga Pattern (Distributed Transactions)

**Beginner definition.** With database-per-service you can't use one ACID transaction across
services. A **saga** models a business transaction as a **sequence of local transactions**,
each publishing an event/message that triggers the next step. If a step fails, the saga runs
**compensating transactions** to semantically undo the prior steps.

**Two coordination styles:**

| Style | How it works | Pros | Cons |
|---|---|---|---|
| **Choreography** | Each service reacts to events and emits its own; no central coordinator | Loose coupling, simple to start | Hard to follow/ debug flow, cyclic dependencies, no single view |
| **Orchestration** | A central **orchestrator** tells each service what to do and handles compensations | Explicit, testable flow, easier to reason about | Orchestrator is a dependency; risk of centralizing logic |

```
Order saga (orchestration):
  createOrder(PENDING) -> reserveCredit -> reserveInventory -> approveOrder
  on failure of any step, run compensations in reverse:
    releaseInventory -> releaseCredit -> rejectOrder
```

**Intermediate & advanced.**
- **Compensations are semantic, not rollbacks** — you can't "un-send" an email; you send an
  apology/refund. Design for **backward recovery** (compensate) or **forward recovery** (retry).
- Sagas provide **ACD** without **I**: no isolation, so anomalies (dirty reads, lost updates)
  can occur. Mitigate with **semantic locks** (a `PENDING`/`APPROVED` status field),
  **commutative updates**, **pessimistic view ordering**, or **version files**.
- **Reliable event publishing** needs the **transactional outbox** pattern: write the state
  change and the event to the same DB in one local transaction, then a relay/CDC (e.g. Debezium)
  publishes the event — avoids the dual-write problem where the DB commits but the broker send
  fails (or vice versa).
- Every step and compensation must be **idempotent** because messages can be redelivered.

---

## CQRS and Event Sourcing

**CQRS (Command Query Responsibility Segregation).** Split the **write model** (commands that
change state) from the **read model** (queries). They can use different schemas, or even
different databases, optimized independently.

- **Why:** complex domains where read and write shapes diverge; you can scale reads separately
  and build denormalized read models (great for the microservices "no cross-service JOIN"
  problem — build a materialized view instead).
- **Cost:** two models to maintain and the read side is usually **eventually consistent** with
  the write side (read replica lags behind after a command).

**Event Sourcing.** Instead of storing current state, store the **full sequence of events**
that led to it. Current state is derived by **replaying** events; the event store is the source
of truth.

- **Benefits:** complete audit log, temporal queries ("state as of last Tuesday"), easy to
  build new read projections by replaying, natural fit for CQRS (events feed read models).
- **Costs / gotchas:** **event schema versioning** (upcasting old events), snapshots to avoid
  replaying millions of events, no easy `UPDATE`/`DELETE` (append-only, so GDPR "delete" needs
  crypto-shredding), and a steeper learning curve.

**Relationships.**
- CQRS **does not require** event sourcing (you can CQRS with two relational models).
- Event sourcing is almost always paired **with** CQRS (events are the write log; projections
  are the read side).
- In Spring land, **Axon Framework** and **Eventuate** provide CQRS/ES/saga building blocks;
  Kafka is a common event backbone.

**Advanced gotcha.** Do NOT reach for CQRS + Event Sourcing by default — it's justified for a
few high-value bounded contexts with complex behavior/audit needs. Applying it everywhere adds
huge accidental complexity (the "CQRS everywhere" anti-pattern).

---

## Idempotency

**Beginner definition.** An operation is **idempotent** if performing it multiple times has the
same effect as performing it once. Critical in distributed systems because networks cause
**retries and duplicate deliveries** ("at-least-once" messaging).

**HTTP semantics.** `GET`, `PUT`, `DELETE`, `HEAD` are defined as idempotent; `POST` and
`PATCH` are **not** (by spec). That's why creating a resource with a retried `POST` can create
duplicates.

**Implementation patterns.**
- **Idempotency key:** client sends a unique `Idempotency-Key` header; the server records the
  key + result. A repeat with the same key returns the stored result instead of re-executing
  (Stripe's model). Store keys with a TTL.
- **Natural/business keys or dedup tables:** reject a message whose unique business id was
  already processed (unique constraint / "inbox" table).
- **Conditional updates / optimistic concurrency:** `If-Match` + ETag, or a version column, so
  a duplicate write is a no-op or a detectable conflict.
- **State machines:** transition only if in the expected state (`PENDING -> PAID`), so a second
  `PAID` is ignored.

**Advanced gotchas.**
- **At-least-once delivery** (Kafka/SQS default) means consumers *must* be idempotent —
  exactly-once end-to-end is very hard; the pragmatic approach is at-least-once + idempotent
  consumer (the "effectively-once" pattern).
- The idempotency store write and the business write should be **atomic** (same transaction /
  outbox) or you can process twice on a crash between them.
- Idempotency is required for **safe retries** (Resilience4j retry, gateway retry filter) and
  for **saga** steps/compensations.

---

## Rate Limiting and Throttling

**Beginner definition.** **Rate limiting** caps how many requests a client (or the whole
system) may make in a window, protecting services from overload and abuse and enforcing fair
usage/quotas.

**Common algorithms:**

| Algorithm | Idea | Notes |
|---|---|---|
| **Token bucket** | Tokens refill at a fixed rate; each request consumes one; bucket has a max (burst) | Allows bursts up to capacity; SCG's `RedisRateLimiter` uses it |
| **Leaky bucket** | Requests queue and drain at constant rate | Smooths output, no bursts |
| **Fixed window** | Count per fixed clock window (per minute) | Simple; suffers boundary bursts (2x at edges) |
| **Sliding window log/counter** | Track timestamps or weighted windows | Smoother, more memory/compute |

**Where to enforce.**
- **Edge / API Gateway** — Spring Cloud Gateway `RequestRateLimiter` (Redis token bucket) with
  a `KeyResolver` (per user/API-key/IP). Best for global, cross-service quotas.
- **Per-service** — Resilience4j `RateLimiter` (in-process, per instance) or **Bucket4j**
  (supports distributed backends like Redis/Hazelcast).
- **Infrastructure** — nginx, cloud API gateways (AWS API Gateway usage plans).

**Advanced gotchas.**
- **Distributed rate limiting** must share state (Redis) — a per-instance limiter of N with 5
  instances effectively allows 5N. Resilience4j `RateLimiter` is per-JVM; use Redis-backed
  (SCG/Bucket4j) for a global limit.
- Return **HTTP 429 Too Many Requests** with a `Retry-After` header; distinguish from 503.
- Rate limiter (throughput) vs bulkhead/concurrency limit (in-flight) vs circuit breaker
  (failure-based) — different levers, often combined.

---

## Graceful Degradation and Fallbacks

**Beginner definition.** **Graceful degradation** means the system keeps delivering *reduced*
but useful functionality when a dependency is unavailable, instead of failing entirely. A
**fallback** is the reduced-behavior path.

**Techniques.**
- **Fallback responses:** serve cached/stale data, a default, or a partial page (e.g. product
  page without the recommendations widget).
- **Circuit breaker fallbacks:** Resilience4j `fallbackMethod` / Feign `fallbackFactory` /
  SCG `fallbackUri` provide the degraded path when the breaker is open.
- **Feature toggles / load shedding:** disable non-critical features under load; shed
  low-priority traffic to protect core flows.
- **Timeouts + defaults:** never wait forever; return a sensible default when a
  best-effort dependency times out.

**Intermediate/advanced.**
- Distinguish **critical vs non-critical** dependencies. Degrade the non-critical (reviews,
  recommendations); fail fast/queue for the critical (payment).
- **Fail fast** (open circuit) prevents cascading failure and thread-pool exhaustion — a slow
  dependency without a breaker/timeout can take the whole caller down.
- **Graceful shutdown** (Boot: `server.shutdown=graceful`) drains in-flight requests on
  SIGTERM — related but distinct from degradation.
- Combine with **bulkheads** so a failing dependency's degradation stays isolated to its
  compartment.

---

## Common follow-up questions

1. **When would you NOT use microservices?** Small team, early-stage product, unclear domain
   boundaries, low scale — start with a modular monolith and extract later.
2. **How do services communicate — sync vs async?** REST/gRPC (sync, simpler, coupled in time)
   vs messaging/events (async, decoupled, resilient, but eventual consistency). Prefer async
   for cross-service state changes.
3. **Why did Spring move off Netflix OSS?** Ribbon/Hystrix/Zuul 1 entered maintenance/EOL;
   replaced by Spring Cloud LoadBalancer, Resilience4j, and Spring Cloud Gateway.
4. **Eureka vs Kubernetes discovery?** On k8s the platform provides DNS-based service discovery
   and load balancing; Eureka is often redundant there.
5. **Circuit breaker vs retry — do they conflict?** Retry handles *transient* faults; circuit
   breaker handles *sustained* faults. Order matters (Retry wraps CircuitBreaker by default).
6. **How do you guarantee a message is published with a DB change?** Transactional outbox + CDC,
   not a dual write.
7. **Exactly-once delivery — real?** Practically no; use at-least-once + idempotent consumers.
8. **Sleuth in Spring Boot 3?** Gone — use Micrometer Tracing + Observation API.
9. **How do you propagate auth/trace headers through Feign?** A `RequestInterceptor`; they are
   not forwarded automatically.
10. **How do you rate-limit across many instances?** Shared store (Redis) — per-instance limiters
    don't enforce a global cap.

## References

- Spring Cloud project docs — https://spring.io/projects/spring-cloud
- Spring Cloud Gateway reference — https://docs.spring.io/spring-cloud-gateway/reference/
- Spring Cloud Netflix (Eureka) — https://docs.spring.io/spring-cloud-netflix/docs/current/reference/html/
- Spring Cloud Config — https://docs.spring.io/spring-cloud-config/reference/
- Spring Cloud LoadBalancer — https://docs.spring.io/spring-cloud-commons/reference/spring-cloud-commons/loadbalancer.html
- Spring Cloud OpenFeign — https://docs.spring.io/spring-cloud-openfeign/docs/current/reference/html/
- Resilience4j docs — https://resilience4j.readme.io/docs
- Spring Cloud Circuit Breaker — https://spring.io/projects/spring-cloud-circuitbreaker
- Micrometer Tracing — https://docs.micrometer.io/tracing/reference/
- Spring Boot Observability — https://docs.spring.io/spring-boot/reference/actuator/observability.html
- Microservices patterns (Saga, CQRS, Outbox, Idempotency) — https://microservices.io/patterns/
- Baeldung: Spring Cloud Gateway — https://www.baeldung.com/spring-cloud-gateway
- Baeldung: Resilience4j — https://www.baeldung.com/spring-cloud-circuit-breaker
- Baeldung: Spring Cloud OpenFeign — https://www.baeldung.com/spring-cloud-openfeign
- Stripe idempotency — https://docs.stripe.com/api/idempotent_requests
