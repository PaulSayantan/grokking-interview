export const meta = {
  name: 'networking-authoring',
  description: 'Author interview-grade concepts.md + a 40-60 MCQ questions.yaml for all 16 Networking & Protocols topics, then verify each for factual accuracy and schema compliance',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact-check + schema-check each topic, fix in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/networking`

const SCOPE_NOTE = `
DOMAIN SCOPE — "Networking & Protocols" is LANGUAGE/VENDOR-AGNOSTIC. Teach how the
network and its protocols actually work on the wire, NOT a specific OS/vendor/library.
Concretely:
- Language-neutral: describe the BSD socket model and readiness APIs (select/poll/epoll/
  kqueue) conceptually; don't teach a specific language's networking library.
- Distinct from the REST APIs & API Design domain: THIS domain owns HTTP as a PROTOCOL
  (message framing, methods/status at the wire level, connection handling, versions,
  TLS). API-design semantics (resource modeling, versioning strategy, pagination,
  HATEOAS, OpenAPI) live in rest-api-design — do NOT re-teach them here.
- Distinct from system-design: stay at protocol/mechanics altitude (handshakes, headers,
  algorithms, packet flow), not whiteboard capacity/topology design.
- Ground claims in the real standards and current reality: TCP/IP (RFC 9293), IP/CIDR,
  DNS (RFC 1034/1035, DoH 8484, DoT 7858), HTTP/1.1 (RFC 9112), HTTP/2 (RFC 9113),
  HTTP/3 (RFC 9114) + QUIC (RFC 9000), TLS 1.3 (RFC 8446), gRPC/protobuf, WebSocket
  (RFC 6455), SSE (WHATWG). Verify version-specific behavior via web research.
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md — the study/answer content:
   - Begins with a single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (these are the MCQ anchor targets — keep them stable).
   - Interview-grade answers, LAYERED: beginner definition + why it matters -> intermediate
     trade-offs/comparisons -> advanced internals/gotchas the interviewer probes.
   - Include concrete examples: packet/header field breakdowns, handshake sequences, CIDR
     math, example dig/curl output, comparison tables. Language/vendor-agnostic.
   - End with a "## Common follow-up questions" section and a "## References" section
     (link the RFCs / authoritative docs you used).
   - Factual accuracy is critical. Cite correct RFC numbers and current status.

2) questions.yaml — the MCQ bank. Top-level keys:
     topic: "<Topic Name>"        # matches the concepts.md H1
     domain: networking
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001     # globally unique within the file, zero-padded 3-digit seq
         difficulty: beginner      # one of: beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options:
           - "<option 0>"
           - "<option 1>"
           - "<option 2>"
           - "<option 3>"
         answer: 2                 # 0-BASED index of the correct option
         explanation: |
           <why the correct answer is right; teach the concept>
         ref: "concepts.md#<anchor>"   # deep-link to a concepts.md H2 (GitHub slug: lowercase, spaces->-, punctuation stripped)

   RULES:
   - Produce 40-60 questions (minimum 40). Cover EVERY subtopic with several questions each.
   - 3-5 options per question, EXACTLY ONE correct. 'answer' is 0-based.
   - VARY the correct option's position across the file (do not cluster on one index).
   - Mixed difficulty (mostly beginner/intermediate with some advanced; this is Pass 1 —
     advanced/expert depth is added in a later deepening pass, so don't over-index on expert).
   - INCLUDE scenario-style questions with lengthy plausible options — e.g. "given this
     capture / this subnet / this handshake, which statement is correct?". Distractors must
     be plausible but wrong for a real reason.
   - No "all of the above" / "none of the above".
   - Every 'ref' anchor MUST resolve to an actual "## " heading in concepts.md.
   - id prefix MUST equal the topic-slug.

Use the Write tool to create both files. Do your own web research to ensure correctness.
Return a one-line summary: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'network-models-osi-tcpip', name: 'Network Models: OSI & TCP/IP', hints: "7-layer OSI vs 4/5-layer TCP/IP model; what each layer does; encapsulation & PDUs (frame/packet/segment/datagram); which protocols and devices live at each layer (hub L1, switch L2, router L3, L4/L7 LB); why layering; where TLS sits; common exam mapping questions (which layer is X)." },
  { slug: 'ip-addressing-and-subnetting', name: 'IP Addressing & Subnetting', hints: "IPv4 32-bit structure & dotted-decimal; IPv6 128-bit & notation/compression; CIDR notation & prefix length; subnet masks; network/broadcast/usable-host math; VLSM & supernetting; public vs private ranges (RFC 1918), loopback, link-local, APIPA; classful legacy vs classless; how many hosts in a /26 etc.; IPv4 exhaustion & NAT context." },
  { slug: 'link-layer-ethernet-arp-switching', name: 'Link Layer: Ethernet, MAC, ARP & Switching', hints: "Ethernet frame structure; MAC addressing (OUI, broadcast); ARP request/reply & the ARP cache; switches vs hubs; MAC learning/CAM table; broadcast vs collision domains; VLANs & trunking (802.1Q) overview; L2 vs L3 forwarding; ARP spoofing (brief); MTU & framing." },
  { slug: 'ip-routing-forwarding-nat', name: 'IP Routing, Forwarding & NAT', hints: "routing table & longest-prefix match; forwarding vs routing; static vs dynamic; interior vs exterior; RIP/OSPF/BGP overview (link-state vs distance-vector, BGP for the internet); default gateway; TTL & ICMP (echo, time-exceeded, unreachable); NAT/PAT source translation, port mapping, why NAT breaks end-to-end; hairpinning." },
  { slug: 'tcp-deep-dive-handshake-flow-congestion', name: 'TCP Deep Dive: Handshake, Flow & Congestion Control', hints: "3-way handshake (SYN/SYN-ACK/ACK) & sequence numbers; TCP state machine (LISTEN/SYN_SENT/ESTABLISHED/FIN_WAIT/TIME_WAIT etc.) & why TIME_WAIT; 4-way teardown; reliable delivery, cumulative ACK, retransmission, RTO, fast retransmit, SACK; sliding-window flow control (receiver window, zero-window); congestion control (slow start, congestion avoidance, AIMD, CUBIC, BBR); head-of-line blocking; Nagle & delayed ACK interaction." },
  { slug: 'udp-datagram-transport', name: 'UDP & Datagram Transport', hints: "UDP datagram & 8-byte header; connectionless best-effort, no ordering/retransmit; when UDP wins (DNS, VoIP, gaming, video, real-time metrics); app-level reliability on UDP; UDP vs TCP trade-off table; broadcast/multicast; QUIC as reliable transport over UDP & why it was built there (avoid kernel TCP ossification); checksum/optional." },
  { slug: 'socket-programming-io-multiplexing', name: 'Socket Programming & I/O Multiplexing', hints: "BSD socket API model (socket/bind/listen/accept/connect/send/recv/close) for TCP & UDP; blocking vs non-blocking sockets; key socket options (SO_REUSEADDR, TCP_NODELAY, SO_KEEPALIVE, backlog); the C10K problem; readiness models select vs poll vs epoll vs kqueue (level vs edge triggered); thread-per-connection vs event loop; language-agnostic." },
  { slug: 'dns-deep-dive', name: 'DNS Deep Dive', hints: "resolution path: stub -> recursive resolver -> root -> TLD -> authoritative; recursive vs iterative queries; record types (A, AAAA, CNAME, MX, TXT, NS, SOA, SRV, PTR, CAA); TTL & caching layers; negative caching; DNS over UDP:53 & TCP fallback; DNS-based load balancing/failover & GeoDNS; CNAME-at-apex problem; DNSSEC (brief); DoH/DoT privacy; propagation misconception." },
  { slug: 'http-protocol-fundamentals', name: 'HTTP Protocol Fundamentals', hints: "HTTP as a text protocol over TCP; request/response message structure (start line, headers, body); HTTP/1.0 vs 1.1 (persistent connections, Host header); methods & status codes at the WIRE level (leave API-design semantics to rest-api-design); headers, cookies & sessions, Set-Cookie; content negotiation & Content-Type; Transfer-Encoding: chunked vs Content-Length; compression (gzip/br); statelessness; HTTP/1.1 HOL blocking & pipelining limits." },
  { slug: 'http2-http3-quic', name: 'HTTP/2, HTTP/3 & QUIC', hints: "HTTP/2: binary framing, streams, multiplexing over one TCP connection, HPACK header compression, server push (deprecated), stream prioritization; TCP-level HOL blocking remains; HTTP/3 over QUIC (UDP): stream-level independence removes HOL blocking, integrated TLS 1.3, 0-RTT, connection migration (conn IDs), head-of-line blocking comparison across versions; when each helps; ALPN negotiation." },
  { slug: 'tls-ssl-https', name: 'TLS, SSL & HTTPS', hints: "TLS position in the stack; TLS 1.2 vs 1.3 handshake (1.3 1-RTT, removed RSA key exchange, forward secrecy mandatory); certificates & PKI chain of trust, CA, cert validation, expiry/revocation (CRL/OCSP/stapling); cipher suites & what they specify; symmetric vs asymmetric in the handshake; session resumption & 0-RTT replay risk; SNI & ESNI/ECH; ALPN; mTLS; HTTPS = HTTP over TLS; how TLS layers over TCP vs QUIC." },
  { slug: 'grpc-protocol-buffers', name: 'gRPC & Protocol Buffers', hints: "gRPC over HTTP/2 (why); protobuf IDL, messages, field numbers & wire format (varint, tag-length-value), backward-compatible evolution rules; 4 RPC types (unary, server-streaming, client-streaming, bidirectional); code generation & contract-first; deadlines/timeouts, metadata, status codes; gRPC-Web & browser limitation; gRPC vs REST vs GraphQL trade-offs (perf, streaming, tooling, human-readability)." },
  { slug: 'realtime-websockets-sse', name: 'WebSockets & Server-Sent Events (SSE)', hints: "the polling problem; short polling vs long polling; WebSocket HTTP Upgrade handshake (101 Switching Protocols, Sec-WebSocket-Key/Accept), full-duplex framing, ping/pong, close codes; Server-Sent Events (text/event-stream, one-way server->client, auto-reconnect, Last-Event-ID); WebSocket vs SSE vs long-poll comparison (direction, protocol, reconnect, proxies/firewalls); scaling stateful connections; when to pick each." },
  { slug: 'connection-management-keepalive-pooling', name: 'Connection Management: Keep-Alive, Pooling & Multiplexing', hints: "TCP connection setup cost (handshake + slow start); HTTP keep-alive/persistent connections & Connection header; client-side connection pooling (why, sizing, per-host limits); HTTP/1.1 pipelining (and why it failed) vs HTTP/2 multiplexing; Nagle's algorithm & TCP_NODELAY; TCP keepalive vs HTTP keep-alive (different things); idle timeouts; connection reuse & TLS session resumption benefits." },
  { slug: 'proxies-gateways-load-balancing', name: 'Proxies, Gateways & Load Balancing (L4 vs L7)', hints: "forward proxy vs reverse proxy; API gateway role; L4 (transport, TCP/UDP, connection-level, fast, opaque) vs L7 (application, HTTP-aware, content routing, header/path-based) load balancing; LB algorithms (round-robin, least-conn, IP-hash, weighted); TLS termination vs passthrough vs re-encryption; health checks; sticky sessions; X-Forwarded-For / Forwarded; DSR; NAT vs proxy mode; when L4 vs L7." },
  { slug: 'network-troubleshooting-tools-metrics', name: 'Network Troubleshooting, Tools & Metrics', hints: "systematic layered diagnosis (bottom-up/top-down); tools: ping (ICMP echo, RTT), traceroute/tracert (TTL-based hop discovery), dig/nslookup (DNS), netstat/ss (sockets/states), tcpdump/Wireshark (capture/filter), curl -v, mtr, nc; interpreting TIME_WAIT/CLOSE_WAIT buildup; metrics: latency vs bandwidth vs throughput vs goodput, RTT, jitter, packet loss, MTU/PMTUD & fragmentation; bufferbloat; common failure patterns." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior network/backend engineer and interview coach authoring LANGUAGE/VENDOR-AGNOSTIC study material for the topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / frequently-asked subtopics to cover for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . This is Pass 1 — aim for 40-60 solid MCQs.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous technical reviewer verifying LANGUAGE/VENDOR-AGNOSTIC interview content for the "Networking & Protocols" topic "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `The files are at ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml . Read BOTH.\n\n` +
    `Check and FIX IN PLACE (using Edit/Write) any of:\n` +
    `1) FACTUAL ERRORS in concepts.md or in MCQ answers/explanations. Do web research to confirm anything uncertain — RFC numbers/status (TCP 9293, HTTP/1.1 9112, HTTP/2 9113, HTTP/3 9114, QUIC 9000, TLS 1.3 8446, DNS 1034/1035, WebSocket 6455), handshake steps, CIDR/subnet math, port numbers, congestion algorithms. A wrong 'answer' index or wrong subnet/handshake fact is the worst defect — fix it.\n` +
    `2) SCOPE DRIFT: if the content teaches API-design semantics (belongs in rest-api-design) or a specific language's socket library, refocus it on the wire/protocol mechanics. Keep HTTP here at the PROTOCOL level.\n` +
    `3) SCHEMA violations in questions.yaml: valid YAML; top-level keys topic/domain(networking)/topic_slug(${t.slug})/version/questions; each question has id (prefix '${t.slug}-', unique, 3-digit seq), difficulty in {beginner,intermediate,advanced,expert}, question, 3-5 options, 0-based 'answer' in range, explanation; ids unique; correct-option position VARIED (not all same index) — if clustered, rewrite some.\n` +
    `4) Every 'ref: concepts.md#anchor' must resolve to an actual '## ' heading in concepts.md (GitHub slug rules). Fix mismatches.\n` +
    `5) COVERAGE: at least 40 questions, every subtopic represented, mixed difficulty, some scenario-style questions present. If thin or a subtopic is uncovered, ADD questions to reach the bar.\n\n` +
    `After fixing, return a one-line verdict: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
