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

**Staff-level deep dive — decomposition strategy and communication.**
- **Strangler Fig migration:** extract services incrementally from a monolith by routing
  specific paths through a facade/gateway to the new service while the rest stays in the
  monolith — never a big-bang rewrite. The seam is usually a bounded context with low coupling.
- **Sync vs async coupling has two dimensions:** *temporal* coupling (both parties must be up
  at the same time — synchronous REST/gRPC) and *behavioral/afferent* coupling. Async events
  remove temporal coupling but introduce eventual consistency and out-of-order/duplicate
  delivery. A long *synchronous* call chain A→B→C→D multiplies latency and failure probability:
  if each hop is 99.9% available, four hops give ~99.6%, and p99 latencies compound.
- **Shared libraries are a hidden coupling vector.** A shared "common" jar with domain logic
  forces lockstep upgrades across services — a compile-time distributed monolith. Keep shared
  code to stable, generic utilities (or none).
- **Two-pizza / team ownership:** service boundaries that cut across team boundaries create
  cross-team release coordination — the organizational form of a distributed monolith
  (Conway's Law working against you).

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

**Staff-level deep dive — filter internals, ordering, and pitfalls.**
- **GlobalFilter vs GatewayFilter:** a `GatewayFilter` applies to a single route (declared in
  its `filters:` list or produced by a `GatewayFilterFactory`); a `GlobalFilter` applies to
  every route. Internally globals are adapted to `GatewayFilterFactory` and merged into each
  route's chain, then the whole chain is sorted by `Ordered`. Lower `getOrder()` runs earlier
  on the *pre* side and (because it's a single reactive chain that unwinds) later on the *post*
  side. `NettyWriteResponseFilter` runs near the end (Ordered around `-1`) to write the
  proxied response.
- **Pre vs post logic in one filter:** in a reactive filter, code before
  `chain.filter(exchange)` is the *pre* phase; code in `.then(Mono.fromRunnable(...))` after it
  is the *post* phase. You cannot mutate the response body length in a naive post filter without
  a `ModifyResponseBody`/`ModifyRequestBody` filter because the body is a streaming
  `Flux<DataBuffer>` — buffering it defeats back-pressure and can OOM on large payloads.
- **`ServerWebExchange` mutation is copy-on-write:** `exchange.mutate().request(...)` returns a
  new exchange; forgetting to pass the mutated exchange down the chain silently loses your
  header/path change.
- **Retry filter + non-idempotent methods:** the SCG `Retry` filter by default retries only
  `GET`. Enabling it for `POST` without idempotency keys can double-submit. It also retries on
  connection failures where the request may or may not have reached the backend.
- **`lb://` requires a `ReactorLoadBalancerExchangeFilterFunction`/`ReactiveLoadBalancer`** on
  the classpath (spring-cloud-loadbalancer). Without a discovery client + LB, `lb://service-id`
  resolves to nothing and you get a 503 / `NotFoundException`.
- **`X-Forwarded-*` and `Forwarded` headers:** SCG adds them by default (`ForwardedHeadersFilter`,
  `XForwardedHeadersFilter`). If you double-proxy (external LB → SCG → service) and the backend
  trusts these blindly, a client can spoof `X-Forwarded-For`; strip/normalize at the trusted edge.

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

**Staff-level deep dive — the propagation-delay math and the "deregistration gap".**
- **Total time for a client to see a new instance** is roughly the sum of several caches, not
  just one: instance registers → server's response cache (`responseCacheUpdateIntervalMs`,
  default 30s) → client fetches delta (`registryFetchIntervalSeconds`, default 30s) → the
  load balancer's own `ServiceInstanceListSupplier` cache. Worst case can approach **2–3
  minutes** with defaults. This is why fresh instances get no traffic immediately and why a
  scaled-down instance can still receive requests for tens of seconds.
- **The deregistration gap is the dangerous one:** when an instance shuts down, other clients
  keep the stale entry until their caches expire, sending requests to a dead host. Mitigate
  with (a) graceful shutdown + `eureka.client.shouldUnregisterOnShutdown=true` (explicit
  cancel), (b) short cache/lease intervals, and (c) retry-on-next-instance in the load balancer.
  Self-preservation makes this worse because it suppresses eviction.
- **`preferIpAddress`:** by default Eureka registers the hostname; in containers the hostname
  is often non-resolvable, so `eureka.instance.prefer-ip-address=true` avoids "connection
  refused to <podname>" errors.
- **Peer replication is asynchronous and best-effort** across Eureka server nodes — two clients
  talking to two different Eureka peers can briefly see different registries. Eureka does not do
  quorum writes; it prioritizes availability.
- **`minimum-number-of-calls` for self-preservation** is governed by the renewal threshold
  (`eureka.server.renewalPercentThreshold`, default 0.85) — if received renewals drop below
  85% of expected, self-preservation kicks in.

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

**Staff-level deep dive — `@RefreshScope` internals and its traps.**
- **How `@RefreshScope` works:** it's a custom Spring scope backed by a caching proxy. Every
  injection point holds a CGLIB proxy; on `RefreshScopeRefreshedEvent` the scope disposes the
  cached target so the *next* method call lazily re-creates the bean from the (now re-bound)
  `Environment`. The refresh sequence: `Environment` is rebuilt from all property sources,
  then `@ConfigurationProperties` beans are re-bound and `@RefreshScope` beans are cleared.
- **The stale-reference trap:** if bean A (a plain singleton) captured a *field* from a
  `@RefreshScope` bean B at construction (e.g. copied `b.getUrl()` into its own field), A keeps
  the old value forever — only calls *through* B's proxy see new values. Inject the refresh-scoped
  bean and call it, don't snapshot its state.
- **Not everything can refresh:** the `@Bean` for a `DataSource`/connection pool, the servlet
  container port, `@Scheduled` cron expressions bound at startup, and Logback levels (unless via
  `/actuator/loggers`) generally do not change on refresh. Some, like `DataSource`, can be made
  refreshable but it drops existing connections.
- **Refresh is not atomic across a fleet:** even with Spring Cloud Bus, instances refresh at
  slightly different times, so during a rollout two instances can serve requests with different
  config. Design config changes to be backward/forward compatible (no coordinated flips).
- **`spring.config.import` ordering:** with `configserver:`, remote properties are imported at
  the *import* location in the property-source order. `optional:configserver:` lets the app boot
  when the server is unreachable. Understand that command-line args and OS env still win over
  imported remote config (standard Boot precedence).

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

**Staff-level deep dive — supplier delegation, retries, and per-client config isolation.**
- **`ServiceInstanceListSupplier` is a decorator chain,** not a single class. A typical stack:
  `DiscoveryClientServiceInstanceListSupplier` (source) → `CachingServiceInstanceListSupplier`
  (TTL cache) → optional `HealthCheckServiceInstanceListSupplier` /
  `ZonePreferenceServiceInstanceListSupplier` / `RequestBasedStickySessionServiceInstanceListSupplier`
  / `SameInstancePreferenceServiceInstanceListSupplier`. You enable each via
  `spring.cloud.loadbalancer.configurations` or by declaring the bean. Order matters:
  caching should wrap the discovery source, and filters should wrap caching.
- **Retry semantics:** SCL retry (`spring.cloud.loadbalancer.retry.*`) can retry on the
  *same* instance and/or the *next* instance, and only on configured statuses/methods.
  `retryOnAllOperations=false` by default restricts retries to `GET`. This is separate from
  Resilience4j retry and from Feign's `Retryer`; stacking all three can multiply attempts
  (e.g. Feign retry × LB retry × Resilience4j retry) — a common "why did we hit the backend 27
  times" bug.
- **The `@Configuration` isolation trap (repeat for emphasis):** a `@LoadBalancerClient`
  configuration class must NOT be discovered by the main `@ComponentScan`, otherwise it becomes
  the *global* default for all clients. Place it in a package outside the scan or exclude it.
- **Round-robin is stateful per-JVM:** `RoundRobinLoadBalancer` uses an `AtomicInteger`
  position, so distribution is even only within one process; across many client instances each
  starts its own counter, so a specific backend can still see skew under low volume.
- **Blocking bridge cost:** `@LoadBalanced RestTemplate` uses `BlockingLoadBalancerClient`,
  which resolves the instance synchronously; on a Netty/WebFlux app prefer `@LoadBalanced
  WebClient` to stay non-blocking.

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

**Staff-level deep dive — fallback vs fallbackFactory, config scope, and thread context.**
- **`fallback` vs `fallbackFactory`:** `fallback` gives a static degraded implementation but
  hides *why* the call failed; `fallbackFactory` receives the `Throwable`, so you can branch on
  a 404 vs a timeout vs a `CallNotPermittedException`. A subtle trap: with Resilience4j-backed
  Feign, the fallback fires for `CircuitBreaker`/`FeignException`, but the exception seen is the
  *decoded* one — a custom `ErrorDecoder` changes what your `fallbackFactory` sees.
- **Configuration precedence:** properties under `feign.client.config.<name>` override
  `feign.client.config.default`, which override programmatic `@Configuration`. Naming the client
  `default` sets the global fallback config. A per-client `@Configuration` referenced by
  `@FeignClient(configuration=...)` must again be kept out of the main component scan (same trap
  as LoadBalancer config).
- **Header propagation and thread context:** a `RequestInterceptor` reading from
  `RequestContextHolder` or a trace context only works if that context is present on the calling
  thread. Feign calls dispatched to a *different* thread (async, `@Async`, reactor scheduler,
  `ThreadPoolBulkhead`) lose `ThreadLocal`-based context unless it's propagated — a frequent
  "the auth header is missing only under load / only async" bug.
- **`FeignException` and connection reuse:** the default JDK `HttpURLConnection` client does not
  pool connections; under load switch to Apache HttpClient 5 or OkHttp (`feign-hc5`/`feign-okhttp`)
  for keep-alive and a bounded pool, or you'll exhaust ephemeral ports (`TIME_WAIT` build-up).
- **`Retryer` is stateful and NOT thread-safe as a shared singleton** for the *default* impl —
  Feign clones it per request. If you supply a custom `Retryer`, implement `clone()` correctly
  or concurrent requests will corrupt each other's attempt counters.

---

## Resilience4j Circuit Breaker

**Beginner definition.** A **circuit breaker** protects a caller from a failing dependency:
when failures cross a threshold, the breaker **opens** and fails fast (or falls back) instead
of hammering a sick service and exhausting threads. **Resilience4j** is the lightweight,
functional-programming library that replaced the now-EOL **Netflix Hystrix**.

**Intuition first.** Think of the breaker in your home's fuse box. When current (failures)
spikes, it trips **OPEN** to protect the wiring (your thread pool / connection pool) rather than
letting the house burn down (a cascading failure). A **CLOSED** breaker is the normal path —
current flows. Failing *fast* matters because a caller blocked on a dead dependency holds a
thread and a connection the whole time it waits; a few thousand of those pile up and take the
*caller* down too. The breaker frees those resources the instant it opens.

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

**Worked example — the state machine with the config above.** Using
`sliding-window-type=COUNT_BASED`, `sliding-window-size=10`, `minimum-number-of-calls=5`,
`failure-rate-threshold=50`, `permitted-number-of-calls-in-half-open-state=3`,
`wait-duration-in-open-state=10s`. Watch the numbers drive each transition:

| Call | Outcome | Window (F/total) | Rate evaluated? | State after |
|---|---|---|---|---|
| 1 | FAIL | 1/1 | no — need ≥ 5 calls | CLOSED |
| 2 | OK | 1/2 | no | CLOSED |
| 3 | FAIL | 2/3 | no | CLOSED |
| 4 | FAIL | 3/4 | no | CLOSED |
| 5 | OK | 3/5 | **yes → 3/5 = 60% ≥ 50%** | **OPEN** |

- Calls 1–4 can *never* trip the breaker, no matter how many fail — `minimumNumberOfCalls=5`
  means the failure rate simply isn't computed until 5 calls are recorded. This is the guard
  against opening on a 1-out-of-1 fluke.
- On call 5 the window holds 3 failures out of 5 = **60% ≥ 50%**, so the breaker trips **OPEN**.
- For the next **10 s** every call is rejected instantly with `CallNotPermittedException`
  (fallback runs) — the dependency gets zero traffic and the caller's threads stay free.
- After 10 s the breaker doesn't move on its own (default
  `automaticTransitionFromOpenToHalfOpenEnabled=false`) — the **next call** flips it to
  **HALF_OPEN**. It admits exactly 3 trial calls. Say they come back OK, FAIL, OK → **1/3 = 33%
  < 50%**, so the breaker returns to **CLOSED**. Had 2 of the 3 failed (67% ≥ 50%) it would snap
  back to **OPEN** for another 10 s.

**COUNT_BASED vs TIME_BASED — same `sliding-window-size=10`, very different denominator.**
Suppose a 1-second burst of 400 calls, of which 40 fail:
- **COUNT_BASED (last 10 calls):** only the most recent 10 outcomes count. If the last 10 happen
  to be all failures, rate = 10/10 = 100% → OPEN, even though system-wide only 10% failed.
- **TIME_BASED (last 10 seconds):** all 400 calls in the window count — rate = 40/400 = 10% <
  50% → stays CLOSED.
  Under bursty load a count window reacts to a short unlucky streak; a time window reflects the
  true rate over the interval. Pick TIME_BASED when call volume swings wildly.

**Advanced gotchas.**
- Resilience4j is built on **decorators / functional interfaces** and is far lighter than
  Hystrix (no dedicated thread pool per command by default — it uses semaphore-style bulkhead;
  thread-pool bulkhead is a separate module).
- **Aspect ordering** matters when combining annotations. Default order (outer→inner):
  **Retry → CircuitBreaker → RateLimiter → TimeLimiter → Bulkhead**. So retry wraps the circuit
  breaker: a retried call that opens the breaker will see `CallNotPermittedException`.
- The breaker records the *result of the whole decorated call*; combine with TimeLimiter so a
  hung call counts as a failure rather than blocking forever.

**Staff-level deep dive — window internals, HALF_OPEN concurrency, and self-calls.**
- **COUNT_BASED vs TIME_BASED window internals:** the count-based window is a circular array of
  the last N calls' outcomes (`O(1)` aggregate via incremental totals). The time-based window is
  a ring of `N` one-second partial aggregates (`slidingWindowSize` = seconds); a call's result is
  added to the current second's bucket, and buckets older than the window are evicted. So
  `slidingWindowSize=10` means "last 10 calls" (count) vs "last 10 seconds" (time) — a very
  different failure-rate denominator under bursty load.
- **HALF_OPEN is bounded, not gated:** `permittedNumberOfCallsInHalfOpenState` permits exactly
  that many concurrent trial calls; extra calls are rejected with `CallNotPermittedException`
  while in HALF_OPEN. Only after all permitted trial calls complete is the aggregate failure
  rate evaluated to decide CLOSED vs OPEN. `automaticTransitionFromOpenToHalfOpenEnabled=false`
  by default means the OPEN→HALF_OPEN move happens on the *next call after the wait elapses*, not
  via a background timer — a totally idle breaker stays OPEN indefinitely until someone calls.
- **Self-invocation / proxy trap:** `@CircuitBreaker` (like `@Transactional`) is AOP-proxy based.
  A method calling another `@CircuitBreaker`-annotated method on `this` bypasses the proxy, so the
  inner breaker never engages. Split into separate beans or use self-injection.
- **The breaker is a shared singleton keyed by `name`:** two methods annotated with the same
  `name` share one `CircuitBreaker` instance and one sliding window — failures on one open the
  other. This is by design (per-dependency), but surprising if you reuse a name across unrelated
  calls. State is held in a thread-safe `AtomicReference`-based state machine.
- **`recordFailurePredicate` / result-based failures:** you can count a *successful* return that
  carries an error payload as a failure via a predicate, not just thrown exceptions.

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

**Worked example — the retry backoff sequence.** With `max-attempts=3`, `wait-duration=200ms`,
`enable-exponential-backoff=true`, `exponential-backoff-multiplier=2`:
- `max-attempts=3` = **1 initial call + 2 retries** (it is the total, not "retries on top").
- Waits between attempts: attempt 1 fails → wait **200 ms** → attempt 2 fails → wait
  **200 × 2 = 400 ms** → attempt 3. Total added latency before giving up ≈ **600 ms** (plus the
  three call durations).
- Wall-clock if each call takes 50 ms and all fail: `50 + 200 + 50 + 400 + 50 = 750 ms` before
  the caller sees the failure.
- Add `enable-randomized-wait` (jitter) and each wait becomes 200 ms and 400 ms **±** a random
  fraction, so 1 000 clients that all failed at the same instant don't re-fire in lockstep
  (that synchronized re-fire is the *thundering herd*). Without jitter, all 1 000 hit the backend
  again at exactly +200 ms, then +600 ms — recreating the spike that caused the failure.

**Worked example — one rate-limiter cycle.** With `limit-for-period=100`, `limit-refresh-period=1s`,
`timeout-duration=0`:
- The limiter grants **100 permits per 1-second cycle**. Requests 1–100 arriving within the same
  second each take a permit and pass.
- Request **101** in that same second finds no permit. Because `timeout-duration=0`, it does
  **not** wait — it fails immediately with `RequestNotPermitted` (map this to HTTP **429**).
- At the cycle boundary the permit count resets to 100, so the next second's first 100 requests
  pass again.
- Change `timeout-duration=250ms`: request 101 now *blocks* up to 250 ms for the next cycle to
  begin. If the fresh cycle starts within that budget it gets a permit and proceeds; if the wait
  would exceed 250 ms it fails with `RequestNotPermitted`. This is the knob between "reject
  instantly" and "briefly queue for the next window".

**Advanced gotchas.**
- **Rate limiter vs bulkhead:** rate limiter bounds *calls per unit time*; bulkhead bounds
  *simultaneous in-flight calls*. A slow dependency saturates a bulkhead even at low request
  rate.
- **TimeLimiter needs async execution** — annotating a plain blocking method with
  `@TimeLimiter` alone won't interrupt it; you need a `CompletableFuture`/`ThreadPoolBulkhead`.
- Combining Retry + CircuitBreaker: retries happen *outside* the breaker by default, so failed
  retries feed the breaker's failure count.
- Every decorator emits **Micrometer metrics** and events for observability.

**Staff-level deep dive — rate limiter internals and bulkhead rejection semantics.**
- **`AtomicRateLimiter` internals:** the default `RateLimiter` is a lock-free, nanosecond-based
  implementation. It divides time into cycles of `limitRefreshPeriod`; each cycle grants
  `limitForPeriod` permits. A caller that finds no permit waits up to `timeoutDuration` for the
  next cycle, computed without a background thread (permits are calculated on-demand from the
  clock). `timeoutDuration=0` means fail immediately with `RequestNotPermitted`. Because it's
  cycle-based (not a smooth token bucket), you can get bursty behavior at cycle boundaries —
  akin to a fixed window, not a leaky bucket.
- **SemaphoreBulkhead rejection is immediate-ish:** `maxWaitDuration` controls how long a caller
  blocks trying to acquire a permit; `0` rejects instantly with `BulkheadFullException`. It
  isolates concurrency but the call still runs on the *caller's* thread, so a truly hung call
  holds its permit until it returns — a slow dependency drains permits and blocks new callers.
- **ThreadPoolBulkhead can't be combined with TimeLimiter naively via annotations order:** the
  `TimeLimiter` must wrap the `ThreadPoolBulkhead`'s `CompletableFuture` for cancellation to
  work; `cancelRunningFuture=true` interrupts the worker thread, but interruption only helps if
  the blocking call responds to `Thread.interrupt()` (many JDBC drivers/socket reads do not).
- **Queue-full behavior:** `ThreadPoolBulkhead` with a full `queueCapacity` and all threads busy
  rejects with `BulkheadFullException` — it does *not* run the task on the caller thread (no
  `CallerRunsPolicy` by default), which is what you want for isolation.
- **Retry + RateLimiter interaction:** with default order Retry(outer) → RateLimiter, each retry
  attempt reacquires a permit, so a retry storm can be *throttled* by the rate limiter but also
  wastes permits legitimate first-attempts need.

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

**Staff-level deep dive — Observation API model, context leaks, and sampling nuances.**
- **One `Observation`, many signals:** the Observation API is the single instrumentation point;
  registered `ObservationHandler`s turn each observation into a Micrometer timer *and* a tracing
  span *and* (optionally) log context. Order of `start()`/`stop()`/`error()` on an `Observation`
  drives span lifecycle. Registering a `MeterRegistry`-based handler alone gives metrics but no
  spans; you need the tracing handler (from `micrometer-tracing`) for spans.
- **Context propagation across threads is opt-in:** `@Async`/executors lose the trace scope
  unless you wrap them. Micrometer's `ContextSnapshot`/`ContextSnapshotFactory` captures the
  current `ThreadLocal`s (trace context, MDC) and restores them on the target thread; Reactor
  requires `Hooks.enableAutomaticContextPropagation()` (Reactor 3.5+) or manual
  `contextWrite`/`ContextPropagation` so the trace id flows through operators. Forgetting this is
  the classic "spans break at the reactive/async boundary" symptom.
- **Sampling vs recording:** the sampling decision (a single bit in `traceparent`'s flags) is
  made at the trace root and propagated. A downstream service **must not** re-decide — it honors
  the parent's sampled flag, which is why probability should effectively be set at the edge.
  Unsampled traces still propagate ids (so logs correlate) but export no spans.
- **B3 vs W3C interop:** if one service emits B3 and another only reads `traceparent`, the trace
  breaks into two. Configure `management.tracing.propagation.type` consistently (e.g. `W3C`,
  `B3`, or both) across the fleet.
- **Cardinality trap:** adding high-cardinality tags (user id, order id) as *low-cardinality*
  Observation key-values explodes Micrometer metric time-series and can OOM the meter registry —
  put those on the span (high-cardinality) not the metric.

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

**Worked example — a failure that fires compensations, with the pivot marked.** Take the order
saga above and let `reserveInventory` fail (out of stock):

```
Step 1  createOrder(PENDING)   OK    [compensatable]
Step 2  reserveCredit          OK    [compensatable]  <- $50 hold placed on the card
Step 3  reserveInventory       FAIL  (no stock)
        --- orchestrator now unwinds completed steps in REVERSE ---
Step 3c (nothing to undo: step 3 never took effect)
Step 2c releaseCredit          OK    <- $50 hold released
Step 1c rejectOrder(REJECTED)  OK
```

Result: no money held, order ends REJECTED, no partial state. Now mark the **pivot**. Say
`reserveCredit` is the go/no-go commit — once the card is actually *charged* (not just held), the
saga must complete **forward**. If instead the flow were
`... → chargeCard (PIVOT) → reserveInventory → shipOrder` and `shipOrder` failed, you would
**not** run a compensation to un-charge — `shipOrder` is a *retriable* post-pivot step, so the
orchestrator retries it forward until it succeeds (idempotently). Treating a post-pivot step as
compensatable is exactly how you end up refunding a customer whose item actually shipped.

The **ABA / late-success race** rides on this same trace: suppose `reserveCredit` is slow, the
orchestrator times out and fires `releaseCredit`, and *then* the original `reserveCredit`
finally succeeds — now credit is reserved with no saga tracking it. The `PENDING` semantic lock
guards this: `releaseCredit` and the late `reserveCredit` both check the order status, and the
one that finds an inconsistent state (order already REJECTED) becomes a no-op.

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

**Staff-level deep dive — compensation ordering, pivot steps, and outbox mechanics.**
- **Pivot transaction / retriable vs compensatable steps:** model each saga step as
  *compensatable* (can be semantically undone), the single *pivot* (the go/no-go commit point —
  once it succeeds the saga must complete forward), or *retriable* (idempotent, guaranteed to
  eventually succeed, only ever runs after the pivot). Compensations run only for steps *before*
  the pivot; steps after must be retried forward, never compensated. Getting the pivot wrong
  (e.g. treating a post-pivot step as compensatable) causes money/inventory inconsistencies.
- **Compensations run in reverse order and must themselves be idempotent and commutative-safe**
  because a compensation message can also be redelivered, and a "late success" of the original
  step can arrive after its compensation (the ABA problem). Semantic locks (`PENDING` status)
  guard against a compensation racing a delayed success.
- **Outbox relay mechanics:** two flavors — *polling publisher* (a scheduled job `SELECT ... FOR
  UPDATE SKIP LOCKED` the unpublished rows, publishes, marks sent) and *transaction-log tailing*
  (CDC, e.g. Debezium reads the DB's WAL/binlog). CDC gives lower latency and no read load but
  publishes in commit order and needs careful handling of schema changes. Both deliver
  *at-least-once*, so consumers must dedupe.
- **Ordering guarantees:** the outbox preserves per-aggregate ordering only if you publish by a
  key (e.g. Kafka partition key = aggregate id). Cross-aggregate ordering is not guaranteed and
  should not be relied on.
- **Orchestrator persistence:** an orchestration saga must persist its own state machine (which
  step, compensation status) transactionally, or a crash mid-saga leaves it unable to resume.
  Frameworks (Axon, Eventuate Tram, Temporal-style) persist the saga instance and rehydrate it.

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

**Staff-level deep dive — read-model consistency, optimistic concurrency, and replay.**
- **Read-your-own-writes:** because the read model lags, a user who just posted a command may
  query the stale read side and not see their change. Mitigations: return the projected result
  from the command directly, read from the write model for that user briefly (session
  stickiness), or use a version token the client passes until the projection catches up.
- **Aggregate concurrency in ES:** the event store enforces optimistic concurrency by appending
  with an *expected version* (`expectedVersion` = last known sequence for the aggregate). Two
  concurrent command handlers appending at the same version — one wins, the other gets a
  concurrency exception and must reload and retry. This is the ES analog of an optimistic lock.
- **Idempotent projections:** a projection consuming events at-least-once must track the last
  processed event sequence per aggregate (or a processed-event table) so replays/redeliveries
  don't double-apply (e.g. incrementing a counter twice). Rebuilding a projection = reset the
  checkpoint and replay from event 0.
- **Snapshots are an optimization, not truth:** a snapshot stores aggregate state at version N;
  loading replays only events > N. A buggy snapshot must be discardable — never treat it as
  authoritative over the event log.
- **Upcasting:** when an event schema changes, old serialized events are transformed on read by
  an *upcaster* chain (v1→v2→v3) rather than migrating the immutable store. You never rewrite
  history; you evolve the read-time transformation.

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

**Staff-level deep dive — the concurrency race, key scoping, and non-determinism.**
- **The check-then-act race:** a naive "SELECT key; if absent INSERT + process" is not
  idempotent under concurrency — two simultaneous retries both see "absent" and both process.
  Fixes: a UNIQUE constraint on the idempotency key with the *insert happening first* (the
  second insert fails and you return the stored/in-progress result), or `INSERT ... ON CONFLICT
  DO NOTHING` returning whether you won. Store an *in-progress* marker so a concurrent duplicate
  can wait/return 409 rather than re-execute.
- **Scope the key correctly:** an idempotency key must be scoped to the *operation + payload*.
  Reusing the same key for a *different* request body should be rejected (409), otherwise a
  client bug silently returns the wrong stored response. Persist a hash of the request with the
  key to detect this.
- **TTL vs correctness:** expiring keys too soon reopens the duplicate window (a slow retry
  after TTL re-executes); too long bloats storage. Match TTL to the maximum realistic
  retry/redelivery horizon (often hours to a day for payments).
- **Non-deterministic operations break replay-return:** if the stored result includes a
  server-generated timestamp/id, returning it on replay is correct only if the *effect* was the
  same. For "create", store and return the originally created id; do not create a new one.
- **Idempotency ≠ deduplication of side effects to third parties:** if step 1 already emailed
  the customer and the retry re-runs step 2, you still must not re-send the email — dedupe each
  external side effect independently, not just the overall HTTP response.

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

**Staff-level deep dive — algorithm edge cases and the atomicity of distributed counting.**
- **Fixed-window boundary burst (the "double burst"):** a fixed window of 100/min lets 100
  requests at 00:00:59 and another 100 at 00:01:00 — 200 in ~1 second across the boundary.
  Sliding-window-counter smooths this by weighting the previous window's count into the current
  one (`count = prev_window_count * overlap_fraction + current_count`), a cheap approximation of
  a sliding log without storing every timestamp.
- **Token bucket vs leaky bucket in practice:** token bucket permits bursts up to capacity then
  throttles to the refill rate (good for APIs that tolerate bursts); leaky bucket (queue + fixed
  drain) *smooths* output to a constant rate and can add latency/queueing — better for
  protecting a strictly rate-limited downstream (e.g. a legacy system, a paid third-party API).
- **Distributed counting must be atomic:** implementing a Redis limiter with `GET`/`INCR`/`SET`
  in separate round-trips races under concurrency and overcounts. Use a single atomic Lua script
  (SCG's `RedisRateLimiter` ships one) or `INCR` + `EXPIRE` pipelined so the check-and-decrement
  is atomic on the Redis single-threaded command loop.
- **Fail-open vs fail-closed on limiter backend outage:** if Redis is down, does the gateway
  allow all traffic (fail-open, risking overload) or deny all (fail-closed, self-inflicted
  outage)? SCG defaults tend toward denying when it can't determine the count; decide
  deliberately and alert on it.
- **Cost-based / weighted limiting:** not all requests are equal — a bulk endpoint may consume
  more permits than a cheap read. Token-bucket permits-per-request (weight) models this;
  fixed-count limiters cannot.

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

**Staff-level deep dive — cache-based degradation hazards and load shedding.**
- **Stale-cache fallback needs freshness signaling:** serving stale data on failure is great,
  but a fallback that silently returns *very* stale prices/inventory can be worse than an error
  (overselling). Attach staleness metadata, cap the acceptable staleness, and prefer
  "soft-TTL/hard-TTL" (serve stale up to hard-TTL, then fail) patterns.
- **Fallbacks must not call the failing dependency:** a fallback that itself calls the same sick
  service (or shares its thread pool / connection pool) defeats the breaker and can deadlock —
  fallbacks should hit a *different* resource (cache, local default, cheaper service).
- **Load shedding vs rate limiting:** rate limiting enforces a *contractual* cap per client;
  load shedding *drops* low-priority work when the *server itself* is near saturation
  (queue depth, CPU, thread pool). Prioritized shedding (e.g. reject anonymous/low-tier first,
  protect checkout) keeps the golden path alive under overload — this is adaptive/admission
  control, not a fixed quota.
- **Timeout budgets across a call chain:** each hop should get a *shrinking* timeout budget so an
  edge request with a 2s SLA doesn't wait on a downstream that itself waits 2s on its downstream
  (nested timeouts must sum to less than the parent). Propagate a deadline, not a fixed per-hop
  timeout.
- **Circuit-breaker fallback + graceful shutdown interaction:** during a rolling deploy, an
  instance draining (graceful shutdown) should ideally deregister first (see Eureka
  deregistration gap) so callers' breakers don't trip on connection-refused from an
  already-terminated instance.

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
