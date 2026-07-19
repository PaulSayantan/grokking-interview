export const meta = {
  name: 'networking-deepen',
  description: 'Pass 2 for Networking & Protocols: exhaustive research gap-analysis, then deepen concepts + append advanced/expert MCQs to 70-90 per topic, then verify — additively',
  phases: [
    { title: 'Research', detail: 'exhaustive web gap-analysis per topic: what protocol/wire concepts are we missing?' },
    { title: 'Deepen', detail: 'fill gaps in concepts + append advanced/expert MCQs' },
    { title: 'Verify', detail: 'fact-check RFC precision, dedupe, schema-check each topic in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/networking`

const SCOPE = `
DOMAIN SCOPE — "Networking & Protocols" is LANGUAGE/VENDOR-AGNOSTIC. Teach how the network
and its protocols actually work ON THE WIRE, NOT a specific OS/vendor/library. Concretely:
- Language-neutral: describe the BSD socket model and readiness APIs (select/poll/epoll/kqueue)
  conceptually; don't teach a specific language's networking library.
- Distinct from the REST APIs & API Design domain: THIS domain owns HTTP as a PROTOCOL
  (message framing, methods/status at the wire level, connection handling, versions, TLS).
  API-design semantics (resource modeling, versioning strategy, pagination, HATEOAS, OpenAPI,
  the API-usage view of OAuth/JWT) live in rest-api-design — do NOT re-teach them here.
- Distinct from system-design: stay at protocol/mechanics altitude (handshakes, headers,
  algorithms, packet flow, state machines), not whiteboard capacity/topology design.
- Ground EVERY claim in the real standards and current reality: TCP/IP (RFC 9293), IP/CIDR,
  DNS (RFC 1034/1035, DoH 8484, DoT 7858, DNSSEC 4033-4035), HTTP/1.1 (RFC 9112), HTTP
  semantics (9110), HTTP caching (9111), HTTP/2 (RFC 9113), HTTP/3 (RFC 9114) + QUIC
  (RFC 9000/9001/9002), TLS 1.3 (RFC 8446), ECH draft, gRPC/protobuf, WebSocket (RFC 6455),
  SSE (WHATWG HTML). Verify version-specific behavior via web research.
`

// slug -> current max question seq (new questions start at start); + research focus per topic.
const TOPICS = [
  { slug: 'network-models-osi-tcpip', name: 'Network Models: OSI & TCP/IP', start: 51,
    dig: "encapsulation/decapsulation byte-by-byte, PDU naming precision, where ambiguous protocols sit (ARP L2/L3 debate, ICMP L3, TLS L5-6 vs 'L4.5'), why the 7-layer model persists despite TCP/IP winning, cross-layer violations (NAT, L7 LBs), MTU/MSS across layers, the 'layer X device' edge cases (multilayer switch, L4 vs L7 LB), data-plane vs control-plane framing." },
  { slug: 'ip-addressing-and-subnetting', name: 'IP Addressing & Subnetting', start: 56,
    dig: "fast VLSM/subnet math under time pressure, supernetting/route aggregation, IPv6 address types in depth (link-local fe80::/10, ULA fc00::/7, global 2000::/3, multicast ff00::/8, solicited-node, EUI-64, SLAAC vs DHCPv6), IPv6 has no broadcast, /31 point-to-point (RFC 3021), /127 links (RFC 6164), CGNAT 100.64.0.0/10 (RFC 6598), anycast, dual-stack, subnetting a /48 into /64s." },
  { slug: 'link-layer-ethernet-arp-switching', name: 'Link Layer: Ethernet, MAC, ARP & Switching', start: 53,
    dig: "802.1Q tag format & native VLAN, 802.1Q vs ISL, jumbo frames & MTU mismatch effects, STP/RSTP loop prevention & why L2 loops are catastrophic (broadcast storm), gratuitous ARP & proxy ARP, ARP cache poisoning mechanics + defenses (DAI), CAM table overflow/MAC flooding attack, unicast flooding, LACP/link aggregation, PoE briefly, frame check sequence/CRC, minimum frame size & collision detection legacy." },
  { slug: 'ip-routing-forwarding-nat', name: 'IP Routing, Forwarding & NAT', start: 49,
    dig: "longest-prefix-match with concrete overlapping-route examples, administrative distance & metric tie-breaks, BGP path selection attributes (AS-path, local-pref, MED) & why the internet uses it, OSPF areas/LSAs & convergence, ECMP, RPF, NAT types in depth (full-cone/restricted/port-restricted/symmetric) & NAT traversal (STUN/TURN/ICE, hole punching), PAT port exhaustion, TTL decrement & traceroute mechanics, ICMP types/codes precision, PMTUD black holes." },
  { slug: 'tcp-deep-dive-handshake-flow-congestion', name: 'TCP Deep Dive: Handshake, Flow & Congestion Control', start: 57,
    dig: "TIME_WAIT purpose (2*MSL, stale-segment & final-ACK reliability) & scaling problems + SO_REUSEADDR/tw_reuse, CLOSE_WAIT leak diagnosis, simultaneous open/close, SYN cookies & SYN-flood defense, sequence-number wrap & PAWS, window scaling & why 64KB default limits throughput (BDP), SACK/D-SACK, RTO computation (Karn/Jacobson), fast retransmit/fast recovery (Reno vs NewReno), CUBIC vs BBR model differences, ECN, delayed-ACK + Nagle interaction latency, incast." },
  { slug: 'udp-datagram-transport', name: 'UDP & Datagram Transport', start: 49,
    dig: "UDP checksum (optional IPv4, mandatory IPv6) & pseudo-header, fragmentation risk & why apps cap datagram size, amplification/reflection attacks (DNS/NTP/memcached) & why UDP enables them, source-port randomization, multicast/IGMP & broadcast scope, QUIC-over-UDP rationale in depth (kernel/middlebox ossification, user-space evolution, connection IDs), GSO/GRO offload, when app-level reliability beats TCP (head-of-line-free)." },
  { slug: 'socket-programming-io-multiplexing', name: 'Socket Programming & I/O Multiplexing', start: 56,
    dig: "level- vs edge-triggered epoll semantics & the EAGAIN drain loop, thundering herd (accept & epoll) + EPOLLEXCLUSIVE/SO_REUSEPORT, select's FD_SETSIZE limit & O(n) scan vs epoll O(1) readiness, the C10K/C10M problem, blocking vs non-blocking vs async (io_uring conceptually), TCP_NODELAY vs TCP_CORK, SO_REUSEADDR vs SO_REUSEPORT distinction, backlog & SYN/accept queues, graceful shutdown (shutdown vs close, SO_LINGER), send/recv partial writes." },
  { slug: 'dns-deep-dive', name: 'DNS Deep Dive', start: 49,
    dig: "full record-type semantics (SOA fields incl. serial/refresh/retry/expire/minimum-TTL for negative caching RFC 2308, SRV format, CAA, PTR/reverse in-addr.arpa & ip6.arpa, ALIAS/ANAME apex workaround), EDNS0 & why >512B needs it, DNS message format/compression, DNSSEC chain (RRSIG/DNSKEY/DS/NSEC vs NSEC3 zone-walking), DoH vs DoT trade-offs & port 853, DNS cache poisoning (Kaminsky) & source-port/0x20 randomization, GeoDNS/anycast/latency-based routing, TTL vs propagation misconception." },
  { slug: 'http-protocol-fundamentals', name: 'HTTP Protocol Fundamentals', start: 53,
    dig: "message framing precision (Content-Length vs chunked Transfer-Encoding, trailers), request smuggling (CL.TE/TE.CL) as a framing consequence, HTTP/1.1 persistent-connection & pipelining limits, absolute-form vs origin-form request targets & Host requirement, cookie attributes at the protocol level (SameSite/Secure/HttpOnly/__Host-), conditional/range requests wire mechanics, connection close semantics, Expect: 100-continue, header injection/CRLF, compression at protocol level (avoid API-design semantics)." },
  { slug: 'http2-http3-quic', name: 'HTTP/2, HTTP/3 & QUIC', start: 61,
    dig: "HPACK vs QPACK (dynamic table & why QPACK needs it for out-of-order), HTTP/2 frame types (HEADERS/DATA/SETTINGS/WINDOW_UPDATE/RST_STREAM/GOAWAY), stream states & flow control (per-stream + connection), TCP HOL vs QUIC per-stream independence with a concrete loss example, QUIC packet vs frame vs stream, 0-RTT & replay risk, connection migration via connection IDs, ALPN (h2/h3) & Alt-Svc discovery, HTTP/2 Rapid Reset (CVE-2023-44487), priority (RFC 9218) replacing deprecated tree, why server push was removed." },
  { slug: 'tls-ssl-https', name: 'TLS, SSL & HTTPS', start: 57,
    dig: "TLS 1.3 handshake message flow (ClientHello/ServerHello/EncryptedExtensions/Certificate/CertificateVerify/Finished) & what 1-RTT means, removed 1.2 features (RSA key exchange, static DH, renegotiation, compression-CRIME), AEAD-only cipher suites & the 1.3 suite naming change, key schedule/HKDF conceptually, PSK & 0-RTT replay mitigation, cert chain building & validation (name/SAN/expiry/EKU), revocation (CRL vs OCSP vs OCSP stapling vs must-staple, CRLite), SNI/ECH, ALPN, session resumption (session ID vs tickets vs PSK), mTLS, downgrade protection & TLS_FALLBACK_SCSV." },
  { slug: 'grpc-protocol-buffers', name: 'gRPC & Protocol Buffers', start: 57,
    dig: "protobuf wire types (0 varint/1 I64/2 LEN/5 I32) & tag = (field<<3)|wiretype, zigzag for sint, packed repeated, backward-compat rules (never reuse field numbers, reserved, optional vs implicit presence proto3), gRPC over HTTP/2 mapping (one call = one stream, HEADERS/DATA/trailers, grpc-status in trailers), the 4 RPC modes framing, deadlines propagation & cancellation, metadata, retries/hedging & interceptors, gRPC-Web proxy requirement & browser limits, reflection & health-check protocol, gRPC vs REST vs GraphQL decision matrix." },
  { slug: 'realtime-websockets-sse', name: 'WebSockets & Server-Sent Events (SSE)', start: 53,
    dig: "WebSocket handshake precision (Sec-WebSocket-Key/Accept magic GUID 258EAFA5..., Upgrade/Connection, 101, subprotocol/extensions negotiation), frame format (FIN/opcode/mask — client MUST mask & why, payload-length encoding), close codes (1000/1001/1006/1011), ping/pong keepalive, permessage-deflate, WSS & proxy traversal, SSE wire format (text/event-stream, event/data/id/retry fields, comment heartbeats, Last-Event-ID reconnect, HTTP/2 removes the 6-connection limit), long-poll vs WebSocket vs SSE decision + scaling stateful fan-out (pub/sub backplane)." },
  { slug: 'connection-management-keepalive-pooling', name: 'Connection Management: Keep-Alive, Pooling & Multiplexing', start: 51,
    dig: "connection-setup cost decomposition (TCP handshake RTT + TLS RTTs + slow-start ramp) & how pooling/0-RTT/resumption amortize it, HTTP/1.1 pool sizing & per-host limits (browser 6), why HTTP/1.1 pipelining failed (HOL + buggy proxies) vs HTTP/2 multiplexing, TCP keepalive (SO_KEEPALIVE, tcp_keepalive_time) vs HTTP keep-alive vs HTTP/2 PING — three different things, idle-timeout races & the retry-on-half-open-connection problem, connection draining/GOAWAY, Happy Eyeballs (RFC 8305) dual-stack, Nagle vs TCP_NODELAY for small writes, connection affinity vs pooling." },
  { slug: 'proxies-gateways-load-balancing', name: 'Proxies, Gateways & Load Balancing (L4 vs L7)', start: 57,
    dig: "L4 vs L7 concrete capability/latency/visibility trade-offs, DSR/direct server return mechanics & why it scales, consistent hashing for LB & why plain modulo breaks on membership change, maglev/rendezvous hashing, connection draining & graceful backend removal, health checks (active vs passive/outlier detection), sticky sessions (cookie vs IP-hash) downsides, TLS termination vs passthrough vs re-encryption trust boundaries, X-Forwarded-For spoofing & trusting the right hop / RFC 7239 Forwarded, PROXY protocol, forward vs reverse vs transparent proxy, gateway vs mesh sidecar boundary." },
  { slug: 'network-troubleshooting-tools-metrics', name: 'Network Troubleshooting, Tools & Metrics', start: 51,
    dig: "reading a traceroute correctly (asymmetric paths, per-hop RTT quirks, * timeouts from ICMP rate-limiting/deprioritization NOT loss), TIME_WAIT vs CLOSE_WAIT root-cause distinction (peer vs local close bug), tcpdump/BPF filter syntax & capturing the handshake, latency vs bandwidth vs throughput vs goodput precise definitions + BDP, jitter & packet loss impact on TCP throughput (Mathis equation intuition), PMTUD black-hole diagnosis & MSS clamping, bufferbloat & AQM (CoDel/FQ), ss/netstat state interpretation, curl -v/-w timing breakdown, mtr vs traceroute, DNS-vs-connect-vs-TLS latency attribution." },
]

const RULES = (t) => `
GOAL: make this topic's MCQ bank DEEPER and HARDER and fill any concept gaps — WITHOUT
removing or altering existing content. This is Pass 2; a research brief of likely-missing
concepts is provided.

${SCOPE}

STEP 1 — READ both existing files first:
  ${DIR}/${t.slug}/concepts.md
  ${DIR}/${t.slug}/questions.yaml
Understand what's already covered so you do NOT duplicate existing questions or concepts.

STEP 2 — ENRICH concepts.md (edit in place, ADDITIVE):
  - Use the RESEARCH BRIEF (provided separately) plus your own web research to add any
    MISSING high-value concepts and deepen thin subtopics (advanced internals, wire-format
    detail, edge cases, trade-offs, failure modes, standards detail). You MAY add new "## "
    subsections for genuinely missing areas. Keep EXISTING "## " headings stable (questions
    ref them). Keep the "## Common follow-up questions" and "## References" sections last.
  - Language/vendor-agnostic; cite correct RFC/spec numbers and current status.

STEP 3 — APPEND new questions to questions.yaml (do NOT rewrite existing ones):
  - Add AT LEAST 25 new questions (target total 70-90). New ids are "${t.slug}-NNN" starting
    at ${String(t.start).padStart(3, '0')}, incrementing, zero-padded 3-digit, unique.
  - Difficulty of NEW questions: heavily ADVANCED and EXPERT (~50% expert, 40% advanced,
    10% intermediate). Use 'expert' for deep standards detail, subtle wire-level distinctions,
    and senior/staff scenario/debugging questions.
  - DEEP-DIVE every subtopic + the newly added concepts. Prioritize scenario questions
    ("given this capture / this handshake / this subnet / this ss output, which is correct?"),
    subtle-distinction, and multi-step reasoning with long plausible options. Distractors
    must be wrong for a real, specific reason.
  - No "all/none of the above". Do NOT duplicate an existing question's meaning.

SCHEMA (must hold for every new question): keys id, difficulty
(beginner|intermediate|advanced|expert), tags[], question, options[3-5], answer (0-BASED,
in range), explanation, ref ("concepts.md#anchor" resolving to a real "## " heading via
GitHub slug rules — lowercase, spaces->-, punctuation stripped, "A & B" -> "#a--b" double
dash). VARY correct-option position (do not cluster on one index). Keep top-level
topic/domain(networking)/topic_slug(${t.slug})/version intact.

Use Edit/Write. Return one line: "${t.slug}: +<newCount> questions (now <total>), concepts enriched: <yes/no>, gaps filled: <short list>".
`

phase('Research')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are researching the topic "${t.name}" for a LANGUAGE/VENDOR-AGNOSTIC "Networking & Protocols" interview library, to make sure Pass-2 deepening misses NOTHING.\n\n${SCOPE}\n\n` +
    `FIRST read the current material at ${DIR}/${t.slug}/concepts.md (its "## " headings show what's already covered).\n` +
    `THEN do EXHAUSTIVE web research (the relevant RFCs/specs, current networking references, "senior/staff network + backend interview questions 2024/2025", vendor-neutral protocol docs) and produce a GAP BRIEF for this topic:\n` +
    `- MISSING concepts/subtopics not in the current concepts.md that a strong 2025 senior interview expects (with a one-line why each matters).\n` +
    `- THIN areas that need deeper treatment (advanced internals / wire-format detail / edge cases / standards detail).\n` +
    `- Specific hard/senior question angles worth adding (scenario/debugging framings).\n` +
    `Focus hints to make sure you cover: ${t.dig}\n\n` +
    `Return a concise but COMPLETE brief (bullet lists). This brief is handed to the deepening author, so be concrete and specific (name the RFC sections, header/field names, packet fields, attack names, algorithm names, spec versions).`,
    { label: `research:${t.slug}`, phase: 'Research', effort: 'high' }
  ),
  (brief, t) => agent(
    `You are a staff-level network/backend engineer and senior interviewer deepening the interview-prep material for "${t.name}" (slug: ${t.slug}). Add the hard, wire-level questions and missing concepts that separate senior candidates from juniors.\n\n` +
    `RESEARCH BRIEF (gaps + angles found for this topic — incorporate these):\n${brief}\n\n${RULES(t)}`,
    { label: `deepen:${t.slug}`, phase: 'Deepen', effort: 'high' }
  ),
  (deepenSummary, t) => agent(
    `Verify the deepened Networking topic "${t.name}" (slug: ${t.slug}). Read ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and FIX IN PLACE:\n` +
    `1) FACTUAL errors in any concept text, MCQ answer index, or explanation — web-research anything uncertain (RFC numbers/status: TCP 9293, IP/CIDR, DNS 1034/1035/2308/4033-4035, HTTP 9110/9111/9112, HTTP/2 9113, HTTP/3 9114, QUIC 9000/9001/9002, TLS 1.3 8446, WebSocket 6455; handshake steps, CIDR/subnet math, protobuf wire types, congestion algorithms, port numbers, ICMP types, close codes). A wrong 'answer' index or wrong subnet/handshake/wire fact is the WORST defect — fix it.\n` +
    `2) SCOPE DRIFT: if content teaches API-design semantics (belongs in rest-api-design), the API-usage view of OAuth/JWT, or a specific language's socket library, refocus it on the wire/protocol mechanics. Keep HTTP here at the PROTOCOL level.\n` +
    `3) DUPLICATES: if a newly added question is a semantic duplicate of an existing one, rewrite it to cover something new.\n` +
    `4) SCHEMA: valid YAML; unique ids all prefixed '${t.slug}-' 3-digit seq, no collisions; difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based in-range 'answer'; every 'ref' resolves to a real '## ' heading. Fix violations. Confirm correct-option positions are VARIED (not clustered on one index) — rebalance if skewed.\n` +
    `5) DIFFICULTY/COVERAGE: confirm the bank now has a strong block of advanced+expert questions and reaches 70-90 total; expert-tagged ones must be genuinely hard. Re-tag/ADD if short.\n\n` +
    `Return one line: "${t.slug}: <total> questions (<nBeg>/<nInt>/<nAdv>/<nExp>), <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
