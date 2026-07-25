# grpc — Content Audit

**Executive summary.** The grpc domain is in strong shape. Across all 16 subtopics the writing is consistently senior-grade and intuition-first: nearly every file leads with a plain-language mental model before any formalism, scopes itself cleanly against sibling topics, and closes with a dedicated "Common Interview Follow-ups" section that mirrors how interviewers actually probe. Clarity is essentially maxed out (avg **4.94/5**) and interview depth is high (avg **4.5/5**). The domain has **zero high-priority files, 14 medium, and 2 low** — this is a refinement pass, not a rescue.

The one systemic weakness maps exactly onto the second refinement axis: **worked examples** (avg **3.44/5**). This is a domain that lives at the byte level and in quantitative trade-offs (framing, protobuf encoding, backoff math, load distribution, metric cardinality), yet the hardest mechanisms are repeatedly *asserted in prose or drawn as a box diagram* rather than *traced with real numbers/bytes*. The single most important finding is not a gap but a likely **correctness bug**: `retries-resiliency-and-deadline-propagation` states a ±20% multiplicative retry-jitter formula and emphatically denies full-jitter, which appears to contradict gRFC A6 — it must be verified before ship. **Every one of the 16 files carries `needs_web_verification=true`**, concentrated on version-specific defaults and spec details (see the Refinement plan).

## Scorecard

Sorted: high priority first (none), then by ascending (clarity+example+depth).

| Subtopic | Clarity | Examples | Depth | Priority | Verdict |
|---|---|---|---|---|---|
| grpc-vs-rest-vs-graphql-ecosystem | 5 | 2 | 4 | medium | Exceptionally clear judgment-first comparison, but "Protobuf is smaller/faster" is claimed ~4x and never shown with one byte/latency example. |
| observability-logging-metrics-tracing | 4 | 3 | 4 | medium | Strong conceptual tour, but p99/cardinality/correlation claims stay in prose; RED/USE and "exemplars" land undefined. |
| http2-foundations-for-grpc | 5 | 3 | 4 | medium | Excellent "status-is-a-trailer" explainer; lacks byte-trace of the 5-byte prefix and misses default window / max-streams footguns. |
| schema-evolution-and-compatibility | 5 | 3 | 4 | medium | Rules well-derived from one idea, but a wire-format topic with zero byte traces and a dangling "packed-repeated nuance below" that never appears. |
| security-tls-mtls-authentication | 5 | 3 | 4 | medium | Crisp credential model/status codes; all examples are config setup, no single traced request; misses cert-rotation and mid-stream token-refresh gotchas. |
| channels-stubs-client-server-lifecycle | 5 | 3 | 5 | medium | Superb channel mental model + follow-ups; the central pooling/stream-ceiling math is asserted, never worked; "keepalive" undefined. |
| deadlines-timeouts-cancellation | 5 | 4 | 4 | medium | Excellent intuition-first; a subtle "server sees CANCELLED" oversimplification, no budget arithmetic, misses whole-stream-deadline gotcha. |
| grpc-fundamentals-and-when-to-use | 5 | 3 | 5 | medium | Great breadth/depth, but the hardest concept (protobuf binary encoding) is formula-only with no bytes-out trace; "varint" undefined. |
| load-balancing-and-service-discovery | 5 | 3 | 5 | medium | Outstanding "why L4 pins gRPC" story taught entirely in prose; no numbers for distribution, weighted/P2C/ring_hash. |
| service-and-message-definition | 5 | 4 | 4 | medium | Strong "why"-first coverage; oneof missing as a design tool and a self-inconsistent FieldMask path example. |
| four-rpc-types-and-streaming | 5 | 4 | 5 | medium | Excellent 2x2 model; length-prefix framing drawn but never traced in bytes; misses MAX_CONCURRENT_STREAMS exhaustion by long streams. |
| metadata-headers-interceptors | 5 | 4 | 5 | medium | Strong wire-level page; the trickiest concept (streaming interceptor wrapping SendMsg/RecvMsg) has no code; Java ordering claim needs verifying. |
| protocol-buffers-syntax-types-encoding | 5 | 4 | 5 | medium | Genuinely byte-level and excellent; missing a packed-repeated byte trace and a fixed-vs-varint numeric break-even. |
| retries-resiliency-and-deadline-propagation | 5 | 4 | 5 | medium | Exceptional teaching, BUT the retry-jitter formula likely contradicts gRFC A6 and the doc doubles down — verify before ship. |
| grpc-web-and-gateways | 5 | 4 | 4 | low | Excellent "why browsers can't speak gRPC" treatment; trailers-in-body framing needs a hex trace; CORS/deadline/auth propagation under-explained. |
| error-handling-and-status-codes | 5 | 4 | 5 | low | Senior-grade, nails the judgment calls; a few missing numbers-in/out traces (retry timeline, error-detail unpacking, wire percent-encoding). |

## Systemic issues

These themes recur across subtopics; addressing them at the domain level will lift most files at once.

### 1. Hard mechanisms taught abstractly, never traced with real numbers/bytes (dominant theme — ~all 16 files)
This is the domain's defining weakness and directly maps to the worked-example bar. Two flavors:

- **Missing byte-level traces** on a domain that *is* the wire format. The protobuf/framing encoding is repeatedly given as a formula or an ASCII box, never as bytes-out:
  - `grpc-fundamentals` (`key = (field_number<<3)|wire_type`, no bytes), `grpc-vs-rest` (Protobuf "smaller/faster" asserted 4x, zero bytes), `http2` (5-byte DATA prefix as a box only), `four-rpc` (length-prefix framing box only), `grpc-web` (trailers-in-body `0x80` flag symbolic only), `schema-evolution` (renumber/sint "silent mangle" asserted, no bytes), `protocol-buffers` (packed-repeated and maps are the *only* encodings with no trace), `metadata` (base64 `-bin` values described, never shown).
- **Missing arithmetic / quantitative walkthroughs** on the quantitative decisions:
  - `channels` (channel-pooling / stream-ceiling math), `deadlines` (deadline-budget arithmetic), `load-balancing` (traffic distribution; weighted 3:1, P2C, ring_hash), `observability` (cardinality explosion; histogram → p99), `retries` (throttle bucket drain/refill; hedging timeline), `error-handling` (retryPolicy JSON → actual backoff timeline).

  **Recommended fix pattern:** for each, add a 3–5 line "numbers-in → numbers-out" block. Because the byte-encoding walkthrough is needed in 6+ files, author **one canonical protobuf-encoding trace** (e.g. `Point{lat=1, lng=2}` → `08 01 10 02`, contrasted with ~28-byte JSON) in `protocol-buffers-syntax-types-encoding` and cross-reference it from the others rather than re-deriving it each time.

### 2. Every file needs a web-verification pass on version/default/spec facts (16/16, `needs_web_verification=true`)
The content confidently states implementation defaults and spec details that drift by language/version. Highest-value verification targets, clustered:
- **Retry/backoff spec (CRITICAL):** gRFC A6 jitter form — `retries` currently asserts multiplicative ±20% and explicitly denies full-jitter `random(0, backoff)`; if A6 is full-jitter the formula, worked numbers, and the emphatic note are all wrong.
- **HTTP/2 defaults:** `MAX_CONCURRENT_STREAMS` (~100) and connection-backoff base/mult/cap (Go vs Java/Netty differ) — referenced in `channels`, `http2`, `four-rpc`.
- **Resolver behavior:** DNS min re-resolution interval (~30s) and event-vs-timer trigger model — `load-balancing` (two statements in mild tension).
- **Tooling/API surfaces:** grpc-java `ServerInterceptors.intercept` ordering (`metadata`, contradicts Go ordering above it), OTel RPC semantic conventions + `stats/opentelemetry` Go API (`observability`), Go/Java `AuthContext`/`SecurityLevel`/ALTS (`security`), buf v2 breaking-rule categories (`schema-evolution`).
- **proto3 history:** unknown-field preservation restored in 3.5 (2017) — `grpc-fundamentals` (vaguely "a later revision"), `schema-evolution`, `service-message`; and `optional` re-introduced ~protoc 3.15 (2021).
- **Fast-moving browser facts:** `fetch` request-body streaming support and gRPC's current CNCF maturity tier — `grpc-web`, `grpc-vs-rest`.

### 3. Streaming / long-lived-connection edge cases under-served (6 files)
A recurring senior probe class is thinner than the unary path:
- Long-lived streams exhaust `MAX_CONCURRENT_STREAMS` and starve new RPCs — missing in `four-rpc`, `http2`.
- A call deadline bounds the **whole stream**, so a normal deadline kills a healthy long-lived stream — `deadlines`.
- Per-RPC token auth is really **per stream-open**, so tokens can't refresh mid-stream and may expire during a long stream — `security`.
- Streaming interceptor body runs **once**; per-message logic must wrap `SendMsg`/`RecvMsg` — stated as a gotcha in `metadata` but with **no code** (every unary path has a snippet).
- mTLS cert rotation applies on next handshake, not to an established connection — `security`.

### 4. Term-of-art dropped without a first-use definition (3 files, quick wins)
- `channels`: "keepalive" used 3x, never defined.
- `grpc-fundamentals`: "varint" used repeatedly, never defined (undercuts the whole "field numbers 1–15 cost 1 byte" argument).
- `observability`: "RED"/"USE" as bare acronyms in the first 8 lines; "exemplars" used as jargon.

### 5. Small precision/correctness slips in otherwise-authoritative claims (6 files)
Distinct from #2 (external verification) — these are internal-logic fixes:
- `retries`: jitter formula + "not full jitter" note (**high severity**, see #2).
- `deadlines`: "server observes the RPC as CANCELLED" on deadline expiry oversimplifies — local deadline reconstruction typically surfaces `DEADLINE_EXCEEDED`/`context.DeadlineExceeded`; CANCELLED is the explicit-cancel/disconnect case.
- `service-message`: FieldMask paths shown as `["total","status"]` but prose says `"order.total"` — inconsistent; AIP-134 masks are relative to the resource.
- `protocol-buffers`: table implies the 10-byte penalty is int64-only; negative **int32** is also sign-extended to 10 bytes.
- `metadata`: Java "last listed = outermost" ordering flatly contradicts the Go ordering just above and could mislead — verify.
- `http2`: status table omits code 12 UNIMPLEMENTED yet the next WARNING references it.

### 6. Code examples skew almost entirely to Go (2 files, minor)
`four-rpc` (all samples Go) and `metadata` (streaming path) name Java/Python APIs (`StreamObserver`, `onCompleted`, `isReady`) only in prose, leaving JVM-targeted candidates without a runnable model for half-close/flow-control/wrapped-stream APIs.

## High-priority subtopics

No subtopic is rated `high` refine_priority — all are medium/low. The subsections below instead cover the **9 medium/low files that carry at least one high-severity issue**, since those are the concrete top-of-queue items. They are ordered by urgency (correctness risk first, then breadth of high-severity gaps).

### retries-resiliency-and-deadline-propagation (medium; contains a HIGH-severity correctness issue)
1. **[HIGH · correctness]** Retry-backoff jitter (lines ~105–111 and follow-ups line ~438): doc states `min(initialBackoff*mult^(n-1), maxBackoff) * random(0.8,1.2)` and emphatically adds "not a full-jitter pick uniformly in [0, base]." gRFC A6 appears to specify `random(0, currentBackoff)` — the exact full-jitter form denied here. **Fix:** verify A6; if full-jitter, replace the formula, delete the "not full jitter" note, rework the worked numbers (3rd retry = random in [0, 0.4s]), and fix the duplicate in Common Follow-ups. `needs_web_verification`.
2. **[MED · example-gap]** Retry throttling: token bucket described abstractly. **Fix:** trace start=100 (half=50) → 55 failures drain to 45 → retries suppressed → ~50 successes at tokenRatio 0.1 to climb back.
3. **[MED · example-gap]** Hedging: timing in prose only. **Fix:** timeline for maxAttempts=3, hedgingDelay=0.5s (fire at t=0, 0.5s, 1.0s; first OK wins, others cancelled).
4. **[LOW · gotchas]** Clarify which attempts count as throttling failures (original included) and the net fail-then-succeed accounting.

### load-balancing-and-service-discovery (medium; TWO HIGH-severity gaps)
1. **[HIGH · example-gap]** "L4 pins gRPC" and the K8s ClusterIP 3→10-pod symptom are prose-only. **Fix:** trace 6 client pods × 1 long-lived conn to 3-pod ClusterIP (kube-proxy DNAT pinning → e.g. 3/2/1), scale to 10 pods → 7 new pods get 0 RPCs; contrast headless + round_robin.
2. **[HIGH · example-gap]** Weighted / least-request / ring_hash given as one-liners. **Fix:** weighted 3:1 → 6:2 over 8 RPCs; P2C over {A:5,B:2} → B; ring_hash key stickiness with ~1/N keys moving on backend loss.
3. **[MED · correctness]** DNS re-resolution: "min interval ~30s" vs "does not re-resolve on a timer alone" are in tension. **Fix:** verify per-impl and state one coherent event-driven-with-rate-floor model.
4. **[LOW · redundancy]** xDS (LDS/RDS/CDS/EDS) covered twice — trim the Lookaside instance to a pointer.
5. **[LOW · gotchas]** Add a connectivity-state diagram + picker trace ({A:READY,B:TRANSIENT_FAILURE,C:READY} → rotate A,C).

### observability-logging-metrics-tracing (medium; TWO HIGH-severity gaps; lowest clarity, 4/5)
1. **[HIGH · example-gap]** Label cardinality never quantified. **Fix:** "50 methods × 17 statuses ≈ 850 series (fine); + user_id (1M) ≈ 850M series → OOMs Prometheus."
2. **[HIGH · example-gap]** Latency histogram/percentile never shown. **Fix:** bucket table (le=10ms:900 … +Inf:1000) → p99 in 50–100ms bucket while mean=12ms.
3. **[MED · example-gap]** metric→trace→log correlation prose-only. **Fix:** worked incident threading `trace_id=abc123` through all three signals.
4. **[MED · jargon]** Expand RED (Rate/Errors/Duration) and USE (Utilization/Saturation/Errors) on first use; gloss "exemplars."
5. **[LOW · correctness]** Verify OTel semantic conventions (`server.address`, `rpc.server.duration`) and the Go `stats/opentelemetry` API surface.

### schema-evolution-and-compatibility (medium; TWO HIGH-severity issues)
1. **[HIGH · example-gap]** A wire-format topic with zero byte traces. **Fix:** renumber trace (`int32 age=2` tag `0x10` → renumber 4 tag `0x20` → old bytes decode as unknown field); zigzag trace (-1 as int32 = 10 bytes vs sint32 = `0x01`).
2. **[HIGH · structure]** "See the packed-repeated nuance below" is a dangling forward-reference — that section doesn't exist. **Fix:** add the packed/unpacked parser-compatibility + singular↔repeated rule, or remove the pointer.
3. **[MED · example-gap]** optional-presence "$0.00 vs no price" abstract. **Fix:** show implicit-presence 0.00 → zero bytes vs `optional` → tag+value emitted.
4. **[MED · gotchas]** Enum exhaustive-switch failure and Java `UNRECOGNIZED` shown only in words. **Fix:** small switch snippet with a v2 value falling through + the default-branch fix.

### grpc-fundamentals-and-when-to-use (medium; HIGH-severity gap)
1. **[HIGH · example-gap]** Protobuf binary encoding is the hardest concept and is formula-only. **Fix:** encode `Point{latitude=1, longitude=2}` → `08 01 10 02` (4 bytes) vs `{"latitude":1,"longitude":2}` (~28 bytes). This is the canonical trace to reuse across the domain (see systemic #1).
2. **[MED · jargon]** Define "varint" (base-128, 7 payload bits + continuation) so the "1–15 fit in one byte" claim is self-evident.
3. **[MED · example-gap]** "Binary beats JSON" has no numbers — reuse the byte counts from #1.
4. **[LOW · correctness]** Pin the proto3 unknown-field history to 3.5 (2017) instead of "a later revision."

### http2-foundations-for-grpc (medium; HIGH-severity gap)
1. **[HIGH · example-gap]** 5-byte DATA prefix shown only as a box. **Fix:** decode `00 00 00 00 05 68 65 6C 6C 6F` (flag=0 uncompressed, len=5, "hello"); show compressed variant (flag `0x01`).
2. **[MED · example-gap]** Deadline propagation prose-only. **Fix:** `grpc-timeout: 500m` → A spends 60ms → B gets ~440m → B blows budget → both fail fast.
3. **[MED · gotchas]** Add the default ~64KB initial-window throughput cap and the 100-stream queuing cliff as footguns.
4. **[LOW]** Add UNIMPLEMENTED (12) to the status table; add the GOAWAY "streams above last-processed ID get retried" detail; add a flow-control window diagram.

### channels-stubs-client-server-lifecycle (medium; HIGH-severity gap)
1. **[HIGH · example-gap]** Channel-pooling / stream-ceiling math asserted, never worked. **Fix:** 5,000 concurrent RPCs; 1 conn caps at 100; round_robin over 50 pods = 5,000 slots or ~50-channel pool + ~20% headroom → ~60 channels.
2. **[MED · example-gap]** wait-for-ready timeline. **Fix:** backend down at t=0, 500ms deadline: false→UNAVAILABLE at ~t=0; true→parks, recovers t=300ms→succeeds, else DEADLINE_EXCEEDED at t=500ms.
3. **[MED · jargon]** Define "keepalive" (periodic HTTP/2 PINGs; tension with server ENHANCE_YOUR_CALM).
4. **[LOW]** Explain idle-timeout state drop (next RPC re-pays resolution+handshake); verify MAX_CONCURRENT_STREAMS/backoff defaults per language.

### grpc-vs-rest-vs-graphql-ecosystem (medium; HIGH-severity gap; lowest example score, 2/5)
1. **[HIGH · example-gap]** "Protobuf is smaller/faster" claimed ~4x, never demonstrated. **Fix:** `{"user_id":42,"name":"Ada","active":true}` JSON (~45 bytes) vs protobuf traced field-by-field (~10 bytes), note it shrinks after gzip.
2. **[MED · example-gap]** Layered "REST/GraphQL edge + gRPC internal" architecture is a diagram with no traced call. **Fix:** browser GETs `/profile/42` → BFF fans out 3 concurrent gRPC calls over one HTTP/2 conn → one JSON response.
3. **[MED · depth]** TCP HOL blocking asserted, not reasoned. **Fix:** one sentence on why one lost segment stalls all streams on the shared ordered byte-stream (QUIC fixes per-stream).
4. **[LOW]** Clarify FieldMask is server-implemented (not transport-enforced like GraphQL); verify gRPC CNCF maturity tier.

### security-tls-mtls-authentication (medium; HIGH-severity gap)
1. **[HIGH · example-gap]** All examples are creds-building config; no single traced request. **Fix:** dial `api.example.com:443` → TLS verifies SAN → `authorization: Bearer eyJ...` in HEADERS → interceptor checks exp/aud → OK; then the expired-token → status 16 variant.
2. **[MED · gotchas]** mTLS cert rotation applies on next handshake, not to a live long-lived connection.
3. **[MED · gotchas]** Per-RPC token = per stream-open; can't refresh mid-stream on a long-lived stream.
4. **[LOW]** Concrete SAN-mismatch error (dial `10.0.2.15` vs `DNS:api.example.com` → x509 IP-SAN failure); verify Go/Java AuthContext + SecurityLevel + ALTS API names.

## Refinement plan

Recommended order of attack. **All 16 files have `needs_web_verification=true`** — batch a single verification pass (below) alongside the edits rather than per-file.

1. **Verify first, ship-blocker: the gRFC A6 retry-jitter claim in `retries-resiliency-and-deadline-propagation`.** This is the only suspected outright *wrong* algorithm and the doc doubles down on it; a candidate could confidently state the wrong answer. Confirm/correct before anything else.
2. **Author the canonical protobuf-encoding byte trace once** (in `protocol-buffers-syntax-types-encoding`, e.g. `Point{1,2}` → `08 01 10 02` vs ~28-byte JSON) and cross-reference it from `grpc-fundamentals`, `grpc-vs-rest`, `http2`, `four-rpc`, `schema-evolution`. This clears the largest cluster of HIGH/MED example-gaps in one stroke.
3. **Knock out the remaining HIGH-severity example-gaps** in the two-HIGH files first: `load-balancing` (distribution + weighted/P2C/ring_hash traces), `observability` (cardinality math + histogram→p99), `schema-evolution` (byte traces + the dangling packed-repeated section). Then the single-HIGH files: `channels` (pooling math), `http2` (5-byte decode), `grpc-vs-rest` (size comparison), `security` (traced request).
4. **Fix the internal correctness/consistency slips** (fast, high-trust-impact): `deadlines` (CANCELLED vs DEADLINE_EXCEEDED on expiry), `service-message` (FieldMask path inconsistency), `protocol-buffers` (negative int32 = 10 bytes), `metadata` (Java interceptor ordering — verify), `http2` (add UNIMPLEMENTED row).
5. **Fill the streaming/long-lived gotcha gaps** as a themed sweep across `four-rpc`, `http2`, `deadlines`, `security`, `metadata` (add the `wrappedServerStream` `RecvMsg` code), `observability`.
6. **Quick jargon fixes:** define keepalive (`channels`), varint (`grpc-fundamentals`), RED/USE + exemplars (`observability`).
7. **Polish:** MED/LOW depth adds (oneof + Any/oneof in `service-message`, hedging timeline, fixed-vs-varint break-even, CORS/deadline propagation in `grpc-web`), the Go-only code diversification in `four-rpc`/`metadata`, and diagrams (flow-control window in `http2`, connectivity states in `load-balancing`).

**Consolidated web-verification checklist** (all files flagged true): gRFC A6 retry jitter form; `MAX_CONCURRENT_STREAMS` and connection-backoff defaults (Go vs Java/Netty); DNS min re-resolution interval + trigger model; grpc-java `ServerInterceptors.intercept` ordering; OTel RPC semantic conventions + `stats/opentelemetry` Go API; Go/Java `AuthContext`/`SecurityLevel`/ALTS names; proto3 unknown-field restoration (3.5, 2017) and `optional` re-introduction (protoc 3.15, 2021); buf v2 breaking categories; HTTP→gRPC status mapping (incl. 404→UNIMPLEMENTED); `fetch` request-body streaming support; gRPC CNCF maturity tier.

_Files read: 16 of 16. Missing/unreadable: 0._
