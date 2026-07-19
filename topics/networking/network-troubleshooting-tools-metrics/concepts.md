# Network Troubleshooting, Tools & Metrics

Diagnosing a network problem is about **localizing the fault to a layer and a hop**, then
using the right tool to confirm the hypothesis. This topic covers a systematic diagnostic
method, the standard command-line toolbox (ping, traceroute, dig, ss/netstat, tcpdump,
curl, mtr, nc), how to read socket states (especially `TIME_WAIT`/`CLOSE_WAIT`), and the
performance metrics interviewers expect you to define precisely — latency vs bandwidth vs
throughput vs goodput, RTT, jitter, packet loss, MTU/PMTUD, and bufferbloat.

> [!KEY-TAKEAWAY]
> Troubleshooting is layered fault isolation. Ask: *is it a name-resolution problem
> (DNS), a reachability/routing problem (L3), a transport problem (TCP handshake/reset),
> or an application problem (HTTP status/TLS)?* Each layer has a canonical tool. Metrics
> matter because "slow" is ambiguous — a high-bandwidth link can still feel slow if
> latency, loss, or bufferbloat is high.

## Systematic Layered Diagnosis

The reliable way to debug a network issue is to walk the layers, not guess. Two
complementary directions:

- **Bottom-up** (start at the physical/link layer, work up): link up? IP assigned?
  default gateway reachable? DNS resolves? TCP connects? TLS completes? HTTP responds?
  Good when you suspect infrastructure ("nothing works").
- **Top-down** (start at the application, work down): app error → is it HTTP 5xx or a
  connection failure? → does `curl` to the IP work (bypass DNS)? → does the TCP port
  accept? → is the route/host reachable? Good when "one app is broken" but the box is
  otherwise healthy.

A pragmatic checklist mapped to tools:

| Layer | Question | Tool |
|---|---|---|
| L2/L3 local | Do I have an IP + gateway? | `ip addr`, `ip route` |
| L3 reachability | Can I reach the host / where does it break? | `ping`, `traceroute`, `mtr` |
| Name resolution | Does the name resolve, and to what? | `dig`, `nslookup` |
| L4 transport | Does the port accept a TCP connection? | `nc -vz`, `ss`, `curl` |
| L7 application | Does the service answer correctly? | `curl -v`, browser devtools |
| Wire truth | What is actually on the wire? | `tcpdump`, Wireshark |

> [!TIP]
> Isolate variables one at a time. `curl https://api.example.com` failing tells you little;
> `curl --resolve api.example.com:443:203.0.113.10 https://api.example.com` (pin the IP,
> bypass DNS) vs `dig api.example.com` vs `nc -vz 203.0.113.10 443` splits DNS, routing,
> and the listener into separate, testable questions.

**Change correlation.** Most outages follow a change: a deploy, a DNS TTL expiry, a cert
rotation, a firewall/security-group edit, a BGP/route change. "What changed?" is often
faster than any packet capture.

## ping — ICMP Echo and RTT

`ping` sends **ICMP Echo Request** (type 8 for IPv4, type 128 for ICMPv6) and measures the
time until the matching **Echo Reply** (type 0 / 129) returns — that is the **round-trip
time (RTT)**. It answers "is the host reachable, and how far away (in time) is it?"

```
$ ping -c 4 example.com
64 bytes from 93.184.216.34: icmp_seq=1 ttl=56 time=11.3 ms
64 bytes from 93.184.216.34: icmp_seq=2 ttl=56 time=11.1 ms
...
4 packets transmitted, 4 received, 0% packet loss
rtt min/avg/max/mdev = 11.1/11.4/11.9/0.31 ms
```

What to read:
- **`time=`** — RTT for that probe. Rising or wildly varying times signal congestion or
  an overloaded host.
- **packet loss %** — dropped probes. Occasional loss to a router is often
  **deprioritized ICMP**, not a real fault; end-to-end loss to the *destination* matters
  more.
- **`ttl=`** in the reply hints at hop distance (reply TTL started at 64/128/255 and was
  decremented once per router).
- **`mdev`/jitter** — variation in RTT.

> [!WARNING]
> "Ping fails" does **not** mean "host is down." Many hosts/firewalls drop ICMP Echo by
> policy while still serving TCP/UDP traffic. Confirm with a transport-level probe
> (`nc -vz host port` or `curl`) before concluding the host is dead. Conversely,
> ping succeeding only proves L3 reachability, not that the application works.

ICMP also carries control messages you'll see elsewhere: **Time Exceeded** (used by
traceroute), **Destination Unreachable** (port/host/net unreachable), and **Fragmentation
Needed** (type 3 code 4, central to PMTUD).

## traceroute and tracert — TTL-Based Hop Discovery

`traceroute` (Unix) / `tracert` (Windows) maps the path to a destination by exploiting the
**IP TTL** field. It sends probes with **TTL=1, then 2, then 3, …**. Each router
decrements TTL; when TTL hits 0 the router discards the packet and returns an **ICMP Time
Exceeded (type 11)** message, revealing that hop's address. When a probe finally reaches
the destination, the response type changes and the trace ends.

Probe type differences:
- **Unix `traceroute`** defaults to **UDP** to high, unlikely ports (destination replies
  with ICMP Port Unreachable to signal arrival). `-I` uses ICMP Echo; `-T` uses TCP SYN
  (great for firewalled paths — target a real open port like 443).
- **Windows `tracert`** uses **ICMP Echo** by default.

```
$ traceroute example.com
 1  192.168.1.1      0.9 ms   0.8 ms   0.7 ms
 2  10.0.0.1         8.1 ms   8.3 ms   8.0 ms
 3  * * *                         <- hop not responding to probes (often filtered)
 4  203.0.113.9     19 ms   18 ms   20 ms
 5  93.184.216.34   21 ms   21 ms   22 ms
```

Reading it:
- **`* * *`** = no ICMP Time Exceeded came back from that hop. Usually the router
  **deprioritizes or filters ICMP**, *not* that the path is broken — if later hops
  respond, traffic is passing through fine.
- **Latency that rises then plateaus** is normal (farther hops). Latency that **spikes at
  one hop and stays high for all subsequent hops** points to congestion/queueing at that
  hop.
- A single hop showing high RTT while the *next* hop is low again is usually just that
  router's slow control-plane ICMP handling — not a data-path problem.
- **Asymmetric routing**: each hop's RTT reflects the *round trip* to that hop; the return
  path may differ from the forward path, so per-hop times can look odd.

> [!TIP]
> Because each TTL value can take a different path (ECMP load balancing), classic
> traceroute can produce misleading/blended paths. **Paris traceroute** and `mtr`
> mitigate this by keeping flow-identifying fields constant.

## dig and nslookup — DNS Diagnostics

When a name won't resolve — or resolves to the wrong thing — use `dig` (preferred, scriptable)
or `nslookup`.

```
$ dig +noall +answer example.com A
example.com.  3600  IN  A  93.184.216.34
```

Key `dig` moves:
- **`dig example.com A` / `AAAA` / `MX` / `NS` / `TXT` / `CNAME`** — query a specific
  record type.
- **`dig @8.8.8.8 example.com`** — query a *specific* resolver (compare your resolver vs a
  public one to spot a poisoned/stale local cache).
- **`dig +trace example.com`** — walk delegation from the root → TLD → authoritative,
  bypassing the recursive cache; pinpoints *where* delegation breaks.
- **`dig +short`** — just the answer; **`+noall +answer`** — clean answer section.
- The **status** in the header matters: `NOERROR` (ok), `NXDOMAIN` (name does not exist),
  `SERVFAIL` (resolver/authoritative failure, often DNSSEC or upstream timeout).
- **TTL** in the answer tells you how long it will be cached — critical when debugging a
  change that "hasn't propagated" (you're seeing a cached record until TTL expires).

> [!WARNING]
> `nslookup` and `dig` use the OS *resolver library differently* from your application.
> In particular, they may bypass `/etc/hosts`, `nsswitch.conf` ordering, and
> `systemd-resolved` caching that your app honors. If `dig` resolves but the app can't,
> suspect the host's stub resolver / hosts file / search-domain configuration, and try
> `getent hosts <name>` which *does* use the nsswitch path.

`nslookup` is interactive/legacy and prints a "Non-authoritative answer" when the reply
came from a cache rather than the zone's authoritative server — a useful distinction.

## netstat and ss — Sockets and Connection States

These list the host's sockets: what's **listening**, what's **connected**, to whom, and in
which **TCP state**. `ss` (from iproute2) is the modern, faster replacement for the
deprecated `netstat`.

```
$ ss -tanp
State    Recv-Q  Send-Q   Local Address:Port    Peer Address:Port
LISTEN   0       128      0.0.0.0:443           0.0.0.0:*
ESTAB    0       0        10.0.0.5:443          203.0.113.7:52344
TIME-WAIT 0      0        10.0.0.5:443          203.0.113.7:51002
```

Common flags (`ss` and `netstat` overlap): `-t` TCP, `-u` UDP, `-a` all (incl. listening),
`-n` numeric (don't resolve names/ports — faster, clearer), `-l` listening only,
`-p` show owning process.

What the queues mean:
- **`Recv-Q`** on a **LISTEN** socket = current **accept-queue backlog** (completed
  handshakes waiting for `accept()`); if it's near `Send-Q` (the backlog limit), the app
  isn't accepting fast enough → connections dropped/reset.
- **`Recv-Q`** on an established socket = bytes received but not yet read by the app.
- **`Send-Q`** = bytes sent but not yet ACKed (or queued to send). Persistent large
  `Send-Q` suggests the peer isn't reading (its receive window is closed) or the network
  is dropping.

Use it to answer: "Is the service even listening on that port/interface?" (LISTEN on
`0.0.0.0` vs `127.0.0.1` is a classic "works locally, not remotely" bug), and "how many
connections, in what states, to which peers?"

## Interpreting TIME_WAIT and CLOSE_WAIT Buildup

These two states are the single most common `ss` finding in interviews, and they mean
**opposite** things.

**`TIME_WAIT`** appears on the side that **actively closed** (sent the first FIN). After
the final ACK, that socket lingers for **2×MSL** (Maximum Segment Lifetime; typically
~60s total on Linux, i.e. MSL≈30s) before being freed.

- **Why it exists:** (1) ensure the final ACK is delivered so the peer can fully close
  (if it's lost, the peer resends FIN and this socket must still be around to re-ACK); (2)
  let any **delayed/duplicate segments** from this connection die out before the same
  4-tuple can be reused, preventing old data from corrupting a new connection.
- **Buildup meaning:** *lots* of `TIME_WAIT` is usually **normal** on a busy client/proxy
  that opens and closes many short-lived connections. It's a symptom of **high connection
  churn**, not a bug. It only becomes a problem if it exhausts **ephemeral ports** (a
  single client IP→server IP:port can run out of source ports) — the fix is
  **connection reuse (keep-alive / pooling)**, not blindly disabling `TIME_WAIT`.
- **Tuning:** `net.ipv4.tcp_tw_reuse=1` lets the kernel reuse `TIME_WAIT` sockets for new
  *outbound* connections safely (uses TCP timestamps). Avoid the old `tcp_tw_recycle`
  (removed in modern kernels — it broke NAT).

**`CLOSE_WAIT`** appears on the side that **received a FIN** (the peer closed) but whose
**application has not yet called `close()`**. The kernel is waiting for the app to close
its end.

- **Buildup meaning:** growing `CLOSE_WAIT` almost always indicates an **application bug**
  — the code isn't closing sockets/file descriptors after the peer hangs up (leaked
  connections, a connection pool that never reaps, missing `close()` in an error path).
  It won't clear on its own and eventually **exhausts file descriptors**.

> [!INTERVIEW]
> "You see thousands of `TIME_WAIT` vs thousands of `CLOSE_WAIT` — which worries you?"
> Answer: **`CLOSE_WAIT`**. `TIME_WAIT` is the kernel doing its job on the closing side
> and self-clears after 2×MSL; mass `CLOSE_WAIT` means *your application* is leaking
> sockets by not calling `close()` and will run out of FDs. Name which side each state
> lives on (active-closer = TIME_WAIT; passive/received-FIN = CLOSE_WAIT).

## tcpdump and Wireshark — Packet Capture and Filtering

When higher-level tools disagree with reality, capture the packets. `tcpdump` is the CLI
capture tool; **Wireshark** is the GUI analyzer (with `tshark` as its CLI). They use the
**BPF (Berkeley Packet Filter)** syntax for *capture* filters.

```
$ tcpdump -i eth0 -nn 'tcp port 443 and host 203.0.113.7' -c 100 -w cap.pcap
```

- **`-i`** interface (`any` for all), **`-nn`** don't resolve host *or* port names,
  **`-w file`** write raw pcap (open later in Wireshark), **`-r file`** read a pcap,
  **`-c N`** stop after N packets, **`-s0`** full packet (default snaplen is already full
  on modern versions), **`-A`/`-X`** ASCII/hex payload.
- **Capture filter** (BPF, applied in kernel, cheap): `host`, `net`, `port`,
  `src`/`dst`, `tcp`, `udp`, `icmp`, `and`/`or`/`not`, e.g.
  `'tcp[tcpflags] & tcp-syn != 0'` to catch SYNs.
- **Display filter** (Wireshark/tshark only, richer, applied after capture):
  `http.request.method == "POST"`, `tcp.flags.reset == 1`, `dns.qry.name`,
  `tcp.analysis.retransmission`. *Different syntax from BPF capture filters* — a common
  gotcha.

What captures reveal that nothing else can: **who sent the RST** (server refusing vs
firewall injecting), **retransmissions/dup-ACKs** (loss), **TLS handshake failures**
(which side sent the alert, cipher/SNI mismatch), **zero-window** advertisements (receiver
stalled), and **actual MSS/MTU** negotiated.

> [!TIP]
> Capture filters cost CPU/loss to *not* apply, but you can't re-filter what you didn't
> capture. On a busy host, capture broadly to a file (`-w`) with a size/count limit, then
> slice it with Wireshark display filters offline.

## curl -v and Application-Layer Debugging

`curl -v` is the fastest way to see the whole request/response conversation for HTTP(S),
including the DNS, TCP, and TLS steps it walks through.

```
$ curl -v https://example.com/
*   Trying 93.184.216.34:443...
* Connected to example.com (93.184.216.34) port 443
* TLS 1.3 handshake, cipher TLS_AES_256_GCM_SHA384
* Server certificate: CN=example.com; expire date: ...
> GET / HTTP/2
> Host: example.com
> user-agent: curl/8.x
>
< HTTP/2 200
< content-type: text/html
```

`* ` lines are curl's diagnostics (connection/TLS), `> ` are request headers sent, `< ` are
response headers received. High-value flags:
- **`--resolve host:port:IP`** — pin the name to an IP, bypassing DNS (test a specific
  backend or a not-yet-live record).
- **`-I`** HEAD only (headers), **`-L`** follow redirects, **`-H`** add a header,
  **`--http1.1`/`--http2`/`--http3`** force a version.
- **`-k`/`--insecure`** skip cert validation (to prove a problem is TLS-trust vs
  connectivity — never in prod clients).
- **`-w '%{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total}\n'`**
  — a **latency breakdown**: DNS vs TCP connect vs TLS vs time-to-first-byte vs total.
  This alone often localizes "slow" to a phase.
- **`--trace-time`**, **`-o /dev/null -s`** for timing without body noise.

`curl` distinguishes failure modes precisely: `Could not resolve host` (DNS),
`Connection refused` (RST — nothing listening / firewall reject), `Connection timed out`
(no route/dropped SYNs), `SSL certificate problem` (TLS trust), and any HTTP status
(the app answered).

## mtr and nc — Continuous Path and Swiss-Army Tools

**`mtr`** (My Traceroute) = `ping` + `traceroute` combined and run **continuously**. It
sends repeated probes and shows **per-hop loss % and latency stats (last/avg/best/worst/
stddev)** updating live — far better than a one-shot traceroute for **intermittent** loss.

```
$ mtr -rwzbc 100 example.com
 Host                     Loss%  Snt  Last  Avg  Best  Wrst StDev
 1. 192.168.1.1            0.0%  100   0.8   0.9   0.7   3.1  0.2
 2. 10.0.0.1               0.0%  100   8.0   8.2   7.9  12.0  0.6
 3. 203.0.113.9            2.0%  100  18.5  19.1  18.0  40.2  2.1
 4. 93.184.216.34          0.0%  100  21.0  21.3  20.8  30.1  1.0
```

Reading `mtr`: **loss that appears at an intermediate hop but is 0% at the final hop is
NOT real end-to-end loss** — that router is just rate-limiting ICMP to itself. **Loss that
starts at a hop and persists through every subsequent hop (including the destination)** is
real forward-path loss at/after that hop.

**`nc` (netcat)** = raw TCP/UDP swiss-army knife:
- **`nc -vz host 443`** — is the TCP port open? (`-z` scan/zero-I/O, `-v` verbose,
  `-u` for UDP). The cleanest "does the listener accept?" test — no application protocol
  needed.
- **`nc -l 8080`** — listen on a port (spin up a fake server to test firewall/routing).
- **`nc host 25`** then type — speak a text protocol (SMTP/HTTP) by hand.
- Pipe files across a link to measure raw throughput.

## Latency, Bandwidth, Throughput, and Goodput

Interviewers want these defined **precisely and distinctly** — conflating them is the most
common mistake.

| Term | Definition | Unit | Analogy (highway) |
|---|---|---|---|
| **Bandwidth** | *Capacity*: max bits/sec the link *could* carry | bps | number of lanes |
| **Throughput** | *Achieved* bits/sec actually delivered | bps | cars/sec actually passing |
| **Goodput** | Application-*useful* bytes/sec (excludes headers, retransmits, ACKs, TLS/proto overhead) | bps | passengers/sec (not the cars themselves) |
| **Latency** | *Delay*: time for one bit/message to travel end to end | seconds | how long one car's trip takes |

- **Bandwidth ≠ throughput.** A 1 Gbps link rarely delivers 1 Gbps — TCP overhead, loss,
  window limits, and contention reduce it. Throughput ≤ bandwidth always.
- **Goodput ≤ throughput** because throughput counts *all* bytes on the wire (Ethernet/IP/
  TCP/TLS headers, retransmitted segments, pure ACKs) while goodput counts only the
  payload the application consumes.
- **Latency and bandwidth are independent.** A satellite link can have huge bandwidth and
  terrible latency; adding bandwidth does nothing for a latency-bound workload.

**Bandwidth-Delay Product (BDP)** = bandwidth × RTT = the amount of data "in flight" to
keep a pipe full. TCP needs a **window ≥ BDP** to saturate a link. Example: 1 Gbps × 80 ms
RTT = 10⁹ × 0.08 / 8 = **10 MB** of window needed — far above the default 64 KB, which is
why **window scaling** (RFC 7323) exists. On high-BDP ("long fat") links, a too-small
window caps throughput regardless of bandwidth.

> [!KEY-TAKEAWAY]
> Latency is often the real bottleneck for interactive apps. Because TCP setup, TLS, and
> each request/response cost round trips, throughput on a single connection is roughly
> `window / RTT` (until loss kicks in). Halving RTT can matter more than doubling
> bandwidth. This is the whole motivation for CDNs, connection reuse, and QUIC's 0-/1-RTT.

## RTT, Jitter, and Packet Loss

- **RTT (Round-Trip Time):** time for a packet to reach the peer and its reply to return.
  Drives TCP's retransmission timeout (RTO), congestion-window growth (per-RTT), and
  perceived interactivity. One-way delay = ~RTT/2 only if the path is symmetric (often it
  isn't).
- **Jitter:** the **variation** in latency (delay variance) between packets. Average
  latency can be fine while jitter wrecks **real-time media** (VoIP, video, gaming), which
  rely on **jitter buffers** to smooth arrival — a buffer trades a little added latency
  for steady playout. High jitter usually comes from variable queueing (congestion,
  bufferbloat, Wi-Fi contention).
- **Packet loss:** fraction of packets that never arrive. Causes: congestion (queue
  overflow — the dominant cause), bit errors (wireless), policing/rate limits, and
  faulty hardware.
  - For **TCP**, loss is a **congestion signal**: it triggers retransmission and
    **shrinks the congestion window**, so even ~1% loss can **collapse throughput**
    (the Mathis approximation: throughput ∝ `MSS / (RTT × √p)` for loss probability `p`)
    — high-RTT paths are hit hardest.
  - For **UDP/real-time**, lost packets are usually **not** retransmitted (too late to be
    useful); the app conceals loss (PLC, FEC) or degrades quality.

> [!WARNING]
> Retransmission is *not* free throughput recovery: retransmitted bytes count against
> throughput but never against goodput, and TCP's loss response (halving cwnd) means the
> visible effect of loss is disproportionately large. "The link is only 1% lossy" can
> still mean a 5–10× throughput drop on a long-RTT flow.

## MTU, PMTUD, and Fragmentation

- **MTU (Maximum Transmission Unit):** the largest L3 payload a link can carry in one
  frame. Classic Ethernet MTU = **1500 bytes**; jumbo frames ≈ 9000; tunnels (VPN, GRE,
  IPsec, PPPoE) *reduce* the effective MTU because they add encapsulation headers.
- **MSS (Maximum Segment Size):** the TCP payload size, negotiated in SYN options.
  Roughly `MSS = MTU − IP header − TCP header` = 1500 − 20 − 20 = **1460** on standard
  IPv4 Ethernet. MSS keeps TCP segments from needing fragmentation.
- **Fragmentation:** if an IP packet exceeds the next link's MTU, IPv4 routers historically
  fragmented it (unless the **DF — Don't Fragment — bit** is set). Fragmentation is
  inefficient and fragile (loss of one fragment loses the whole datagram; some middleboxes
  drop fragments). **IPv6 routers do NOT fragment** at all — only the source host may, and
  it relies entirely on PMTUD.
- **PMTUD (Path MTU Discovery, RFC 1191 / RFC 8201 for IPv6):** the sender sets **DF=1**;
  if a router along the path has a smaller MTU, it drops the packet and returns **ICMP
  "Fragmentation Needed / Packet Too Big" (IPv4 type 3 code 4; ICMPv6 type 2)** carrying
  the next-hop MTU. The sender then lowers its packet size.

> [!WARNING]
> **PMTUD black holes**: if a firewall blocks the ICMP "Fragmentation Needed / Packet Too
> Big" messages, the sender never learns to shrink its packets — small packets (handshake)
> succeed, but large ones (the actual data/TLS certs) are silently dropped. Classic
> symptom: **"connection establishes, small requests work, large transfers or HTTPS hang."**
> Mitigations: **MSS clamping** on the gateway (rewrite the SYN's MSS down to fit the
> tunnel), **PLPMTUD** (RFC 4821, probes MTU without relying on ICMP), or allowing the
> needed ICMP types. Never blanket-block all ICMP — it breaks PMTUD.

## Bufferbloat

**Bufferbloat** is the excess latency and jitter caused by **oversized buffers** in
routers, switches, modems, and NICs. When a buffer is too large, packets queue instead of
being dropped; TCP (which uses **loss** as its congestion signal) doesn't back off until
the buffer overflows, so the queue stays persistently full and every packet waits behind a
large backlog.

- **Symptom:** a saturated link (e.g., a big upload) drives interactive latency from ~20 ms
  to **hundreds/thousands of ms**, even with "plenty of bandwidth." Web pages, video calls,
  and games stutter *while* a download/upload runs. The classic test: run `ping`/`mtr`
  during a bulk transfer and watch RTT explode.
- **Why big buffers backfire:** buffers should absorb *bursts*, not sustained load. A
  standing queue adds pure delay with no throughput benefit ("full buffers help no one").
- **Fixes: Active Queue Management (AQM)** — **CoDel** (Controlled Delay) and **FQ-CoDel**
  target *queue sojourn time* and drop/mark early to keep queues short; **fq_codel** and
  **CAKE** are common Linux qdiscs. **ECN (Explicit Congestion Notification)** lets routers
  *mark* rather than drop. Congestion controllers like **BBR** are **latency/model-based**
  rather than loss-based, so they don't fill buffers the way CUBIC/Reno do.

> [!INTERVIEW]
> "Downloads are fast but the video call is choppy on the same link — why?" Bufferbloat: a
> full bulk-transfer queue in the modem/router adds huge queueing delay and jitter to the
> latency-sensitive flow. Diagnose by pinging during load; fix with AQM (fq_codel/CAKE),
> and/or a latency-based CC like BBR, not by buying more bandwidth.

## Common Failure Patterns

A catalog of signatures interviewers love, and how to tell them apart:

- **"Connection refused" (immediate RST):** something answered but nothing is listening on
  that port, or a firewall is set to *reject*. Nothing to do with DNS or routing —
  the SYN reached a host that sent RST. Check `ss -ltn` on the server.
- **"Connection timed out" (SYN, no reply):** SYNs are being **dropped** silently — a
  firewall/security-group *drop* rule, wrong route, or the host is down. `traceroute -T`
  to the port shows where it dies.
- **Works by IP, fails by name:** DNS problem (or wrong/stale record). `dig` vs
  `curl --resolve` splits it.
- **Establishes then hangs on large transfers / HTTPS:** **PMTUD black hole** (ICMP
  filtered) or MTU mismatch on a tunnel — small packets pass, big ones vanish. MSS-clamp.
- **Intermittent slowness/loss, one hop:** use `mtr` over time; distinguish ICMP
  rate-limiting (loss at a middle hop, clean at destination) from real loss (persists to
  the destination).
- **High latency only under load:** **bufferbloat**; ping-during-transfer confirms.
- **Growing `CLOSE_WAIT`:** app not calling `close()` — FD leak (app bug). Growing
  `TIME_WAIT`: high connection churn — add keep-alive/pooling.
- **TLS "handshake failed" / cert errors:** name/SNI mismatch, expired/untrusted cert,
  or protocol/cipher mismatch. `curl -v` (see the alert) and `openssl s_client -connect
  host:443 -servername host`.
- **Asymmetric/one-way traffic:** works in one direction only — check firewall state
  tables, NAT, and reverse-path (uRPF) filtering; capture on both ends.
- **Everything slow after a deploy/DNS change:** correlate with the change; a new record
  with a long TTL or a bad backend IP will "stick" until caches expire.

> [!TIP]
> The fastest triage is often three commands: `dig <name>` (resolution),
> `nc -vz <ip> <port>` or `curl -v` (transport + app), and `mtr <ip>` (path + loss). They
> cover DNS, L4/L7, and L3 in seconds and tell you which layer to dig into.

## Common follow-up questions

- **Why might `ping` fail but the website still load?** ICMP Echo is often filtered/dropped
  by policy while TCP 443 is open; ping only tests L3 + ICMP, not the app.
- **You see `* * *` in traceroute — is the path broken?** Not necessarily; that hop just
  isn't replying to ICMP (deprioritized/filtered). If later hops respond, traffic passes.
- **Difference between TIME_WAIT and CLOSE_WAIT, and which side owns each?** TIME_WAIT is on
  the active closer (self-clears after 2×MSL, usually benign). CLOSE_WAIT is on the side
  that received a FIN but hasn't `close()`d — an app bug that leaks FDs.
- **Bandwidth vs throughput vs goodput?** Capacity vs achieved rate vs application-useful
  rate (payload only, minus headers/retransmits/ACKs).
- **How does 1% packet loss affect a TCP flow?** Disproportionately — loss halves cwnd;
  throughput ∝ 1/(RTT·√loss), so long-RTT flows collapse.
- **Symptom: HTTPS/large transfers hang but small requests work.** PMTUD black hole — ICMP
  "Packet Too Big"/"Fragmentation Needed" is filtered; clamp MSS.
- **Downloads fast, video call choppy on the same link?** Bufferbloat; diagnose with
  ping-under-load, fix with AQM (fq_codel/CAKE) or BBR.
- **BDP and window scaling?** BDP = bandwidth × RTT = in-flight data needed to fill a pipe;
  window must be ≥ BDP, hence RFC 7323 window scaling on long-fat networks.
- **Capture vs display filters in tcpdump/Wireshark?** BPF capture filters (kernel, before
  capture) vs Wireshark display filters (richer, after capture) — different syntax.
- **How to bypass DNS to test a specific backend?** `curl --resolve host:port:IP` or
  `dig @resolver` / `nc -vz IP port`.

## References

- RFC 792 — Internet Control Message Protocol (ICMP)
- RFC 4443 — ICMPv6 for IPv6
- RFC 9293 — Transmission Control Protocol (TCP), incl. TIME_WAIT / 2×MSL, connection states
- RFC 6528 — Defending against Sequence Number Attacks (randomized ISN)
- RFC 1191 — Path MTU Discovery (IPv4); RFC 8201 — Path MTU Discovery for IPv6
- RFC 4821 — Packetization Layer Path MTU Discovery (PLPMTUD)
- RFC 7323 — TCP Extensions for High Performance (window scaling, timestamps)
- RFC 3168 — The Addition of Explicit Congestion Notification (ECN) to IP
- RFC 8289 — Controlled Delay Active Queue Management (CoDel);
  RFC 8290 — FlowQueue-CoDel (FQ-CoDel)
- RFC 1035 / 1034 — Domain Name System (DNS)
- Bufferbloat: Gettys & Nichols, "Bufferbloat: Dark Buffers in the Internet" (CACM 2012);
  bufferbloat.net
- man pages: ping(8), traceroute(8), dig(1), ss(8), tcpdump(1), curl(1), mtr(8), nc(1)
