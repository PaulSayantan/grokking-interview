# gRPC & Protocol Buffers

gRPC is a high-performance **Remote Procedure Call (RPC)** framework: you call a method on
a remote server as if it were a local function, and gRPC handles serialization, framing,
and transport. It runs over **HTTP/2** (RFC 9113) and uses **Protocol Buffers** (protobuf)
as its default interface definition language (IDL) and binary serialization format.

This topic lives in the **Networking & Protocols** domain, so the emphasis is on what goes
**on the wire**: how gRPC maps calls onto HTTP/2 frames and headers, how protobuf encodes
bytes, and how streaming, deadlines, metadata, and status codes are represented at the
protocol level. API-design concerns (resource modeling, versioning strategy) belong in the
REST/API-design topic and are not re-taught here.

> [!KEY-TAKEAWAY]
> gRPC = **Protocol Buffers** (contract + binary encoding) + **HTTP/2** (multiplexed
> transport) + a **method-call abstraction** (four RPC shapes). Interviewers probe all
> three pillars: the wire format, the transport mapping, and the schema-evolution rules.

---

## gRPC over HTTP/2 (why HTTP/2)

**What it is.** Every gRPC call is exactly one HTTP/2 request/response exchange. The RPC
method name becomes the HTTP/2 `:path` pseudo-header (`/package.Service/Method`), the
`:method` is always `POST`, and the message payloads travel in HTTP/2 DATA frames.

**Why HTTP/2 specifically.** gRPC needs features that HTTP/1.1 cannot provide cleanly:

- **Multiplexing** — many concurrent RPCs share one TCP connection as independent HTTP/2
  *streams*, without head-of-line blocking at the application layer and without the
  6-connection-per-origin limit of HTTP/1.1.
- **Bidirectional streaming** — HTTP/2 streams can carry a continuous flow of DATA frames
  in both directions, which is exactly what client-, server-, and bidi-streaming RPCs need.
  HTTP/1.1's request-then-response model cannot express this.
- **Binary framing** — HTTP/2 is already a binary protocol, so gRPC's length-prefixed
  binary messages ride naturally in DATA frames.
- **Header compression (HPACK, RFC 7541)** — repeated metadata (auth tokens, content-type)
  is compressed per connection.
- **Flow control** — per-stream and per-connection windows let gRPC apply backpressure to
  streams independently.
- **Trailers** — HTTP/2 supports trailing headers (a HEADERS frame after DATA). gRPC uses
  trailers to send the final status *after* the response body, which is essential because
  the outcome of a streaming call is not known until the stream ends.

**Wire anatomy of a unary call:**

```
Client → Server  HEADERS frame:
  :method = POST
  :scheme = https
  :path = /helloworld.Greeter/SayHello
  :authority = api.example.com
  content-type = application/grpc+proto
  grpc-timeout = 1S              (optional deadline)
  te = trailers                  (required)
  <custom metadata as headers>
Client → Server  DATA frame:  <length-prefixed protobuf message>  (END_STREAM)

Server → Client  HEADERS frame:   (initial response headers / "headers")
  :status = 200                  (HTTP status is 200 even on gRPC errors!)
  content-type = application/grpc
Server → Client  DATA frame:   <length-prefixed protobuf message>
Server → Client  HEADERS frame (trailers, "trailers"):
  grpc-status = 0                (OK)
  grpc-message = ...             (optional, percent-encoded)
```

> [!WARNING]
> A successful *HTTP* response (`:status = 200`) does **not** mean the RPC succeeded. The
> real gRPC outcome is in the `grpc-status` **trailer**. Errors are carried as HTTP/2
> trailers with a 200 status, so tooling that only reads the HTTP status will misread
> failures.

**Length-prefix framing.** Inside the DATA frames, each gRPC message has a 5-byte prefix:
1 byte **compressed-flag** (0 or 1) + 4-byte **big-endian length**, followed by the message
bytes. This lets a stream carry many discrete messages back-to-back.

---

## Protocol Buffers IDL: messages, fields, and field numbers

**What it is.** Protobuf is a schema language. You write a `.proto` file describing
messages and services; a code generator (`protoc`) produces types and stubs in your target
language. This is **contract-first** by design.

```proto
syntax = "proto3";
package helloworld;

message HelloRequest {
  string name = 1;          // field 1
  int32  retries = 2;       // field 2
  repeated string tags = 3; // field 3 (a list)
}

message HelloReply {
  string message = 1;
}

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
}
```

**Field numbers are the real identity.** The name (`name`, `retries`) is *not* sent on the
wire — only the **field number** is. Field numbers are the stable contract:

- Range **1–536,870,911** (2^29−1). Numbers **19000–19999** are reserved for protobuf's own
  use.
- Field numbers **1–15** encode their tag in a **single byte**, so assign them to the most
  frequently populated fields for compactness. Fields 16–2047 use two bytes.
- Once assigned and deployed, a field number must **never** be reused for a different field
  — doing so silently corrupts data for peers using the old schema.

**proto3 semantics.** In proto3, scalar fields are not "required"; a field left at its
default (0, "", false) is generally not serialized. proto3 later re-added explicit
presence via the `optional` keyword (tracks "was it set?" with a hidden hasbit) so you can
distinguish "0" from "unset." Enums must have a zero value as their first entry (the
default). `oneof` groups fields so that setting one clears the others.

> [!TIP]
> "Why don't field names appear on the wire?" Because protobuf is a *schema-driven* format:
> both sides already share the `.proto`, so only the compact numeric tag + value is sent.
> This is the core reason protobuf is smaller and faster to parse than JSON, which carries
> field names as strings on every message.

---

## Protobuf wire format: varints and tag-length-value

**What it is.** On the wire, a protobuf message is a flat sequence of **key-value pairs**.
Each field is encoded as a **tag** followed by its value, where:

```
tag = (field_number << 3) | wire_type
```

The low 3 bits are the **wire type**; the rest is the field number. The tag itself is
encoded as a varint.

**Wire types (proto3):**

| Wire type | Value | Used for |
|---|---|---|
| VARINT | 0 | int32, int64, uint32/64, bool, enum, sint32/64 |
| I64 (64-bit) | 1 | fixed64, sfixed64, double |
| LEN | 2 | string, bytes, embedded messages, packed repeated |
| SGROUP/EGROUP | 3/4 | deprecated groups |
| I32 (32-bit) | 5 | fixed32, sfixed32, float |

**Varints (variable-length integers).** Each byte uses its high bit (MSB) as a
"continuation" flag: 1 = more bytes follow, 0 = last byte. The remaining 7 bits are the
payload, stored **little-endian** (least-significant group first).

Example — encode `300`:
- 300 in binary = `100101100`.
- Split into 7-bit groups (LSB first): `0101100` and `0000010`.
- Add continuation bits: first byte `1 0101100` = `0xAC`, second byte `0 0000010` = `0x02`.
- Wire bytes: `AC 02`.

**Full field example.** `int32 retries = 2;` set to `300`:
- tag = (2 << 3) | 0 = `16` = `0x10` (field 2, wire type VARINT).
- value 300 = `AC 02`.
- Bytes: `10 AC 02`.

**LEN (length-delimited).** For strings/bytes/sub-messages: tag, then a varint **length**,
then that many raw bytes (tag-length-value / TLV). `string name = 1;` = `"hi"`:
- tag = (1 << 3) | 2 = `0x0A`, length = `0x02`, bytes `68 69` → `0A 02 68 69`.

**ZigZag for signed values.** Plain varints are inefficient for negative numbers (a `-1`
int32 encodes as 10 bytes because of sign extension). Use `sint32`/`sint64`, which apply
**ZigZag** encoding: `(n << 1) ^ (n >> 31)`, mapping −1→1, 1→2, −2→3, … so small-magnitude
negatives stay small.

**Packed repeated.** In proto3, repeated scalar numeric fields are **packed** by default:
one LEN field holds all the values concatenated, instead of repeating the tag per element.

> [!INTERVIEW]
> Expect to hand-decode a few bytes: given `08 96 01`, tag `0x08` = field 1 / VARINT;
> `96 01` = varint → 0x96 has MSB set so continue: low bits `0010110`, next `0000001` →
> `0000001 0010110` = 150. So it's field 1 = 150.

---

## Backward and forward compatible schema evolution

**Why it matters.** Services and clients deploy independently; old and new schemas coexist.
Protobuf is designed so both sides can evolve without a flag day, **if you follow the
rules**.

**Safe changes:**

- **Add a new field** with a new, never-before-used field number. Old readers see an
  *unknown field* and, by default, **preserve** it (retain unknown fields) or ignore it;
  new readers get the value or the type default if absent.
- **Remove a field** — but **reserve** its number and name so they can never be reused:
  `reserved 3, 5; reserved "old_name";`.
- **Rename a field** — safe on the wire (names aren't transmitted), but it breaks JSON
  mapping and generated code, so treat it as a code-level change.
- Certain **type changes are compatible** because they share a wire type: `int32`, `uint32`,
  `int64`, `uint64`, `bool` are interchangeable on VARINT (with truncation/range caveats);
  `sint32`/`sint64` are *not* compatible with the plain int types (different ZigZag
  encoding); `fixed32`↔`sfixed32`, `fixed64`↔`sfixed64` are compatible. `string` and
  `bytes` are compatible if the bytes are valid UTF-8.

**Unsafe changes (never do these):**

- **Reusing a field number** for a different field/type — the classic data-corruption bug.
- **Changing a field's number** — equivalent to deleting the old and adding a new field;
  in-flight data is misinterpreted.
- **Changing wire type** incompatibly (e.g., `int32` → `string`), or switching a field into
  or out of a `oneof`.
- Moving a field in/out of `repeated` when packing differs.

> [!WARNING]
> `required` does not exist in proto3, and even in proto2 it was a design mistake: a
> `required` field can never be safely removed, because old peers will reject messages that
> omit it. This is why proto3 dropped `required` entirely.

**Enum evolution.** Adding enum values is compatible, but a peer that doesn't know a value
will treat it as unknown (proto3 stores the raw number). Always keep a `UNSPECIFIED = 0`
default so a missing/unknown enum is meaningful.

---

## The four RPC types

gRPC defines four call shapes, all built on HTTP/2 streams:

| Type | `.proto` signature | HTTP/2 mapping |
|---|---|---|
| **Unary** | `rpc M (Req) returns (Resp)` | one request DATA frame, one response DATA frame |
| **Server streaming** | `rpc M (Req) returns (stream Resp)` | one request, many response messages |
| **Client streaming** | `rpc M (stream Req) returns (Resp)` | many request messages, one response |
| **Bidirectional streaming** | `rpc M (stream Req) returns (stream Resp)` | both sides send message streams independently |

**Unary** is the most common — a classic request/response, semantically like a REST call
but binary and over one multiplexed connection.

**Server streaming** suits large result sets, feeds, or progress updates: the client sends
one request, the server writes many messages then closes the stream with a trailer.

**Client streaming** suits uploads/aggregation: the client sends many messages then
half-closes; the server replies once (e.g., a summary).

**Bidirectional streaming** is a full-duplex conversation: both sides read and write on the
same HTTP/2 stream in any interleaving. Ordering is guaranteed **within** each direction of
a single stream. This enables chat, telemetry, and interactive protocols.

> [!TIP]
> All four map onto **one** HTTP/2 stream per call. The difference is only how many DATA
> frames flow in each direction and when `END_STREAM` is set (half-close). "Streaming" in
> gRPC is application-level message streaming, distinct from TCP byte streaming.

---

## Code generation and contract-first development

**What it is.** You define the contract once in `.proto`, then run the **protobuf compiler**
`protoc` (with language plugins, e.g. `protoc-gen-go`, `grpc_python_plugin`) to generate:

- **Message types** — strongly typed structs/classes with getters/setters and
  serialize/parse methods.
- **Service stubs** — a client stub (call the remote method like a local function) and a
  server base/skeleton you implement.

**Why contract-first matters.** The `.proto` is the single source of truth shared by every
language and team. Clients and servers written in different languages interoperate because
they generate from the same contract. This is stricter than REST/OpenAPI, where the schema
is often documentation that can drift from the implementation.

- **Reflection** — servers can optionally expose the schema at runtime (the gRPC Server
  Reflection protocol) so tools like `grpcurl` can call methods without a local `.proto`.
- **Descriptors** — `protoc` can emit a `FileDescriptorSet`, a compiled binary form of the
  schema used for reflection, dynamic messages, and gateways.
- **Well-known types** — `google.protobuf.Timestamp`, `Duration`, `Empty`, `Any`,
  `Struct`, and the wrapper types (`Int32Value`, etc.) provide standard, portable building
  blocks.

> [!INTERVIEW]
> "gRPC vs REST for tooling": gRPC's strength is machine-generated, type-safe clients in
> many languages from one contract; its weakness is that you can't just `curl` a JSON body
> — you need protobuf-aware tools (grpcurl, Postman with proto, BloomRPC) because the wire
> format is binary.

---

## Deadlines, timeouts, and cancellation

**What it is.** A gRPC client sets a **deadline** (an absolute point in time) or a
**timeout** (a relative duration) for each call. It is transmitted as the `grpc-timeout`
HTTP/2 header, e.g. `grpc-timeout: 100m` (100 milliseconds; units: `H`, `M`, `S`, `m`, `u`,
`n`).

**Why deadlines, not just timeouts.** A deadline propagates through a call chain: if A calls
B with a 1s deadline and B calls C, B forwards the *remaining* budget so the whole chain
gives up together. This prevents work from continuing on requests the caller has already
abandoned — critical for avoiding cascading resource exhaustion.

**Behavior:**

- When the deadline passes, the RPC terminates with status **`DEADLINE_EXCEEDED` (4)**.
- **Cancellation**: a client can cancel; the server observes cancellation via its context
  and should stop work. Cancellation is propagated by the transport (RST_STREAM /
  END_STREAM). Status **`CANCELLED` (1)**.
- Without a deadline, a call can hang indefinitely if the server never responds — always
  set one.

> [!WARNING]
> A common bug: setting timeouts per-hop instead of propagating a deadline. If each hop
> resets a fresh 1s timeout, a 4-hop chain can legitimately run 4s while the original
> caller gave up at 1s — wasted work and confusing latency.

---

## Metadata, and gRPC status codes

**Metadata** is gRPC's key–value side-channel — essentially HTTP/2 headers. It carries auth
tokens, tracing IDs, custom context. Two phases:

- **Headers/leading metadata** — sent before the message body.
- **Trailers/trailing metadata** — sent after, alongside the final status.

Keys are ASCII. Binary values use a `-bin` suffix (e.g. `trace-context-bin`) and are
base64-encoded on the wire. Keys prefixed `grpc-` are reserved for the protocol
(`grpc-timeout`, `grpc-status`, `grpc-message`, `grpc-status-details-bin`).

**Status codes.** gRPC has its own fixed set of canonical status codes (independent of HTTP
status). `grpc-status: 0` = OK. Key codes:

| Code | Name | Meaning |
|---|---|---|
| 0 | OK | success |
| 1 | CANCELLED | caller cancelled |
| 2 | UNKNOWN | unknown error |
| 3 | INVALID_ARGUMENT | bad client input (independent of system state) |
| 4 | DEADLINE_EXCEEDED | deadline elapsed |
| 5 | NOT_FOUND | entity not found |
| 6 | ALREADY_EXISTS | entity already exists |
| 7 | PERMISSION_DENIED | authenticated but not authorized |
| 8 | RESOURCE_EXHAUSTED | quota/rate limit |
| 9 | FAILED_PRECONDITION | system not in required state; don't retry as-is |
| 10 | ABORTED | conflict, e.g. txn abort; retry at higher level |
| 11 | OUT_OF_RANGE | out of valid range |
| 12 | UNIMPLEMENTED | method not implemented/supported |
| 13 | INTERNAL | serious internal invariant broken |
| 14 | UNAVAILABLE | transient; safe to retry with backoff |
| 15 | DATA_LOSS | unrecoverable data loss |
| 16 | UNAUTHENTICATED | missing/invalid credentials |

> [!TIP]
> Interview trap on `INVALID_ARGUMENT` (3) vs `FAILED_PRECONDITION` (9): use
> `INVALID_ARGUMENT` when the argument is bad **regardless of system state** (e.g.,
> malformed name); use `FAILED_PRECONDITION` when the argument is fine but the system
> **isn't in the state** to serve it (e.g., deleting a non-empty directory). `UNAVAILABLE`
> (14) is the retry-safe transient code; `INTERNAL` and `FAILED_PRECONDITION` are not.

Rich error details (structured payloads like `google.rpc.Status` with `error_details`) ride
in the `grpc-status-details-bin` trailer.

---

## gRPC-Web and the browser limitation

**Why it matters.** Browsers cannot speak native gRPC. The Fetch/XHR APIs do **not** expose
the raw HTTP/2 frame layer needed to control DATA frames and read HTTP/2 **trailers**, and
JavaScript can't force HTTP/2 or manage streams at that level. So a browser cannot produce
the exact wire behavior gRPC requires.

**gRPC-Web** is the adaptation. It defines a slightly different, browser-friendly wire
protocol:

- Works over HTTP/1.1 or HTTP/2, using standard XHR/Fetch.
- **Trailers are encoded in the response body** (a trailer frame after the message frames),
  because browsers can't read HTTP trailers. gRPC status therefore arrives in-band.
- Payloads can be `application/grpc-web+proto` (binary) or `application/grpc-web-text`
  (base64) for environments that mangle binary.
- Requires a **proxy** (e.g., Envoy's gRPC-Web filter, or an in-process translator) that
  converts between gRPC-Web and native gRPC to reach the backend.

**Streaming limits.** gRPC-Web supports unary and **server-streaming** well. **Client
streaming and bidirectional streaming are not generally supported** over gRPC-Web (fetch
request bodies aren't full-duplex in browsers), so those are the classic "gotcha" answer.

> [!WARNING]
> "Just point the browser at the gRPC endpoint" does not work. You need gRPC-Web plus a
> translating proxy, and you lose client/bidi streaming. This is a frequent source of
> confusion when teams assume gRPC is a drop-in for browser APIs.

---

## gRPC vs REST vs GraphQL trade-offs

**REST** (JSON over HTTP/1.1 or HTTP/2): human-readable, universally supported, cacheable
via HTTP semantics, trivially debuggable with `curl`/browser. Weaknesses: verbose text
payloads, no built-in contract enforcement, no first-class streaming, over/under-fetching.

**gRPC** (protobuf over HTTP/2): compact binary payloads, strong typed contract with
codegen in many languages, all four streaming modes, deadline propagation, HTTP/2
multiplexing. Weaknesses: not human-readable, needs special tooling, **poor browser
support** (needs gRPC-Web + proxy), harder to cache with standard HTTP caches, less
friendly to some firewalls/proxies that don't handle HTTP/2 trailers.

**GraphQL** (query language over usually HTTP POST): client specifies exactly the fields it
wants, solving over/under-fetching; single endpoint; strong introspection/tooling.
Weaknesses: complex server (resolvers, N+1 risk), HTTP caching is hard (POST), no native
binary efficiency, subscriptions for streaming are bolt-on.

| Dimension | REST | gRPC | GraphQL |
|---|---|---|---|
| Payload | JSON (text) | Protobuf (binary) | JSON (text) |
| Transport | HTTP/1.1 or 2 | HTTP/2 (required) | usually HTTP/1.1 |
| Contract | OpenAPI (optional) | `.proto` (enforced) | SDL schema (enforced) |
| Streaming | limited (SSE/WS bolt-on) | all 4 modes native | subscriptions (bolt-on) |
| Browser | native | needs gRPC-Web + proxy | native |
| Human-readable | yes | no | yes (query + JSON) |
| Best for | public/web APIs, CRUD | internal microservices, low-latency, streaming | client-driven, aggregating many resources |

> [!INTERVIEW]
> The senior answer isn't "gRPC is faster, use it." It's **fit-for-purpose**: gRPC shines
> for **east-west** internal service-to-service traffic (typed contracts, streaming, low
> overhead); REST/GraphQL shine for **north-south** public/browser-facing traffic
> (reach, cacheability, human debuggability). Many systems use both.

---

## Common follow-up questions

- **Why must `te: trailers` be sent?** It tells intermediaries the client accepts HTTP/2
  trailers, which gRPC requires to deliver `grpc-status`. Some proxies strip trailers and
  break gRPC.
- **Why is the HTTP status 200 even on an error?** gRPC always returns HTTP 200 for a
  well-formed call; the RPC-level result is separately in the `grpc-status` trailer. Non-200
  HTTP is reserved for transport/protocol errors (e.g., 404 for a missing service).
- **How big can a field number get and why care about 1–15?** Up to 2^29−1; 1–15 fit their
  tag in one byte, so hot fields should use them.
- **What's the difference between `int32` and `sint32` on the wire?** Both are VARINT, but
  `sint32` ZigZag-encodes so negatives are compact; they are *not* wire-compatible.
- **Can you distinguish "unset" from "0" in proto3?** Only if you mark the field `optional`
  (which adds explicit presence tracking) or wrap it (e.g., `Int32Value`).
- **What happens to a field number you delete?** `reserved` it so it can never be reused;
  otherwise a future field could collide and corrupt data.
- **Does gRPC do load balancing?** It's client-side/L7 aware because one connection carries
  many streams; naive L4 balancers can pin all streams to one backend — a classic gotcha.
- **How do retries interact with status codes?** Retry on `UNAVAILABLE`; be careful with
  non-idempotent calls; `ABORTED`/`RESOURCE_EXHAUSTED` may need backoff at a higher layer.

---

## References

- gRPC over HTTP/2 protocol spec — https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md
- gRPC-Web protocol spec — https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md
- gRPC status codes — https://grpc.io/docs/guides/status-codes/ and google.rpc.Code
- gRPC deadlines/cancellation — https://grpc.io/docs/guides/deadlines/
- Protocol Buffers language guide (proto3) — https://protobuf.dev/programming-guides/proto3/
- Protobuf encoding / wire format — https://protobuf.dev/programming-guides/encoding/
- Protobuf schema evolution — https://protobuf.dev/programming-guides/proto3/#updating
- RFC 9113 — HTTP/2
- RFC 7541 — HPACK header compression
- RFC 8446 — TLS 1.3 (transport security for gRPC)
- grpc.io core concepts — https://grpc.io/docs/what-is-grpc/core-concepts/
