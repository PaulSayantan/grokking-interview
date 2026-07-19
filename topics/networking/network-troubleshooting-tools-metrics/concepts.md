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

## Per-Socket TCP Internals with ss

`ss -i` (and `ss -e` for extended info) exposes the kernel's **per-connection congestion
and timing state** — the modern "look inside one socket without a capture" move. Combine
with a filter, e.g. `ss -tinp state established '( dport = :443 )'`.

```
$ ss -tin dst 203.0.113.7
ESTAB 0 0 10.0.0.5:44322 203.0.113.7:443
   cubic wscale:7,7 rto:312 rtt:11.3/2.1 mss:1448 pmtu:1500 rcvmss:1448
   cwnd:10 ssthresh:7 bytes_acked:1.2M bytes_retrans:38k
   segs_out:920 segs_in:610 data_segs_out:900
   send 10.2Mbps lastsnd:4 lastrcv:12 pacing_rate 20.4Mbps
   delivery_rate 9.8Mbps busy:820ms retrans:0/26 reordering:3 rcv_space:14480
```

Fields to read for diagnosis:
- **`cwnd`** — current congestion window (segments). A collapsed `cwnd:2` on a flow that
  should be fast means loss is repeatedly shrinking it.
- **`rtt:X/Y`** — smoothed RTT / RTT variance (ms). Feeds the **RTO**.
- **`retrans:X/Y`** — retransmits (current/total); **`bytes_retrans`** — bytes resent. High
  retrans ⇒ the *network* is dropping.
- **`ssthresh`, `rto`, `mss`, `pmtu`, `pacing_rate`, `delivery_rate`, `bytes_acked`,
  `unacked`** — window, timers, negotiated segment size, and achieved rate.
- **`lastsnd`/`lastrcv`** (ms since last send/receive) — a growing `lastsnd` with **zero
  retrans** means the *application* isn't sending (idle/blocked), not a network fault.
- **`cubic` / `bbr:(...)`** — the congestion-control algorithm in use and (for BBR) its
  bandwidth/RTT model.

> [!INTERVIEW]
> "`ss -i` shows `cwnd:2 retrans:840/1200` on a slow flow — vs a socket where `lastsnd`
> keeps growing but retrans is 0. What's the difference?" First = network loss collapsing
> the congestion window (fix the path/loss). Second = the app isn't writing data (fix the
> application or upstream dependency). This distinction is invisible to `ping`.

## eBPF Network Observability

Modern low-overhead debugging increasingly uses **eBPF** (via **bcc** and **bpftrace**,
Brendan Gregg's tools) instead of full packet captures. eBPF programs attach to kernel
tracepoints/kprobes, so they see **every connection host-wide** with per-event context and
near-zero cost — you don't have to know which flow to capture in advance.

- **`tcpconnect` / `tcpaccept`** — trace active/passive connection setups (who connected to
  what, PID, latency).
- **`tcpconnlat`** — connection-establishment latency (SYN → SYN-ACK).
- **`tcpretrans`** — live retransmissions with the socket state at the time.
- **`tcplife`** — one line per connection with duration and bytes (great for churn/goodput).
- **`tcpdrop`** — packets dropped by the kernel *with the exact stack location and reason*.
  This is the key differentiator: it tells you whether a "loss" was an app-side close, a
  RST, or a kernel drop (e.g., bad checksum, full backlog) and *where in the stack* it
  happened — something a wire capture cannot show.

Why it matters: eBPF answers "which process, which syscall, which kernel path" — root-cause
attribution that pcap (which only sees bytes on the wire) cannot provide.

## Active Throughput Measurement (iperf3, netperf)

Piping through `nc` gives a rough number; **`iperf3`** and **`netperf`** are the standard
tools for *correct* capacity/latency measurement.

- **`iperf3 -c server`** — TCP throughput; **`-R`** reverse (server→client), **`-u`** UDP
  mode (reports **loss and jitter**, since UDP won't retransmit), **`-P N`** N parallel
  streams, **`-Z`** zero-copy, **`--get-server-output`** to see both ends.
- **`netperf`**: `TCP_STREAM` (bulk), `TCP_RR`/`TCP_CRR` (request-response rate and
  connect-request-response, i.e. transaction/latency benchmarks).

Measurement pitfalls seniors are expected to know:
- **Warm past slow-start:** a short test measures ramp-up, not steady state — use a longer
  duration or omit the first seconds.
- **Single flow is window/BDP-limited and pinned to one CPU's softirq** — a 10 Gbps LAN can
  cap a single stream at ~1 Gbps. **`-P 8`** (parallel streams) plus larger socket buffers
  (`rmem_max`/`wmem_max`) exposes true link capacity.
- **UDP throughput ≠ TCP goodput:** UDP tests raw send rate + loss/jitter; TCP reflects
  congestion control.

> [!INTERVIEW]
> "Single-stream iperf3 caps at ~1 Gbps on a 10 GbE link, but `-P 8` hits ~9.4 Gbps — why?"
> One flow is limited by its window (BDP), slow-start ramp, and single-core softirq
> processing. Parallel flows spread load across CPUs/queues and aggregate more window, so
> they reveal the link's real capacity. Fix single-flow with bigger buffers/window scaling
> and RSS/RPS tuning.

## Host-Stack Drops and NIC Counters

"Packet loss" is not always in the network — the **receiving host** can drop under load.
Senior interviews probe *where in the stack* a drop happened.

- **`ip -s link`** / **`ethtool -S ethN`** — interface/driver counters: `rx_dropped`,
  `rx_missed_errors`, `rx_fifo_errors`/overruns (NIC ring buffer overflowed because the
  CPU/softirq couldn't drain it fast enough), CRC errors (cabling/L1).
- **NIC ring-buffer size** (`ethtool -g`) — too small ⇒ drops under bursty load; raise
  RX/TX ring size.
- **`/proc/net/softnet_stat`** — per-CPU softirq drops and `time_squeeze` (softirq budget
  exhausted). **`net.core.netdev_max_backlog`** caps the per-CPU input queue.
- **Socket buffer caps** (`net.core.rmem_max` / `wmem_max`, `tcp_rmem`/`tcp_wmem`) — too
  small a receive buffer closes the TCP window (zero-window) and caps throughput on high-BDP
  paths.

The interview point: an `mtr` that's clean to the destination but an app still "sees loss"
means look at the host — undersized rings, slow softirq, or capped socket buffers — not the
WAN.

## Nagle's Algorithm and Delayed ACK

A classic senior latency bug: periodic **~40 ms** stalls on small request/response traffic.

- **Nagle's algorithm (RFC 896):** to avoid flooding the network with tiny "tinygram"
  packets, TCP withholds a small write if there is **unacknowledged data outstanding**,
  coalescing until an ACK arrives or a full segment accumulates.
- **Delayed ACK (RFC 1122):** the receiver delays sending a bare ACK (up to ~40–200 ms,
  ~40 ms typical on Linux) hoping to piggyback it on response data or batch two segments.
- **The deadlock:** sender has a small segment held by Nagle (waiting for an ACK) while the
  receiver holds the ACK (waiting for more data / delayed-ACK timer). Neither moves until
  the delayed-ACK timer fires — injecting a fixed ~40 ms latency into every small
  request/response round trip. Large writes don't trigger it (they fill a full segment).
- **Fixes:** set **`TCP_NODELAY`** (disable Nagle) on latency-sensitive request/response
  sockets; **`TCP_QUICKACK`** to suppress delayed ACKs; or batch application writes so each
  request is a single `send()`.

> [!INTERVIEW]
> "An RPC shows fixed ~40 ms latency spikes on small POSTs but large uploads are fine — root
> cause?" Nagle × delayed-ACK interaction. Disable Nagle with `TCP_NODELAY` (or coalesce the
> write). The "fixed, quantized" latency (not proportional to size) is the tell.

## SYN Queue, Accept Queue, and Backlog Overflow

A listening socket has **two** distinct queues, and confusing them is a common gap:

1. **SYN queue (half-open)** — connections that received a SYN and sent SYN-ACK but haven't
   completed the handshake. Sized by **`net.ipv4.tcp_max_syn_backlog`**.
2. **Accept queue (completed)** — fully handshaked connections waiting for the app to call
   `accept()`. Sized by **`min(backlog, net.core.somaxconn)`** (the `backlog` arg to
   `listen()`).

**Overflow behavior:**
- Accept queue full ⇒ the kernel **drops the final ACK / the completed connection**
  (or, with `tcp_abort_on_overflow`, sends RST). Counter: **`ListenOverflows`** and
  **`ListenDrops`** (see `nstat -az | grep -i listen` or `netstat -s | grep -i listen`).
  On a `LISTEN` socket, `ss -ltn` `Recv-Q` = current accept-queue depth, `Send-Q` = its max.
- SYN queue full under a **SYN flood** ⇒ SYNs dropped, clients see "connection timed out".
  **`net.ipv4.tcp_syncookies=1`** lets the server respond without storing state (encoding it
  in the SYN-ACK sequence number), surviving the flood but **losing some SYN options** for
  cookie-validated connections (a trade-off).

> [!INTERVIEW]
> "Under load, some clients get 'connection timed out' while the server CPU is idle — where?"
> Accept-queue (or SYN-queue) overflow: `ListenDrops`/`ListenOverflows` climbing, `somaxconn`
> or the app's `listen()` backlog too small, or the accept loop too slow. The server is
> healthy CPU-wise but silently dropping completed connections.

## conntrack and Ephemeral-Port Exhaustion

Two modern (NAT/cloud/Kubernetes) exhaustion failures distinct from `TIME_WAIT`:

- **conntrack table full:** stateful firewalls/NAT (netfilter) track every flow in a table
  bounded by **`nf_conntrack_max`**. When full, the kernel logs
  `nf_conntrack: table full, dropping packet` and **drops new connections**. Check
  `conntrack -S` and `/proc/sys/net/netfilter/nf_conntrack_count`. Extremely common on NAT
  gateways and k8s nodes under high connection rates (and UDP DNS floods, since UDP "flows"
  linger in the table).
- **Ephemeral-port / SNAT source-port exhaustion:** a connection is identified by the
  4-tuple (src IP, src port, dst IP, dst port). Behind a NAT/LB (or many clients sharing one
  source IP), the pool of source ports (`net.ipv4.ip_local_port_range`, ~28k by default) can
  be exhausted for a given destination. Symptom: **`EADDRNOTAVAIL` / "cannot assign
  requested address."** This is distinct from `TIME_WAIT` buildup — it can happen even
  without churn if concurrency to one destination is very high. Fixes: widen the port range,
  spread across more destination IPs/ports, add source IPs, or reuse connections.

## TCP Keepalive

TCP is silent on an idle connection — neither side sends anything, so a peer that vanished
(crash, NAT/LB idle-timeout evicting the flow, cable pull) goes undetected until the next
write fails. **TCP keepalive** probes idle connections:

- **`net.ipv4.tcp_keepalive_time`** (default 7200s = 2h before the first probe),
  **`tcp_keepalive_intvl`** (probe interval), **`tcp_keepalive_probes`** (count before
  declaring dead). Must be enabled per-socket (`SO_KEEPALIVE`).
- **Why idle connections "silently die":** a NAT/firewall/LB drops the flow from its state
  table after an idle timeout (often 60–350s). Later traffic hits a middlebox with no state
  → dropped or RST → the app sees a hung or reset connection "after N minutes idle."
  Application-level keepalive/heartbeats (or lowering `tcp_keepalive_time` below the
  middlebox timeout) prevents this. Note the default 2h keepalive is *longer* than most NAT
  idle timeouts, so it often doesn't help without tuning.

## DNS Resolver Configuration and Latency

Beyond resolution *correctness*, resolver **config** and **latency** cause many modern
(cloud/Kubernetes) incidents:

- **`/etc/resolv.conf` knobs:** `search` (domains appended to unqualified names), `ndots:N`
  (if a name has fewer than N dots, try the search domains *first*), `timeout`, `attempts`,
  `rotate`.
- **The Kubernetes `ndots:5` problem:** k8s injects `ndots:5` and several search domains, so
  an external name like `api.example.com` (2 dots < 5) is first tried as
  `api.example.com.<ns>.svc.cluster.local`, `...svc.cluster.local`, `...cluster.local`, etc.
  — each an extra query (A **and** AAAA) that returns NXDOMAIN before the real lookup. Result:
  latency spikes and DNS load. Fixes: fully-qualify with a trailing dot, lower `ndots`, or
  use NodeLocal DNSCache.
- **EDNS0 buffer size, truncation (TC bit), UDP→TCP fallback:** DNS over UDP is capped by the
  advertised EDNS0 buffer; a response too large (DNSSEC, many records) sets the **TC
  (truncated) bit**, forcing the client to **retry over TCP**. If a firewall blocks DNS over
  **TCP/53**, large responses fail intermittently while small ones work.
- **Negative caching:** how long an NXDOMAIN is cached is governed by the zone's **SOA
  `MINIMUM`** field (RFC 2308), so a mistaken NXDOMAIN can "stick."

## Happy Eyeballs and Dual-Stack Racing

**Happy Eyeballs v2 (RFC 8305)** governs how dual-stack (IPv4+IPv6) clients connect: resolve
both **AAAA** and **A**, then **race** connection attempts with a short stagger (try IPv6
first, start IPv4 shortly after if IPv6 hasn't connected), using whichever completes first.
Purpose: avoid long stalls when IPv6 is broken but advertised.

Debugging relevance: on dual-stack hosts, "connect is slow/flaky" can be an IPv6 path that
black-holes — the client wastes the stagger delay before falling back to IPv4. `curl -6` /
`curl -4` forces a family to isolate it; `%{remote_ip}` in `curl -w` shows which was chosen.

## Percentiles and Tail-Latency Measurement

The Metrics section defines latency; *measuring* it well is a guaranteed senior probe.

- **Use percentiles, not averages:** report **p50/p90/p99/p99.9**. A mean hides the tail;
  one slow-but-common code path can wreck p99 while barely moving the average. Aggregate with
  **histograms** (e.g., HDR histograms), never by averaging pre-computed percentiles across
  hosts (that's mathematically invalid).
- **Coordinated omission (Gil Tene):** a load generator that waits for a response before
  sending the next request **stops the clock** during a stall, so it never records how long
  *queued* requests would have waited — dramatically under-reporting the tail. Fix: measure
  against the *intended* schedule (record latency from when a request *should* have been
  sent), or use tools that correct for it.
- **Tail at scale (Dean & Barroso):** a request that fans out to many backends waits for the
  slowest, so the **p99 of the parent ≈ driven by the tail of each dependency** — even if
  each backend's p99 is fine, fanning out to 100 of them makes a slow response likely.
  Mitigations: hedged/tied requests, fewer dependencies, tail-tolerant design.

## Little's Law and the Utilization-Latency Knee

The rigorous answer to "why does latency spike under load even below max bandwidth":

- **Little's Law:** `L = λ · W` — average concurrency (items in system) = arrival rate ×
  average time in system. Lets you derive any one from the other two (e.g., required
  concurrency = throughput × latency).
- **Utilization knee (M/M/1 queue):** average latency scales as **`W ∝ 1/(1−ρ)`** where ρ is
  utilization. Latency is nearly flat at low load but **explodes as ρ→1**: going from 60% to
  90% utilization roughly *quadruples* queueing delay; 90%→95% doubles it again. So a system
  can be far below raw bandwidth/CPU capacity yet show terrible latency because it's near the
  knee. This complements bufferbloat (queue-induced delay) with the *queuing-theory* reason.

> [!INTERVIEW]
> "Latency is fine at 60% load but terrible at 90%, and bandwidth isn't the limit — explain."
> The utilization-vs-latency knee: queueing delay ∝ 1/(1−ρ) blows up as utilization
> approaches 100%. You must run with headroom; you can't safely run a latency-sensitive
> system at 95% utilization.

## QUIC and HTTP/3 Observability

HTTP/3 rides **QUIC over UDP/443 (RFC 9000/9001/9002)**, which breaks TCP-centric tooling:

- **TCP tools miss it entirely:** `ss` TCP states and `tcpdump 'tcp port 443'` see nothing —
  capture with **`udp port 443`**. There are no TCP connection states to inspect.
- **Encrypted transport header:** QUIC encrypts most of its transport header (packet numbers,
  ACKs) plus the payload, so a raw capture is opaque. To see inside you need **qlog**
  (endpoint-emitted structured logs) or the TLS keys via **`SSLKEYLOGFILE`**.
- **Connection migration:** a QUIC connection is identified by a **Connection ID**, not the
  4-tuple, so it survives IP/port changes (Wi-Fi→cellular) — a flow you're tracking by 5-tuple
  can "move."
- **0-RTT / 1-RTT setup** and **UDP/443 blocked as a trap:** many firewalls block or
  rate-limit UDP/443; clients then **fall back to TCP (HTTP/2)**. Symptom: "HTTP/3 is slow or
  never used on this network" while HTTPS still works over TCP — check whether UDP/443 is
  actually allowed end-to-end.

## Decrypting TLS Captures

To read encrypted HTTP/2 or HTTP/3 traffic you captured, you can't rely on the wire alone —
you need the session keys:

- **`SSLKEYLOGFILE`:** point this env var at a file before launching the client (curl,
  browsers, many TLS libraries honor it). The library writes the per-session secrets there;
  load that keylog into Wireshark (TLS protocol preferences → *(Pre)-Master-Secret log
  filename*) and it decrypts the captured TLS records — including HTTP/2 frames and QUIC.
- This works because TLS 1.3 uses ephemeral (EC)DHE keys, so you *cannot* decrypt from the
  server's private key alone (no RSA key exchange to recover the session key) — the keylog is
  the practical path. For QUIC, the same keylog plus **qlog** exposes the streams.

## Reading a Capture: Handshake and Loss Signatures

**Walking a handshake in a capture:**
- Identify **SYN → SYN-ACK → ACK**. Read the **SYN options** to confirm what was negotiated:
  **MSS**, **window scale** factor (RFC 7323), **SACK-permitted** (RFC 2018), **timestamps**.
  If one side omits window scaling or SACK, that explains poor high-BDP or loss-recovery
  behavior.
- BPF flag filters: `tcp[tcpflags] & tcp-syn != 0`, `... & tcp-rst != 0`, `tcp-fin`,
  `tcp-ack`. Wireshark shows **relative** sequence numbers by default.
- Teardown: **FIN/ACK** each way (graceful) vs **RST** (abortive).

**Loss / recovery signatures (Wireshark display filters):**
- `tcp.analysis.retransmission`, `tcp.analysis.fast_retransmission` (triggered by **3
  duplicate ACKs** → fast retransmit, RFC 5681), `tcp.analysis.spurious_retransmission`
  (data was actually received — retransmit was unnecessary).
- `tcp.analysis.duplicate_ack`, `tcp.analysis.out_of_order`,
  `tcp.analysis.ack_lost_segment`, `tcp.analysis.zero_window` / `window_full` (receiver
  stalled), `tcp.analysis.rto`.
- **SACK (RFC 2018)** lets the receiver acknowledge non-contiguous blocks so the sender
  retransmits only the missing segments; **D-SACK (RFC 2883)** reports a *duplicate* segment
  the receiver already had — the signature of **reordering or a spurious retransmit** (not
  real loss). Telling loss from reordering from a stalled receiver is exactly this: retransmit
  vs D-SACK vs zero-window.

## RST Diagnosis and Connection-Timeout Timing

**Who sent the RST and why** — a taxonomy the earlier RST note doesn't fully give:
- **RST to a SYN** on a closed port ⇒ connection **refused** (nothing listening / reject
  rule).
- **RST on an ESTABLISHED connection** ⇒ an abort: the app called abortive close
  (`SO_LINGER 0`), an **LB/firewall idle-timeout** reset a flow it evicted, a **half-open**
  peer that lost state resets on the next segment, or the OS killed an **orphaned** socket.
- **Middlebox/censorship RST injection** — a device forges a RST with the connection's
  addresses to tear it down. TCP only accepts a RST whose **sequence number is within the
  current receive window** (RFC 9293), so out-of-window injected RSTs are ignored — a clue
  when diagnosing whether a RST is genuine.

**Why a "connection timed out" takes the time it does (retransmit backoff):**
- Unanswered **SYN**s are retried per **`net.ipv4.tcp_syn_retries`** with **exponential
  backoff** (1s, 2s, 4s, …), so the default ~6 retries take on the order of **~127 s+**
  before failing. That's why a firewalled/dead host "times out" after a long, specific delay
  rather than instantly.
- For an **established** connection, **`net.ipv4.tcp_retries2`** (default 15) governs how many
  retransmits before the kernel gives up; **RTO** starts from RTT (RFC 6298) and doubles each
  loss. Seniors reason about the *duration* of a failure, not just its category.

## TCP States Beyond TIME_WAIT and CLOSE_WAIT

Rounding out the connection state machine (RFC 9293) beyond the two "buildup" states:

- **`SYN_SENT`** — client sent SYN, awaiting SYN-ACK. Sockets **stuck** here mean SYNs aren't
  being answered (dropped/filtered path or dead peer).
- **`SYN_RECV`** — server sent SYN-ACK, awaiting the final ACK (half-open). A pile of these
  suggests a **SYN flood** or lost final ACKs.
- **`FIN_WAIT_1`** — sent FIN, awaiting its ACK. **`FIN_WAIT_2`** — our FIN was ACKed, now
  waiting for the peer's FIN; a buildup of **FIN_WAIT_2 on the active closer** mirrors
  **CLOSE_WAIT on the peer** — the remote app received our FIN but isn't calling `close()`.
- **`LAST_ACK`** — passive closer sent its FIN and awaits the final ACK before fully closing.
- **`CLOSING`** — simultaneous close (both sent FIN before ACKing).

> [!INTERVIEW]
> "Server shows growing `CLOSE_WAIT`, client shows growing `FIN_WAIT_2` — what's each side
> doing?" The client actively closed (FIN sent, ACKed → FIN_WAIT_2) and is waiting for the
> server's FIN; the server received the FIN (CLOSE_WAIT) but its application never called
> `close()`. Same root cause — the server app is leaking sockets — seen from both ends.

## One-Way Delay, Asymmetry, and Loss Types

- **One-way delay ≠ RTT/2** when routing is **asymmetric** (forward and return paths differ),
  which is common on the Internet. Measure one-way delay directly with **OWAMP (RFC 4656)**
  or round-trip-but-symmetric-capable **TWAMP (RFC 5357)**; these need synchronized clocks
  (e.g., PTP/NTP) for one-way accuracy.
- **Reverse-path filtering (uRPF)** can drop packets whose source address doesn't match the
  route back out an interface — a cause of one-way-only connectivity.
- **Policing vs congestion loss:** **policing** enforces a hard rate cap and *drops* any
  bursts above it (even when the link isn't congested), producing a characteristic
  **plateau/sawtooth** and loss that appears at a fixed rate regardless of buffer state.
  **Congestion (queue-overflow) loss** happens when a real buffer fills. Different fixes:
  **shaping** (buffer/delay to the rate) instead of policing; **AQM** for congestion. In a
  capture, policing shows clean loss at a rate ceiling; congestion shows loss rising with
  queue depth/RTT.

## Modern Congestion Control and AQM (L4S)

Extending the bufferbloat section with the current landscape:
- **Congestion-control families:** **CUBIC** (Linux default, **loss-based** — fills the buffer
  until a drop), **Reno** (classic AIMD), **BBR/BBRv2/v3** (**model/rate-based** — estimates
  bottleneck bandwidth and RTT, so it avoids standing queues), **DCTCP** (ECN-based, for
  datacenters).
- **L4S — Low Latency, Low Loss, Scalable throughput (RFC 9330 architecture / 9331 / 9332):**
  the current ultra-low-latency direction. It uses **ECN codepoint ECT(1)** to mark L4S
  traffic and a **DualQ Coupled AQM (RFC 9332)** to give scalable-CC flows a separate,
  very-low-latency queue while coexisting with classic traffic — near-zero queuing delay
  without starving classic flows.
- **DPLPMTUD (RFC 8899):** Datagram Packetization Layer PMTUD — probes the path MTU using the
  transport itself **without relying on ICMP at all**, the modern fix for PMTUD black holes,
  and what **QUIC** uses. QUIC also pads its **Initial** packets to **≥1200 bytes** to ensure
  the path supports a safe minimum. IPv6's minimum MTU is **1280**.

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
- **Fixed ~40 ms latency on small requests?** Nagle × delayed-ACK deadlock; set
  `TCP_NODELAY` (or batch the write). Large writes don't trigger it.
- **`ss -i` shows high `retrans` vs a growing `lastsnd`?** High retrans = network loss
  collapsing `cwnd`; growing `lastsnd` with zero retrans = the app isn't sending.
- **Connections time out under load but the server CPU is idle?** SYN/accept-queue overflow —
  check `ListenDrops`/`ListenOverflows`, `somaxconn`, and the `listen()` backlog.
- **"Cannot assign requested address" from a busy client?** Ephemeral/SNAT source-port
  exhaustion (4-tuple), distinct from `TIME_WAIT`; also check `nf_conntrack` table fullness.
- **Why does latency explode near 90–95% utilization?** Queueing knee: delay ∝ 1/(1−ρ)
  (Little's Law / M/M/1) — run with headroom.
- **Why can't classic TCP tools see HTTP/3?** QUIC is UDP/443 with an encrypted transport
  header; capture `udp port 443` and decrypt via `SSLKEYLOGFILE`/qlog.
- **Why might a load-test p99 look great but users complain?** Coordinated omission and
  fan-out tail amplification (tail at scale).

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
- RFC 896 — Congestion Control (Nagle's algorithm); RFC 1122 — Host Requirements (delayed ACK)
- RFC 2018 — TCP Selective Acknowledgment (SACK); RFC 2883 — D-SACK extension
- RFC 5681 — TCP Congestion Control; RFC 6298 — Computing TCP's Retransmission Timer
- RFC 2308 — Negative Caching of DNS Queries (SOA MINIMUM)
- RFC 8305 — Happy Eyeballs v2 (dual-stack connection racing)
- RFC 4950 — ICMP Extensions for Multiprotocol Label Switching (MPLS in traceroute)
- RFC 8899 — Datagram Packetization Layer PMTUD (DPLPMTUD)
- RFC 9330 / 9331 / 9332 — L4S architecture, ECN (ECT(1)), and DualQ Coupled AQM
- RFC 4656 — OWAMP; RFC 5357 — TWAMP (one-way / two-way active measurement)
- RFC 6335 — IANA port ranges (ephemeral ports)
- RFC 9000 / 9001 / 9002 — QUIC transport, TLS, and loss detection/congestion control
- Dean & Barroso, "The Tail at Scale" (CACM 2013); Gil Tene on coordinated omission
- Brendan Gregg — BPF Performance Tools (bcc/bpftrace: tcpconnect, tcpretrans, tcplife, tcpdrop)
- man pages: ping(8), traceroute(8), dig(1), ss(8), tcpdump(1), curl(1), mtr(8), nc(1),
  iperf3(1), netperf(1), conntrack(8), ethtool(8)
