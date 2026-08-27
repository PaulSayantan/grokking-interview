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
| Event Sourcing | store events as the source of truth; rebuild current state by replaying all past events in order | rebuild state by replay | ledger, audit |
| CQRS | separate write model (commands) from read model (queries), often event-synced | write path emits events read side subscribes to | order write DB + separate read-optimized query view |

One line of intuition per style: **Notification** just says "something changed, go look" (small, but chatty — every consumer calls back). **ECST** ships the whole new state so consumers never call back (bigger messages, but self-sufficient replicas). **Event Sourcing** stores the *events themselves* as the source of truth instead of the current row — because if you keep every "MoneyDeposited"/"MoneyWithdrawn" fact you can always recompute today's balance, get a perfect audit trail for free, and replay history to fix a bug or build a new view; the trade-off is you must replay (or snapshot) to read current state. **CQRS** splits the model you *write* through from the model(s) you *read* through so each can be optimized independently (normalized write DB, denormalized read view), usually kept in sync by events.

**Command vs Event:** A **command** is an instruction directed at one handler ("ShipOrder")
and may be rejected; an **event** is a fact broadcast to zero-or-more listeners and cannot be
rejected (it already happened). Naming: commands are imperative, events are past-tense.

**Advanced gotchas:**
- **Dual-write problem:** updating a DB *and* publishing an event in two separate steps is
  not atomic — a crash between them loses or duplicates the event. Solve with the
  **Transactional Outbox** pattern (write event to an outbox table in the same DB
  transaction, then a relay/CDC like Debezium publishes it) or a **listener-to-log** CDC.

  **Outbox walkthrough (trace).** Say `placeOrder` must both persist the order and emit
  `OrderPlaced`:
  1. **One local transaction:** `INSERT INTO orders(...)` **and** `INSERT INTO outbox(id='evt-9',
     type='OrderPlaced', payload='{...}', sent=false)` — both rows commit together or neither does.
     No broker call happens inside the tx, so there is nothing to be "half done".
  2. **Relay** (a poller doing `SELECT * FROM outbox WHERE sent=false`, or a CDC tool tailing the
     DB log) reads `evt-9` and publishes it to the broker.
  3. On broker ack it marks the row `sent=true` (or deletes it).
  4. **Crash between step 2 and 3?** The row is still `sent=false`, so on restart the relay
     publishes `evt-9` **again** → the same event reaches the broker twice.

  So the relay is **at-least-once**: the outbox kills the dual-write *loss/silent-drop* problem,
  but it does **not** stop *duplicate emits*. That is precisely why the consumer must still be
  **idempotent** — outbox on the producer + idempotent consumer is the effective-once combo.
- **Eventual consistency:** consumers see state after a delay; UIs and business logic must
  tolerate staleness.
- **Ordering & idempotency** become first-class concerns (covered below).
- Spring's in-JVM `ApplicationEventPublisher` / `@EventListener` is EDA *inside one process*
  (synchronous by default; add `@Async` for async) — distinct from cross-service brokered
  messaging.

**Expert — Spring event internals & `@TransactionalEventListener`:** Synchronous
`@EventListener` invocations run on the **publisher's thread inside the publisher's call
stack**, so a `RuntimeException` thrown by a listener propagates back to `publishEvent(...)`
and can roll back the caller's transaction — listeners are *not* isolated. Ordering among
multiple listeners for the same event is controlled by `@Order` (lower value = earlier);
without it, order is undefined. `@TransactionalEventListener` binds the callback to a
transaction phase — `AFTER_COMMIT` (default), `AFTER_ROLLBACK`, `AFTER_COMPLETION`,
`BEFORE_COMMIT`. A classic trap: an `AFTER_COMMIT` listener runs **after** the transaction
committed, so any DB write it performs needs a *new* transaction (`REQUIRES_NEW`) or it
silently does nothing because there is no active transaction to flush/commit (by default the
handler is not wrapped in one). If the event is published outside any transaction, an
`@TransactionalEventListener` is **skipped entirely** unless `fallbackExecution=true`. This
is exactly the hook the **outbox** pattern uses: write the outbox row `BEFORE_COMMIT` so it
is part of the same atomic unit.

**Async events:** making the multicaster async requires an `ApplicationEventMulticaster`
bean with a `TaskExecutor` (or `@Async` on the listener + `@EnableAsync`). Once async, the
exception no longer propagates to the publisher — it is handled by the executor's
`AsyncUncaughtExceptionHandler`, and there is no automatic retry.

**Choreography vs orchestration (sagas):** in **choreography** each service reacts to events
and emits its own, with no central coordinator — highly decoupled but the end-to-end flow is
implicit and hard to trace. In **orchestration** a central saga orchestrator sends commands
and awaits reply events — easier to reason about and to implement compensations, at the cost
of a coordinator. Distributed transactions across services use **compensating actions**
(semantic rollback), not 2PC.

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

**Expert — `CachingConnectionFactory` gotcha with listener containers:** `DefaultMessage`
`ListenerContainer` (DMLC) holds long-lived consumers. If you point a DMLC at a
`CachingConnectionFactory` with the default `sessionCacheSize=1`, each concurrent consumer
needs its own session, so raising `concurrentConsumers` above the cache size causes sessions
to be created and destroyed rather than cached — set `sessionCacheSize >= maxConcurrent`
`Consumers`. Also, the Spring cache assumes a **single** underlying connection by default; a
network blip that kills that connection is recovered, but `cacheConsumers=true` combined with
per-message temporary reply queues can leak consumers.

**`JmsTemplate` synchronous-receive trap:** `JmsTemplate.receive()` performs a **blocking**
synchronous poll with `receiveTimeout` (default is indefinite / `RECEIVE_TIMEOUT_INDEFINITE`
= block forever). It should **never** be used inside a `@JmsListener` or for high-throughput
consuming — that is what the listener container (async push) is for. Mixing a synchronous
`JmsTemplate.receive` with a container on the same destination causes the two to compete for
messages.

**`sessionTransacted` vs external transaction manager:** `JmsTemplate.setSessionTransacted`
(true)` or the container's `sessionTransacted=true` uses the **local JMS transaction** — send
and ack commit together at the session level, but this is *not* synchronized with a database
transaction. To make DB + JMS commit atomically you either need an XA `JtaTransactionManager`
(true 2PC, expensive and often avoided) or the **best-effort-1PC** pattern
(`ChainedTransactionManager`-style ordering) where the JMS commit is the last step after the
DB commit — which still has a small window and is why idempotent consumers remain necessary.

**Delivery mode & TTL:** JMS `PERSISTENT` (default) writes messages to the broker store so
they survive a broker restart; `NON_PERSISTENT` is faster but lost on crash. Per-message TTL
(`timeToLive`) and priority (0-9) are standard JMS features; note that priority ordering is a
provider-*optional* hint, not a guarantee.

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

**Expert — requeue storm / poison-message loop:** In Spring AMQP, if a listener throws a
plain exception under `AcknowledgeMode.AUTO` and the container's default requeue behavior is
on (`defaultRequeueRejected=true`), the message is nacked with `requeue=true` and immediately
redelivered — a tight infinite loop that pins a CPU and never makes progress (there is no
built-in retry/backoff by default). Fixes: (1) throw `AmqpRejectAndDontRequeueException` (or
`ImmediateRequeueAmqpException` for the opposite), (2) configure a stateful/stateless
`RetryTemplate` interceptor with a `RepublishMessageRecoverer` to route to a DLQ after N
attempts, or (3) set `defaultRequeueRejected=false` so failures dead-letter on the first
error. A `MessageConversionException` (bad payload) is inherently non-recoverable and should
never be requeued.

**Quorum vs classic mirrored queues:** since RabbitMQ 3.8+, **quorum queues** (Raft-based
replication) are the recommended HA primitive, replacing the deprecated classic *mirrored*
queues. Quorum queues track a per-message **delivery-count** header and support
`x-delivery-limit` for native poison-message handling — after the limit the message is dead-
lettered automatically, something classic queues cannot do without the TTL/DLX trick.

**Lazy queues & memory:** by default RabbitMQ keeps message bodies in RAM and only pages to
disk under pressure; **lazy queues** (or quorum queues, which are effectively lazy) store on
disk from the start, trading latency for much lower and more predictable memory use with deep
backlogs — important when a consumer outage lets a queue grow to millions of messages.

**Single Active Consumer (SAC):** setting `x-single-active-consumer` makes the broker route
to only **one** consumer at a time (others are hot standbys), giving strict ordering with
failover — a cleaner alternative to prefetch=1 with a single connection.

**Publisher confirms are async & can be nacked:** a `confirm` is not always positive — the
broker can send a `nack` (e.g., on internal error or a full disk with an unroutable durable
message). Correct producer code must handle the negative-confirm callback, not just assume
success. Confirms also arrive out of order and may be batched (multiple-flag), so you track
outstanding sequence numbers.

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

**Partition placement (trace).** Topic `orders` with **4 partitions** (0–3), producing with
`key="order-42"`. The default partitioner computes `partition = (hash(keyBytes) & 0x7fffffff) %
numPartitions` (the `& 0x7fffffff` just forces the hash non-negative). Suppose the key's bytes
hash to `34`. Then `34 % 4 = 2` → the record lands on **partition 2**. The hash is a pure
function of the *key bytes*, so **every** future `"order-42"` event also hashes to `34`, also
`% 4 = 2`, and also lands on partition 2 — which is exactly why same-key records stay ordered
(they share one log). Change the key to `"order-43"` (say it hashes to `35`): `35 % 4 = 3` →
partition 3, a different log with no ordering relationship to partition 2's records. And note
what breaks if you later grow to 6 partitions: `34 % 6 = 4`, so old `"order-42"` events sit on
partition 2 while new ones go to partition 4 — the per-key ordering guarantee is severed.

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

**Expert — poll loop, heartbeats, and the two liveness timeouts:** Since KIP-62, the consumer
has **two independent liveness mechanisms**. A background **heartbeat thread** sends
heartbeats every `heartbeat.interval.ms`; if none arrive within `session.timeout.ms` the
broker considers the member dead. Separately, `max.poll.interval.ms` bounds the time between
*successive `poll()` calls on the application thread* — this is what catches a consumer that
is alive (heartbeating) but stuck in slow processing. So a hung listener still heartbeats yet
is evicted for exceeding `max.poll.interval.ms`. When Spring's listener detects the container
is being revoked, the offending record is reprocessed after the rebalance. Mitigations:
reduce `max.poll.records`, raise `max.poll.interval.ms`, or use the container's async
`Pausing`/`pause()` behavior.

**`RECORD` vs `BATCH` ack and the "commit only advances" rule:** Spring's `AckMode.BATCH`
commits the offsets of the whole poll batch *after* the batch is processed; `RECORD` commits
after each record (safer, slower). Kafka offsets are **monotonic per partition** — you commit
the offset of the *next* record to read (last-processed + 1). You cannot "un-commit"; to
reprocess you must `seek()`. `MANUAL` gives you an `Acknowledgment` to call `acknowledge()`;
`MANUAL_IMMEDIATE` commits synchronously right away rather than queuing for the next poll.

**`ConcurrentMessageListenerContainer` thread model:** `concurrency=N` creates N child
`KafkaMessageListenerContainer`s, each with **its own `KafkaConsumer` on its own thread**
(a `KafkaConsumer` is single-threaded and not thread-safe). Partitions are split across the N
consumers by the assignor; if `N > partitions`, the surplus consumers idle. A single listener
instance may therefore be invoked concurrently from different threads for different
partitions, so listener state must be thread-safe. Setting concurrency higher than partitions
does not increase throughput.

**Static membership & cooperative rebalancing:** `group.instance.id` (static membership,
KIP-345) lets a bouncing consumer rejoin with the *same* partitions without triggering a
rebalance, avoiding churn during rolling restarts. The `CooperativeStickyAssignor`
(incremental cooperative rebalancing) revokes only the partitions that must move rather than
the stop-the-world "revoke everything, then reassign" of the older `RangeAssignor`/
`RoundRobinAssignor`.

**`auto.offset.reset` only fires with no committed offset:** `earliest`/`latest`/`none`
apply **only** when there is no valid committed offset for the group (new group, or the
committed offset was aged out). A common misconception is that `latest` skips backlog on
every start — it does not; an existing committed offset always wins.

## Delivery Semantics (At-Most / At-Least / Exactly-Once) & Idempotent Producer

**Beginner definitions:**
- **At-most-once:** each message delivered 0 or 1 times — may be lost, never duplicated.
  (Commit offset *before* processing; if you crash after commit, the message is skipped.)
- **At-least-once:** delivered 1+ times — never lost, may be duplicated. (Process *then*
  commit; crash after processing but before commit ⇒ redelivery.) This is the common default.
- **Exactly-once:** delivered and processed effectively once — hardest and most expensive.

**Crash-sequence trace (why the offsets matter).** Consumer is at **offset 5** = "charge the
card for order 5":
- **At-least-once** (process *then* commit): `poll offset 5` → charge card ✓ → **CRASH before
  commit**. On restart the committed offset is still 4, so it re-polls **offset 5** → charges
  the card **again** = duplicate charge. Never lost, may double.
- **At-most-once** (commit *then* process): `poll offset 5` → **commit offset 6 first** → **CRASH
  before charging**. On restart the committed offset is 6, so it resumes at offset 6 and
  **never charges order 5** = lost charge. Never doubled, may be lost.
- **Exactly-once (effective):** either use Kafka transactions so the charge-output and the
  offset-advance commit atomically, or make the charge idempotent on `order-5` so the
  at-least-once redelivery above is a no-op the second time.

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

**Durability trace — `replication.factor=3`, `min.insync.replicas=2`, `acks=all`.** The topic
has 3 replicas (1 leader + 2 followers). `acks=all` means "wait until every replica *currently
in the ISR* (in-sync replica set) has the record"; `min.insync.replicas=2` means "the ISR must
have at least 2 members or refuse the write". Walk the failure ladder:
- **All 3 up:** ISR = 3. Producer's write is acked once the record is on all in-sync replicas;
  since 3 ≥ 2 the write succeeds and can survive losing any one broker.
- **1 broker down:** ISR shrinks to 2. `2 ≥ min.insync.replicas(2)`, so the write **still
  succeeds** — it's acked after both remaining in-sync replicas have it. You're now one failure
  from unavailability, but no data loss.
- **2 brokers down:** ISR shrinks to 1. `1 < min.insync.replicas(2)`, so the leader **refuses**
  the produce and the producer gets `NotEnoughReplicasException` (it blocks/retries rather than
  ack a write that couldn't be safely replicated). Availability is sacrificed to guarantee that
  nothing is acknowledged unless it's on ≥2 replicas — the whole point of the setting.

Note the interplay: `min.insync.replicas` only bites *with* `acks=all`. With `acks=1` the leader
acks alone regardless, so a leader crash before followers replicate silently loses the record.

**JMS/RabbitMQ:** auto-ack ≈ at-most-once risk (ack before processing); manual/transacted ack
after processing ≈ at-least-once. True exactly-once generally isn't offered — you achieve
effective-once with idempotent consumers + dedup.

**Expert — why in-flight <= 5 preserves order with idempotence:** The broker keeps the last 5
batch sequence numbers per producer/partition. With `enable.idempotence=true` and up to 5
in-flight requests, the broker can detect an out-of-order or duplicate batch (sequence gap)
and reject/reorder it, so ordering *and* dedup hold. Above 5 it loses the ability to
guarantee ordering on retry, which is why 5 is the hard cap. Setting `retries=0` disables
idempotence's protection against the reordering-on-retry problem (there's no retry to
reorder, but you also lose delivery on transient errors).

**Transaction fencing & zombies:** `transactional.id` is stable across producer restarts; on
`initTransactions()` the broker bumps an **epoch** and fences the previous instance, so a
"zombie" producer from a crashed pod that comes back cannot commit stale writes
(`ProducerFencedException`). This is what makes read-process-write safe across restarts.
`transaction.timeout.ms` bounds an open transaction; exceeding it aborts and fences.

**EOS v2 (`sendOffsetsToTransaction`):** the read-process-write loop calls
`producer.sendOffsetsToTransaction(offsets, consumerGroupMetadata)` so the *consumed* offsets
are committed **inside the same producer transaction** as the produced output. Either both the
output records and the offset advance commit, or neither does — that atomicity is the whole
point. Spring wires this automatically when a `KafkaTransactionManager` drives a listener
container with a transactional `KafkaTemplate`.

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

**Expert — Classic vs Artemis architecture:** ActiveMQ *Classic* (5.x) is thread-per-
connection with a KahaDB message store; it can hit throughput/latency ceilings under high
connection counts. *Artemis* uses an asynchronous, non-blocking journal (append-only,
optionally backed by Linux AIO/libaio) and a Netty-based transport, achieving far higher
throughput and lower latency — which is why `spring-boot-starter-artemis` is the forward-
looking choice. Note Spring Boot **3.x removed the auto-configuration for the embedded
ActiveMQ *Classic* broker** (`spring-boot-starter-activemq` still exists as a client, but you
point it at an external broker); the embedded-broker convenience story now lives with Artemis.

**Message groups & exclusive consumers:** ActiveMQ Classic supports `JMSXGroupID` (all
messages with the same group id pin to one consumer, giving per-group ordering with parallel
groups) and **exclusive consumers** (`consumer.exclusive=true`) for strict total ordering on
a queue with automatic failover — the JMS-broker analog of Rabbit's single-active-consumer
and Kafka's per-partition ordering.

**Redelivery policy & DLQ:** ActiveMQ has a client-side `RedeliveryPolicy` (max redeliveries,
exponential backoff); after exhaustion the message goes to the broker's dead-letter queue
(default `ActiveMQ.DLQ`, configurable per-destination via an `individualDeadLetterStrategy`).

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

**Expert — `@RetryableTopic` semantics & the ordering trade-off:** Non-blocking retry
**reorders** relative to the source partition: the failed record is forwarded to
`<topic>-retry-0`, `<topic>-retry-1`, ... (or a single time-based retry topic) and reprocessed
later, while newer records on the main topic proceed. So `@RetryableTopic` trades strict
ordering for liveness — do **not** use it where per-key order across the retry gap matters;
use blocking retry (`DefaultErrorHandler` with a `BackOff`) there and accept head-of-line
blocking, or key-partition so only the affected key stalls. `@RetryableTopic` retry topics are
consumed by the *same* application; the delay is implemented by the consumer pausing/seeking
based on the record timestamp, not by the broker.

**`DefaultErrorHandler` details:** replaced `SeekToCurrentErrorHandler` (2.8). It classifies
exceptions as retryable vs **not-retryable** (via `addNotRetryableExceptions`) — e.g.,
`DeserializationException`, `MethodArgumentNotValidException` are non-retryable by default and
go straight to the recoverer. A `FixedBackOff`/`ExponentialBackOff` bounds attempts; after
exhaustion the configured recoverer (commonly `DeadLetterPublishingRecoverer`) runs, then the
offset advances. With batch listeners you must throw `BatchListenerFailedException` (index-
aware) so the handler knows which record in the batch failed — otherwise the whole batch is
retried/recovered.

**Deserialization poison records:** a record that cannot be deserialized would throw before
the listener even runs and would loop forever. `ErrorHandlingDeserializer` wraps the
key/value deserializer, catches the failure, and passes a null value plus the exception in a
header so the `DefaultErrorHandler`/DLT path can handle it instead of the container spinning.

**DLQ replay is not free:** re-publishing from a DLT/DLQ back to the main topic can violate
ordering and re-trigger the original failure if the root cause (bad data, downstream outage)
is unresolved. Production DLQ handling usually needs a human/tooling gate, not blind
auto-replay.

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

**Expert — dedup-check vs unique-constraint race:** The naive pattern "SELECT to check if
processed, then INSERT + do work" has a **check-then-act race**: two concurrent redeliveries
(different threads/pods) both see "not processed" and both proceed. The robust version relies
on the database's atomicity: attempt the `INSERT` of the idempotency key first and let a
**unique constraint** reject the duplicate (catch the constraint violation and skip), all in
the *same* transaction as the side effect. This turns a TOCTOU race into an atomic DB
decision. For non-transactional external effects (send email, call payment API), a DB marker
still leaves a window between "did the effect" and "recorded the effect" — use a provider-side
idempotency key (Stripe-style) so the *external* system dedups.

**Race trace — two pods, message `id='abc'`, redelivered.** `processed(key PRIMARY KEY)` table.
- *Naive check-then-act (broken):*
  ```
  Pod A: SELECT ... WHERE key='abc'  -> 0 rows ("not processed")   ┐ both see "new"
  Pod B: SELECT ... WHERE key='abc'  -> 0 rows ("not processed")   ┘ interleaved
  Pod A: charge card ; INSERT key='abc'  -> OK
  Pod B: charge card ; INSERT key='abc'  -> OK (or overwrites)  => card charged TWICE
  ```
  The gap between SELECT and INSERT is the TOCTOU hole.
- *Insert-first, let the constraint arbitrate (correct):* inside the same tx as the side effect —
  ```
  Pod A: BEGIN; INSERT key='abc'  -> OK ; charge card ; COMMIT          => processed once
  Pod B: BEGIN; INSERT key='abc'  -> UNIQUE VIOLATION -> catch -> ROLLBACK/skip (no charge)
  ```
  The DB's unique constraint is the single point of arbitration, so exactly one pod wins the
  insert and only that pod runs the effect. No SELECT-then-INSERT window exists.
- *Ordering guard (orthogonal problem).* Duplicates handled, but a **stale** update can still
  clobber a newer one if messages arrive reordered. Carry a version in the payload and write
  conditionally so an older event is a no-op:
  ```sql
  UPDATE account SET balance = :newBalance, version = :incoming
  WHERE id = :id AND version < :incoming;   -- 0 rows updated if :incoming is stale -> ignore
  ```

**Ordering vs idempotency are orthogonal:** idempotency stops *duplicates* from corrupting
state, but a *reordered* pair of updates can still land the wrong final value. Guard with a
monotonic version/sequence in the payload and a conditional write
(`UPDATE ... WHERE version < :incoming`) so stale/out-of-order updates are ignored — the
combination of version-guarded writes + idempotency keys is what makes at-least-once safe.

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

**Expert — the correlation-id/reply-queue pitfalls:** Async request/reply reintroduces
temporal coupling and adds failure modes sync calls don't have. If the requester crashes
after sending, the reply is orphaned — a **temporary/exclusive reply queue** dies with the
connection (reply lost), while a **shared/fixed reply queue** requires correlation-id matching
and risks one instance receiving a reply meant for another (Spring's
`RabbitTemplate`/`ReplyingKafkaTemplate` handle correlation, but a naive shared queue without
correlation delivers replies round-robin to the wrong instance). `ReplyingKafkaTemplate`
requires a dedicated reply topic and sets a `KafkaHeaders.CORRELATION_ID`; you must configure
the reply-topic partitions the requester listens on. Timeouts are mandatory — without one, a
lost reply blocks the caller forever, negating the resilience you sought.

**Blocking a thread-per-request server on async reply is an anti-pattern at scale:** doing
`convertSendAndReceive` on a servlet thread ties up that thread for the whole round trip,
giving you the latency of async *and* the thread cost of sync. Prefer truly async handling
(callbacks, reactive, or fire-and-forget with a later notification) if throughput matters.

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

**Expert — competing consumers vs partition parallelism:** In RabbitMQ you scale a queue by
adding consumers arbitrarily — 100 consumers can drain one queue (order is sacrificed). In
Kafka, consumer parallelism within a group is **hard-capped at the partition count**; to get
more parallel consumers you must add partitions (which, as noted, can disrupt key ordering).
This is the single most consequential operational difference: Rabbit decouples scaling from
topology, Kafka couples it to partition count decided up front.

**Selective consumption / competing routing:** RabbitMQ can route a *subset* of messages to a
consumer via bindings/headers/selectors so different consumers see different messages from the
same publish. Kafka has no server-side filtering — every consumer in a group reads whole
partitions and must filter client-side, so "give consumer A only high-priority orders" is
natural in Rabbit and awkward in Kafka.

**Backpressure semantics differ:** Rabbit pushes to consumers bounded by prefetch (broker-
driven flow control, plus TCP back-pressure / `connection.blocked` when memory/disk alarms
fire). Kafka is **pull-based**: the consumer decides when and how much to fetch, so a slow
consumer simply falls behind (lag grows) without back-pressuring the producer — you monitor
**consumer lag**, not queue depth.

**AMQP 1.0 vs 0-9-1 confusion:** RabbitMQ's core model is AMQP **0-9-1** (exchanges/bindings);
AMQP **1.0** is a different, wire-level standard (what ActiveMQ/Azure Service Bus speak).
RabbitMQ supports AMQP 1.0 via a plugin/native in newer versions, but the exchange model is a
0-9-1 concept, not part of AMQP 1.0.

## Common follow-up questions

- Why does Kafka only guarantee ordering within a partition, not a topic? Each partition
  is an independent log consumed by one consumer in a group; across partitions there is no
  global clock. Use a partition key to co-locate related records.
- Does the Kafka idempotent producer give exactly-once? No — it only dedups producer
  retries per partition. End-to-end EOS needs transactions (`transactional.id`,
  `read_committed`) or idempotent consumers for external sinks.
- How do you handle a poison message? Bounded retries with backoff, then route to a
  DLQ/DLT; on Kafka prefer non-blocking `@RetryableTopic` to avoid head-of-line blocking.
- RabbitMQ: producer publishes to a queue — true or false? False. Producers publish to
  **exchanges**; bindings route to queues.
- How do you make a consumer idempotent? Dedup on a business/message key (unique
  constraint or cache), or use naturally idempotent/UPSERT operations, ideally committing the
  dedup marker in the same transaction as the side effect.
- What breaks message ordering on producer retries in Kafka? `max.in.flight > 1` with a
  non-idempotent producer and retries. Idempotency preserves order up to 5 in-flight.
- javax.jms vs jakarta.jms? Spring Boot 3 / Spring 6 use `jakarta.jms`; Boot 2 uses
  `javax.jms`. Same for the whole Jakarta EE migration.
- When would you pick sync REST over messaging? When the caller needs an immediate result
  and both services are expected to be available (queries, synchronous validation).
- What is the dual-write problem and how do you fix it? Writing DB + publishing an event
  non-atomically. Fix with the transactional outbox + CDC/relay.
- Kafka consumer group with 3 consumers and 2 partitions? One consumer sits idle; max
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
