# HTTP Protocol Fundamentals

HTTP (Hypertext Transfer Protocol) is a stateless, request/response application-layer
protocol. This topic covers HTTP as it appears **on the wire** — how messages are
framed, how connections are managed, and how versions 1.0 and 1.1 behave. The wire
semantics of methods, status, headers, and framing are defined by RFC 9110 (HTTP
Semantics) and RFC 9112 (HTTP/1.1 message syntax). API-design semantics (resource
modeling, versioning strategy, pagination) live in the `rest-api-design` domain and are
deliberately out of scope here.

> [!KEY-TAKEAWAY]
> HTTP/1.1 is a plain-text, line-oriented protocol carried over a reliable TCP byte
> stream. Everything hard about it — framing, connection reuse, head-of-line blocking —
> comes from the fact that TCP gives you *one ordered stream of bytes* and HTTP has to
> carve discrete messages out of it.

## HTTP as a Text Protocol over TCP

Classic HTTP/1.x is a **human-readable, text-based** protocol. A client opens a TCP
connection (default port 80 for `http://`, 443 for `https://` where TLS wraps the same
HTTP bytes), then writes ASCII lines terminated by CRLF (`\r\n`, i.e. bytes 0x0D 0x0A).
The server reads the request, then writes a response using the same grammar.

TCP provides a **reliable, ordered, bidirectional byte stream**. It does *not* preserve
message boundaries — TCP has no concept of "one HTTP request." HTTP must therefore
define its own framing rules (start line + headers + blank line + body) so the receiver
knows where one message ends and the next begins. This is the central design problem of
HTTP/1.x.

A minimal exchange you can reproduce with `nc` or `telnet`:

```
$ printf 'GET /index.html HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n' | nc example.com 80
HTTP/1.1 200 OK
Content-Type: text/html; charset=UTF-8
Content-Length: 1256
Connection: close

<!doctype html>...
```

Because the protocol is text, it is easy to debug (`curl -v`, `tcpdump`, Wireshark show
readable headers) but comparatively verbose and expensive to parse versus a binary
framing. HTTP/2 and HTTP/3 replace this text framing with a binary one — but the
*semantics* (methods, status, header meanings) are identical across versions.

> [!TIP]
> "HTTP is stateless and text-based over TCP; TCP is a byte stream with no message
> boundaries, so HTTP defines framing on top." That one sentence answers a surprising
> number of interview questions.

## Request and Response Message Structure

Every HTTP/1.x message has the same shape:

```
start-line CRLF
*( field-line CRLF )
CRLF                     <-- empty line: end of headers
[ message-body ]
```

A **request** start line (the "request line") is:

```
method  SP  request-target  SP  HTTP-version  CRLF
GET /search?q=cat HTTP/1.1
```

A **response** start line (the "status line") is:

```
HTTP-version  SP  status-code  SP  [reason-phrase]  CRLF
HTTP/1.1 404 Not Found
```

Key wire details interviewers probe:

- Lines are separated by **CRLF**. RFC 9112 says recipients MAY accept a bare LF as a
  line terminator for robustness, but senders MUST send CRLF.
- The **blank line** (a CRLF on its own) separates headers from the body. Without it the
  parser cannot know headers have ended.
- The **reason phrase** (`OK`, `Not Found`) is purely informational and advisory —
  clients act on the numeric code, not the text. In HTTP/2 and HTTP/3 the reason phrase
  is dropped entirely.
- The `request-target` is usually an **origin-form** path+query (`/search?q=cat`). A
  full **absolute-form** URI (`GET http://example.com/ HTTP/1.1`) is used when talking
  to a forward proxy; **authority-form** (`CONNECT example.com:443`) is used for CONNECT;
  **asterisk-form** (`OPTIONS * HTTP/1.1`) targets the server itself.

> [!WARNING]
> Trailing whitespace and header injection matter on the wire. A CRLF smuggled into a
> header value can split a message ("request smuggling"/"response splitting"). Servers
> must reject bare CR or LF inside field values.

## HTTP 1.0 vs 1.1 Persistent Connections and the Host Header

HTTP/1.0 (RFC 1945, informational) and HTTP/1.1 (RFC 9112) differ in two changes that
dominate interviews:

**1. Persistent connections (keep-alive).** In HTTP/1.0 the default was **one request
per TCP connection**: the server closed the socket after the response, so the client
paid a fresh TCP (and later TLS) handshake for every object. HTTP/1.0 clients could opt
in with `Connection: keep-alive`. In HTTP/1.1 **persistent connections are the
default** — the connection stays open for reuse unless a party sends `Connection:
close`. This amortizes handshake cost and avoids repeatedly re-entering TCP slow start.

**2. Mandatory Host header.** HTTP/1.1 requires every request to carry a `Host` header
(a request without it MUST be answered with 400). This enables **name-based virtual
hosting** — many domains sharing one IP address — because the server uses `Host` to pick
which site to serve. HTTP/1.0 had no `Host` header, which is why one IP could serve only
one website. (With HTTPS, the equivalent at the TLS layer is SNI, which lets the server
pick a certificate before it can read the `Host` header.)

Other HTTP/1.1 additions: chunked transfer-encoding, better caching controls
(`Cache-Control`, `ETag`), the `100 Continue` mechanism, byte-range requests, and
`OPTIONS`/`TRACE`.

| Feature | HTTP/1.0 | HTTP/1.1 |
|---|---|---|
| Default connection | close after response | persistent (keep-alive) |
| `Host` header | absent | **required** |
| Chunked transfer-encoding | no | yes |
| Byte ranges | no | yes |
| Pipelining | no | yes (but problematic) |

## HTTP Methods at the Wire Level

At the wire level a method is just a **case-sensitive token** in the request line. The
registry (RFC 9110) defines: GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, and
PATCH (RFC 5789). Wire-level facts that matter here (semantics like idempotency detail
belong to `rest-api-design`, but these framing points are protocol-level):

- **HEAD** must return the *same headers* as GET (including `Content-Length`) but **no
  body**. Clients use it for cheap metadata/freshness checks.
- **CONNECT** asks a proxy to open a raw TCP tunnel to `host:port` (authority-form
  target). It is how HTTPS is proxied and how WebSocket-through-proxy works.
- **OPTIONS** with target `*` (`OPTIONS * HTTP/1.1`) asks about server capabilities;
  it is also the CORS preflight method.
- **TRACE** echoes the received request back for diagnostics; it is commonly disabled
  because it can leak headers (Cross-Site Tracing).
- Method names are **case-sensitive** and conventionally uppercase; `get` is a different
  (and invalid) token from `GET`.
- Whether a body is *expected* is method-dependent by convention, but framing is
  determined by headers (`Content-Length`/`Transfer-Encoding`), not by the method. A GET
  *may* carry a body syntactically, but it has no defined semantics.

## Status Codes at the Wire Level

The status code is a **three-digit integer** on the status line; its first digit defines
the class (RFC 9110):

| Class | Meaning | Examples |
|---|---|---|
| 1xx | Informational (interim) | 100 Continue, 101 Switching Protocols |
| 2xx | Success | 200 OK, 201 Created, 204 No Content, 206 Partial Content |
| 3xx | Redirection | 301, 302, 304 Not Modified, 307, 308 |
| 4xx | Client error | 400, 401, 403, 404, 405, 409, 429 |
| 5xx | Server error | 500, 502, 503, 504 |

Wire-level details interviewers like:

- A client that doesn't recognize a specific code treats it as the **x00** of its class
  (e.g. an unknown 499 is handled like 400). This is why the class digit is the contract.
- **204 No Content** and **304 Not Modified** MUST NOT include a message body, and the
  connection framing must reflect that (no `Content-Length`-delimited body follows).
- **1xx** responses are interim: the server may send one or more `1xx` lines *before* the
  final response on the same connection. `100 Continue` pairs with `Expect: 100-continue`
  (client withholds a large body until the server signals it's willing to receive it).
- **101 Switching Protocols** is how a connection is upgraded to WebSocket (`Upgrade:
  websocket`) — after 101 the bytes on the socket are no longer HTTP.
- **426 Upgrade Required**, **505 HTTP Version Not Supported** relate to version
  negotiation at the wire.

## Headers Structure and Parsing Rules

A header (field line) is `field-name ":" OWS field-value OWS`, e.g.
`Content-Type: application/json`. Rules that show up on the wire:

- **Field names are case-insensitive** (`Content-Type` == `content-type`). HTTP/2 and
  HTTP/3 require them lowercase on the wire.
- Leading/trailing **optional whitespace (OWS)** around the value is stripped.
- A field that can appear multiple times has **list semantics**: `Accept: a` +
  `Accept: b` is equivalent to `Accept: a, b` (comma-joined). `Set-Cookie` is the notable
  exception — it MUST NOT be folded, so multiple cookies use repeated lines.
- **Obsolete line folding** (continuing a value on the next line with leading whitespace)
  is deprecated; recipients should reject or handle it carefully (smuggling vector).
- Headers are **metadata**; the entity/representation data goes in the body. Some headers
  describe the *message* (hop-by-hop, e.g. `Connection`, `Transfer-Encoding`,
  `Keep-Alive`, `TE`, `Upgrade`) and MUST NOT be forwarded by proxies; most are
  **end-to-end** and are forwarded.
- **Trailers** are header fields sent *after* a chunked body (announced with the
  `Trailer` header) — useful for values computed only after the body, like a checksum.
  Only a client that sent `TE: trailers` is guaranteed to want them, and most clients
  **silently discard** trailers. Framing/routing/auth-sensitive fields are **forbidden**
  in trailers — notably `Transfer-Encoding`, `Content-Length`, `Host`, `Cache-Control`,
  and authentication headers — because a recipient may have already acted on the head. The
  main real-world consumer is **gRPC**, which carries its `grpc-status`/`grpc-message` in
  trailers.

Chunked wire detail worth knowing: each chunk-size line may carry **chunk extensions**
(`1a;name=value\r\n`) after the hex size; `chunked` must be the **last** transfer coding;
each hop **decodes then re-frames** (a proxy may de-chunk before forwarding); and an
oversized or malformed chunk-size line is a **smuggling/DoS vector**, so parsers bound it
strictly. Per RFC 9112 §6.1, a message bearing **both** `Content-Length` and
`Transfer-Encoding` should be treated as an **error** (respond `400`, or for a proxy close
the connection) — modern stacks **reject** rather than silently prefer TE.

Rough size limits are implementation-defined; servers commonly cap total header size
(e.g. 8–16 KB) and reply **431 Request Header Fields Too Large** when exceeded.

## Cookies Set-Cookie and Sessions

Cookies (RFC 6265) are the mechanism that layers **state** on top of stateless HTTP. The
server sends `Set-Cookie` in a response; the client stores it and echoes it back in a
`Cookie` request header on subsequent matching requests.

```
HTTP/1.1 200 OK
Set-Cookie: sid=abc123; Path=/; Domain=example.com; Max-Age=3600; Secure; HttpOnly; SameSite=Lax

GET /account HTTP/1.1
Cookie: sid=abc123
```

Attribute meanings:

- **Domain / Path** — scope of which requests include the cookie.
- **Expires / Max-Age** — persistence; absent both = *session cookie* (dropped when the
  browser closes). `Max-Age` takes precedence over `Expires`.
- **Secure** — only sent over HTTPS.
- **HttpOnly** — not readable by JavaScript (mitigates XSS token theft).
- **SameSite=Strict/Lax/None** — controls cross-site sending (CSRF defense).
  `SameSite=None` must be paired with `Secure`.
- **`__Host-` / `__Secure-` prefixes** enforce Secure + scoping constraints:
  `__Secure-` requires `Secure`; `__Host-` requires `Secure` **and** `Path=/` **and no
  `Domain`** (locking the cookie to the exact host).

**Current SameSite reality (2025).** Chrome and other major browsers treat a cookie with
**no `SameSite` attribute as `Lax` by default** (since 2020). The implicit default-Lax
has a **2-minute "top-level POST" exception** (a newly set cookie is still sent on a
top-level cross-site POST for up to 2 minutes) that an **explicit** `SameSite=Lax` does
**not** get. With third-party cookies being phased out, the **`Partitioned` attribute
(CHIPS)** opts a cross-site cookie into per-top-level-site partitioned storage; it is
recommended alongside `__Host-` for embedded third-party contexts.

**Sessions** are the classic pattern: the cookie holds an opaque **session ID**, and the
server keeps the real state (login, cart) server-side keyed by that ID. Because each
`Cookie` header is self-contained, this keeps HTTP itself stateless while giving the
application the *illusion* of state. The tradeoff is server-side session storage
(sticky sessions or a shared store) versus stateless tokens (e.g. signed JWTs) that
carry claims in the cookie/`Authorization` header and need no server lookup.

> [!WARNING]
> `Set-Cookie` must never be comma-folded into a single header line — each cookie needs
> its own `Set-Cookie` line. This is the classic exception to HTTP's list-header rule and
> a frequent bug in header-handling code.

## Content Negotiation and Content-Type

**Content negotiation** lets one URL serve different representations. In *proactive*
(server-driven) negotiation the client advertises preferences via `Accept*` request
headers and the server picks:

- `Accept: application/json, text/html;q=0.9` — media types with **quality values**
  (`q`, 0–1, default 1). Higher `q` wins; `q=0` means "not acceptable."
- `Accept-Encoding: br, gzip` — acceptable compressions.
- `Accept-Language: en-US, en;q=0.8` — languages.
- `Accept-Charset` — largely obsolete (UTF-8 assumed).

The response declares what it actually sent with **`Content-Type`** (the media type,
e.g. `text/html; charset=UTF-8` or `application/json`) plus `Content-Language`,
`Content-Encoding`. If the server can satisfy none of the constraints it may return
**406 Not Acceptable**.

Crucially, when a resource varies by a request header the server MUST send a **`Vary`**
header (e.g. `Vary: Accept-Encoding`) so caches key correctly — otherwise a cache could
serve a gzipped body to a client that can't decode it.

`Content-Type` also governs how the body is interpreted. For uploads,
`multipart/form-data` uses a `boundary` parameter to delimit parts;
`application/x-www-form-urlencoded` percent-encodes key/value pairs. Missing/incorrect
`Content-Type` causes servers to guess ("MIME sniffing"), which is a security risk —
hence `X-Content-Type-Options: nosniff`.

## Message Framing Content-Length vs Chunked Transfer-Encoding

Because TCP is a byte stream, the receiver must know **where the body ends**. HTTP/1.1
offers two mutually exclusive framing mechanisms:

**1. `Content-Length: N`** — the body is exactly N octets. Simple, but the sender must
know the total size *before* sending the first byte. Good for files; bad for streamed or
dynamically generated content.

**2. `Transfer-Encoding: chunked`** — the body is sent as a series of chunks, each
prefixed by its size in **hexadecimal** followed by CRLF; a zero-length chunk terminates
the body. This lets a server **stream** a response whose length is unknown up front (and
optionally append trailers).

```
HTTP/1.1 200 OK
Transfer-Encoding: chunked

1a\r\n
Mozilla Developer Network \r\n     <-- 0x1a = 26 octets
10\r\n
is a great site.\r\n               <-- 0x10 = 16 octets
0\r\n
\r\n                               <-- terminating 0-size chunk
```

Rules and gotchas:

- A message **must not** use both `Content-Length` and `Transfer-Encoding: chunked`.
  RFC 9112 §6.1 historically instructed a recipient that sees both to **remove
  `Content-Length` and prefer `Transfer-Encoding`**; but because front-end/back-end
  disagreement over exactly that reconciliation is the root of **HTTP request smuggling**
  (CL.TE / TE.CL attacks), modern hardened stacks instead **reject** the message (respond
  `400` and close the connection) rather than silently preferring TE. (This matches the
  Headers and Request-Smuggling sections.)
- `chunked` must be the **final** transfer coding, and it is a **hop-by-hop** property
  (a proxy may de-chunk before forwarding).
- Some responses are **implicitly** framed: 1xx/204/304 and any response to HEAD have no
  body regardless of headers.
- HTTP/1.0 without either mechanism framed the body by **closing the connection**
  ("connection: close" delimiting) — which is why HTTP/1.0 keep-alive needed
  `Content-Length`.
- `Transfer-Encoding` (how the body is framed for transfer) is distinct from
  `Content-Encoding` (compression of the representation itself, which is end-to-end).

## Compression gzip and Brotli

HTTP can compress the message body to save bandwidth. The client advertises support with
`Accept-Encoding`, the server compresses and sets **`Content-Encoding`**:

```
GET /app.js HTTP/1.1
Accept-Encoding: br, gzip, deflate

HTTP/1.1 200 OK
Content-Encoding: br
Vary: Accept-Encoding
Content-Length: 30215        <-- length of the COMPRESSED body
```

- **gzip** (DEFLATE, RFC 1952) — universally supported, good ratio, fast.
- **br (Brotli)** (RFC 7932) — better ratio than gzip for text, widely supported over
  HTTPS; often the first choice for static assets.
- **deflate** — historically ambiguous/buggy; avoided in practice.
- **zstd** — newer, increasingly supported.

Key points:

- `Content-Encoding` is **end-to-end** and applies to the representation; the recipient
  decodes it before use. `Content-Length`, when present, is the size of the *encoded*
  (compressed) body.
- Because the body varies by the client's `Accept-Encoding`, the server **must** emit
  `Vary: Accept-Encoding` for correct caching.
- Compression interacts with security: compressing secret-containing responses that also
  reflect attacker input enabled the **BREACH/CRIME** attacks — mitigations include not
  compressing sensitive responses or masking.
- Compress text (HTML/CSS/JS/JSON); don't re-compress already-compressed media
  (JPEG/PNG/MP4) — you spend CPU for near-zero gain.

## Statelessness

HTTP is **stateless**: each request/response is self-contained, and the server is not
*required* to retain information between requests. Everything needed to understand a
request (target, method, auth, content type) must be present in that request.

Why it matters:

- **Scalability / resilience** — any server behind a load balancer can handle any
  request; there is no per-connection session affinity mandated by the protocol, so you
  can scale horizontally and tolerate node loss.
- **Simplicity and cacheability** — stateless requests are easier to cache, retry, and
  reason about.

The cost is that stateful applications must carry state *in the messages*: cookies /
session IDs, bearer tokens (`Authorization: Bearer …`), or query/body parameters. This is
the difference between the **protocol** being stateless and the **application** being
stateful.

> [!INTERVIEW]
> "If HTTP is stateless, how does a site remember I'm logged in?" Answer: the state lives
> outside the protocol — a cookie carries a session ID or token on every request, so each
> request remains self-describing while the app reconstructs your session. Persistent TCP
> connections (keep-alive) are an *optimization*, not state: they don't change HTTP's
> stateless semantics.

## HTTP 1.1 Head-of-Line Blocking and Pipelining

A single HTTP/1.1 connection is **strictly serialized**: one request, one full response,
then the next. HTTP/1.1 defined **pipelining** — sending multiple requests back-to-back
without waiting for each response — to hide round-trip latency. But it has a fatal flaw:
responses must come back **in request order**, so a slow or large first response blocks
every response queued behind it. This is **HTTP-level head-of-line (HOL) blocking**.

Because of that (plus buggy proxies that mishandled pipelined requests), pipelining was
**never enabled by default** in mainstream browsers and is effectively dead.

The practical workaround in HTTP/1.1 is **multiple parallel TCP connections** per origin
(browsers cap around 6). This gives concurrency but costs more sockets, more handshakes,
more congestion-control state, and still no true multiplexing.

HTTP/2 solves *application-layer* HOL blocking with **binary framing and multiplexed
streams** over one connection — but a lost TCP segment still stalls all streams
(**transport-layer** HOL blocking) because they share one ordered TCP stream. HTTP/3
finally removes that by running over **QUIC (UDP)**, where each stream is independently
ordered so one lost packet only stalls its own stream. (Details of HTTP/2 and HTTP/3 live
in the `http2-http3-quic` topic.)

| Level | Cause | Fixed by |
|---|---|---|
| HTTP/1.1 HOL | serialized responses / in-order pipelining | HTTP/2 stream multiplexing |
| Transport HOL | one lost TCP segment stalls all HTTP/2 streams | HTTP/3 over QUIC |

## Request-Target Forms and Host Reconciliation

The request line carries the target in one of four forms (RFC 9112 §3.2), and the
*interaction* between the target and the `Host` header is a routing- and
security-critical rule interviewers probe:

- **origin-form** — `/search?q=cat` (path+query). The normal case; the authority comes
  from the `Host` header.
- **absolute-form** — `GET http://example.com/path HTTP/1.1`. Used to a forward proxy.
  Critical rule: when absolute-form is used, the server **MUST ignore any `Host` header
  and use the authority from the request line** (RFC 9112 §3.2.1). A mismatch between the
  absolute-form authority and a conflicting `Host` is a routing/smuggling vector.
- **authority-form** — `CONNECT example.com:443` (host:port only). Only for CONNECT.
- **asterisk-form** — `OPTIONS * HTTP/1.1`. Server-wide OPTIONS.

**Host reconciliation and injection.** A request with **two `Host` headers** (or a Host
whose value disagrees with an absolute-form authority) is ambiguous and MUST be rejected
with **400** — front-end/back-end disagreement here is a classic smuggling/routing
desync. **Host header injection** is a distinct attack: if an application builds an
absolute URL from the incoming `Host` (e.g. a password-reset link), an attacker who sets
`Host: attacker.com` can poison the link so the victim's reset token is sent to the
attacker; the same trick poisons caches keyed on the wrong host. Defenses: validate
`Host` against an allowlist of expected authorities; never trust it to build absolute
links.

**HTTP/2 and HTTP/3** replace the `Host` header with the **`:authority` pseudo-header**;
`Host`, if also present, must agree. When an HTTP/2 front-end rewrites to HTTP/1.1 for a
back-end, it derives `Host` from `:authority` — a mismatch here is the root of H2 downgrade
smuggling (see below).

## Conditional Requests and Validators

Conditional requests (RFC 9110 §13) let a client say "only act if the resource is in the
state I expect," powering both cache revalidation and optimistic concurrency. The server
supplies **validators** in responses:

- **`ETag`** — an opaque representation identifier. **Strong** (`"abc"`) means byte-for-byte
  identical; **weak** (`W/"abc"`) means semantically equivalent but possibly
  byte-different. Range requests and byte-level caching require a **strong** validator;
  weak validators only permit **weak comparison** (equal tags, ignoring the `W/`).
- **`Last-Modified`** — a timestamp validator (1-second granularity, hence weaker).

Request precondition headers:

- **`If-None-Match: "abc"`** / **`If-Modified-Since`** — used by GET for cache
  revalidation. If the validator still matches, the server returns **`304 Not Modified`**
  with **no body**, echoing the current validators; the client reuses its cached copy.
- **`If-Match: "abc"`** / **`If-Unmodified-Since`** — used by unsafe methods (PUT/DELETE)
  for **optimistic concurrency**. If the resource changed since the client last read it,
  the ETag no longer matches and the server returns **`412 Precondition Failed`**,
  preventing the **lost-update** problem without locking.
- **`If-Range`** — combined with `Range`: if the validator still matches, serve the
  requested range (`206`); if it changed, serve the whole current representation (`200`)
  atomically, so the client never stitches together mismatched pieces.

> [!INTERVIEW]
> "Optimistic concurrency without locking?" Read the resource, keep its `ETag`, then
> `PUT` with `If-Match: <etag>`. A concurrent writer's change bumps the ETag, so your
> conditional PUT fails with **412** and you re-read/merge — no server-side lock needed.

## Range Requests and Partial Content

Range requests (RFC 9110 §14) fetch part of a representation — the basis of resumable
downloads and media seeking. A server that supports them advertises **`Accept-Ranges:
bytes`**.

```
GET /video.mp4 HTTP/1.1
Range: bytes=1000-1999

HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 1000-1999/1048576
Content-Length: 1000
```

- A satisfiable single range → **`206 Partial Content`** with a **`Content-Range`** header
  giving `start-end/total`.
- **Multiple ranges** in one request → a **`multipart/byteranges`** body with a boundary
  delimiting each part (each part carries its own `Content-Range`).
- An unsatisfiable range (e.g. start beyond the resource size) → **`416 Range Not
  Satisfiable`**, with a `Content-Range: bytes */<total>` telling the client the true size.
- `If-Range` (above) makes "resume or restart" atomic.

**Video seeking on the wire**: the player issues `Range` requests for the byte offsets it
needs as the user scrubs, rather than downloading the whole file.

> [!WARNING]
> **Range-based DoS amplification**: a request with a huge number of tiny, overlapping
> ranges can force the origin to assemble a `multipart/byteranges` response far larger
> than the resource, or to do expensive work. Servers cap the number/size of ranges and
> may ignore or `200` a pathological `Range`.

## The Expect 100-continue Handshake

`Expect: 100-continue` (RFC 9110 §10.1.1) is a bandwidth-saving handshake for large or
unsafe bodies. The client sends the **request headers only**, with `Expect: 100-continue`,
and **pauses** before sending the body:

- If the server is willing, it replies **`100 Continue`** (an interim 1xx) and the client
  then streams the body.
- If the server would reject the request regardless of the body — auth failure (`401`),
  body too large (`413`), or it doesn't understand the expectation (`417 Expectation
  Failed`) — it sends that **final** response immediately, so a 2 GB upload is never sent.
- If the server never answers, a conformant client should **still send the body after a
  short timeout** (a few seconds) so a proxy or old server that ignores `Expect` doesn't
  deadlock the request.

Proxies must forward the expectation and relay the interim `100` back. This is why large
`PUT`/`POST` uploads commonly use it.

## Redirects and Method Preservation

The 3xx redirects differ precisely in **whether they preserve the method and body**
(RFC 9110 §15.4) — a distinction that matters enormously for non-idempotent requests. A
method is **safe** if it only reads and has no side effects, and **idempotent** if sending
it more than once has the same net effect as sending it once (`GET`, `PUT`, and `DELETE`
qualify; a `POST` generally does **not**, so silently replaying it can double-charge a
payment). Full treatment lives in `rest-api-design`; the one-line gloss here is enough to
follow the retry and method-preservation reasoning below.

| Code | Name | Effect on method/body |
|---|---|---|
| 301 | Moved Permanently | Historically clients rewrote POST→GET (spec discourages but permits) |
| 302 | Found | Same historical POST→GET rewriting in practice |
| 303 | See Other | **Always** switch to GET, drop the body (Post/Redirect/Get pattern) |
| 307 | Temporary Redirect | **Preserve** method and body exactly |
| 308 | Permanent Redirect | **Preserve** method and body exactly (permanent) |

The redirect target is the **`Location`** header (may be relative or absolute; resolved
against the request URI). Clients cap redirect chains to avoid loops.

> [!INTERVIEW]
> "301 vs 308 after a POST payment?" A `301`/`302` might make the client re-issue the
> payment as a `GET` (dropping the body) — dangerous. `308` guarantees the browser
> re-`POST`s the same body to the new URL. Use `308`/`307` whenever method preservation
> matters; use `303` to *deliberately* turn a POST into a follow-up GET.

## HTTP Authentication Framing

At the wire level, HTTP authentication (RFC 9110 §11) is a challenge/response using a
small set of headers — the *usage* of specific token schemes (OAuth/JWT flows) belongs to
`rest-api-design`, but the framing lives here:

- A server demanding credentials for the **origin** returns **`401 Unauthorized`** with a
  **`WWW-Authenticate`** challenge naming the scheme and a `realm`. The client retries
  with an **`Authorization`** header.
- A **proxy** demanding credentials returns **`407 Proxy Authentication Required`** with
  **`Proxy-Authenticate`**; the client answers with **`Proxy-Authorization`**.
- Common schemes: **Basic** — `Authorization: Basic base64(user:pass)` — is base64
  **encoding, not encryption**, so it is only safe over TLS. **Bearer** — `Authorization:
  Bearer <token>` — carries an opaque/JWT token. **Digest** uses a nonce-based hash.
- **`401` vs `403`**: `401` means "not authenticated — here's how to authenticate"
  (challenge included); `403` means "authenticated (or auth won't help) — you are not
  allowed," and carries no `WWW-Authenticate` retry hint.

## URL Percent-Encoding and Normalization

URLs on the wire follow RFC 3986. **Unreserved** characters (`A–Z a–z 0–9 - . _ ~`) pass
literally; **reserved** and unsafe characters are **percent-encoded** as `%HH`. Where
encoding is required differs by component:

- The **path** and **query** are sent to the server; the **fragment** (`#...`) is **never
  transmitted** — it is client-side only.
- A literal `?` or `#` in a path segment must be `%3F`/`%23`; `+` means space only in
  `application/x-www-form-urlencoded`, not in the path.

**Path normalization discrepancies** are a live attack surface: if a proxy and origin
resolve dot-segments (`/a/../b`), trailing slashes, or `%2e%2e` differently, an attacker
can achieve **path confusion** — routing a request past an access-control rule, or **web
cache deception** (tricking a cache into storing a private page under a static-looking
URL like `/account/nonexistent.css`). Normalize consistently, and key caches on the
normalized path.

## Request Smuggling and Desync Attacks

Request smuggling exploits **disagreement about where one request ends** between a
front-end (proxy/CDN/load balancer) and a back-end that share a keep-alive connection.
The attacker's smuggled bytes get prepended to the *next* victim's request. The taxonomy
(PortSwigger "HTTP Desync Attacks," "HTTP/2: The Sequel Is Always Worse," "Browser-Powered
Desync Attacks"):

- **CL.TE** — front-end uses `Content-Length`, back-end uses `Transfer-Encoding`. The
  front-end forwards what it thinks is one body; the back-end de-chunks and treats the
  tail as a new request.
- **TE.CL** — the reverse: front-end honors chunked, back-end honors CL.
- **TE.TE** — both support chunked, but one is tricked into ignoring the `Transfer-Encoding`
  header via **obfuscation**: `Transfer-Encoding: xchunked`, a space/tab before the colon,
  a duplicate `Transfer-Encoding` line, or a value prefixed with a bare `\n`. One hop
  falls back to `Content-Length`, desyncing.
- **CL.CL** — duplicate, conflicting `Content-Length` headers honored differently.
- **CL.0 / 0.CL** — the back-end ignores the body entirely (or expects none) while the
  front-end forwards one; a pure Content-Length desync that is often **browser-compatible**
  (needs no malformed request), enabling client-side attacks.
- **H2.CL / H2.TE downgrade smuggling** — an HTTP/2 front-end rewrites to HTTP/1.1 and
  trusts an attacker-injected `Content-Length`/`Transfer-Encoding` (HTTP/2 has its own
  length, so a conflicting CL/TE should be stripped, not forwarded).
- **Response queue poisoning** — desync leaves an extra response in the connection's queue,
  so victims receive **someone else's response**.
- **Request tunnelling** — smuggling a request whose response the attacker reads directly
  (blind or via `HEAD`).
- **Client-side / pause-based desync** — the desync is triggered from the browser or by
  pausing mid-request to exploit read timeouts.

The modern hardening (RFC 9112 §6.1/§6.3) is to **reject rather than reconcile**: a
message with both `Content-Length` and `Transfer-Encoding`, or with malformed/obfuscated
framing headers, should be answered **400** (and the connection closed) rather than
"preferring" one — silently preferring TE is exactly what makes CL.TE exploitable.

## CRLF Injection and Response Splitting

Because CRLF is structural in HTTP/1.x, an attacker-controlled `\r\n` reflected into a
**header value** — classically a `Location` (open redirect endpoints) or `Set-Cookie` —
lets the attacker terminate the current header block and inject arbitrary headers or even
a **second complete response**. This is **HTTP response splitting**, and it enables cache
poisoning (the injected second response gets cached and served to others) and reflected
XSS. RFC 9110 §5.5 therefore forbids CR, LF, and NUL in field values; servers and
frameworks must strip/reject them.

**HTTP/2 and HTTP/3 structurally eliminate classic response splitting** because headers
are carried as length-prefixed binary fields (HPACK/QPACK), not CRLF-delimited text — a
`\r\n` in a value is just data, not a delimiter. But the risk **reappears on downgrade**:
when an HTTP/2 front-end translates to HTTP/1.1 for a back-end (or vice versa) without
validating field values, the injected CRLF becomes a delimiter again.

## HTTP Caching Protocol Mechanics

HTTP caching (RFC 9111) is the on-the-wire machinery for reusing responses. The core
directives senior interviews filter on:

- **`Cache-Control: max-age=<s>`** — freshness lifetime for private caches; **`s-maxage`**
  overrides it for **shared** (proxy/CDN) caches.
- **`no-cache`** — MAY store, but MUST **revalidate** with the origin before each reuse
  (conditional request). **`no-store`** — MUST NOT store at all. These are frequently
  confused; `no-cache` still caches, `no-store` doesn't.
- **`private`** — only a single-user (browser) cache may store it; a shared cache MUST
  NOT. **`public`** — explicitly cacheable even when it otherwise wouldn't be.
- **`must-revalidate`** — once stale, the cache MUST NOT serve it without revalidating
  (no serving stale on error/disconnect); pairs with `max-age`.
- **`immutable`** — the response won't change during its freshness lifetime, so clients
  skip revalidation even on reload (used for fingerprinted static assets).
- **`stale-while-revalidate` / `stale-if-error`** (RFC 5861) — serve a stale copy
  immediately while revalidating in the background, or serve stale if the origin errors.
- **`Age`** — seconds since the response was generated at the origin (added by caches);
  **`Expires`** — an absolute expiry date (legacy; `max-age` wins if both present).

**Freshness** = a cache may reuse a stored response while `age < freshness_lifetime`
(from `s-maxage`/`max-age`/`Expires`, or heuristics). When stale, the cache
**revalidates** via a conditional request; a `304` refreshes the stored copy's metadata
without re-transferring the body.

**`Vary` cache-key semantics** (RFC 9111 §4.1): a cache must key a stored response by the
request headers named in `Vary` (e.g. `Vary: Accept-Encoding`). **`Vary: *`** means the
response is effectively **uncacheable** (every request is unique). Varying on `Cookie` or
`Authorization` causes **cache-key explosion** (a distinct entry per user) — an
anti-pattern that destroys shared-cache hit rates.

## Connection Management and Lifecycle

Beyond "keep-alive is default," the lifecycle details drive real debugging:

- **`Connection`** is a **hop-by-hop** control. `Connection: close` announces the socket
  closes after this message; `Connection: keep-alive` (HTTP/1.0 opt-in) requests reuse.
  Crucially, `Connection` also **names other headers to strip** before forwarding
  (e.g. `Connection: close, X-Foo` tells a proxy to remove `X-Foo` as hop-by-hop).
- **`Keep-Alive: timeout=5, max=100`** hints how long the peer keeps an idle socket open
  and how many more requests it will serve on it.
- **Idle-timeout race**: a client may reuse a socket at the exact moment the server is
  closing it for idleness; the request hits a `FIN`/`RST` and fails. This is why clients
  transparently **retry idempotent** requests on a reused connection — but must **not**
  blindly retry a non-idempotent `POST`.
- **Connection-close as delimiter is ambiguous**: for an HTTP/1.0-style body framed only
  by connection close, a premature close is **indistinguishable from a complete
  response** — a truncated download can look "successful." `Content-Length` or the
  chunked terminating 0-chunk removes this ambiguity (a missing terminator reveals
  truncation).

> [!INTERVIEW]
> "curl works but the browser intermittently truncates on a keep-alive connection." Prime
> suspects: an **idle-timeout race** (socket reused as the server closes it — verify with
> `Keep-Alive` timeout and retry-on-idempotent behavior), or a response **framed by
> connection close** so truncation is silently accepted. Fix framing (send
> `Content-Length`/chunked) and align client/server idle timeouts.

## Specialized and Modern Status Codes

Beyond the everyday codes, senior interviews probe these:

- **`103 Early Hints`** (RFC 8297) — an interim 1xx sent *before* the final response to
  let the client **preload** critical assets (`Link: rel=preload`) while the origin
  computes the page. The modern server-push replacement.
- **`421 Misdirected Request`** — the connection was **coalesced** to an authority this
  server can't serve (e.g. HTTP/2 reused one connection for two hostnames sharing a cert,
  but this origin isn't authoritative for the requested `:authority`). The client should
  retry on a fresh connection.
- **`425 Too Early`** (RFC 8470) — the server refuses to process a request sent in TLS
  1.3 **0-RTT** data, because 0-RTT is **replayable**; the client retries after the
  handshake completes.
- **`451 Unavailable For Legal Reasons`** — blocked for legal/censorship reasons.
- **`511 Network Authentication Required`** — a **captive portal** signals the client must
  authenticate to the network.
- **`418 I'm a teapot`** — a joke (RFC 2324); not a real HTTP feature, but interviewers
  like to see you know it's not serious.

## Common follow-up questions

- **Why can't TCP just deliver "one request"?** TCP is a byte stream with no message
  boundaries; HTTP must frame messages itself (start line + headers + blank line + body).
- **How does the receiver know the body length?** `Content-Length`, or
  `Transfer-Encoding: chunked` (0-size chunk terminates), or connection close (HTTP/1.0
  style). Never both CL and chunked — that enables request smuggling.
- **Why is the `Host` header mandatory in HTTP/1.1?** To support name-based virtual
  hosting — many hostnames on one IP. Missing `Host` → 400.
- **What changed from HTTP/1.0 to 1.1?** Persistent connections by default, mandatory
  `Host`, chunked encoding, better caching, ranges, `100 Continue`.
- **How do sessions work if HTTP is stateless?** State is carried in each request via
  cookies/tokens; the server keeps session data keyed by an opaque session ID (or uses
  self-contained signed tokens).
- **Why is pipelining dead?** In-order response requirement causes HOL blocking; proxies
  mishandled it. Browsers used parallel connections instead, and HTTP/2 multiplexing
  replaced it.
- **Difference between `Content-Encoding` and `Transfer-Encoding`?** `Content-Encoding`
  (e.g. gzip/br) is an end-to-end property of the representation; `Transfer-Encoding`
  (e.g. chunked) is a hop-by-hop framing of the message body for one connection.
- **Why does compression need `Vary: Accept-Encoding`?** So caches don't hand a
  br-encoded body to a client that only accepts gzip.

## References

- RFC 9110 — HTTP Semantics (methods, status codes §15, headers, content negotiation,
  Host §7.2, auth §11, conditional requests §13, ranges §14, field-value CR/LF §5.5)
- RFC 9111 — HTTP Caching (`Cache-Control` §5.2, `Vary` §4.1)
- RFC 9112 — HTTP/1.1 (message syntax, request-target/Host §3.2, framing precedence
  §6.1/§6.3, chunked/trailers §7.1)
- RFC 5861 — `stale-while-revalidate` / `stale-if-error` cache directives
- RFC 8297 — 103 Early Hints · RFC 8470 — Using Early Data (0-RTT) in HTTP / 425 Too Early
- RFC 3986 — URI Generic Syntax (percent-encoding, normalization)
- RFC 1945 — HTTP/1.0 (informational)
- RFC 6265 — HTTP State Management Mechanism (Cookies; attributes/prefixes §4.1) +
  cookie-bis draft (SameSite default-Lax, `__Host-`, `Partitioned`/CHIPS)
- RFC 5789 — PATCH method
- RFC 9113 — HTTP/2 · RFC 9114 — HTTP/3 · RFC 9000 — QUIC (cross-references)
- RFC 1952 — GZIP file format · RFC 7932 — Brotli compressed data format
- MDN Web Docs — HTTP overview, messages, headers, cookies, compression
- PortSwigger Web Security Academy — HTTP request smuggling (CL.TE / TE.CL)
