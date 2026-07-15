# Reactive Programming with Spring WebFlux

Spring WebFlux is the **reactive, non-blocking** web stack introduced in Spring 5
(2017), living alongside the classic servlet-based Spring MVC. It is built on
**Project Reactor** (`Mono`/`Flux`), implements the **Reactive Streams**
specification, and by default runs on **Netty** with a small pool of event-loop
threads. The core promise: handle many concurrent connections with few threads
by never blocking a thread while waiting for I/O. This topic is interview-heavy
because the mental model (declarative pipelines, lazy publishers, backpressure,
schedulers) is fundamentally different from imperative thread-per-request code,
and the classic trap — **blocking inside a reactive chain** — silently destroys
throughput.

---

## Reactive programming and Reactive Streams

**Reactive programming** is an asynchronous, declarative paradigm built around
**data streams** and the **propagation of change**. Instead of pulling a result
by blocking, you *declare a pipeline* of transformations and *react* to items as
they are pushed to you over time. It embraces four ideas from the **Reactive
Manifesto**: responsive, resilient, elastic, and message-driven.

**Reactive Streams** is a small specification (2013–2015, adopted into JDK 9 as
`java.util.concurrent.Flow`) defining an interoperability contract for
**asynchronous stream processing with non-blocking backpressure**. It is just
four interfaces and a set of rules (the TCK):

```java
public interface Publisher<T> { void subscribe(Subscriber<? super T> s); }
public interface Subscriber<T> {
    void onSubscribe(Subscription s);
    void onNext(T t);
    void onError(Throwable t);
    void onComplete();
}
public interface Subscription { void request(long n); void cancel(); }
public interface Processor<T,R> extends Subscriber<T>, Publisher<R> {}
```

**Why it matters:** because the spec is standardized, Reactor, RxJava 2/3, Akka
Streams, and the JDK `Flow` types can interoperate. Project Reactor is the
concrete implementation Spring uses; `Mono` and `Flux` are Reactor's
`Publisher`s.

**Key contract rules (interview gold):** `onNext`* is emitted at most
`request(n)` times, terminated by exactly one `onError` **or** one
`onComplete` (never both, and nothing after). Signals for a given subscriber
must be serialized (no concurrent `onNext`). Backpressure is expressed by the
subscriber calling `request(n)` — the publisher must not emit more than
requested.

**Push-pull hybrid:** Reactive Streams is often called a *push* model, but it is
really **push with pull-based backpressure** — the subscriber pulls demand via
`request(n)`, the publisher pushes up to that demand.

---

## Mono vs Flux

Reactor provides two `Publisher` types, distinguished by **cardinality**:

| Type | Emits | Analogy | Typical use |
|---|---|---|---|
| `Mono<T>` | 0 or 1 item, then complete/error | `Optional<T>` / `CompletableFuture<T>` | single result: find-by-id, save one, HTTP response body |
| `Flux<T>` | 0..N items, then complete/error | `Stream<T>` / `List<T>` | streams: query results, SSE, WebSocket messages |

```java
Mono<User>  user  = userRepo.findById(id);      // 0 or 1
Flux<User>  users = userRepo.findAll();          // 0..N
Mono<Void>  done  = userRepo.deleteById(id);     // completion signal, no value
```

**Why two types:** the type communicates intent and enables API precision. A
controller returning `Mono<ResponseEntity<T>>` says "one response"; returning
`Flux<T>` says "a stream." `Mono<Void>` represents a task that completes with no
value (like a fire-and-complete delete).

**Conversions:** `Flux.from(mono)`, `mono.flux()`, `flux.next()` (first element
as `Mono`), `flux.collectList()` → `Mono<List<T>>`, `flux.single()` /
`mono.single()` (error if not exactly one). `Mono.zip`/`Flux.zip` combine.

**Advanced — laziness:** Both are **lazy**. Declaring the pipeline builds a plan
but does nothing; **nothing happens until you subscribe**. In WebFlux the
framework subscribes for you when it writes the HTTP response. Calling
`.block()` yourself subscribes and waits (forbidden on event-loop threads).

**Hot vs cold:** A **cold** publisher restarts/produces fresh data for each
subscriber (e.g., an HTTP request re-fired per subscription). A **hot**
publisher emits regardless of subscribers and shares emissions among them (e.g.,
`Sinks`, `.share()`, `.publish().refCount()`). Late subscribers to a hot source
miss earlier items.

---

## Publisher, Subscriber, Subscription and backpressure

The four Reactive Streams roles work together:

1. `Publisher.subscribe(Subscriber)` — subscriber attaches.
2. Publisher calls `subscriber.onSubscribe(Subscription)` handing back a
   `Subscription`.
3. Subscriber signals demand: `subscription.request(n)`.
4. Publisher emits up to `n` via `onNext`, then `onComplete`/`onError`, or the
   subscriber calls `subscription.cancel()`.

**Backpressure** is the mechanism that lets a slow consumer tell a fast producer
"send me only N more," preventing unbounded buffering / `OutOfMemoryError`. It
is the defining feature that separates Reactive Streams from naive callbacks or
`java.util.stream`. Demand flows **upstream** (consumer → producer); data flows
**downstream**.

```java
flux.subscribe(
    value -> handle(value),          // onNext
    err   -> log.error("boom", err), // onError
    ()    -> log.info("done"),       // onComplete
    sub   -> sub.request(10));       // onSubscribe -> initial demand
```

If you use the simple `subscribe(consumer)` overloads, Reactor requests
`Long.MAX_VALUE` (unbounded demand — effectively "no backpressure applied by
this subscriber").

**Prefetch and demand batching (internals):** Even when a downstream subscriber
requests `Long.MAX_VALUE`, most Reactor operators do **not** propagate an
unbounded request upstream. Operators that queue items (`flatMap`, `publishOn`,
`concatMap`, etc.) request a bounded **prefetch** amount (default
`Queues.SMALL_BUFFER_SIZE` = **256**), and replenish demand once ~75% of a batch
has been consumed (the "limit"/replenish threshold). This is why an operator like
`publishOn` needs an internal queue sized to the prefetch and why tuning prefetch
matters for throughput vs memory. So "unbounded downstream demand" does not mean
"the source is asked for everything at once."

**Backpressure strategies** when a source cannot be slowed (e.g., mouse events,
`Flux.create`): `onBackpressureBuffer` (queue, risk OOM), `onBackpressureDrop`
(discard overflow), `onBackpressureLatest` (keep newest), `onBackpressureError`
(signal `IllegalStateException`). `Flux.create(sink, OverflowStrategy.X)` sets
it at the source. Operators like `limitRate(n)` shape demand.

**Advanced:** True end-to-end backpressure requires the whole chain to honor
demand (e.g., R2DBC drivers, Netty TCP flow control). Bridging a blocking source
via `Flux.create` breaks it unless you handle overflow, which is why "blocking
in a reactive chain" and "no real backpressure" often appear together.

---

## Project Reactor operators (map, flatMap, zip)

Operators build the pipeline. The three most-asked:

**`map`** — synchronous 1:1 transform, `T -> R`. Does not subscribe to anything;
just transforms each item.

```java
Flux.just(1,2,3).map(i -> i * 2);   // 2,4,6
```

**`flatMap`** — asynchronous 1:N transform, `T -> Publisher<R>`. Subscribes to
each inner publisher and **merges** their emissions. Use it when the mapping
function itself returns a `Mono`/`Flux` (a DB call, a WebClient call). Because
inners run concurrently, **ordering is not preserved** by default.

```java
// map would give Flux<Mono<User>> (nested) — wrong. Use flatMap:
Flux<User> users = idFlux.flatMap(id -> userRepo.findById(id));  // async, unordered
```

- `concatMap` — like `flatMap` but subscribes to inners **one at a time**,
  preserving order (less concurrency).
- `flatMapSequential` — subscribes eagerly (concurrent) but **emits in original
  order** by buffering.
- `switchMap` — cancels the previous inner when a new source item arrives
  (typeahead search).

**Trap:** using `map` where the function returns a publisher yields
`Flux<Mono<T>>`; you need `flatMap`. Conversely using `flatMap` for a pure
synchronous transform is wasteful.

**`flatMap` concurrency (senior detail):** `flatMap` has a `concurrency`
parameter that defaults to `Queues.SMALL_BUFFER_SIZE` = **256** — meaning it
subscribes to at most 256 inner publishers simultaneously. This is a hidden
throttle: fan-out over a large `Flux` of IDs will cap in-flight downstream calls
at 256 (protecting the downstream), and a lower explicit value
(`flatMap(fn, 8)`) is a common way to bound concurrent DB/HTTP calls. `concatMap`
is effectively `flatMap` with concurrency 1 plus ordering. `flatMapSequential`
subscribes eagerly (up to `concurrency`) but buffers to emit in subscription
order — so a slow first inner **holds back** later completed inners (potential
memory growth), unlike `flatMap` which emits the instant any inner produces.

**`switchMap` vs `concatMap` under bursts:** `switchMap` cancels the previous
inner on each new source item, so under a rapid burst it may only ever complete
the *last* inner — earlier work is cancelled mid-flight (side effects like a DB
write started in the cancelled inner may or may not have committed). `concatMap`
runs every inner to completion in order, so it never drops work but can build a
backlog.

**`zip`** — combines the *latest* item from each of several publishers pairwise
into a tuple/combined value, completing when the shortest completes. Great for
firing independent calls in parallel and joining:

```java
Mono<UserProfile> profile = Mono.zip(
        userService.getUser(id),        // runs...
        orderService.getOrders(id))     // ...concurrently
    .map(t -> new UserProfile(t.getT1(), t.getT2()));
```

Related combinators: `merge` (interleave, no order), `concat` (sequential,
ordered), `combineLatest`, `then`/`thenMany` (ignore values, chain on
completion), `zipWith`.

**Error/util operators:** `onErrorReturn`, `onErrorResume` (fallback publisher),
`onErrorMap`, `retry(n)`, `retryWhen(Retry.backoff(...))`, `timeout`,
`defaultIfEmpty`, `switchIfEmpty`, `filter`, `doOnNext`/`doOnError` (side-effect
"peek" operators — do not transform the stream).

---

## Spring MVC vs Spring WebFlux (threading models)

This comparison is the heart of the topic.

| Aspect | Spring MVC | Spring WebFlux |
|---|---|---|
| API base | Servlet API (`jakarta.servlet.*` in Boot 3) | Reactive Streams / Reactor |
| Concurrency model | **thread-per-request**, blocking | **event loop**, non-blocking |
| Default server | Tomcat (servlet container) | **Netty** (also Tomcat/Jetty/Undertow via Servlet 3.1+ async) |
| Return types | `T`, `ResponseEntity<T>` | `Mono<T>`, `Flux<T>`, `ResponseEntity<Mono<T>>` |
| Threads under load | large pool (e.g. 200) — one blocked per in-flight request | few threads = # CPU cores |
| Data access | JDBC/JPA (blocking) | R2DBC, reactive Mongo/Redis/Cassandra (non-blocking) |
| Client | `RestTemplate` (also `WebClient`) | `WebClient` |

**Thread-per-request (MVC):** each incoming request grabs a container thread and
**holds it for the entire request**, including time spent blocked on JDBC or a
downstream HTTP call. Under high concurrency you need many threads; each thread
costs ~1MB stack + context-switch overhead. When the pool is exhausted, requests
queue and latency spikes.

**Event loop (WebFlux):** a small fixed set of **event-loop threads** (Netty,
~one per core) process events. When a handler awaits I/O it **returns the thread
to the loop** and resumes via a callback when data is ready. Thus a handful of
threads can serve tens of thousands of concurrent connections — as long as
**nothing blocks the event loop**.

**Runtime, not just server:** WebFlux can run on a Servlet 3.1+ container
(Tomcat/Jetty) using async non-blocking I/O, or on Netty/Undertow. You are **not
forced** onto Netty, but Netty is the default and typical choice.

**Advanced — you cannot mix freely:** A single application is *either* MVC or
WebFlux based on classpath (`spring-boot-starter-web` →
`DispatcherServlet`/Tomcat; `spring-boot-starter-webflux` →
`DispatcherHandler`/Netty). If both starters are present, Boot **defaults to
MVC** unless you explicitly set `spring.main.web-application-type=reactive`.
WebFlux uses `DispatcherHandler` (reactive) vs MVC's `DispatcherServlet`.

---

## When to choose WebFlux

WebFlux is **not automatically faster**; for a single request it can be slightly
slower due to overhead. It shines under specific conditions:

**Choose WebFlux when:**
- High concurrency with **I/O-bound** work: many slow downstream calls
  (microservice fan-out, aggregating APIs, gateways).
- **Streaming** data: Server-Sent Events, WebSocket, large downloads, chat.
- You need to do more with **fewer threads / less memory** (constrained
  environments, high connection counts, "C10k").
- The **whole stack is reactive** (reactive drivers: R2DBC, reactive Mongo,
  reactive Kafka), so backpressure is end-to-end.
- Functional, composable pipelines and resilience (timeouts/retries/fallbacks)
  are valuable.

**Prefer MVC when:**
- The team/ecosystem is **blocking** (JPA/JDBC, blocking libraries) — wrapping
  blocking calls in WebFlux gives you complexity without the benefit.
- **CPU-bound** workloads — event loops don't help; you still need parallelism.
- Simpler debugging, familiar stack traces, and mature tooling matter more.
- The app is low/moderate traffic — MVC is simpler and perfectly adequate.

**Interview one-liner:** "WebFlux pays off for I/O-bound, high-concurrency,
streaming workloads with an end-to-end non-blocking stack; it is not a free
performance upgrade for a JDBC/JPA CRUD app." Note also **Spring MVC can return
reactive types** (`Mono`/`Flux`) too — but MVC still uses a servlet thread and
async servlet support, so the win is smaller.

---

## WebClient vs RestTemplate

`WebClient` is the modern, **non-blocking, reactive** HTTP client (from
`spring-webflux`); `RestTemplate` is the classic **synchronous, blocking**
client from `spring-web`.

| | RestTemplate | WebClient |
|---|---|---|
| Model | synchronous, blocking | asynchronous, non-blocking, reactive |
| Returns | `T` / `ResponseEntity<T>` directly | `Mono<T>` / `Flux<T>` |
| API style | template methods | fluent builder |
| Streaming | no | yes (`Flux`, SSE) |
| Status | **in maintenance mode** since Spring 5.0 | recommended for new code |
| Backpressure | n/a | yes |

```java
// RestTemplate (blocking)
User u = restTemplate.getForObject("/users/{id}", User.class, id);

// WebClient (reactive)
Mono<User> u = webClient.get().uri("/users/{id}", id)
    .retrieve()
    .bodyToMono(User.class);
```

**Clarifications (traps):**
- `RestTemplate` is **not deprecated** — it is in *maintenance mode* (no new
  features, still supported/bug-fixed). Interviewers love this distinction.
- `WebClient` can be used in a **Spring MVC** app too, but if you call `.block()`
  on it you turn it back into a blocking client (fine on MVC threads, forbidden
  on WebFlux event-loop threads).
- Spring 6.1 introduced **`RestClient`** — a synchronous client with WebClient's
  fluent API — as the modern blocking successor to `RestTemplate`.
- `retrieve()` throws `WebClientResponseException` on 4xx/5xx by default; use
  `exchangeToMono` / `onStatus` for fine-grained control (`exchange()` is
  deprecated due to connection-leak risk if the body isn't consumed).

**Advanced:** `WebClient` is backed by a connection pool (Reactor Netty
`HttpClient`). One shared, immutable `WebClient` bean is thread-safe and should
be reused (`WebClient.Builder` is auto-configured). Configure timeouts on the
underlying `HttpClient`, not by blocking.

---

## Functional endpoints (RouterFunction/HandlerFunction) vs annotated controllers

WebFlux supports **two** programming models that can even coexist:

**1. Annotated controllers** — the familiar `@RestController` /
`@GetMapping` style, but returning reactive types:

```java
@RestController
class UserController {
    @GetMapping("/users/{id}")
    Mono<User> byId(@PathVariable String id) { return service.find(id); }

    @GetMapping(value="/users", produces=MediaType.TEXT_EVENT_STREAM_VALUE)
    Flux<User> stream() { return service.all(); }
}
```

**2. Functional endpoints** — routing and handling as **explicit, composable
functions**, declared as beans:

```java
@Bean
RouterFunction<ServerResponse> routes(UserHandler h) {
    return route(GET("/users/{id}"), h::byId)
          .andRoute(POST("/users"), h::create);
}

@Component
class UserHandler {
    Mono<ServerResponse> byId(ServerRequest req) {
        return service.find(req.pathVariable("id"))
            .flatMap(u -> ServerResponse.ok().bodyValue(u))
            .switchIfEmpty(ServerResponse.notFound().build());
    }
}
```

Key types: `RouterFunction<ServerResponse>` maps a `RequestPredicate` to a
`HandlerFunction`; `HandlerFunction` is `ServerRequest -> Mono<ServerResponse>`.

| | Annotated | Functional |
|---|---|---|
| Routing | annotations, reflection-driven | explicit code, `RouterFunctions` DSL |
| Style | declarative | functional/programmatic |
| Request/response | method params + return | `ServerRequest` / `Mono<ServerResponse>` |
| Discoverability | scattered across classes | routing centralized/visible |
| Testing | `WebTestClient` / mock MVC-style | easy unit test of handler functions |

Both run on the same reactive engine (`DispatcherHandler`); choice is stylistic.
Functional endpoints give more explicit control and less "magic," and are often
preferred for small, focused services or when you want routing in one place.

---

## Schedulers and threading in Reactor

By default a reactive chain executes on the thread that **triggered the
subscription / emitted the signal** — Reactor does **not** switch threads unless
you ask. `Schedulers` control *where* work runs; two operators move execution:

- **`subscribeOn(scheduler)`** — affects the **whole chain's** subscription
  (upstream), i.e., where the source starts emitting. Position-independent
  (first `subscribeOn` wins).
- **`publishOn(scheduler)`** — switches the thread for **downstream** operators
  from that point on. You can use several to hop threads.

```java
flux.subscribeOn(Schedulers.boundedElastic())  // source runs on elastic pool
    .publishOn(Schedulers.parallel())           // downstream on parallel pool
    .map(...);
```

**Common schedulers:**

| Scheduler | Backing | Use |
|---|---|---|
| `Schedulers.parallel()` | fixed pool = #cores | CPU-bound, non-blocking work |
| `Schedulers.boundedElastic()` | elastic, capped pool of many threads | **wrapping blocking/legacy calls** (JDBC, file I/O) |
| `Schedulers.single()` | one reused thread | low-volume one-at-a-time tasks |
| `Schedulers.immediate()` | current thread | no-op / testing |
| `Schedulers.fromExecutor(...)` | your executor | custom |

**Key rule:** to run **blocking** code in a reactive app, offload it to
`boundedElastic` so you never tie up event-loop threads:

```java
Mono.fromCallable(() -> blockingJdbcCall())     // blocking
    .subscribeOn(Schedulers.boundedElastic());   // ...on a safe pool
```

**Advanced:** `subscribeOn` influences where the subscription signal and source
emission run, but a subsequent `publishOn` overrides the thread for downstream
operators. Netty event-loop threads should only run non-blocking work.
`BlockHound` is a tool that instruments the JVM to **detect blocking calls on
non-blocking threads** at runtime — a favorite for catching pitfalls in tests.

**Multiple `subscribeOn` (gotcha):** Only the `subscribeOn` **closest to the
source** takes effect for where subscription begins; a second `subscribeOn`
further downstream is essentially ignored for thread placement of the source (it
changes the thread on which the subscription signal propagates upstream from that
point, but the earlier one has already switched it). By contrast you can chain
several `publishOn` calls and each one re-routes everything below it.

**`subscribeOn` does NOT parallelize:** A single `subscribeOn` moves the whole
chain to *one* worker thread of the pool — it does not run operators in parallel.
For real parallelism use `flatMap` with inner publishers each on
`subscribeOn(Schedulers.parallel()/boundedElastic())`, or the `ParallelFlux` API
via `.parallel(n).runOn(scheduler)`.

**`publishOn` and blocking (subtle):** `publishOn(boundedElastic())` shifts
*downstream* operators onto a blocking-safe pool, so blocking code placed *after*
it is safe — but everything *upstream* of the `publishOn` still runs wherever it
was (possibly the event loop). Placement is load-bearing: to protect a blocking
call, ensure that call executes downstream of the `publishOn` (or wrap it with
`subscribeOn` on its own inner publisher).

**Thread affinity within a chain:** Reactor guarantees signals for one subscriber
are serialized, but a chain can hop threads at each `publishOn`. Never assume an
operator sees the same thread as the one before it; capture context explicitly
rather than relying on `ThreadLocal`.

**Non-blocking sleep:** `Thread.sleep` blocks the loop; use
`Mono.delay(Duration)` / `.delayElement(...)` which schedule on
`Schedulers.parallel()` via a timer and never block.

---

## Error handling in reactive chains

Errors are **terminal signals** (`onError`) that travel downstream and, unless
handled, terminate the sequence and propagate to the subscriber. You do **not**
use try/catch around a lazy pipeline (it wouldn't catch async errors); you use
operators:

| Operator | Behavior |
|---|---|
| `onErrorReturn(fallback)` | replace error with a single fallback value |
| `onErrorResume(fn)` | switch to a fallback `Publisher` on error |
| `onErrorMap(fn)` | translate one exception type to another |
| `onErrorContinue(fn)` | (special) drop offending element and continue — use with care |
| `retry(n)` / `retryWhen(Retry.backoff(..))` | resubscribe on error |
| `doOnError(fn)` | side-effect only (logging); does **not** handle the error |
| `timeout(d)` | emit `TimeoutException` if no signal in time |

```java
service.find(id)
    .timeout(Duration.ofSeconds(2))
    .retryWhen(Retry.backoff(3, Duration.ofMillis(100)))
    .onErrorResume(NotFoundException.class, e -> Mono.empty())
    .switchIfEmpty(Mono.error(new ResponseStatusException(NOT_FOUND)));
```

**Traps:** `doOnError` logs but the error still propagates (people expect it to
"handle"). A `try/catch` around building the pipeline won't catch runtime
emission errors. `onErrorContinue` requires operator support and can be
surprising — prefer `onErrorResume` inside `flatMap` for per-item recovery.

**`onErrorContinue` vs `onErrorResume` (deep distinction):** `onErrorResume`
handles the error signal *conventionally* — it terminates the failing sequence
and switches to a fallback publisher. `onErrorContinue` is fundamentally
different: it reaches **upstream** via the Reactor `Context` and instructs
compatible operators (like `map`/`flatMap`) to **drop the offending element and
continue** the same sequence, without a terminal signal. Because it mutates
upstream behavior through context, it only works with operators that opted in,
and it can "leak" past a `flatMap` boundary into inner publishers unexpectedly.
Rule of thumb: to recover the *whole* stream, use `onErrorResume`; to skip
*individual* bad items, wrap the risky call in `flatMap(x ->
process(x).onErrorResume(...))` rather than relying on `onErrorContinue`.

**`retry` resubscribes the COLD source (gotcha):** `retry`/`retryWhen` work by
**re-subscribing** to the upstream. On a cold publisher (e.g. a fresh WebClient
call) that re-executes the request — good. But if upstream is hot or has
side-effects already performed, retry won't "rewind" them. Also, retry counts the
number of *retries* not total attempts: `retry(3)` = up to 4 executions.
`Retry.backoff` adds jitter by default (50%) to avoid thundering-herd
resubscription.

**Error inside `flatMap` cancels siblings:** If one inner publisher in a
`flatMap` errors and you don't handle it inside the inner, the error propagates
and Reactor **cancels the other in-flight inners** and terminates the outer
`Flux`. To make per-item failures isolated, attach `onErrorResume`/`onErrorReturn`
to the *inner* publisher so the outer sequence never sees the error.

**`ResponseStatusException` vs `@ExceptionHandler`:** In WebFlux you still use
`@ExceptionHandler` / `@ControllerAdvice` (they return reactive types) or a
custom `WebExceptionHandler`/`AbstractErrorWebExceptionHandler`. Throwing
imperatively inside a lambda is fine only if it happens during assembly;
emission-time failures must be signalled via `Mono.error(...)` so they travel as
`onError`, not as a thrown exception that escapes the reactive boundary.

---

## Reactive data access and context

For end-to-end non-blocking you need **reactive drivers**:

- **R2DBC** (Reactive Relational Database Connectivity) — non-blocking SQL;
  `ReactiveCrudRepository`, `R2dbcEntityTemplate`. **JPA/Hibernate are blocking**
  and have no reactive equivalent — using JPA under WebFlux reintroduces
  blocking (offload to `boundedElastic` or just use MVC).
- Reactive MongoDB, Cassandra, Redis (Lettuce), and reactive Kafka exist.

**Context propagation trap:** `ThreadLocal`-based tools (Spring Security
context, MDC logging, transaction context) **don't** follow a reactive pipeline
across thread hops. Reactor provides the immutable **`Context`** (accessed via
`contextWrite` / `Mono.deferContextual`) to carry request-scoped data through the
chain. Spring Security's reactive `ReactiveSecurityContextHolder` uses it. Since
Reactor 3.5 / Micrometer, `ContextPropagation` bridges `ThreadLocal`s.

**Transactions:** reactive apps use `ReactiveTransactionManager` +
`TransactionalOperator` (or `@Transactional` on reactive types with a reactive
tx manager). The classic JPA `PlatformTransactionManager` is blocking.

**Reactive `@Transactional` binds to the SUBSCRIBER context, not a
`ThreadLocal`:** In blocking Spring, transaction/connection state lives in a
`ThreadLocal`; in reactive Spring the R2DBC connection and transaction context
ride in the Reactor `Context`. This means a `@Transactional` reactive method only
governs the operations that are part of the **same reactive chain** it returns.
If you call `.subscribe()` on a nested publisher (breaking the chain into an
independent subscription with a fresh context), that work runs **outside** the
transaction. Always compose with `flatMap`/`then` so everything shares one
subscription and one transactional `Context`.

**`Context` is immutable and written bottom-up:** `contextWrite` affects
operators **upstream** of it (the context is assembled from the subscriber
downward and read as it flows up during subscription), so a value written by
`contextWrite` near the end of a chain is visible to `deferContextual` earlier in
the chain. This "reads backwards" behavior is a classic interview trap.

**Micrometer Context Propagation (Boot 3 / Reactor 3.5+):** the
`context-propagation` library plus `Hooks.enableAutomaticContextPropagation()`
(default-on for WebFlux in recent Boot 3.x) bridges registered `ThreadLocal`
accessors (MDC, Micrometer tracing, Security) to/from the Reactor `Context`
automatically across `publishOn`/`subscribeOn` boundaries — reducing the need for
manual `contextWrite`.

---

## Common pitfalls (blocking in a reactive chain)

The #1 mistake: **calling blocking code on an event-loop thread.** It stalls
that thread; a handful of blocked event-loop threads can freeze the entire
application under load — worse throughput than MVC.

Examples of blocking to avoid on reactive threads:
- `.block()` / `.blockFirst()` / `.blockLast()` on a `Mono`/`Flux`.
- JDBC / JPA calls, `Thread.sleep`, synchronous file I/O.
- `RestTemplate` calls, `future.get()`, synchronized locks with contention.

```java
// BAD — blocks the Netty event-loop thread:
@GetMapping("/x")
Mono<User> bad() {
    User u = restTemplate.getForObject(...);   // blocking!
    return Mono.just(u);
}

// GOOD — stay reactive:
Mono<User> good() { return webClient.get()...bodyToMono(User.class); }

// If you MUST call blocking code, offload it:
Mono<Data> okBlocking() {
    return Mono.fromCallable(() -> legacyBlockingDao.load())
               .subscribeOn(Schedulers.boundedElastic());
}
```

**Other frequent pitfalls:**
- **Forgetting to subscribe** — a `Mono`/`Flux` you never return or subscribe to
  does *nothing* (lazy). In a controller, *return* it; don't call methods for
  side effects and discard the publisher.
- **Calling `.block()`** inside a chain to "get the value" — defeats the whole
  model and throws on non-blocking threads (`block()/blockFirst()/blockLast() are
  blocking, which is not supported...`).
- **Nested `map` returning a publisher** → use `flatMap`.
- **Doing heavy CPU work on the event loop** — offload to `parallel()`.
- **Broken backpressure** when bridging from blocking/callback sources.
- **Losing `ThreadLocal` context** across scheduler hops (MDC, security).
- **`subscribe()` swallowing errors** — always provide an error consumer or use
  `.onError*` operators; unhandled errors go to a dropped-error hook.
- Detect blocking in tests with **BlockHound**.

---

## Assembly time vs subscription time vs runtime

A frequently-probed mental model: a Reactor pipeline has **three distinct
phases**, and confusing them causes real bugs.

- **Assembly time** — when the operator chain is *built* (each operator wraps the
  previous in a new `Publisher`). Runs eagerly, on the declaring thread. Code
  written *directly* in the method body (not inside a lambda/`defer`) executes
  here, once, regardless of subscriptions.
- **Subscription time** — when `subscribe()` walks the chain from the bottom up,
  wiring `onSubscribe` and propagating the Reactor `Context` upstream. Happens
  once per subscriber (per subscription for cold sources).
- **Runtime** — the actual `onNext`/`onError`/`onComplete` signal flow downstream.

```java
Mono<Long> m = Mono.just(System.currentTimeMillis()); // captured at ASSEMBLY
Mono<Long> d = Mono.defer(() ->
        Mono.just(System.currentTimeMillis()));         // captured per SUBSCRIPTION
```

`Mono.just(expensiveCall())` runs `expensiveCall()` **eagerly at assembly** — a
classic bug when people expect laziness. Wrap it in `Mono.fromCallable(...)` or
`Mono.defer(...)` so it executes lazily per subscription. Likewise `Flux.just`,
`Mono.error(new Exc())` all evaluate their argument at assembly time; use `defer`
to make the value/exception per-subscription.

---

## Sinks, multicasting, and hot streams

`Sinks` (Reactor 3.4+, replacing the deprecated `Processor`/`DirectProcessor`
family) are the programmatic way to **push** signals into a reactive stream —
building a hot publisher from an imperative source.

```java
Sinks.Many<Event> sink = Sinks.many().multicast().onBackpressureBuffer();
Flux<Event> flux = sink.asFlux();
// producer side (thread-safe emit with explicit failure handling):
Sinks.EmitResult r = sink.tryEmitNext(event);
```

Key variants:

| Factory | Semantics |
|---|---|
| `Sinks.many().multicast()` | fan-out to N subscribers; late subscribers miss prior items (warm-up buffer only until first subscriber) |
| `Sinks.many().unicast()` | at most **one** subscriber; buffers until it subscribes |
| `Sinks.many().replay()` | replays history (all or last N) to every subscriber |
| `Sinks.one()` | a single-value hot `Mono` |

**`emitNext` vs `tryEmitNext`:** `tryEmitNext` returns an `EmitResult` you must
inspect (e.g. `FAIL_NON_SERIALIZED`, `FAIL_OVERFLOW`, `FAIL_TERMINATED`).
`emitNext(v, EmitFailureHandler)` throws/handles for you. Because Reactive
Streams forbids concurrent `onNext`, sinks detect concurrent emission and fail
with `FAIL_NON_SERIALIZED` rather than corrupting the stream — you must serialize
emissions yourself (or use `EmitFailureHandler.busyLooping`).

**`share()` / `publish().refCount()` / `replay()`** turn a cold `Flux` hot:
`share()` = `publish().refCount(1)` — the source is subscribed once when the
first subscriber arrives and cancelled when the last leaves. `cache()` replays to
all. These are how you avoid re-running an expensive cold source per subscriber.

---

## WebClient internals, connection pooling, and timeouts

`WebClient` is backed by Reactor Netty's `HttpClient`, which owns a **shared
connection pool** (`ConnectionProvider`) and the event-loop group. Getting this
wrong is a common production incident.

- **Reuse one `WebClient`/`ConnectionProvider`.** Building a `WebClient` per
  request (especially `WebClient.create()` in a hot path) can spin up new
  resources and defeat pooling. Inject the auto-configured `WebClient.Builder`.
- **Timeout layers** (all distinct): connection-acquire timeout (pool), TCP
  connect timeout (`CONNECT_TIMEOUT_MILLIS`), response timeout
  (`responseTimeout`), read/write idle timeouts (`ReadTimeoutHandler`), and the
  Reactor `.timeout(Duration)` operator (cancels the subscription). Relying only
  on `.timeout()` cancels the Mono but the underlying connection handling is
  governed by Netty; configure both.
- **`retrieve()` vs `exchangeToMono()`:** `exchange()` is **deprecated** because
  the returned `ClientResponse` must have its body consumed/released or the
  connection leaks back-pressuring the pool to exhaustion. `exchangeToMono`
  guarantees release. `retrieve()` auto-handles the body.
- **Pool exhaustion symptom:** `PoolAcquirePendingLimitException` /
  acquire timeouts under load usually mean responses aren't being consumed,
  timeouts are too long, or `maxConnections` is too low — not that you need more
  threads.
- WebClient works fine in an MVC app; `.block()` on it is legal on servlet
  threads but forbidden on event-loop threads.

---

## Testing reactive code: StepVerifier and virtual time

`StepVerifier` subscribes to a publisher and asserts the exact signal sequence;
`.verify()` (or `verifyComplete`/`verifyError`) is **terminal and blocking** —
nothing is asserted until you call it (forgetting it is a silent no-op test).

```java
StepVerifier.create(service.find("1"))
    .expectNext(user)
    .expectComplete()
    .verify(Duration.ofSeconds(1));
```

**Virtual time** tests time-based operators without real waiting:

```java
StepVerifier.withVirtualTime(() -> Flux.interval(Duration.ofHours(1)).take(2))
    .thenAwait(Duration.ofHours(2))   // fast-forwards the virtual clock
    .expectNext(0L, 1L)
    .verifyComplete();
```

The supplier lambda is required so the time-based publisher is **assembled inside
the virtual-time scheduler's scope**. `StepVerifier.create(...).expectNext(...)`
also supports `.expectNextCount`, `.thenRequest(n)` (to drive backpressure), and
`.expectError(Class)`. `WebTestClient` tests at the HTTP layer (bind to a
controller, router function, or a running server).

---

## Streaming, SSE, WebSocket, and JSON serialization

WebFlux distinguishes how a `Flux` response body is serialized by **media type**:

- `application/json` — a `Flux<T>` is rendered as a **single JSON array**; the
  server still buffers/aggregates conceptually and emits one array. Backpressure
  applies but the client sees one document.
- `application/x-ndjson` (newline-delimited JSON) / `text/event-stream` — each
  item is flushed as it is produced, enabling true streaming and per-item
  backpressure over the connection.
- `text/event-stream` (SSE) — use `Flux<ServerSentEvent<T>>` or a `Flux<T>` with
  `produces = MediaType.TEXT_EVENT_STREAM_VALUE`. `ServerSentEvent` lets you set
  `id`, `event`, `retry`, and comments.

**WebSocket** uses `WebSocketHandler` with `handle(WebSocketSession)` returning
`Mono<Void>`; you compose `session.receive()` (inbound `Flux<WebSocketMessage>`)
and `session.send(...)`. The returned `Mono<Void>` represents session lifetime —
completing it closes the socket, so you typically `.then()` the send/receive
pipelines.

**Backpressure over HTTP:** for a streaming media type, Reactor Netty maps
downstream demand onto TCP flow control — if the client (or a slow consumer)
stops reading, the OS TCP window fills, Netty stops reading, and the server
`Flux` sees reduced demand. This end-to-end propagation only holds for streaming
media types, not the single-array JSON case.

---

## Cancellation and resource cleanup

Cancellation is a first-class signal that flows **upstream** (opposite of data).
When a WebFlux client disconnects, the framework **cancels** the subscription; a
well-behaved source (WebClient call, R2DBC query) then aborts its work.

- `switchMap`, `timeout`, `take(n)`, and downstream `cancel()` all trigger
  upstream cancellation. `flatMap` cancels its inners when the outer is cancelled
  or errors.
- Use `doOnCancel`, `doFinally(signalType -> ...)` (fires on complete, error, or
  cancel), and `using`/`usingWhen` for resource acquisition/release bound to the
  reactive lifecycle.
- **Gotcha:** side effects started in a cancelled inner (e.g. a partial DB write)
  are **not** rolled back by cancellation alone — cancellation stops further
  signals, it does not undo work. Design idempotent or transactional operations.
- A hanging request that never completes and is never cancelled ties up a Netty
  connection; always bound with `timeout`.

---

## Common follow-up questions

- **Is WebFlux always faster than MVC?** No. For CPU-bound or low-concurrency
  work it can be equal or slower; it wins for I/O-bound, high-concurrency,
  streaming workloads with an end-to-end non-blocking stack.
- **Can Spring MVC return `Mono`/`Flux`?** Yes — MVC supports reactive return
  types via async servlet support, but it still uses a servlet thread per
  request, so the concurrency benefit is limited.
- **What happens if I don't subscribe?** Nothing runs; the publisher is lazy.
- **Difference between `subscribeOn` and `publishOn`?** `subscribeOn` sets the
  thread for the subscription/source (affects upstream, position-agnostic);
  `publishOn` switches the thread for downstream operators from that point.
- **`map` vs `flatMap`?** `map` is synchronous 1:1; `flatMap` is asynchronous
  1:N returning publishers, merged (unordered). `concatMap` keeps order.
- **Why `boundedElastic`?** To safely run blocking/legacy calls off the event
  loop, with a capped, reusable, elastic thread pool.
- **Is `RestTemplate` deprecated?** No — it is in maintenance mode; `WebClient`
  (reactive) and `RestClient` (blocking, Spring 6.1+) are the modern choices.
- **How do you test reactive code?** `StepVerifier` (assert emissions/errors) and
  `WebTestClient` (endpoint integration).
- **How is backpressure achieved over HTTP?** Reactor Netty maps demand to TCP
  flow control (read backpressure); for streaming responses the client's demand
  throttles the server.
- **What replaces `ThreadLocal`?** Reactor `Context` / `contextWrite`, plus
  Micrometer context propagation for bridging existing `ThreadLocal`s.
- **Can MVC and WebFlux run in one app?** Not as the primary web stack — one is
  chosen at startup (`web-application-type`); but you can use `WebClient` in an
  MVC app and Reactor types in services.

---

## References

- Spring Framework Reference — Web on Reactive Stack (WebFlux):
  https://docs.spring.io/spring-framework/reference/web/webflux.html
- Spring WebFlux — Reactive core, DispatcherHandler:
  https://docs.spring.io/spring-framework/reference/web/webflux/dispatcher-handler.html
- Spring WebFlux functional endpoints (RouterFunction):
  https://docs.spring.io/spring-framework/reference/web/webflux-functional.html
- WebClient reference:
  https://docs.spring.io/spring-framework/reference/web/webflux-webclient.html
- Project Reactor reference guide:
  https://projectreactor.io/docs/core/release/reference/
- Reactor Schedulers & threading:
  https://projectreactor.io/docs/core/release/reference/#schedulers
- Reactive Streams specification: https://www.reactive-streams.org/
- Baeldung — Spring WebFlux: https://www.baeldung.com/spring-webflux
- Baeldung — Reactor Map vs FlatMap: https://www.baeldung.com/java-reactor-map-flatmap
- Baeldung — WebClient vs RestTemplate: https://www.baeldung.com/spring-webclient-resttemplate
- Baeldung — Reactor Schedulers / publishOn vs subscribeOn:
  https://www.baeldung.com/spring-reactor-threading
- Spring Boot docs — Reactive web applications:
  https://docs.spring.io/spring-boot/reference/web/reactive.html
