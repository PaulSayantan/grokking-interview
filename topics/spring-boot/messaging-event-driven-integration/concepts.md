# Messaging & Event-Driven Integration

Messaging decouples producers from consumers in time, space, and delivery. Instead of a
synchronous call where the caller blocks and both services must be up simultaneously, a
producer hands a message to a broker and moves on; consumers process it when ready. This
section covers event-driven architecture, JMS, RabbitMQ, Apache Kafka (with Spring),
ActiveMQ, delivery semantics, ordering, retries/DLQs, idempotency, and how to choose
between brokers.

## Event-Driven Architecture

**Beginner:** Event-Driven Architecture (EDA) is a style where components communicate by
producing and consuming **events** — immutable facts about something that already happened
("OrderPlaced", "PaymentCaptured"). Producers emit events without knowing who (if anyone)
consumes them. This inverts control compared to request/response: the emitter does not call
a specific handler; the broker/router delivers to whoever subscribed.

**Why it matters:** EDA gives you loose coupling, independent scaling, resilience (a slow or
down consumer does not block the producer), and easy fan-out (one event, many reactions).

**Intermediate — event styles:**

| Style | Payload | Coupling | Example |
|-------|---------|----------|---------|
| Event Notification | thin ("OrderId=42 changed") | consumer must call back for details | webhook ping |
| Event-Carried State Transfer | fat (full order snapshot) | consumer keeps a local copy, no callback | replicated read model |
| Event Sourcing | store events as the source of truth; state = fold(events) | rebuild state by replay | ledger, audit |
| CQRS | separate write model (commands) from read model (queries), often event-synced | | reporting DB |

**Command vs Event:** A **command** is an instruction directed at one handler ("ShipOrder")
and may be rejected; an **event** is a fact broadcast to zero-or-more listeners and cannot be
rejected (it already happened). Naming: commands are imperative, events are past-tense.

**Advanced gotchas:**
- **Dual-write problem:** updating a DB *and* publishing an event in two separate steps is
  not atomic — a crash between them loses or duplicates the event. Solve with the
  **Transactional Outbox** pattern (write event to an outbox table in the same DB
  transaction, then a relay/CDC like Debezium publishes it) or a **listener-to-log** CDC.
- **Eventual consistency:** consumers see state after a delay; UIs and business logic must
  tolerate staleness.
- **Ordering & idempotency** become first-class concerns (covered below).
- Spring's in-JVM `ApplicationEventPublisher` / `@EventListener` is EDA *inside one process*
  (synchronous by default; add `@Async` for async) — distinct from cross-service brokered
  messaging.

## JMS (Java Message Service)

**Beginner:** JMS is a **Java API specification** (not a product) for message-oriented
middleware. Your code programs against interfaces (`ConnectionFactory`, `Connection`,
`Session`, `MessageProducer`, `MessageConsumer`, `Destination`); a provider (ActiveMQ,
Artemis, IBM MQ) implements them. It standardizes messaging the way JDBC standardizes DB
access.

**Two messaging domains:**
- **Queue (point-to-point):** one message consumed by exactly one consumer. Competing
  consumers load-balance.
- **Topic (publish/subscribe):** each message delivered to *all* current subscribers
  (durable subscriptions survive disconnects).

**Message types:** `TextMessage`, `BytesMessage`, `MapMessage`, `ObjectMessage`,
`StreamMessage`.

**Jakarta EE note (critical for Spring Boot 3):** JMS moved from `javax.jms.*` to
`jakarta.jms.*` with Jakarta EE 9+. Spring Framework 6 / Spring Boot 3 use `jakarta.jms`;
Spring 5 / Boot 2 use `javax.jms`. This is a common upgrade pitfall.

**Spring support:**
- `JmsTemplate` — convenience for send/receive (synchronous receive by default; `send`,
  `convertAndSend`, `receive`, `receiveAndConvert`).
- `@JmsListener` — annotation-driven async message-driven POJO, backed by
  `DefaultMessageListenerContainer`. Enable with `@EnableJms`.
- `MessageConverter` (e.g. `MappingJackson2MessageConverter`) for POJO ↔ message.

```java
@Component
public class OrderListener {
    @JmsListener(destination = "orders.queue")
    public void handle(OrderDto order) { /* ... */ }
}
```

**Acknowledgement modes:** `AUTO_ACKNOWLEDGE`, `CLIENT_ACKNOWLEDGE`,
`DUPS_OK_ACKNOWLEDGE`, and `SESSION_TRANSACTED`. With transacted sessions, receipt+processing
commit together.

**Advanced:** JMS `Session` objects are **not thread-safe** and are meant to be used by a
single thread; `ConnectionFactory` and `Connection` are thread-safe. In Spring, use a
`CachingConnectionFactory` to avoid re-creating connections/sessions/producers per send —
without caching, `JmsTemplate` opens and closes a connection on every call (very slow).

## RabbitMQ (Exchanges, Queues, Bindings, Routing Keys, Ack)

**Beginner:** RabbitMQ is a broker implementing **AMQP 0-9-1**. The core model: a **producer**
publishes to an **exchange** (never directly to a queue). The exchange routes the message to
zero or more **queues** according to **bindings** and the message's **routing key**.
Consumers read from queues.

**Exchange types:**

| Type | Routing behavior |
|------|------------------|
| **direct** | routing key must equal the binding key exactly |
| **topic** | routing key matched against binding pattern with `*` (one word) and `#` (zero+ words) |
| **fanout** | ignores routing key; broadcasts to every bound queue |
| **headers** | routes on message headers (`x-match: any/all`) instead of routing key |
| **default** (nameless direct) | every queue is implicitly bound by its own name; publish with routing key = queue name |

**Ack model:** RabbitMQ uses consumer **acknowledgements**. With manual ack
(`basic.ack`/`basic.nack`/`basic.reject`), an unacked message is redelivered if the consumer
dies. `basic.nack`/`reject` with `requeue=false` sends the message to a Dead Letter Exchange
if configured. **Publisher confirms** (`confirm.select`) let the producer know the broker
persisted/routed the message; **mandatory** flag + returns handle unroutable messages.

**Prefetch (QoS):** `basic.qos(prefetchCount)` limits how many unacked messages a consumer
holds — the key knob for fair dispatch and avoiding one consumer hogging the queue.

**Spring AMQP:** `RabbitTemplate` to send, `@RabbitListener` to consume, `@EnableRabbit`,
plus `Queue`/`Exchange`/`Binding` beans (or `@RabbitListener` with `bindings`) auto-declared
by the `AmqpAdmin`.

```java
@RabbitListener(bindings = @QueueBinding(
    value = @Queue("orders.q"),
    exchange = @Exchange(value = "orders.ex", type = "topic"),
    key = "order.created"))
public void onOrder(OrderDto o) { /* ... */ }
```

Acknowledgement mode in Spring AMQP: `AcknowledgeMode.AUTO` (default; ack after listener
returns, nack on exception), `MANUAL` (you call `channel.basicAck`), `NONE` (fire-and-forget).

**Advanced gotchas:**
- **Messages route to exchanges, not queues** — a frequent trap. If no binding matches, the
  message is dropped (or returned if `mandatory`).
- A queue with **no active consumer** simply holds messages (up to limits); a **topic
  exchange** with no bound queue silently discards.
- **Smart broker / dumb consumer:** RabbitMQ tracks per-message state and does routing/redelivery
  logic itself (contrast Kafka's dumb broker / smart consumer).
- Consumer ordering is per-queue and best-effort; requeue-to-head can reorder. Use a single
  consumer with prefetch=1 if strict order per queue is required.

## Apache Kafka with Spring (Template, Listener, Topics, Partitions, Groups, Offsets)

**Beginner:** Kafka is a distributed, partitioned, replicated **commit log**. Producers append
records to **topics**; consumers read them. Unlike a queue, Kafka **retains** messages for a
configured time/size regardless of consumption, so multiple independent consumers can read the
same data and replay it.

**Core model:**
- A **topic** is split into **partitions**. A partition is an ordered, append-only log; each
  record has a monotonically increasing **offset**.
- **Ordering is guaranteed only within a partition**, not across a topic.
- The **partition key** (`hash(key) % partitions`) decides placement — same key ⇒ same
  partition ⇒ ordered.
- A **consumer group** is a set of consumers sharing a `group.id`. Each partition is assigned
  to **exactly one consumer within a group** — so max parallelism = partition count. Different
  groups each get the full stream (pub/sub across groups, queue within a group).
- **Offset** = a consumer's position; committed offsets (in the internal `__consumer_offsets`
  topic) let a restarted consumer resume.

**Spring for Apache Kafka:**
- `KafkaTemplate<K,V>` to produce; `send()` returns a `CompletableFuture` (Spring Kafka 3.x;
  it was `ListenableFuture` in 2.x).
- `@KafkaListener` for consumers, backed by `ConcurrentMessageListenerContainer`; concurrency
  spins up N containers (≤ partitions). Enable with `@EnableKafka`.
- `KafkaAdmin` + `NewTopic` beans auto-create topics.

```java
kafkaTemplate.send("orders", order.getId(), order); // key = id ⇒ per-order ordering

@KafkaListener(topics = "orders", groupId = "billing")
public void consume(ConsumerRecord<String, Order> rec) { /* ... */ }
```

**Offset commit modes (Spring `AckMode`):** `BATCH` (default — commit after the batch of poll
records is processed), `RECORD`, `MANUAL`, `MANUAL_IMMEDIATE`, `TIME`, `COUNT`. Set
`enable.auto.commit=false` (Spring's default) and let the container commit for correctness.

**Rebalancing:** when consumers join/leave, partitions are reassigned. In-flight work can be
reprocessed, so commit carefully. Cooperative-sticky assignor reduces stop-the-world
rebalances.

**Advanced gotchas:**
- **Adding partitions breaks key-ordering** for existing keys because the hash mapping
  changes; plan partition count up front.
- **More consumers than partitions ⇒ idle consumers** (they get no partition).
- `max.poll.interval.ms`: if your listener takes too long between polls, the broker considers
  the consumer dead and rebalances — a classic "why do my messages get reprocessed" bug.
- Kafka is **dumb broker / smart consumer**: the broker does not track per-message acks; the
  consumer tracks offsets.
- Log compaction (`cleanup.policy=compact`) keeps only the latest record per key — used for
  changelog/state topics.

## Delivery Semantics (At-Most / At-Least / Exactly-Once) & Idempotent Producer

**Beginner definitions:**
- **At-most-once:** each message delivered 0 or 1 times — may be lost, never duplicated.
  (Commit offset *before* processing; if you crash after commit, the message is skipped.)
- **At-least-once:** delivered 1+ times — never lost, may be duplicated. (Process *then*
  commit; crash after processing but before commit ⇒ redelivery.) This is the common default.
- **Exactly-once:** delivered and processed effectively once — hardest and most expensive.

**Kafka specifics:**
- **Idempotent producer** (`enable.idempotence=true`, default since Kafka 3.0): the broker
  assigns each producer a PID and per-partition sequence numbers, so retries of the same
  record are deduplicated **within a producer session/partition**. Requires `acks=all`,
  `max.in.flight.requests.per.connection <= 5`, and retries > 0. It prevents duplicates from
  producer retries — it does **not** give end-to-end exactly-once by itself.
- **Transactions / EOS:** `transactional.id` + `initTransactions/beginTransaction/commit`
  enable atomic writes across partitions and the **read-process-write** pattern (consume,
  produce, commit offsets atomically). Consumers must set
  `isolation.level=read_committed` to skip aborted/uncommitted records. Spring: enable via
  `transactionIdPrefix` on the producer factory and use `KafkaTemplate.executeInTransaction`
  or `@Transactional` with `KafkaTransactionManager`.
- Exactly-once **to external systems** (a DB, an email) still requires idempotent consumers or
  a transactional sink — Kafka EOS only covers Kafka-to-Kafka.

**acks levels:** `acks=0` (fire and forget, may lose), `acks=1` (leader only), `acks=all`/`-1`
(all in-sync replicas — durable; pair with `min.insync.replicas>=2`).

**JMS/RabbitMQ:** auto-ack ≈ at-most-once risk (ack before processing); manual/transacted ack
after processing ≈ at-least-once. True exactly-once generally isn't offered — you achieve
effective-once with idempotent consumers + dedup.

## ActiveMQ

**Beginner:** ActiveMQ is Apache's popular **JMS provider** (message broker). Two lines:
- **ActiveMQ "Classic"** (5.x) — mature, feature-rich, JMS 1.1/2.0.
- **ActiveMQ Artemis** — the next-gen high-performance broker (the core of Red Hat AMQ 7 and
  the basis for `spring-boot-starter-artemis`).

**Protocols:** besides its native **OpenWire**, ActiveMQ speaks **AMQP 1.0**, **STOMP**,
**MQTT**, and WebSockets — useful for polyglot/IoT clients.

**Spring Boot:** `spring-boot-starter-activemq` (Classic) or `spring-boot-starter-artemis`
autoconfigures a `ConnectionFactory` and `JmsTemplate`. `spring.activemq.broker-url=vm://…`
runs an **embedded** broker for tests/dev.

**When to use:** you want classic JMS queue/topic semantics, transactions, message
selectors, and per-message priority/TTL — without Kafka's log/replay model. It is a broker
(smart, tracks acks), not a log; not designed for Kafka-scale replayable streams.

**Gotchas:** enabling persistence (KahaDB / JDBC store) is required for durability across
restarts; `ObjectMessage` deserialization is a security risk (set trusted-packages).

## Message Ordering, Retries, and Dead-Letter Queues

**Ordering:**
- **Kafka:** ordered per partition. Route related messages to the same partition via key.
  Beware: `max.in.flight.requests.per.connection > 1` with retries and *non*-idempotent
  producer can reorder on retry; idempotent producer preserves order up to 5 in-flight.
- **RabbitMQ:** order preserved per queue for a single consumer, but requeue/redelivery and
  multiple competing consumers break global order.
- **JMS:** ordering guaranteed within a session for a single consumer; message groups
  (ActiveMQ `JMSXGroupID`) pin a group to one consumer.

**Retries:**
- **Spring Kafka:** `DefaultErrorHandler` (replaced `SeekToCurrentErrorHandler` in 2.8+)
  with a `BackOff`; **non-blocking retries** via `@RetryableTopic` route failures to
  per-attempt retry topics and finally a DLT — so a poison record doesn't block the
  partition.
- **Spring AMQP:** `RetryInterceptor` (stateful/stateless) with backoff, or set up a DLX;
  exhausted retries are republished to the DLQ.

**Dead-Letter Queue (DLQ)/Dead-Letter Topic (DLT):** a destination for messages that cannot
be processed (repeated failures, deserialization errors, TTL expiry). Lets you quarantine
"poison messages" for inspection/replay instead of infinite redelivery.
- **RabbitMQ:** set `x-dead-letter-exchange` (and optional `x-dead-letter-routing-key`) on the
  queue; messages dead-letter on reject/nack (requeue=false), TTL expiry, or queue-length
  overflow. A common **delayed-retry** trick uses a TTL queue that dead-letters back to the
  work exchange.
- **Kafka:** no native DLQ; Spring's `DeadLetterPublishingRecoverer` sends failed records to a
  `<topic>.DLT`.

**Advanced gotcha — blocking vs non-blocking retry (Kafka):** naive in-place retry with
backoff *blocks the whole partition* (head-of-line blocking) because you can't advance the
offset. `@RetryableTopic` avoids this by moving the record to a separate retry topic.

## Idempotent Consumers

**Beginner:** Because most systems are at-least-once, a consumer **will** occasionally see the
same message twice. An **idempotent consumer** produces the same end state no matter how many
times it processes a given message. This is the practical substitute for exactly-once.

**Techniques:**
- **Dedup by message/business key:** store processed IDs (e.g., a `processed_messages` table
  with a unique constraint, or Redis SET with TTL); skip if seen. Ideally write the dedup row
  in the **same DB transaction** as the side effect so they commit atomically.
- **Idempotent writes:** design operations to be naturally idempotent — `UPSERT`/`SET x=5`
  instead of `INCREMENT`; conditional updates (optimistic version/`WHERE status='NEW'`).
- **Natural idempotency keys** carried in the message (e.g., `Idempotency-Key` header).

**Advanced:** dedup must consider the window (how long to remember IDs) and ordering (a later
message may legitimately update state — use versioning). Combining an outbox on the producer
(no duplicate *emits* from dual-write) with an idempotent consumer (tolerate broker
duplicates) gives robust effective-once end-to-end without Kafka transactions.

## Sync Request/Response vs Async Messaging

**Beginner:** In **synchronous request/response** (REST/gRPC), the caller blocks awaiting a
reply; both parties must be available; coupling is temporal and direct. In **asynchronous
messaging**, the producer sends to a broker and does not wait; the consumer processes later.

| Aspect | Sync (REST/gRPC) | Async (messaging) |
|--------|------------------|-------------------|
| Coupling | temporal + location | decoupled in time and space |
| Availability | both must be up | broker buffers; consumer can be down |
| Latency | immediate response | eventual |
| Backpressure/load | caller overwhelmed by spikes | queue absorbs spikes (buffer) |
| Failure handling | retry/timeouts by caller | retries, DLQ by broker/consumer |
| Complexity | simple mental model | eventual consistency, ordering, idempotency |
| Result delivery | direct return value | callback, reply queue, or polling |

**Async request/reply:** you *can* do request/reply over messaging using a `reply-to`
destination + `correlationId` (Spring's `RabbitTemplate.convertSendAndReceive`,
`JmsTemplate` with a temporary queue, or `ReplyingKafkaTemplate`). It reintroduces some
temporal coupling.

**When to choose which:** use sync when the caller genuinely needs the result now (a user
query, validation). Use async for work that can happen later, fan-out, spiky load, long-running
tasks, or cross-service integration where you want resilience and decoupling.

## Comparing Kafka vs RabbitMQ

**One-liner:** RabbitMQ is a **traditional message broker/queue** (smart broker, dumb
consumer) optimized for flexible routing and per-message delivery; Kafka is a **distributed,
replayable commit log** (dumb broker, smart consumer) optimized for high-throughput streaming
and retention.

| Dimension | RabbitMQ | Apache Kafka |
|-----------|----------|--------------|
| Model | queues + exchanges (AMQP) | partitioned append-only log |
| Message retention | deleted after ack (transient by default) | retained by time/size; replayable |
| Consumption | broker pushes; competing consumers | consumer pulls by offset |
| Ordering | per-queue (weakened by requeue/multi-consumer) | strict per partition |
| Routing | rich (direct/topic/fanout/headers) | by partition key only; routing is app-side |
| Throughput | high (tens–hundreds k/s) | very high (millions/s), sequential disk I/O |
| Replay | no (once acked, gone) | yes (reset offset) |
| Delivery | at-most / at-least-once | at-most/at-least/exactly-once (transactions) |
| Fan-out | bind many queues to an exchange | many consumer groups read same log |
| Backpressure | prefetch/QoS, broker-side | consumer-controlled poll rate |
| Typical use | task queues, RPC, complex routing, per-message workflows | event streaming, log aggregation, event sourcing, analytics, high-volume pipelines |

**Choosing:**
- Need **replay, high throughput, event sourcing, stream processing, long retention** → Kafka.
- Need **complex/conditional routing, per-message TTL/priority, simple task queues, request/
  reply, transactional JMS-style semantics** → RabbitMQ (or ActiveMQ).
- Kafka's "smart consumer" means clients manage offsets and reprocessing; Rabbit's "smart
  broker" means the broker manages state/redelivery.

## Common follow-up questions

- **Why does Kafka only guarantee ordering within a partition, not a topic?** Each partition
  is an independent log consumed by one consumer in a group; across partitions there is no
  global clock. Use a partition key to co-locate related records.
- **Does the Kafka idempotent producer give exactly-once?** No — it only dedups producer
  retries per partition. End-to-end EOS needs transactions (`transactional.id`,
  `read_committed`) or idempotent consumers for external sinks.
- **How do you handle a poison message?** Bounded retries with backoff, then route to a
  DLQ/DLT; on Kafka prefer non-blocking `@RetryableTopic` to avoid head-of-line blocking.
- **RabbitMQ: producer publishes to a queue — true or false?** False. Producers publish to
  **exchanges**; bindings route to queues.
- **How do you make a consumer idempotent?** Dedup on a business/message key (unique
  constraint or cache), or use naturally idempotent/UPSERT operations, ideally committing the
  dedup marker in the same transaction as the side effect.
- **What breaks message ordering on producer retries in Kafka?** `max.in.flight > 1` with a
  non-idempotent producer and retries. Idempotency preserves order up to 5 in-flight.
- **javax.jms vs jakarta.jms?** Spring Boot 3 / Spring 6 use `jakarta.jms`; Boot 2 uses
  `javax.jms`. Same for the whole Jakarta EE migration.
- **When would you pick sync REST over messaging?** When the caller needs an immediate result
  and both services are expected to be available (queries, synchronous validation).
- **What is the dual-write problem and how do you fix it?** Writing DB + publishing an event
  non-atomically. Fix with the transactional outbox + CDC/relay.
- **Kafka consumer group with 3 consumers and 2 partitions?** One consumer sits idle; max
  useful consumers = partition count.

## References

- Spring for Apache Kafka reference: https://docs.spring.io/spring-kafka/reference/
- Spring AMQP (RabbitMQ) reference: https://docs.spring.io/spring-amqp/reference/
- Spring Framework JMS: https://docs.spring.io/spring-framework/reference/integration/jms.html
- Apache Kafka documentation (design, delivery semantics, transactions): https://kafka.apache.org/documentation/
- RabbitMQ tutorials & AMQP concepts: https://www.rabbitmq.com/tutorials/amqp-concepts
- Apache ActiveMQ: https://activemq.apache.org/ and Artemis: https://activemq.apache.org/components/artemis/
- Confluent — Kafka exactly-once / idempotent producer: https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/
- Baeldung — Spring Kafka: https://www.baeldung.com/spring-kafka
- Baeldung — Spring AMQP / RabbitMQ: https://www.baeldung.com/spring-amqp
- Martin Fowler — Event-Driven / What do you mean by "Event-Driven"?: https://martinfowler.com/articles/201701-event-driven.html
- microservices.io — Transactional Outbox & Idempotent Consumer patterns: https://microservices.io/patterns/data/transactional-outbox.html
