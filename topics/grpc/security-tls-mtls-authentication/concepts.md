# Security: TLS, mTLS & Authentication

gRPC ships security as a **credentials** abstraction rather than a set of ad-hoc
options. The single most important distinction to internalize for interviews:
gRPC splits security into two orthogonal layers — **channel credentials** (secure the
*transport*: who you are talking to and whether the bytes are encrypted) and **call
credentials** (authenticate the *caller* per-RPC, typically a bearer token carried in
metadata). You compose them; you do not choose one *or* the other. Getting this
two-axis model right is what separates a rote answer from a senior one.

This page teaches the **gRPC credential model** and the auth flow: what a
`ChannelCredentials` is, how TLS/mTLS is configured at the channel, how a per-RPC token
rides in the `authorization` metadata header, where auth is *enforced* (interceptors),
and how the server reads the verified peer identity from the `AuthContext`.

Cross-references (do not re-derive here):
- **TLS handshake internals, certificate chains, cipher suites, HTTP/2 on the wire**
  live in `networking` / `security`. Here we stay at the gRPC-credentials altitude.
- **OAuth2 / JWT threat model, token issuance, refresh, revocation** live in
  `security`. Here we cover *how gRPC carries and enforces* a token, not how it is
  minted or its full threat model.
- **Service mesh / xDS / SPIFFE-based workload identity at scale** live in
  `system-design`. Here we describe the gRPC-side hooks (mTLS credentials, mesh-managed
  certs) and reference the mesh architecture there.

> [!KEY-TAKEAWAY]
> Two axes, always composed:
> **Channel credentials** = transport security (TLS server-auth, mTLS mutual-auth, or
> insecure plaintext). **Call credentials** = per-RPC caller authentication (a token in
> metadata). Composite = both at once. TLS answers "is the pipe encrypted and is the
> server who it claims?"; call credentials answer "who is calling, and are they allowed?"

## Channel Credentials vs Call Credentials

These are the two building blocks of gRPC security, and they operate at different
scopes and layers.

| Aspect | Channel credentials | Call credentials |
|---|---|---|
| Scope | The whole **channel/connection** | A **single RPC** |
| Question answered | "Is the transport secure and is the *server* authentic?" | "Who is the *caller*?" (authentication) |
| Layer | Transport (TLS record layer) | Application (metadata header) |
| Examples | TLS, mTLS, ALTS, `insecure` | OAuth2/JWT bearer token, Google IAM token, custom token |
| On the wire | TLS handshake + encrypted records | `authorization: Bearer <token>` in HTTP/2 HEADERS (metadata) |
| Requires secure transport? | It *is* the transport | Yes — call creds normally **refuse to attach over an insecure channel** |

**Channel credentials** determine how the underlying HTTP/2 connection is secured.
You attach them once, when you create the channel/stub. **Call credentials** produce
metadata (usually an `authorization` header) that is attached to *each* RPC on that
channel. A single set of channel creds can carry many call creds over time.

A crucial safety rule enforced by gRPC implementations: **call credentials will not be
sent over an insecure (plaintext) channel by default.** The reasoning is
straightforward — a bearer token sent in cleartext is a credential anyone on the path
can steal and replay. So call creds *require* a secure channel (TLS/mTLS/ALTS) unless
you explicitly opt out (e.g., Java's `CallCredentials` "requires privacy" contract, or
Go's `grpc.WithPerRPCCredentials` combined with `PerRPCCredentials.RequireTransportSecurity()`
returning `true`).

```mermaid
flowchart TD
  A["Create channel"] --> B{Channel credentials}
  B -->|"insecure (dev only)"| C["Plaintext HTTP/2 h2c"]
  B -->|"TLS"| D["Server authenticated, encrypted"]
  B -->|"mTLS"| E["Both peers authenticated, encrypted"]
  D --> F["Composite: attach call credentials"]
  E --> F
  F --> G["Per-RPC token in authorization metadata"]
  C -.->|"call creds refused by default"| X["No token attached"]
```

> [!INTERVIEW]
> "What is the difference between channel credentials and call credentials?" is the
> canonical opener. Answer with the two-axis model, then note the safety rule: call
> creds ride in metadata and are refused over plaintext because a bearer token has no
> transport binding of its own.

## Composite Credentials

**Composite credentials** combine channel credentials with call credentials into one
object so the channel is both transport-secured *and* attaches a per-RPC token. This
is the standard production shape: TLS (or mTLS) for the transport, plus a bearer token
for authentication.

Go example (channel = TLS, call = per-RPC token):

```go
// Channel credentials: TLS validating the server cert against system roots
tlsCreds := credentials.NewTLS(&tls.Config{ /* RootCAs, ServerName, ... */ })

// Call credentials: attach an OAuth2 bearer token to every RPC
perRPC := oauth.TokenSource{TokenSource: myTokenSource}

conn, err := grpc.NewClient(
    "api.example.com:443",
    grpc.WithTransportCredentials(tlsCreds),   // channel creds
    grpc.WithPerRPCCredentials(perRPC),         // call creds
)
```

Java composes explicitly with `CompositeChannelCredentials`:

```java
ChannelCredentials creds = CompositeChannelCredentials.create(
    TlsChannelCredentials.create(),          // channel: TLS
    MoreCallCredentials.from(oauthCreds));   // call: bearer token
```

The composition is asymmetric: **channel creds must be able to provide transport
security** for call creds to attach. You cannot compose call creds onto an insecure
channel and expect the token to be sent.

## Transport Layer Security (TLS)

**TLS** is the default and expected transport security for production gRPC. In the
common configuration it provides **server authentication** (the client verifies the
server's certificate against a trusted CA and checks the hostname/SAN) plus
**encryption and integrity** of all bytes on the connection. The client is *not*
authenticated by a certificate in plain TLS — caller authentication is a separate
concern handled by call credentials.

Mechanism (at the gRPC altitude — the handshake details live in `networking`):
1. The channel opens a TCP connection and performs the TLS handshake. gRPC negotiates
   HTTP/2 via **ALPN** advertising `h2`.
2. The server presents its certificate chain; the client validates it against its
   configured **root CAs** and checks that the requested authority (hostname / `:authority`)
   matches a Subject Alternative Name (SAN) in the cert.
3. Once the handshake completes, all HTTP/2 frames (HEADERS, DATA, etc.) travel inside
   encrypted TLS records.

Server-side config (Go):

```go
serverCreds := credentials.NewServerTLSFromFile("server.crt", "server.key")
grpcServer := grpc.NewServer(grpc.Creds(serverCreds))
```

Client-side config (Go), validating against a specific CA:

```go
creds, _ := credentials.NewClientTLSFromFile("ca.crt", "" /* serverNameOverride */)
conn, _ := grpc.NewClient("host:443", grpc.WithTransportCredentials(creds))
```

> [!WARNING]
> A classic bug: the certificate's SAN must include the hostname the client dials
> (`:authority`). If you connect by IP or a name not in the SAN, verification fails
> with a handshake error. Use `serverNameOverride` (test only) or issue a cert with the
> right SANs. Modern TLS ignores the deprecated CN field for hostname matching — SANs
> are authoritative.

Concrete failure: the server cert has `SAN = DNS:api.example.com`, but the client dials
`10.0.2.15:443` (the pod IP) instead of the DNS name. The handshake presents the cert,
the client tries to match `10.0.2.15` against the SAN list, finds no matching IP entry,
and aborts with `x509: cannot validate certificate for 10.0.2.15 because it doesn't
contain any IP SANs`. Fix by dialing `api.example.com:443` (so `:authority` matches the
DNS SAN) or by reissuing the cert with `IP:10.0.2.15` added to the SANs. Note the RPC
never even starts — this is a transport handshake failure, surfaced to the caller as
`UNAVAILABLE`, not an application-level auth error.

gRPC requires **HTTP/2**, and public HTTP/2 in practice implies TLS with ALPN. gRPC
also supports **h2c** (HTTP/2 cleartext) for the insecure case, but that is dev/internal
only.

## Mutual TLS (mTLS)

**mTLS** extends TLS so that **both** peers present and verify certificates: the client
authenticates the server (as in plain TLS) *and* the server authenticates the client by
requesting and validating the client's certificate during the handshake. This gives you
**cryptographically strong, transport-level identity for both sides** — no application
token required for the *who-is-this-connection* question.

mTLS is the backbone of **zero-trust** service-to-service architectures and **service
meshes** (Istio, Linkerd), where every workload gets a short-lived certificate and all
in-mesh traffic is mutually authenticated automatically. The mesh sidecar/proxy or a
library like `xds` credentials manages certificate issuance and rotation so application
code often does not touch certs directly.

```mermaid
sequenceDiagram
  participant C as Client
  participant S as Server
  C->>S: ClientHello (ALPN h2)
  S->>C: ServerHello, server certificate, CertificateRequest
  C->>S: Client certificate, verify
  Note over C,S: both sides validate peer cert against trusted CA
  S->>C: Finished (mutual identity established)
  C->>S: HTTP/2 HEADERS + DATA (encrypted, over authenticated connection)
```

Server config requiring client certs (Go):

```go
certPool := x509.NewCertPool()
certPool.AppendCertsFromPEM(caPEM)
tlsCfg := &tls.Config{
    Certificates: []tls.Certificate{serverCert},
    ClientCAs:    certPool,
    ClientAuth:   tls.RequireAndVerifyClientCert, // enforce mTLS
}
srv := grpc.NewServer(grpc.Creds(credentials.NewTLS(tlsCfg)))
```

The `ClientAuth` policy matters: `RequireAndVerifyClientCert` is true mTLS;
`VerifyClientCertIfGiven` makes it optional (a downgrade risk if you rely on it for
authz).

> [!WARNING]
> **Cert rotation does not retroactively refresh a live connection.** gRPC channels are
> long-lived and their subchannels are pooled and reused. The peer certificates are
> negotiated *once*, during the handshake — so if SPIRE rotates a workload's SVID at
> 12:00 while a channel established at 11:30 is still open, that open connection keeps
> the *old* cert until it re-handshakes (i.e., reconnects). Concretely: SVID TTL is 1h,
> minted at 11:00 (expires 12:00), rotated to a fresh SVID at 11:50. A channel dialed at
> 11:10 and never dropped is still presenting the 11:00 cert at 12:05 — now expired — and
> the *next* reconnect (or a peer that revalidates) rejects it. This is why mesh mTLS
> pairs short TTLs with a **rotating credentials provider** (xds/tls reloader, Istio's
> SDS) that supplies the fresh cert on the *next* handshake, and why callers must be
> willing to reconnect. Contrast tokens: a call credential re-mints per-RPC, so token
> refresh is transparent on the same connection; cert refresh is not.

### SPIFFE / SPIRE identities

In mesh / zero-trust deployments, workload identity is often expressed as a **SPIFFE ID**
— a URI like `spiffe://example.org/ns/prod/sa/payments` — embedded in the certificate's
SAN (a **SVID**, SPIFFE Verifiable Identity Document). **SPIRE** is the reference
implementation that attests workloads and issues these short-lived X.509 SVIDs. The
server reads the peer's SPIFFE ID from the verified cert (via `AuthContext`) and uses it
for authorization. This decouples identity from network location (IP/DNS), which is the
whole point of zero-trust.

> [!TIP]
> mTLS authenticates the *connection/workload*; a JWT/OAuth token authenticates the
> *end user or caller principal*. Meshes commonly use both: mTLS for service-to-service
> identity and a propagated JWT for the acting user. They are not redundant.

## Insecure Channel (Plaintext)

An **insecure channel** uses no transport security — HTTP/2 in cleartext (**h2c**), no
TLS handshake, no encryption, no server authentication. In Go this is
`grpc.WithTransportCredentials(insecure.NewCredentials())`; Python has
`grpc.insecure_channel(...)`; Java has `InsecureChannelCredentials.create()`.

Use it **only** for local development, tests, or a trusted loopback where a sidecar
already handles TLS. Consequences of shipping it to production:
- All payloads (including anything sensitive in messages) are readable by anyone on the
  path.
- There is no server authentication, so you are vulnerable to man-in-the-middle.
- **Call credentials will not attach** by default (tokens require a secure transport),
  so your auth silently breaks or you are forced to weaken `RequireTransportSecurity()`.

> [!WARNING]
> `grpc.insecure_channel` / `insecure.NewCredentials()` are named "insecure" on purpose.
> They are a code smell in any config that touches production. In a mesh, the app may
> legitimately speak plaintext to a *local* sidecar that upgrades to mTLS — but that is
> loopback-only.

## Token-Based Authentication (OAuth2 / JWT)

Per-RPC caller authentication is implemented with **call credentials** that place a
token in the request metadata, conventionally:

```
authorization: Bearer <token>
```

`authorization` is a normal (ASCII) metadata key; the token is an opaque string —
usually an **OAuth2 access token** or a **JWT**. gRPC does not mint or validate tokens
itself; it provides the plumbing to attach them per-RPC and to read them on the server.
Token issuance, signing, expiry, refresh, and the full threat model live in `security`.

Client (Go) attaching a static bearer token as call creds:

```go
type bearer struct{ token string }
func (b bearer) GetRequestMetadata(ctx context.Context, uri ...string) (map[string]string, error) {
    return map[string]string{"authorization": "Bearer " + b.token}, nil
}
func (b bearer) RequireTransportSecurity() bool { return true } // refuse over plaintext
```

The token is **per-RPC** because call credentials' `GetRequestMetadata` is invoked for
each call — this lets the credential refresh a short-lived token transparently
(e.g., an OAuth2 `TokenSource` that re-mints before expiry).

> [!WARNING]
> **"Per-RPC" means per stream-open, not per message.** Metadata is sent once, in the
> initial HEADERS frame when the stream opens — so `GetRequestMetadata` runs at stream
> start and its token is fixed for the stream's lifetime. For unary calls this is fine
> (each call is its own short-lived stream). But a long-lived server/bidi stream can
> *outlive* its token: token minted at stream open with `exp` in 15 min, stream stays
> open for 2 hours → after minute 15 the token is expired but the stream keeps flowing
> DATA frames because no new metadata is ever sent. The initial validation passed and
> gRPC does not re-invoke the interceptor per message. Mitigations: keep streams short
> and re-open (re-auth) on reconnect; or push authorization into per-message
> application-level checks inside the handler; or bind stream lifetime to token `exp`
> and close when it lapses.

Why put the token in **metadata** and not in the protobuf message?
- It is cross-cutting context, not domain data — it should not pollute your `.proto`.
- Interceptors can enforce it uniformly without every handler unpacking it.
- It matches HTTP conventions (`authorization` header), so proxies/meshes understand it.

> [!KEY-TAKEAWAY]
> **Never put secrets (tokens, passwords, keys) inside protobuf message fields.** They
> belong in metadata over a secure channel, where they are handled by credentials and
> interceptors and are less likely to be logged as business data.

## Where Auth Is Enforced: Interceptors & AuthContext

Transport creds get you a secure, possibly mutually-authenticated pipe; **enforcement of
caller authorization happens in a server interceptor** (middleware). The pattern:

1. A **server interceptor** runs before the handler for every RPC.
2. It reads the `authorization` token from the incoming metadata, validates it
   (signature, expiry, audience, scopes), and either rejects with `UNAUTHENTICATED`
   (bad/missing credentials) / `PERMISSION_DENIED` (valid identity, insufficient rights)
   or lets the call proceed, often injecting the resolved principal into the context.
3. For mTLS, the interceptor (or handler) reads the verified peer identity from the
   **`AuthContext`** — the certificate-derived facts about the peer (SPIFFE ID, subject,
   SANs). Because these come from a validated cert, they are trustworthy in a way a
   self-asserted metadata field is not.

```mermaid
flowchart LR
  A["Incoming RPC"] --> B["Server interceptor"]
  B --> C{"Credentials valid?"}
  C -->|"missing / bad token"| D["Return UNAUTHENTICATED (16)"]
  C -->|"valid identity, no rights"| E["Return PERMISSION_DENIED (7)"]
  C -->|"OK"| F["Inject principal into context"]
  F --> G["Business handler"]
```

**Status-code precision** (a favorite interview trap):
- **`UNAUTHENTICATED` (16)** — the request lacks valid authentication credentials
  (missing/expired/invalid token). Maps to HTTP 401 semantically.
- **`PERMISSION_DENIED` (7)** — the caller *is* authenticated but is not authorized for
  this operation. Maps to HTTP 403. Do **not** use it for missing credentials.

`AuthContext` (Go exposes it via `peer.FromContext` + `credentials.TLSInfo`; Java via
`io.grpc.Grpc.TRANSPORT_ATTR_SSL_SESSION` / `SecurityLevel`) surfaces the peer's
`SecurityLevel` (NONE / INTEGRITY / PRIVACY) and, under mTLS, the verified client
certificate chain from which you extract the identity.

### Worked trace: one RPC end-to-end

Wire it all together with concrete values so the pieces stop being a pile of config
snippets and become one flow.

**Happy path** — client calls `PaymentService/Charge` at t = `1690000100`:

1. **Dial + handshake (channel creds).** Client does `grpc.NewClient("api.example.com:443",
   WithTransportCredentials(tls))`. TCP connects, TLS handshake runs, ALPN negotiates
   `h2`. Server presents its cert; client checks `:authority = api.example.com` against
   `SAN = DNS:api.example.com` → match. Encrypted connection established;
   `SecurityLevel = PRIVACY`.
2. **Mint token (call creds).** For this RPC, gRPC invokes `GetRequestMetadata`. The
   `TokenSource` sees the cached JWT with `exp = 1690003600` (valid for ~58 min) and
   returns `{"authorization": "Bearer eyJhbGci...aud=payments...exp=1690003600"}`.
   Because the channel is `PRIVACY`, the safety check passes and the header is attached.
3. **On the wire.** The token rides in the HTTP/2 **HEADERS** frame as
   `authorization: Bearer eyJhbGci...`, inside encrypted TLS records, alongside
   `:path = /PaymentService/Charge`.
4. **Server interceptor.** Runs before the handler. Reads the metadata, verifies the JWT
   signature, then checks `exp (1690003600) > now (1690000100)` → still valid, and
   `aud = payments` → matches this service. Resolves principal `sub = user-42`, injects
   it into the context, returns nil (proceed).
5. **Handler.** `Charge` runs, returns `OK (0)`.

**Expired-token path** — same client, but 1 hour later at t = `1690003700`:

1–3 are identical (same open channel, `TokenSource` returns the *same* cached JWT
   because it has not refreshed yet — or a bidi stream is reusing the token minted at
   step 2).
4. Interceptor checks `exp (1690003600) > now (1690003700)`? → `3600 < 3700`, **false**.
   The token expired 100 seconds ago. Interceptor short-circuits and returns
   **`UNAUTHENTICATED (16)`** — the handler never runs.
5. Client sees status 16. It must obtain a fresh token and retry. (If instead the token
   were valid but `user-42` lacked the `charge:write` scope, the interceptor would pass
   authentication but fail authorization → **`PERMISSION_DENIED (7)`**, not 16.)

> [!INTERVIEW]
> "Client sent no token / an expired token — which status?" → `UNAUTHENTICATED` (16).
> "Client is authenticated but tries an admin call it can't make?" → `PERMISSION_DENIED`
> (7). Confusing these two is the most common error-model mistake in security questions.

## ALTS (Application Layer Transport Security)

**ALTS** is Google's mutual-authentication transport, conceptually similar to mTLS but
using a different handshake and **identity model based on service accounts** rather than
X.509 PKI certificates. It provides mutual authentication and encryption for
service-to-service traffic and is designed for use **inside Google's infrastructure**
(GCP / Google internal), where the identity system is integrated.

Key points for interviews:
- ALTS is a `ChannelCredentials` alternative to TLS — same *slot*, different mechanism.
- It targets **trusted-cloud, service-account** identities; it is not a general-purpose
  internet transport like TLS. Outside Google's environment, use TLS/mTLS.
- Like mTLS, it authenticates both peers; you still layer call credentials for end-user
  auth.

## Best Practices & Gotchas

- **Always TLS in production.** Insecure channels are dev/test/loopback only. If a
  sidecar terminates TLS, the app-to-sidecar hop must be genuinely local.
- **Prefer mesh-managed mTLS** for east-west (service-to-service) traffic — short-lived,
  auto-rotated certs (SPIFFE/SPIRE, Istio) beat long-lived static certs you rotate by
  hand.
- **Short-lived certs and tokens.** Rotation limits blast radius; call credentials'
  per-RPC `GetRequestMetadata` makes transparent token refresh natural.
- **Never put secrets in messages.** Tokens/keys go in metadata over a secure channel.
- **Compose, don't choose.** Production = channel creds (TLS/mTLS) *plus* call creds
  (token). mTLS authenticates the *workload*; the token authenticates the *user/caller*.
- **Use the right status code.** `UNAUTHENTICATED` for bad/missing creds,
  `PERMISSION_DENIED` for authorized-but-forbidden.
- **Enforce, don't assume.** A secure transport does not authorize anyone; an
  interceptor must actually validate the token / peer identity.
- **Don't trust self-asserted identity in metadata for authz decisions** when you have
  cert-based identity available — read the peer from `AuthContext`, which is
  cryptographically verified.
- **Beware `VerifyClientCertIfGiven`** if you gate access on client identity — optional
  client certs allow a downgrade. Use `RequireAndVerifyClientCert` for true mTLS.
- **Validate the token fully:** signature, `exp`, `aud`, and scopes — not just presence.

## Common Interview Follow-ups

- **"Channel credentials vs call credentials — difference and how do they combine?"**
  Transport security vs per-RPC caller auth; combined via composite credentials. Call
  creds refuse to attach over an insecure channel.
- **"How does a bearer token travel with a gRPC call?"** As an `authorization: Bearer <token>`
  entry in the request metadata (an HTTP/2 HEADERS field), produced per-RPC by call
  credentials.
- **"TLS vs mTLS in gRPC — when mTLS?"** TLS authenticates the server only; mTLS
  authenticates both peers via certs. Use mTLS for zero-trust / service-mesh
  east-west traffic; TLS (+ token) for client-to-edge.
- **"Where do you enforce authentication?"** In a server interceptor that validates the
  metadata token and/or reads the verified peer identity from `AuthContext`.
- **"UNAUTHENTICATED vs PERMISSION_DENIED?"** Missing/invalid creds → `UNAUTHENTICATED`
  (16); valid identity lacking rights → `PERMISSION_DENIED` (7).
- **"Why won't my token be sent?"** You are on an insecure channel; call creds require
  transport security (or an explicit `RequireTransportSecurity() == false`).
- **"What is a SPIFFE ID and where does it live?"** A URI workload identity in the cert
  SAN (an SVID), issued by SPIRE; read from the verified cert via `AuthContext`.
- **"What is ALTS?"** Google's mTLS-like transport using service-account identity inside
  Google's infra — an alternative channel credential to TLS.
- **"Can I run gRPC without TLS?"** Yes, an insecure/h2c channel — dev only; no
  encryption, no server auth, and call creds won't attach.

## References

- gRPC docs — Authentication guide: https://grpc.io/docs/guides/auth/
- gRPC docs — Auth concepts / credentials: https://grpc.io/docs/guides/auth/#authentication-mechanisms
- gRPC ALTS: https://grpc.io/docs/languages/go/alts/ and https://grpc.io/docs/languages/cpp/alts/
- gRPC over HTTP/2 wire spec: https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md
- gRPC status code definitions: https://grpc.github.io/grpc/core/md_doc_statuscodes.html
- SPIFFE / SPIRE: https://spiffe.io/docs/latest/spiffe-about/overview/
- RFC 9113 (HTTP/2): https://www.rfc-editor.org/rfc/rfc9113
- OAuth2 Bearer Token usage (RFC 6750): https://www.rfc-editor.org/rfc/rfc6750
- Cross-ref: `networking` (TLS handshake, HTTP/2), `security` (OAuth/JWT threat model),
  `system-design` (service mesh / xDS), `reliability-ops` (resilience theory),
  `observability` (interceptor-based instrumentation).
