# networking — Content Audit

**Executive summary.** The networking domain is in strong shape: all 16 subtopics clear a senior/staff interview bar on depth (every file scores depth 5/5) and most lead with genuine intuition before formalism. The health problem is narrow and remarkably uniform — the collection under-delivers on the two most heavily weighted refinement dimensions: **worked examples** (domain avg 3.56/5) and, to a lesser degree, **clarity/intuition on the hardest primitives** (avg 4.44/5). Concretely, quantitative claims (BDP/flow-control windows, congestion-window growth, Mathis loss, Little's Law, amplification factors) and bit-level mechanics (checksums, ZigZag, WebSocket masking, binary subnet math) are repeatedly *stated as formulas or asserted facts but never traced with numbers-in/numbers-out*. Priority mix: **0 high, 11 medium, 5 low.** No subtopic is rated high-priority overall, but **7 medium subtopics carry high-severity issues** (a factual self-contradiction in HTTP framing, plus six "hardest concept taught only in prose" gaps) — these are the true top targets. Headline takeaways: (1) the single most common defect is the missing worked calculation, and the *same* BDP/64 KB-window example is owed by four different files; (2) there is one genuine correctness bug (http-protocol CL+TE) plus a cluster of smaller factual nits to fix; (3) 14 of 16 files are flagged `needs_web_verification` for time-sensitive RFC/limit numbers. This is a polish-and-concretize pass, not a rewrite.

## Scorecard

Sorted high-priority first, then lowest combined (clarity+example+depth) score first.

| Subtopic | Clarity (/5) | Examples (/5) | Depth (/5) | Priority | Verdict |
|---|---|---|---|---|---|
| link-layer-ethernet-arp-switching | 4 | 3 | 5 | medium | Encyclopedic on gotchas but reads like an expert cheat-sheet; STP election, MAC bit-decode, ARP-cache trace stated abstractly. |
| proxies-gateways-load-balancing | 4 | 3 | 5 | medium | Staff-level breadth; LB algorithms, Maglev, consistent-hashing ring explained in prose without worked walkthroughs. |
| socket-programming-io-multiplexing | 4 | 3 | 5 | medium | Deep and gotcha-rich, but level-vs-edge-triggered and Nagle/delayed-ACK deadlock lack the traced walkthroughs that remove doubt. |
| tcp-deep-dive-handshake-flow-congestion | 4 | 3 | 5 | medium | Staff-level breadth; the quantitative heart (cwnd growth, BDP, RTO) is prose/formula with no numeric trace. |
| tls-ssl-https | 4 | 3 | 5 | medium | Easily clears staff bar on depth, but almost no worked numbers and DH/HKDF used before intuited. |
| udp-datagram-transport | 4 | 3 | 5 | medium | RFC-grounded and interview-savvy, but checksum arithmetic, amplification factor, anti-amplification budget lack concrete numbers. |
| realtime-websockets-sse | 5 | 3 | 5 | medium | Outstanding depth/intuition; hardest bit-level concepts (Accept computation, masking XOR, length encoding) never walked through. |
| connection-management-keepalive-pooling | 5 | 4 | 5 | medium | Near-exemplary; HTTP/2 flow control and slow start describe the math in prose without tracing concrete numbers. |
| http-protocol-fundamentals | 5 | 4 | 5 | medium | Deep, wire-accurate HTTP/1.x reference marred by a direct internal contradiction on CL+TE handling. |
| ip-addressing-and-subnetting | 4 | 5 | 5 | medium | Worked-example-rich; asserts binary fluency is required but never teaches decimal↔binary conversion step by step. |
| network-troubleshooting-tools-metrics | 5 | 4 | 5 | medium | Near-reference-quality; math-heavy concepts (Mathis, Little's Law, utilization knee) state formulas without a walkthrough. |
| http2-http3-quic | 4 | 3 | 5 | low | Near-reference-grade; short on numbers-in/out (compression, flow-control math) and dense enumeration in the back half. |
| ip-routing-forwarding-nat | 4 | 4 | 5 | low | Senior-grade and deep; missing worked numbers on formula-only concepts plus a RIPv2 multicast correctness nit. |
| dns-deep-dive | 5 | 4 | 5 | low | Near-exemplary DNS reference; only minor worked-example (SRV selection, amplification factor) and jargon polish. |
| grpc-protocol-buffers | 5 | 4 | 5 | low | Reference-quality with real byte-level walkthroughs; a few formulas (ZigZag, retry backoff, token bucket) not traced. |
| network-models-osi-tcpip | 5 | 4 | 5 | low | Outstanding intuition-first treatment; minor MTU-definition imprecision and a missing multi-hop address trace. |

## Systemic issues

Clustered across subtopics, worst/most-common first. This is where the leverage is: fixing a theme once yields a reusable pattern across many files.

### 1. Formula stated, never worked with numbers (the dominant defect) — ~13 of 16 files
The most heavily weighted dimension (examples) is exactly where the collection is weakest, and the failure mode is consistent: the correct formula is present but never plugged in.
- **The BDP / 64 KB-window example is owed by four separate files** — `connection-management-keepalive-pooling`, `grpc-protocol-buffers`, `http2-http3-quic`, `tcp-deep-dive-handshake-flow-congestion` all assert "a 64 KB window caps throughput at window/RTT" without computing it. Recommend authoring **one canonical worked example** (e.g. 65,535 B / 100 ms ≈ 640 KB/s ≈ 5 Mbps vs a 1 Gbps line; window needed = bw×RTT ≈ 12.5 MB) and reusing it verbatim.
- **Congestion/slow-start math** un-traced in `connection-management-keepalive-pooling` and `tcp-deep-dive` (cwnd 10→20→40→80, ssthresh halving, RTO collapse to 1 MSS).
- Other un-worked formulas: Mathis loss & Little's Law & utilization knee (`network-troubleshooting`), RTO = SRTT+4·RTTVAR and CUBIC W(t) (`tcp-deep-dive`), retry backoff & token-bucket throttle (`grpc`), OSPF cost / iBGP n(n−1)/2 / PAT 64K ports (`ip-routing`), LB round-robin overload & Maglev table & consistent-hash ring (`proxies`), amplification BAF→Gbps (`udp`, `dns`), q-value negotiation (`http-protocol`), HPACK/QPACK byte savings (`http2-http3`).

### 2. Bit-/wire-level mechanics asserted but not decoded — ~7 files
Concepts whose whole payoff is watching bytes transform are taught in prose:
- Checksum one's-complement + end-around carry (`udp`), WebSocket `Sec-WebSocket-Accept` SHA1/base64 and frame-masking XOR and length encoding (`realtime-websockets`), ZigZag varint bytes (`grpc`), decimal↔binary octet conversion (`ip-addressing` — high severity, since the file *demands* binary fluency), MAC I/G-bit "odd first byte = multicast" decode and filled-in ARP packet/cache trace (`link-layer`), AEAD per-record nonce construction (`tls-ssl`).

### 3. Hardest primitive used before it is intuited — ~6 files
Missing plain-language mental model before the formalism, on exactly the concept a student is most likely to be stuck on:
- Diffie-Hellman and HKDF Extract/Expand (`tls-ssl`, both high severity), level- vs edge-triggered and Reactor vs Proactor (`socket-programming`), two-level HTTP/2 flow control "why two windows" (`connection-management`), network-vs-host address split analogy (`ip-addressing`), Maglev/rendezvous hashing (`proxies`), why a flat burned-in MAC exists vs routable IP (`link-layer`), BGP tie-break ladder rationale (`ip-routing`).

### 4. Missing diagrams for spatial/dataflow concepts — ~6 files
The repo already ships a mermaid render pipeline, so these are cheap, high-value wins. Requested in: `link-layer` (per-hop MAC rewrite, 802.1Q double-tagging, ARP exchange), `proxies` (L4/L7, DSR asymmetric path, hashing ring), `socket-programming` (SYN queue → accept queue), `realtime-websockets` (pub/sub backplane fan-out), `grpc` (channel pipeline + L4-pinning), `tcp-deep-dive` (AIMD sawtooth, CUBIC curve), `network-troubleshooting` (triage decision tree).

### 5. Correctness / factual nits — 8 files (1 is a real bug)
- **Real bug (high):** `http-protocol-fundamentals` contradicts itself on CL+TE handling — the Framing section says "Transfer-Encoding wins, ignore Content-Length" while the Headers and Smuggling sections say "reject with 400," and explicitly call "prefer TE" the exploitable behavior. Must be reconciled into one statement (historical RFC 9112 rule vs modern hardened reject).
- Smaller slips: MTU defined as "IP payload" not "IP packet" causing double-subtraction of the IP header (`network-models`); RIPv2 said to "broadcast" — it multicasts to 224.0.0.9 (`ip-routing`); ephemeral-port range internally inconsistent 49152–65535 vs ~28K/32768–60999 (`socket-programming`); gzip "(DEFLATE, RFC 1952)" conflates RFC 1951/1952 (`http-protocol`); "TLS 1.3 (RFC 8446)" reads as required when 1.2 is still common (`grpc`); ~17 s vs ~34 s sequence-wrap ambiguity and AccECN RFC number (`tcp-deep-dive`); OCSP-stapling RFC 6066 vs 6961 conflation (`tls-ssl`); Class A 0/127 carve-out omitted (`ip-addressing`).

### 6. Reference-cheat-sheet drift in back halves + intentional-but-jarring redundancy — ~7 files
Later sections shift from intuition-first teaching to dense hex/flag enumerations without a "why this matters" hook: `http2-http3` (packet-number spaces, frame/error codes, GREASE), `socket-programming` (io_uring/kqueue/zero-copy flag lists), `link-layer`, `ip-routing`. Separately, several files revisit the same topic across a "basics" and a "deep-dive" half without signposting, which reads as bloat to a linear reader: `dns`, `network-models`, `ip-routing`, `tcp-deep-dive`, `tls-ssl`, `udp`. Cheap fix: one-line forward-reference/signpost at the first mention.

### 7. Jargon unexpanded on first use — ~5 files
Files that are otherwise scrupulous about defining terms slip on: RTO/MSS/SAN (`connection-management`), ALPN/anycast (`dns`), FIB/SNAcP/SNDCP/SNICP (`network-models`), TSO/GSO/stretch-ACK/qdisc/AQM (`tcp-deep-dive`), idempotent/safe (`http-protocol`, load-bearing for the retry reasoning).

## High-priority subtopics

**No subtopic is rated `refine_priority: high`.** However, 7 medium-priority subtopics carry **high-severity individual issues** and are the de-facto top targets for the refinement pass. They are documented here, worst first.

### tcp-deep-dive-handshake-flow-congestion (medium; 2 high-severity)
1. **[high · example-gap] Slow Start / AIMD** — cwnd evolution described only in prose. Add a traced table: IW=10 MSS → 20→40→80, loss at 80 → ssthresh=40, halve to 40, then +1 MSS/RTT; contrast the RTO case (cwnd→1 MSS). Columns: (RTT#, event, cwnd, ssthresh).
2. **[high · example-gap] Sliding-window / BDP** — "64 KB caps throughput" asserted, never computed. Add: 1 Gbps × 80 ms = 10 MB BDP; 64 KiB / 0.08 s ≈ 6.5 Mbps ≈ 0.65% utilization → motivates window scaling.
3. **[medium] RTO** — show RFC 6298 α=1/8, β=1/4 with a worked SRTT/RTTVAR update (100/20 → RTO 180 ms → new sample 140 → RTO 205 ms).
4. **[medium] CUBIC** — plug numbers into W(t)=C(t−K)³+W_max; show concave→W_max→convex.
5. **[medium] "which CC when"** — add CUBIC-default / BBR-lossy-WAN / DCTCP-L4S-datacenter decision guidance.

### tls-ssl-https (medium; 2 high-severity)
1. **[high · missing-intuition] Diffie-Hellman** — described operationally only. Add the mixing-paint analogy + a toy modular-exp example (g=5, p=23, a=6, b=15 → shared 2).
2. **[high · example-gap] handshake RTT** — 2-RTT vs 1-RTT vs 0-RTT never made concrete. Add a worked latency box (e.g. 40 ms RTT London↔NYC: TLS1.2 ≈120 ms, TLS1.3 ≈80 ms, 0-RTT ≈40 ms, QUIC fresh ≈40 ms).
3. **[medium · missing-intuition] HKDF key schedule** — explain Extract (whiten entropy) vs Expand (stretch into labelled keys) in plain words before the ASCII ladder.
4. **[medium] AEAD nonce** — trace write_iv XOR seq for seq=0,1; note catastrophic reuse on wrap.
5. **[medium] cert chain validation** — add a concrete success trace (leaf→R3→ISRG X1) and the missing-intermediate failure.

### socket-programming-io-multiplexing (medium; 2 high-severity)
1. **[high · example-gap] level- vs edge-triggered** — the file's most confusing concept, prose-only. Trace: 2000 B arrive, read 1400; LT re-reports the fd, ET does not (400 B stuck) → show the read-until-EAGAIN fix on the same numbers.
2. **[high · example-gap] Nagle + delayed-ACK deadlock** — add a timeline showing the ~40 ms standoff (client holds part B until A is ACKed; server holds delayed ACK awaiting a reply it can't form). Show TCP_NODELAY/writev fix.
3. **[medium · correctness] ephemeral-port inconsistency** — reconcile IANA 49152–65535 (~16K) vs Linux default 32768–60999 (~28K); state which the ~28K figure uses.
4. **[medium · missing-intuition] Reactor vs Proactor** — add the kitchen analogy before the readiness/completion formalism; map epoll→Reactor, io_uring/IOCP→Proactor.

### udp-datagram-transport (medium; 2 high-severity)
1. **[high · example-gap] checksum internals** — one's-complement + end-around carry taught only in words. Add a 5-line traced sum (e.g. 0xF3D2 + 0x1E4C, carry wrap, complement, receiver re-sum → 0xFFFF).
2. **[high · example-gap] amplification** — BAF given but never turned into leverage. Trace: 60-byte NTP monlist → ~33 KB reply (~556×); 1 Gbps spoofed → ~556 Gbps; tie to memcached ~51,000× / GitHub 1.35 Tbps.
3. **[medium · example-gap] QUIC anti-amplification** — show the 3× budget: 1200-byte Initial → ≤3600 bytes before validation → why Retry is needed.
4. **[medium · missing-intuition] HoL blocking** — trace two HTTP/2 streams over one TCP conn where one lost segment stalls the other.

### link-layer-ethernet-arp-switching (medium; 1 high-severity)
1. **[high · example-gap] STP root-bridge election / path cost** — the most-tested STP mechanic, abstract only. Add a Bridge-ID tie-break example (priority tie → lower MAC wins; lower priority flips root) and an IEEE path-cost accumulation (1G=20000, 10G=2000) picking root port vs blocked.
2. **[medium · example-gap] MAC I/G bit** — decode 0x01 = 00000001, LSB=1 → multicast (hence "odd"); contrast 0x00 even → unicast.
3. **[medium · example-gap] ARP** — fill in a real request/reply (op=1/2, sender/target IP+MAC) and show the neighbor cache transition INCOMPLETE → REACHABLE.
4. **[medium · missing-intuition]** — add a one-line "why a flat burned-in MAC exists" lead to MAC addressing and a "why these fields" lead to the frame table.

### http-protocol-fundamentals (medium; 1 high-severity — the only true bug)
1. **[high · correctness] CL + Transfer-Encoding contradiction** — Framing section says "TE wins, ignore CL"; Headers and Smuggling sections say "reject 400." Reconcile: state RFC 9112 §6.1 historical rule (remove CL, prefer TE) *and* the modern hardened rule (reject 400 + close) together in the Framing section.
2. **[medium · example-gap] q-value negotiation** — add a worked resolution (`Accept: text/html;q=0.8, application/json` → JSON at implicit q=1; then a 406/next-acceptable case).
3. **[medium · jargon] idempotent/safe** — inline one-line gloss on first use (retry reasoning is unintelligible without it), pointer to rest-api-design.
4. **[low] HOL blocking** — quantify (30 assets, 50 ms RTT: 1 conn ≈30 round-trips vs 6 conns ≈5 waves).
5. **[low] gzip RFC** — correct to "gzip container RFC 1952 wrapping DEFLATE RFC 1951."

### ip-addressing-and-subnetting (medium; 1 high-severity)
1. **[high · example-gap] decimal↔binary conversion** — file declares binary fluency mandatory but never teaches the method. Add one decimal→binary (168 → 10101000 by successive place-value subtraction) and one binary→decimal.
2. **[medium · missing-intuition]** — add the postal analogy (prefix = street/ZIP shared, host bits = house number) before the network/host formalism.
3. **[medium · clarity] EUI-64 U/L bit** — reconcile "7th bit" vs "second-least-significant bit"; tie to the 0x02 mask; clarify globally-unique MAC (U/L=0) flips to 1.
4. **[low] Class A** — note 0.0.0.0/8 and 127.0.0.0/8 carve-outs (assignable 1–126).

## Refinement plan

**Recommended order of attack** (do the reusable work first, then the highest-severity individual gaps):

1. **Author the shared BDP / flow-control-window worked example once**, then drop it into the four files that owe it (`connection-management`, `grpc`, `http2-http3`, `tcp-deep-dive`). Biggest single-fix leverage in the domain.
2. **Fix the one real bug:** `http-protocol-fundamentals` CL+TE self-contradiction. It's a correctness defect a sharp interviewer catches and the only high-severity *correctness* issue.
3. **Concretize the "hardest concept, prose-only" high-severity gaps**, worst first: `tcp-deep-dive` (cwnd + BDP), `tls-ssl` (DH + RTT + HKDF), `socket-programming` (LT/ET + Nagle), `udp` (checksum + amplification), `link-layer` (STP), `ip-addressing` (binary conversion).
4. **Sweep the correctness nits** (theme 5) in one pass: MTU definition (`network-models`), RIPv2 multicast (`ip-routing`), ephemeral-port reconciliation (`socket-programming`), gzip RFC (`http-protocol`), TLS-version phrasing (`grpc`), sequence-wrap/AccECN (`tcp-deep-dive`), OCSP RFC (`tls-ssl`).
5. **Batch the diagram additions** (theme 4) via the existing mermaid pipeline — cheap, high clarity payoff across 6 files.
6. **Polish pass:** jargon expansions (theme 7), back-half intuition hooks and signposting (theme 6), and the low-priority worked examples in `dns`, `grpc`, `http2-http3`, `ip-routing`, `network-models`.

**Web verification required.** 14 of 16 files are flagged `needs_web_verification: true` — verify before finalizing any time-sensitive number:
`connection-management-keepalive-pooling`, `dns-deep-dive`, `grpc-protocol-buffers`, `http-protocol-fundamentals`, `http2-http3-quic`, `ip-routing-forwarding-nat`, `network-models-osi-tcpip`, `network-troubleshooting-tools-metrics`, `proxies-gateways-load-balancing`, `realtime-websockets-sse`, `socket-programming-io-multiplexing`, `tcp-deep-dive-handshake-flow-congestion`, `tls-ssl-https`, `udp-datagram-transport`.
Highest-value verification targets: AccECN & L4S RFC numbers and sequence-wrap timing (`tcp-deep-dive`); TLS SC-081 cert-lifetime date ladder, Let's Encrypt OCSP sunset, ML-KEM-768 share sizes, OCSP-stapling RFCs (`tls-ssl`); RIPv2/OSPF/PAT defaults (`ip-routing`); Linux ephemeral-port range (`socket-programming`); GSO segment-count cap and Cloudflare syscall figures (`udp`); TLS-version claim (`grpc`).
The 2 files **not** requiring web verification: `ip-addressing-and-subnetting`, `link-layer-ethernet-arp-switching`.

**Missing/unreadable files:** 0 — all 16 audit files were read successfully.
