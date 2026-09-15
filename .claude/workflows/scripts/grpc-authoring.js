export const meta = {
  name: 'grpc-authoring',
  description: 'Author gRPC study content for all 16 topics: fundamentals, Protocol Buffers, service/message definition, the 4 RPC/streaming types, HTTP/2 foundations, channels/stubs, deadlines/cancellation, metadata/interceptors, error model, schema evolution, security/mTLS, load balancing, resiliency, observability, gRPC-Web/gateways, and gRPC vs REST vs GraphQL. Author -> verify.',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact/spec-precision check + boundary-scope check + schema check, fix in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/grpc`

const SCOPE_NOTE = `
DOMAIN SCOPE — "gRPC" for BACKEND + SENIOR developer interviews. High-performance RPC using Protocol
Buffers over HTTP/2: the framework, its contract-first workflow, the four call types, and the
production concerns (deadlines, errors, security, load balancing, resiliency, observability). Teach
it at the MECHANISM + protocol level, language-agnostic where possible, with concrete .proto snippets
and small idiomatic examples (Go/Java/Python) where they clarify. Ground everything in the actual
specs and canonical docs: the gRPC docs (grpc.io), the Protocol Buffers language guide (proto3), the
HTTP/2 RFC 9113, the gRPC-over-HTTP2 wire spec, gRFCs (e.g. A6 client retries, A8 client-side keepalive),
and the standard status-code model. Be precise about the wire format, framing, and defaults.

BOUNDARY RULES (STRICT — cross-reference, do NOT duplicate other domains):
- networking OWNS HTTP/2 on the wire (framing, HPACK, streams, flow control, multiplexing) + TLS
  handshake. HERE, teach the HTTP/2 foundations AS THEY MATTER FOR gRPC (why gRPC needs HTTP/2:
  multiplexed streams for streaming, trailers for status, binary framing) and reference
  networking for the full protocol deep dive; teach mTLS at the gRPC-credentials level and
  reference networking/security for TLS internals.
- rest-api-design OWNS REST/HTTP API contracts + GraphQL as an API style. HERE, the
  'grpc-vs-rest-vs-graphql-ecosystem' topic COMPARES them (when to pick which) and references
  rest-api-design/system-design rather than re-teaching REST or GraphQL.
- reliability-ops OWNS the general resilience patterns (retries/backoff/circuit-breakers/deadlines
  as concepts). HERE, teach the gRPC-SPECIFIC mechanics (gRPC retry policy in service config, gRFC
  A6, deadline propagation across gRPC calls, hedging) and cross-ref reliability-ops for the theory.
- system-design owns service-to-service architecture at scale + service mesh. HERE stay at the
  gRPC framework/protocol altitude; reference system-design for mesh/xDS architecture.
- observability owns OTel/metrics/tracing tooling. HERE, gRPC instrumentation specifics
  (interceptors, OTel gRPC, channelz, per-RPC stats) + cross-ref.
Verify all wire/spec specifics (status codes, header names like grpc-status/grpc-timeout, proto3
field rules, HTTP/2 trailers) via the canonical docs.
`

const SCHEMA = `
CONTENT CONTRACT (follow exactly). Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1.
   - "## <Subtopic>" H2 per subtopic (MCQ anchor targets — keep stable).
   - Interview-grade depth: define the concept, explain the MECHANISM (what actually happens on the
     wire / in the framework and WHY), show concrete .proto / config / small code where it clarifies,
     and always cover TRADE-OFFS + GOTCHAS (proto3 field-presence, streaming backpressure/flow-control,
     deadline propagation, load-balancing-needs-L7, error-model limits, breaking vs non-breaking schema
     changes).
   - Use comparison tables where useful (the 4 RPC types; unary vs streaming; gRPC vs REST vs GraphQL;
     status-code mapping; proto2 vs proto3; client-side vs proxy vs lookaside load balancing).
   - Where a diagram clarifies (the 4 call shapes, HTTP/2 stream framing for an RPC, a channel/subchannel
     model, deadline propagation across a call chain, an interceptor chain), use a \`\`\`mermaid fenced
     block (flowchart / sequenceDiagram). NO ASCII-art. CRITICAL: no semicolons in sequenceDiagram
     message text (use commas); QUOTE flowchart node labels containing "(" ")" or "?".
   - End with "## Common Interview Follow-ups" and "## References".

2) questions.yaml — top-level keys:
     topic: "<Topic Name>"
     domain: grpc
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001    # unique, zero-padded 3-digit seq; prefix == slug
         difficulty: beginner     # beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options: ["<0>","<1>","<2>","<3>"]
         answer: 2                # 0-BASED index
         explanation: |
           <why correct; teach the concept>
         ref: "concepts.md#<anchor>"  # resolves to a real "## " heading (GitHub slug rules)

   RULES: aim for 40-60 MCQs per topic. Focus on: MECHANISM ("what does gRPC put in HTTP/2 trailers?",
   "what happens to in-flight RPCs when a deadline expires?"), the 4 RPC types + streaming semantics,
   proto3 precision ("is a scalar field with default value sent on the wire?"), status/error handling,
   SCHEMA EVOLUTION (which changes are backward/forward compatible — a top interview area), and
   JUDGMENT/SCENARIO ("client needs to cancel a long stream — how?", "which load-balancing approach for
   a headless gRPC service?"). 3-5 options, exactly one correct, 0-based answer; VARY the correct index
   (no single index >40%, no guessable cycle); mixed difficulty; scenario items preferred; distractors
   plausible but wrong for a real reason; no all/none-of-the-above; every 'ref' resolves to a real
   "## " heading; id prefix == slug. Quote any YAML option containing a colon+space or leading brace.

Use the Write tool. Research grpc.io + the proto3 guide + relevant gRFCs/RFC 9113 to get specifics
right. Return: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'grpc-fundamentals-and-when-to-use', name: 'gRPC Fundamentals & When to Use It', hints: "What gRPC is (a high-performance, contract-first RPC framework by Google/CNCF; the name, gRPC Remote Procedure Calls); the pillars: Protocol Buffers as IDL + binary serialization, HTTP/2 transport, code generation of client stubs + server skeletons in many languages, pluggable auth/LB/interceptors; the RPC mental model (call a remote method like a local function) vs REST resources; strengths (low latency, small binary payloads, streaming, strong typed contracts, polyglot, code-gen) vs weaknesses (not browser-native without gRPC-Web, binary/not human-readable, needs HTTP/2 end-to-end, tooling/debuggability); WHEN to use (internal microservice-to-microservice, low-latency, streaming, polyglot orgs) vs when NOT (public browser-facing APIs, simple CRUD where REST suffices); gRPC vs Thrift/Avro RPC/JSON-RPC (brief). Cross-ref grpc-vs-rest-vs-graphql for the deep comparison." },
  { slug: 'protocol-buffers-syntax-types-encoding', name: 'Protocol Buffers: Syntax, Types & Encoding', hints: "proto3 syntax (syntax=\"proto3\"; message/field definitions; field NUMBERS are the wire identity — never reuse/renumber; reserved fields/numbers); scalar types (int32/int64/uint/sint/fixed/sfixed — and the zigzag encoding for sint to make negatives small; float/double; bool; string=UTF8; bytes); the WIRE FORMAT (TLV: field number + wire type tag = (field_number << 3) | wire_type; varint encoding for ints; length-delimited for strings/bytes/embedded messages; why field numbers 1-15 take 1 byte -> assign to frequent fields); proto3 FIELD PRESENCE (scalars have no presence by default — a field set to its default/zero value is NOT serialized and is indistinguishable from unset; the 'optional' keyword re-adds explicit presence in proto3.15+; message fields + wrappers DO have presence); repeated + packed encoding; maps (sugar for repeated key/value message); enums (first value MUST be 0 = default; open vs closed enum semantics); oneof; well-known types (Timestamp, Duration, Any, Struct, FieldMask, wrappers); proto2 vs proto3 differences. Deterministic serialization caveat (NOT canonical — don't hash serialized bytes)." },
  { slug: 'service-and-message-definition', name: 'Service & Message Definition (proto3)', hints: "defining a service (service Foo { rpc Method(Request) returns (Response); }); the 4 method signatures (unary, server-streaming returns (stream X), client-streaming (stream X) returns, bidi (stream X) returns (stream Y)); request/response MUST be message types (wrap scalars — a top gotcha; and use a wrapper message even for one field so you can evolve it); package + namespacing; import (and import public); options (java_package, go_package, etc.); code generation (protoc + language plugins, or buf); message design best practices (wrap request/response, use field masks for partial updates, avoid deeply nested, prefer explicit types); the API-design discipline (a request/response message per RPC so each can evolve independently). buf for linting/breaking-change detection/BSR. Cross-ref schema-evolution." },
  { slug: 'four-rpc-types-and-streaming', name: 'The Four RPC Types & Streaming', hints: "THE core topic. UNARY (1 request -> 1 response, like a function call); SERVER STREAMING (1 request -> stream of responses, e.g. subscribe/feed/large result); CLIENT STREAMING (stream of requests -> 1 response, e.g. upload/aggregate); BIDIRECTIONAL STREAMING (independent read+write streams over one HTTP/2 stream — full-duplex, e.g. chat/realtime); how each maps to ONE HTTP/2 stream; message framing (each message = a length-prefixed frame: 1 compression byte + 4-byte length + payload); ordering guarantees within a stream (messages ordered; bidi read/write are independent); FLOW CONTROL / backpressure inherited from HTTP/2 (a slow reader slows the writer); half-close (client-streaming client calls half-close to signal done); when to choose streaming vs repeated-field-in-unary (streaming for unbounded/incremental/long-lived; unary+repeated for bounded batches); cancellation propagation on a stream. Mermaid of the 4 shapes + a sequenceDiagram of bidi. Comparison table." },
  { slug: 'http2-foundations-for-grpc', name: 'HTTP/2 Foundations for gRPC', hints: "WHY gRPC requires HTTP/2 (multiplexed streams over one TCP connection -> no head-of-line blocking at the app layer, many concurrent RPCs; binary framing; header compression HPACK; trailers for status; server push not used); the gRPC-over-HTTP2 mapping: an RPC = one HTTP/2 stream; request = HEADERS frame (:method POST, :path /package.Service/Method, content-type application/grpc, custom metadata) + DATA frames (length-prefixed messages) + END_STREAM; response = HEADERS (initial metadata) + DATA + TRAILERS (grpc-status, grpc-message — status delivered in TRAILERS because it's known only after streaming completes, a key insight); grpc-timeout header for deadlines; flow control (per-stream + connection WINDOW_UPDATE) = the backpressure mechanism; connection management + keepalive PING (gRFC A8); why L7 (not L4) load balancing is needed (many RPCs multiplexed on one connection — cross-ref load-balancing). Cross-ref networking/http2 for the full HTTP/2 deep dive — DON'T re-derive HPACK/frames in detail, focus on the gRPC mapping. A sequenceDiagram of HEADERS/DATA/TRAILERS is ideal." },
  { slug: 'channels-stubs-client-server-lifecycle', name: 'Channels, Stubs & Client/Server Lifecycle', hints: "CHANNEL (a virtual connection to a logical endpoint — manages a POOL of subchannels/HTTP2 connections, name resolution, load balancing, connectivity state; expensive to create -> create ONCE and reuse, share across stubs; channel connectivity states IDLE/CONNECTING/READY/TRANSIENT_FAILURE/SHUTDOWN + wait-for-ready); STUBS/clients generated from the .proto (blocking/sync, async/future, and the language variants); the SERVER (register service impls, bind a port, handle concurrency — a thread pool or async); NAME RESOLUTION (dns:/// , the resolver plugin picks addresses) feeding the LB policy; per-RPC vs per-channel options (deadlines, metadata, compression, wait-for-ready); channel pooling for high throughput (one connection can bottleneck on HTTP/2 max-concurrent-streams -> multiple channels/round-robin); graceful shutdown (drain in-flight RPCs, GOAWAY); interceptors attach at channel/server. Cross-ref load-balancing for resolver+LB detail." },
  { slug: 'deadlines-timeouts-cancellation', name: 'Deadlines, Timeouts & Cancellation', hints: "DEADLINES vs timeouts (gRPC uses absolute DEADLINES, not relative timeouts — the client sets a deadline, sent as the grpc-timeout header; the server sees remaining time); ALWAYS set a deadline (no default -> can hang forever, a top production lesson); DEADLINE PROPAGATION across a call chain (service A calls B calls C — the remaining deadline propagates so downstream calls don't outlive the caller; the Context carries it); what happens on expiry (RPC terminated with DEADLINE_EXCEEDED, both sides notified, server should stop work by checking the context); CANCELLATION (client cancels -> server context cancelled -> propagates to its downstream calls; cancel a streaming RPC; cancellation is best-effort/cooperative — server must check ctx); the Context object (carries deadline, cancellation, metadata; per-RPC); choosing deadline values (based on downstream p99 + budget, cross-ref reliability-ops deadline-propagation which owns the general theory); deadline vs keepalive vs connection timeout distinctions. Mermaid of deadline propagation." },
  { slug: 'metadata-headers-interceptors', name: 'Metadata, Headers & Interceptors', hints: "METADATA = key/value pairs (like HTTP headers) sent with an RPC — REQUEST metadata (initial, before the message) + RESPONSE metadata (initial headers + TRAILING metadata sent after the response, e.g. for stats); ASCII keys (-bin suffix for binary values, base64-encoded on the wire); reserved grpc-* / : keys you can't set; common uses (auth tokens/authorization, tracing headers, request-id, api-version); INTERCEPTORS (the gRPC middleware — client-side + server-side; unary + streaming interceptors; chained in order); use cases (auth, logging, metrics, tracing, retries, validation, error mapping); how an interceptor wraps the handler/invoker; ordering + short-circuiting; interceptors vs filters; per-call credentials injected via metadata (CallCredentials). Cross-ref observability (tracing) + security (auth). Mermaid of an interceptor chain." },
  { slug: 'error-handling-and-status-codes', name: 'Error Handling & Status Codes', hints: "the gRPC STATUS MODEL: every RPC ends with a status = a code + message (+ optional details); the ~17 canonical STATUS CODES (OK=0, CANCELLED, UNKNOWN, INVALID_ARGUMENT, DEADLINE_EXCEEDED, NOT_FOUND, ALREADY_EXISTS, PERMISSION_DENIED, RESOURCE_EXHAUSTED, FAILED_PRECONDITION, ABORTED, OUT_OF_RANGE, UNIMPLEMENTED, INTERNAL, UNAVAILABLE, DATA_LOSS, UNAUTHENTICATED) — know the common ones + when to use each (INVALID_ARGUMENT vs FAILED_PRECONDITION vs OUT_OF_RANGE; UNAVAILABLE=retryable transient; PERMISSION_DENIED vs UNAUTHENTICATED); status delivered in HTTP/2 TRAILERS (grpc-status, grpc-message percent-encoded); RICH ERROR MODEL (google.rpc.Status + error_details Any: ErrorInfo, RetryInfo, QuotaFailure, BadRequest field violations — the standard way to return structured errors); which codes are RETRYABLE (UNAVAILABLE yes, INVALID_ARGUMENT no); mapping domain errors to codes; error handling in streaming (status ends the stream); client sees status via exception/error. Cross-ref retries (which codes trigger retry)." },
  { slug: 'schema-evolution-and-compatibility', name: 'Schema Evolution & Backward Compatibility', hints: "a TOP interview area. The rules for evolving a .proto without breaking clients/servers: field NUMBERS are the contract (never change/reuse a number; RESERVE removed numbers + names to prevent reuse); SAFE changes (add new fields with new numbers — old clients ignore unknown fields, which are preserved on passthrough in proto3; add new RPC methods; add new enum values IF clients handle unknown; rename a field — name doesn't matter on the wire, only the number, but breaks JSON/text + generated code); UNSAFE/breaking (change a field's number, change a field's type incompatibly, reuse a number, remove a required — n/a in proto3, change field to/from repeated in incompatible ways, change message-vs-scalar); wire compatibility vs source compatibility vs JSON compatibility (distinct!); unknown-field preservation (proto3 3.5+ retains them); enum unknown-value handling (open enums store unknown as the raw int); compatible type changes (int32/int64/uint32/uint64/bool are wire-compatible varints; sint not compatible with int; fixed32<->sfixed32); optional/oneof migration; buf breaking-change detection to enforce this in CI; forward vs backward compatibility framing. Cross-ref messaging-databases schema-evolution/registry (Avro/Protobuf compat modes) — note the parallel." },
  { slug: 'security-tls-mtls-authentication', name: 'Security: TLS, mTLS & Authentication', hints: "CHANNEL CREDENTIALS vs CALL CREDENTIALS (channel = transport security TLS/mTLS; call = per-RPC auth like a bearer token, sent via metadata; composite credentials combine them); TLS (server auth, encrypted transport — the default for prod; how you configure server/client certs); mTLS (mutual TLS — both sides present certs; common in service meshes / zero-trust; SPIFFE/SPIRE identities); INSECURE channel (plaintext — dev only); token-based auth (OAuth2/JWT bearer token in the authorization metadata via CallCredentials; per-RPC); ALTS (Google's mTLS-like transport, brief); the auth flow + where auth is enforced (interceptor validates metadata token); AuthContext (peer identity from the cert); best practices (always TLS in prod, short-lived certs, mesh-managed mTLS, don't put secrets in messages). Cross-ref security (OAuth/JWT threat model) + networking (TLS handshake internals) — teach the gRPC credential model here, reference them for depth." },
  { slug: 'load-balancing-and-service-discovery', name: 'Load Balancing & Service Discovery', hints: "WHY gRPC LB is hard (HTTP/2 multiplexes many long-lived RPCs on ONE connection -> L4/connection-level LB pins all traffic to one backend; you need L7/request-level or client-side LB — a key insight); the approaches: CLIENT-SIDE LB (the channel's LB policy — pick_first vs round_robin — picks a subchannel per RPC; fat client, needs to know all backends via the resolver); PROXY LB (an L7 proxy like Envoy/nginx/Linkerd distributes per-RPC — thin client, extra hop); LOOKASIDE / external LB (gRPC-LB / xDS: a control plane tells the client the backends + policy — the modern approach, Envoy xDS, service mesh); NAME RESOLUTION (dns:/// returns multiple A records; custom resolvers; headless K8s service for round_robin; the K8s ClusterIP gotcha — it's L4 so it pins connections, use headless + client-side LB or a mesh); keepalive + subchannel connectivity; weighted/least-request policies; xDS-based LB (the CNCF direction). Cross-ref system-design (service mesh) + reliability-ops (LB theory). Mermaid comparing the 3 LB models." },
  { slug: 'retries-resiliency-and-deadline-propagation', name: 'Deadlines Propagation, Retries & Resiliency', hints: "gRPC-SPECIFIC resiliency. Built-in RETRY policy via SERVICE CONFIG (gRFC A6 client retries — JSON config: maxAttempts, initialBackoff/maxBackoff/backoffMultiplier, retryableStatusCodes e.g. [UNAVAILABLE]); RETRY vs HEDGING (hedging = send parallel attempts after a delay, take the first response — gRFC A6; for latency-sensitive idempotent calls); the RETRY THROTTLING / token bucket to prevent retry storms (retryThrottling in service config); only retry SAFE/idempotent methods + retryable codes (UNAVAILABLE yes, INVALID_ARGUMENT no); DEADLINE PROPAGATION (the remaining deadline flows downstream so retries+downstream calls respect the overall budget); WAIT_FOR_READY (queue the RPC until the channel is READY instead of failing fast with UNAVAILABLE — trade-off); keepalive (gRFC A8, detect dead connections); circuit-breaking (usually at the mesh/Envoy layer for gRPC, or app-level — cross-ref reliability-ops circuit-breakers); how service config is delivered (via the resolver/xDS). Note reliability-ops owns the general retry/backoff/circuit-breaker THEORY — here teach the gRPC config mechanics + cross-ref." },
  { slug: 'observability-logging-metrics-tracing', name: 'Observability: Logging, Metrics & Tracing', hints: "instrumenting gRPC. METRICS (per-RPC: request count by method+status code, latency histograms, message sizes, in-flight RPCs; the standard gRPC metrics; OpenTelemetry gRPC instrumentation / the OTel semantic conventions for RPC); TRACING (context propagation via METADATA — the trace headers ride in request metadata; interceptors inject/extract span context; OTel + W3C traceparent; a span per RPC, parent-child across services); LOGGING (per-RPC access logs via interceptors; grpc-status + method + peer + latency; avoid logging message bodies/PII); CHANNELZ (gRPC's built-in introspection — per-channel/subchannel/server/socket live stats + connectivity, exposed via a gRPC service, great for debugging LB/connection issues); gRPC health checking protocol (grpc.health.v1.Health — Check/Watch, used by LB + K8s probes); server reflection (dynamic discovery of services for grpcurl/tooling); debugging tools (grpcurl, grpc_cli, Wireshark with the gRPC dissector). Cross-ref observability (OTel/metrics/tracing tooling owns the platform depth) — teach the gRPC-specific hooks here." },
  { slug: 'grpc-web-and-gateways', name: 'gRPC on the Web & Gateways (gRPC-Web, grpc-gateway)', hints: "WHY browsers can't do plain gRPC (browsers can't control HTTP/2 framing / trailers / can't send binary framed requests directly via fetch/XHR — the fundamental limitation); gRPC-WEB (a modified protocol + a PROXY: the browser speaks gRPC-Web (base64 or binary over HTTP/1.1 or HTTP/2, trailers encoded in the body) and a proxy (Envoy grpc_web filter, or the grpc-web proxy) translates to real gRPC; supports unary + server-streaming but NOT client/bidi streaming); the JS/TS client + protoc-gen-grpc-web codegen; grpc-gateway (a reverse-proxy that exposes a gRPC service as a RESTful JSON/HTTP API via google.api.http annotations in the .proto — lets you serve BOTH gRPC and REST from one definition; transcoding); Connect (connectrpc — a newer alternative that speaks gRPC, gRPC-Web, and its own HTTP/JSON protocol, browser-friendly without a proxy); Envoy as the common gateway; when to use each (gRPC-Web for browser gRPC clients; grpc-gateway/transcoding for REST compatibility; Connect for a unified modern stack). Cross-ref rest-api-design." },
  { slug: 'grpc-vs-rest-vs-graphql-ecosystem', name: 'gRPC vs REST vs GraphQL & Ecosystem', hints: "the comparison + when to pick which (a very common interview question). gRPC vs REST (binary Protobuf vs JSON/text; HTTP/2 required vs any HTTP; strong contract+codegen vs looser/OpenAPI; streaming native vs SSE/websockets bolt-on; RPC method model vs resource/verb model; not browser-native vs universal; performance/latency vs human-readability/cacheability/debuggability); gRPC vs GraphQL (RPC vs query language; fixed methods vs client-specified fields/over-under-fetching; GraphQL great for aggregating/flexible frontends, gRPC great for typed internal service-to-service); the DECISION GUIDE (internal microservices+low-latency+streaming+polyglot -> gRPC; public/browser/third-party APIs -> REST; flexible frontend data-aggregation -> GraphQL; often BOTH: gRPC internally + REST/GraphQL at the edge/BFF); the ECOSYSTEM (buf + BSR for schema management/lint/breaking-change; Connect; Envoy/service mesh; grpc-gateway; protovalidate; the CNCF landscape); performance reality (gRPC faster for high-throughput internal RPC but the gap is workload-dependent; HTTP caching favors REST); Protobuf-over-REST as a middle ground. Cross-ref rest-api-design + system-design (which owns architecture-level choices) — this topic is the synthesis." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a distributed-systems engineer and gRPC expert authoring study material for the topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / subtopics for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . Remember: interview-grade MECHANISM depth (what happens on the wire / in the framework), concrete .proto + config snippets, the 4 RPC types + schema-evolution + status-model classics where relevant, cross-reference (don't duplicate) networking (HTTP/2, TLS), rest-api-design (REST/GraphQL), reliability-ops (resilience theory), observability, system-design (mesh), and 40-60 MCQs weighted to mechanism + spec-precision + judgment/scenario.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer (senior distributed-systems engineer + interviewer) verifying gRPC content for "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `Files: ${DIR}/${t.slug}/concepts.md and questions.yaml . Read BOTH. Check and FIX IN PLACE:\n` +
    `1) FACTUAL/SPEC PRECISION (most important): every wire/spec claim MUST be correct — status delivered in HTTP/2 TRAILERS (grpc-status/grpc-message), the 4 RPC types & their stream mapping, message framing (1 compression byte + 4-byte length prefix), proto3 field-presence rules (default-valued scalars not serialized; 'optional' re-adds presence; enum first value must be 0), field NUMBERS are the wire contract (reserve on removal), the ~17 status codes & which are retryable (UNAVAILABLE yes, INVALID_ARGUMENT no), deadlines are ABSOLUTE (grpc-timeout header) & propagate, why L7/client-side LB is needed over HTTP/2, gRPC-Web needs a proxy & lacks client/bidi streaming, service-config retry policy (gRFC A6). Web-research anything uncertain (grpc.io, proto3 guide, RFC 9113, gRFCs) and FIX it. A wrong spec claim or answer index is the WORST defect.\n` +
    `2) NO WRONG-IN-PRACTICE KEYS: ensure no correct answer endorses a bad practice (no deadline set, retrying non-idempotent/INVALID_ARGUMENT, reusing a field number, plaintext in prod, creating a channel per RPC, L4-balancing multiplexed gRPC). A plausible-but-wrong option must be a DISTRACTOR, never the key.\n` +
    `3) SCOPE DRIFT: refocus content that belongs to networking (HTTP/2 framing/HPACK/TLS internals), rest-api-design (REST/GraphQL), reliability-ops (general resilience theory), observability (OTel platform), or system-design (mesh/xDS architecture) onto the gRPC mechanism angle, cross-referencing not duplicating.\n` +
    `4) SCHEMA: valid YAML; keys topic/domain(grpc)/topic_slug(${t.slug})/version/questions; 40-60 questions; ids (prefix '${t.slug}-', unique, 3-digit seq); difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based 'answer' in range; explanation; correct-option VARIED (rebalance if any index >40% or a guessable cycle — shuffle options, keep 'answer' correct). Quote any YAML option with a colon+space or leading brace.\n` +
    `5) Every 'ref' resolves to a real '## ' heading; Mermaid valid (no semicolons in sequenceDiagram messages; QUOTE flowchart labels with ( ) or ?).\n` +
    `6) COVERAGE: every subtopic represented; MCQs weighted to mechanism/spec-precision/judgment, and the 4-RPC-types / schema-evolution / status-model classics where relevant.\n\n` +
    `After fixing, return: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
