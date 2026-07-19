# Proxies, Gateways & Load Balancing (L4 vs L7)

A **proxy** is an intermediary that terminates one connection and originates another on
behalf of a client or a server. **Load balancers** are a specialized kind of proxy (or
packet forwarder) that spread traffic across a pool of backends. **API gateways** are L7
reverse proxies enriched with API-management logic. This topic is about the *mechanics* —
which OSI layer the box operates at, how it forwards packets vs connections, what it can
see and rewrite, and the trade-offs an interviewer will probe. It is vendor- and
language-agnostic: no specific product or library is assumed.

> [!KEY-TAKEAWAY]
> The single most important axis is **which layer the device understands**. An **L4**
> load balancer forwards *connections/packets* (TCP/UDP) and is opaque to application
> content — fast, cheap, protocol-agnostic. An **L7** load balancer terminates the
> *application protocol* (usually HTTP), so it can route on path/host/header, but it must
> parse and re-originate the request — richer, but more CPU and a real endpoint.

---

## Forward proxy vs reverse proxy

Both sit between client and server; the difference is **whom they act on behalf of** and
**who knows they exist**.

**Forward proxy** — sits in front of *clients*, on the client's side of the network. The
client is (usually) explicitly configured to send traffic through it. It acts on behalf of
the client to reach arbitrary origin servers. Uses: corporate egress filtering, caching,
anonymity, bypassing geo-restrictions, content inspection. The origin server sees the
proxy's IP, not the client's.

- For plaintext HTTP the client sends an absolute-form request line
  (`GET http://example.com/x HTTP/1.1`).
- For HTTPS the client issues an **HTTP `CONNECT`** request to open a blind TCP tunnel; the
  proxy just relays encrypted bytes and cannot see inside without a
  man-in-the-middle/TLS-interception setup with a trusted CA.

**Reverse proxy** — sits in front of *servers*, on the server's side. Clients think they
are talking directly to the origin; they are unaware of it. It acts on behalf of the
server/service. Uses: load balancing, TLS termination, caching, compression, WAF,
request routing, hiding backend topology. This is what CDNs, ingress controllers, and API
gateways are.

| | Forward proxy | Reverse proxy |
|---|---|---|
| Protects/serves | the client | the server |
| Who configures it | client (explicit) | server operator |
| Client aware of it? | usually yes | usually no |
| Sees origin selection | client picks origin | proxy picks backend |
| Typical use | egress control, caching, anonymity | LB, TLS term, WAF, routing |

> [!TIP]
> Same software (e.g. a generic HTTP proxy) can be either — the label is about **direction
> and intent**, not the binary. "Forward = for clients reaching out; reverse = for servers
> being reached."

---

## API gateway role

An **API gateway** is an L7 reverse proxy specialized for API traffic. It is the single
entry point ("front door") for a set of backend services and offloads cross-cutting
concerns so services don't each reimplement them:

- **Routing / composition** — map external paths to internal services; sometimes aggregate
  several backend calls into one response.
- **Authentication & authorization** — validate API keys, JWTs, OAuth tokens, mTLS.
- **Rate limiting / throttling / quotas** — protect backends from overload and abuse.
- **TLS termination**, request/response transformation, protocol translation
  (e.g. REST↔gRPC, HTTP/1.1↔HTTP/2 to the backend).
- **Observability** — centralized logging, metrics, tracing, request IDs.

**Gateway vs plain load balancer:** a load balancer answers "which healthy backend gets
this connection?"; a gateway answers that *plus* "is this caller allowed, within quota, and
does the request need transforming/authenticating first?" A gateway is API-aware policy; an
LB is traffic distribution.

**Gateway vs service mesh:** an API gateway handles **north–south** traffic (external
clients → cluster edge). A service mesh (sidecar proxies) handles **east–west** traffic
(service ↔ service inside the cluster). They complement each other; the gateway is the
edge, the mesh is the interior.

> [!WARNING]
> Don't put business logic in the gateway. It becomes a shared bottleneck and a deployment
> chokepoint ("distributed monolith at the edge"). Keep it to cross-cutting concerns.

---

## L4 load balancing (transport layer)

An **L4** load balancer operates at the transport layer (TCP/UDP). It makes its forwarding
decision using the **4-tuple** (source IP, source port, dest IP, dest port) plus protocol,
without parsing the application payload. It is **connection-** or **packet-oriented** and
**opaque** to what's inside.

**Characteristics:**
- Extremely fast and low-latency; minimal per-packet work; can push huge throughput.
- Protocol-agnostic — works for HTTP, SMTP, databases, game/UDP traffic, anything on TCP/UDP.
- Cannot see hostnames, URLs, headers, or cookies (they're above L4, and encrypted if TLS).
- A backend choice is typically pinned **per connection**: once a TCP connection is pinned
  to backend B, all its packets go to B for the connection's life.
- One client TCP connection maps to one backend connection (or is forwarded verbatim).

**How it forwards** — usually one of: NAT (rewrite dest IP/port and track state), Direct
Server Return, or tunneling (encapsulate the packet, e.g. IPIP/GRE). See the NAT-vs-proxy
and DSR sections.

L4 is the right tool when the traffic isn't HTTP, when you need raw speed, when you must
pass TLS through untouched, or when you want the LB to be a lightweight packet mover rather
than a protocol endpoint.

---

## L7 load balancing (application layer)

An **L7** load balancer terminates the **application protocol** — almost always HTTP(S) —
and therefore understands requests. It reads the request line, `Host` header, path, method,
cookies, and other headers, and routes based on **content**.

**Characteristics:**
- **Content-based routing:** `Host: api.example.com` → API pool, `/images/*` → static pool,
  `/checkout` → payments pool. Header/cookie/method-based routing.
- Can modify requests/responses: rewrite paths, inject/strip headers (e.g.
  `X-Forwarded-For`), compress, cache.
- Terminates the client connection and opens its **own** connection(s) to backends, so it
  can **multiplex/pool** many client requests onto a few reusable backend connections and
  even bridge protocols (HTTP/2 in front, HTTP/1.1 to backend).
- Enables per-request load balancing: two requests on the *same* client connection can go to
  *different* backends (especially with HTTP/2 multiplexing).
- Higher CPU cost (parse + often TLS terminate), and it is a real HTTP endpoint (so it must
  handle HTTP correctly, buffering, timeouts, etc.).

> [!INTERVIEW]
> "Can an L4 load balancer route based on URL path?" — No. The path lives in the HTTP
> request line at L7 and, under HTTPS, is encrypted. An L4 LB never parses it. (One nuance:
> it *can* peek at the TLS **SNI** in the ClientHello — that's cleartext — to route by
> hostname without decrypting. That's "L4 with SNI routing," still not payload parsing.)

---

## L4 vs L7: when to use which

| Dimension | L4 | L7 |
|---|---|---|
| OSI layer | Transport (TCP/UDP) | Application (HTTP) |
| Routing key | 4-tuple (+ maybe SNI) | host, path, header, cookie, method |
| Sees payload | No (opaque/encrypted) | Yes (terminates protocol) |
| Speed / overhead | Very fast, low CPU | Slower, more CPU |
| TLS | passthrough (or SNI peek) | usually terminates |
| Protocols | any TCP/UDP | HTTP(S), gRPC, WebSocket |
| Granularity | per connection | per request |
| Health checks | TCP connect / port | HTTP status / body |
| Rewrites/headers | none | full |

**Choose L4 when:** non-HTTP protocols; raw throughput/low latency; you must not terminate
TLS (compliance/end-to-end encryption, passthrough); simple stateless distribution; you
want the LB out of the crypto path.

**Choose L7 when:** you need path/host-based routing, canary/blue-green by header, sticky
sessions by cookie, request rewriting, WAF, response caching/compression, per-request
balancing, or protocol bridging.

**Common real design:** an L4 LB at the very edge (fast, absorbs volume, handles DDoS,
DSR) fronts a fleet of L7 proxies that do the smart HTTP routing. Layering gives speed +
intelligence.

---

## Load-balancing algorithms

How the LB picks a backend from the healthy pool:

- **Round robin** — hand each new request/connection to the next backend in rotation.
  Simple and fair *only if* backends are equal and requests cost the same. Ignores actual
  load.
- **Weighted round robin** — assign weights (e.g. bigger boxes get weight 3) so stronger
  backends receive proportionally more. Good for heterogeneous hardware or gradual rollout
  (send 5% to a new version).
- **Least connections** — send to the backend with the fewest active connections. Adapts to
  uneven request durations (long-lived connections, slow requests) far better than round
  robin. **Weighted least connections** combines both.
- **Least response time / least load** — pick the backend with lowest latency (or a blended
  metric). Needs live measurement.
- **IP hash / consistent hashing** — hash the client IP (or 4-tuple, or a key) to a backend
  deterministically, so the same client keeps landing on the same backend (a form of
  session affinity that needs no cookie). **Consistent hashing** minimizes remapping when
  the pool changes size (only ~1/N keys move), which matters for cache-server pools.
- **Random / random-of-two ("power of two choices")** — pick two backends at random and
  send to the less loaded of the two; cheap and surprisingly close to optimal.

> [!TIP]
> Round robin is the classic default, but **least connections** is usually the better
> general-purpose choice when request costs or durations vary. Interviewers love the
> follow-up "why can round robin overload one node?" — because it ignores that some
> requests are slow/long-lived.

---

## TLS termination vs passthrough vs re-encryption

Three ways an LB/proxy can handle TLS:

- **TLS termination (offload):** the LB holds the certificate/private key, decrypts the TLS
  connection, and talks **plaintext HTTP** to the backends over the (trusted) internal
  network. Pros: backends offload crypto CPU, the LB can inspect/route/rewrite/cache/WAF,
  centralized cert management. Cons: traffic is cleartext inside; the LB is a high-value key
  holder; not end-to-end encrypted.
- **TLS passthrough:** the LB does **not** decrypt; it forwards the encrypted bytes to a
  backend that terminates TLS itself. Preserves true end-to-end encryption; the LB can't see
  or route on HTTP content (it can only route on 4-tuple or **SNI**). Needed for strict
  compliance/mTLS-to-backend or when the LB must stay out of the crypto path. This is inherently an L4 behavior.
- **TLS re-encryption (bridging / end-to-end):** the LB terminates the client TLS (so it can
  inspect/route at L7) **and** opens a *new* TLS connection to the backend. Content is
  visible at the LB but encrypted on both hops. Best of both when you need L7 features *and*
  encryption on the wire to backends (e.g. zero-trust internal networks). Extra CPU for two
  TLS sessions.

| | Termination | Passthrough | Re-encryption |
|---|---|---|---|
| LB decrypts? | Yes | No | Yes |
| Encrypted LB→backend? | No (plaintext) | Yes (same session) | Yes (new session) |
| LB sees HTTP content? | Yes | No | Yes |
| L7 routing/WAF/cache? | Yes | No | Yes |
| End-to-end encrypted? | No | Yes | Two hops, both encrypted |
| Backend crypto load | Low | High | High |

> [!WARNING]
> With TLS termination, the internal hop is plaintext. If your threat model includes the
> internal network (zero-trust), use **re-encryption**, not plain termination.

---

## Health checks

An LB must only send traffic to **healthy** backends. It probes them and removes failing
ones from rotation, re-adding them when they recover.

- **Active health checks:** the LB proactively probes on an interval.
  - **L4 check:** open a TCP connection to the port (or send a UDP probe). Confirms the port
    is listening — but a process can accept connections while being unable to serve requests.
  - **L7 check:** send an HTTP request (e.g. `GET /healthz`) and require a specific status
    (200) and/or body. Much more meaningful — verifies the app actually works, DB reachable,
    etc.
- **Passive health checks (outlier detection):** infer health from real traffic — e.g. if a
  backend returns 5xx or times out N times, eject it temporarily. No probe overhead; reacts
  to real failures.
- **Key parameters:** interval, timeout, **unhealthy threshold** (consecutive failures to
  eject) and **healthy threshold** (consecutive successes to re-add). Thresholds add
  hysteresis so a single blip doesn't flap a node in and out.

> [!TIP]
> Distinguish a **liveness** check ("is the process up?") from a **readiness/deep** check
> ("can it serve — dependencies OK?"). A health endpoint that also pings critical
> dependencies catches "up but broken" backends that a bare TCP check misses — but make it
> cheap, or the check itself becomes a load source and a cascading-failure risk.

---

## Sticky sessions (session affinity)

**Sticky sessions** pin a given client to the same backend across multiple requests. Needed
when a backend holds **local session state** (in-memory session, local cache, a
long-running upload/WebSocket) that other backends don't share.

Mechanisms (L7):
- **Cookie-based affinity:**
  - *LB-inserted cookie* — the LB sets its own cookie (e.g. identifying backend B) and reads
    it on later requests to route back to B. The app doesn't need to know.
  - *Application cookie* — the LB keys affinity off an existing app cookie (e.g. a session
    id).
- **Source-IP affinity (L4):** hash client IP to a backend. Simple, but breaks when many
  clients share one IP (corporate NAT/CGNAT → one backend gets everyone) and when a client's
  IP changes (mobile).

**Trade-offs / gotchas:**
- Stickiness undermines even load distribution and complicates **draining/scaling**: when a
  sticky backend dies, its clients lose their session state anyway.
- Affinity duration and what happens on backend failure both matter.

> [!INTERVIEW]
> The senior answer: sticky sessions are a **crutch for stateful backends**. Prefer
> **stateless services** with session state in a shared store (Redis/DB) or a signed cookie
> (client-held). Then any backend can serve any request and you can load balance freely,
> deploy without draining sessions, and scale horizontally. Reach for stickiness only when
> you truly can't externalize state (e.g. WebSocket connections, which are inherently pinned
> to one backend for the connection's life).

---

## X-Forwarded-For and the Forwarded header

When a reverse proxy/LB terminates the client connection, the backend sees the **proxy's**
source IP, not the client's. To preserve the real client IP (for logging, geo, rate
limiting, ACLs), proxies inject headers:

- **`X-Forwarded-For` (XFF):** de-facto standard, comma-separated list of IPs. Each proxy
  **appends** the address it received the request from, building a left-to-right chain:
  `X-Forwarded-For: <client>, <proxy1>, <proxy2>`. The **leftmost** is (claimed to be) the
  original client; each hop to the right is the next proxy.
- Companions: **`X-Forwarded-Proto`** (`http`/`https` the client used — important after TLS
  termination so the app knows the client was on HTTPS), **`X-Forwarded-Host`**,
  **`X-Forwarded-Port`**.
- **`Forwarded`** (RFC 7239) is the standardized single header replacing the ad-hoc `X-`
  set:
  `Forwarded: for=192.0.2.60;proto=http;by=203.0.113.43`, and can carry multiple `for=`
  entries for a chain. Adopted less widely than XFF in practice.

> [!WARNING]
> **XFF is client-controllable and trivially spoofable.** A client can send
> `X-Forwarded-For: 1.2.3.4` and, if you blindly trust the leftmost value for security
> (IP allowlists, rate limits), you've been fooled. Trust XFF **only** from proxies you
> control, and derive the real client by counting a known number of trusted hops from the
> right (or configure trusted-proxy CIDRs). The address your edge actually received the
> packet from — the L4 peer — is the only truly trustworthy source IP.

---

## Direct Server Return (DSR)

**Direct Server Return** (a.k.a. direct routing / DR mode) is an L4 technique where request
traffic goes **client → LB → backend**, but the backend sends the response **directly back
to the client**, bypassing the LB on the return path.

**How it works:** the LB forwards the request packet without rewriting the destination IP
(often via L2 MAC rewrite or L3 tunneling like IPIP/GRE). Each backend is configured with
the **service VIP** on a loopback (non-ARPing) interface, so it accepts packets addressed to
the VIP and sends replies with the VIP as the source IP straight to the client.

**Why:** in many workloads (streaming, downloads, video) responses are far larger than
requests. Keeping the response off the LB removes it as a bandwidth bottleneck and lets it
scale to enormous throughput — it only handles the small inbound half.

**Limitations / gotchas:**
- The LB never sees responses, so it **can't do L7 processing, response rewriting, or
  connection-level tracking of the reply** — DSR is inherently L4.
- Requires specific network topology (backends and LB on the same L2 segment for MAC-rewrite
  DSR, or tunneling) and loopback VIP + ARP suppression on backends.
- Health checking and connection state are trickier since the LB sees only one direction.

---

## NAT mode vs proxy mode

Two fundamentally different ways an intermediary forwards traffic:

**NAT mode (L4, packet-level):** the LB rewrites packet headers and forwards packets. It's a
router-with-a-twist, tracking connection state in a table.
- **Destination NAT (DNAT):** rewrite the dest IP/port from VIP → chosen backend on the way
  in; rewrite it back on the way out. Replies **must** traverse the LB (so it can un-NAT),
  which means the LB (or the backend's default route pointing at it) is on the return path.
- The backend often sees the **client's real source IP** (in one-arm DNAT-only setups) — a
  plus for logging.
- Low overhead: no connection termination, no payload parsing. But return traffic through
  the LB can be a bottleneck (unlike DSR).

**Proxy mode (full proxy, connection-level):** the LB **terminates** the client's TCP
connection and opens a **separate** TCP connection to the backend. There are two independent
connections stitched together.
- The backend sees the **LB's** IP as source (hence the need for `X-Forwarded-For`).
- Enables connection pooling/multiplexing, buffering (absorb slow clients), independent
  TCP tuning per side, TLS termination, and all L7 features.
- Higher resource cost (state + buffers for two connections each), but far more capable.
  This is how every L7 proxy works.

| | NAT mode | Proxy (full-proxy) mode |
|---|---|---|
| Layer | L4 | L4-terminate or L7 |
| Connections | one, packets rewritten | two separate connections |
| Backend sees source | client IP (typ.) | LB IP (use XFF) |
| Return path | via LB (to un-NAT) | via LB (owns the connection) |
| L7 features | none | full |
| Overhead | low | higher |

> [!KEY-TAKEAWAY]
> Three L4 forwarding styles, by return path and rewriting: **NAT** (LB rewrites dest,
> replies return through LB), **DSR** (LB forwards, replies bypass LB), and **full proxy**
> (LB owns both connections). Proxy mode is the only one that unlocks L7.

---

## Common follow-up questions

- **"Difference between a load balancer and a reverse proxy?"** Every load balancer that
  terminates connections is a reverse proxy; not every reverse proxy load-balances (a single
  reverse proxy can front one backend for TLS/caching). "Load balancer" emphasizes
  distribution across a pool; "reverse proxy" emphasizes the intermediary role.
- **"Why can't an L4 LB do path-based routing?"** The path is in the HTTP request at L7 and
  is encrypted under HTTPS; L4 only sees the 4-tuple. It can at most peek at TLS SNI.
- **"How do you preserve the client IP through a proxy?"** L7: `X-Forwarded-For`/`Forwarded`
  (only trusted from your own proxies). L4: NAT mode or DSR can keep the real source IP; or
  use the PROXY protocol to carry it out-of-band to the backend.
- **"When would you terminate TLS at the LB vs pass it through?"** Terminate for L7 features
  and to offload backend CPU; pass through for end-to-end encryption/compliance; re-encrypt
  when you need both.
- **"Round robin vs least connections?"** Round robin ignores load and can overload a node
  when request durations vary; least connections adapts to that.
- **"How do sticky sessions hurt you?"** Uneven load, painful draining/scaling, lost state on
  failure — prefer stateless backends with shared session storage.
- **"What breaks source-IP stickiness?"** Shared NAT/CGNAT (many clients, one IP → one
  backend) and clients whose IP changes (mobile roaming).
- **"Why DSR?"** Asymmetric traffic (big responses) — keep the response off the LB so it
  isn't the bandwidth bottleneck; cost is losing L7 and reverse-path visibility.

## References

- RFC 9293 — Transmission Control Protocol (TCP)
- RFC 9110 — HTTP Semantics
- RFC 9112 — HTTP/1.1 (message framing, `CONNECT`)
- RFC 9113 — HTTP/2
- RFC 9114 — HTTP/3; RFC 9000 — QUIC
- RFC 8446 — TLS 1.3 (incl. SNI in ClientHello, `server_name` extension per RFC 6066)
- RFC 6066 — TLS Extensions (Server Name Indication)
- RFC 7239 — Forwarded HTTP Extension (standardized `Forwarded` header)
- RFC 6455 — The WebSocket Protocol (long-lived connections and stickiness)
- HAProxy PROXY protocol specification (carrying original client address to backends)
- Cloudflare / NGINX / Envoy documentation — reverse proxy, L4/L7 load balancing, TLS
  termination vs passthrough, health checks, session affinity (conceptual references)
