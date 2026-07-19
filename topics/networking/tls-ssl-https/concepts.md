# TLS, SSL & HTTPS

TLS (Transport Layer Security) is the protocol that gives us **confidentiality, integrity,
and authentication** on top of a plain byte-stream transport. "SSL" is the obsolete
predecessor name — every version of SSL (2.0, 3.0) is broken and deprecated, and what people
loosely call "SSL" today is really TLS. **HTTPS is simply HTTP carried inside a TLS session.**
This topic covers the on-the-wire mechanics: where TLS sits, how the handshake works, how
certificates and PKI establish trust, cipher suites, session resumption, SNI/ALPN, mTLS, and
how TLS layers over TCP versus QUIC.

> [!KEY-TAKEAWAY]
> TLS provides three guarantees: **authentication** (you're talking to the real server, via
> certificates), **confidentiality** (eavesdroppers see only ciphertext), and **integrity**
> (tampering is detected via AEAD/MAC). "SSL" is a dead brand name for the same idea; use
> "TLS." The current versions are **TLS 1.2 (RFC 5246)** and **TLS 1.3 (RFC 8446)**.

---

## TLS position in the protocol stack

**Why it matters.** Interviewers want to know that TLS is a distinct layer that sits
**between the reliable transport (TCP) and the application (HTTP)**. It is often described as
a "session/presentation layer" protocol in OSI terms, but pragmatically it's a shim: the
application writes plaintext, TLS encrypts it into **records**, and TCP delivers those record
bytes reliably and in order.

```
+-------------------------+
|   Application (HTTP)    |   plaintext requests/responses
+-------------------------+
|   TLS (record layer)    |   encrypts/authenticates into TLS records
+-------------------------+
|   TCP                   |   reliable, ordered byte stream
+-------------------------+
|   IP                    |   best-effort packet delivery
+-------------------------+
```

- TLS **requires a reliable, ordered transport** (TCP) because its record and handshake
  processing cannot tolerate reordering or loss. This is exactly why HTTP/3 does **not** use
  TLS-over-UDP directly — QUIC integrates the TLS 1.3 handshake into its own transport
  instead (see "TLS over TCP vs QUIC").
- The unit TLS emits on the wire is the **TLS record** (max 16 KB / 2^14 bytes of plaintext
  per record). A single application write may be split across records; a single record may
  carry several application messages.
- HTTPS = HTTP + TLS. The HTTP bytes are unchanged; TLS just wraps them. Default port is
  **443** for HTTPS vs **80** for cleartext HTTP.

> [!TIP]
> "Where does TLS sit in the OSI model?" There's no perfect answer — say it operates above
> the transport layer (L4) and below the application (L7), commonly mapped to L5/L6
> (session/presentation). The pragmatic answer interviewers accept: "between TCP and the
> application protocol."

---

## HTTPS = HTTP over TLS

**Definition.** HTTPS is the ordinary HTTP protocol running inside an established TLS session.
There is no separate "HTTPS protocol" — the client opens a TCP connection to port 443,
performs a TLS handshake, and then sends the exact same HTTP request bytes it would have sent
over cleartext, but now they travel as encrypted TLS records.

Sequence for a modern `https://example.com` request:

1. **DNS** resolves `example.com` to an IP.
2. **TCP** three-way handshake to the IP on port 443 (SYN / SYN-ACK / ACK).
3. **TLS handshake** authenticates the server and derives session keys (see below).
4. **HTTP** request/response flow inside encrypted records.
5. Connection close: TLS `close_notify` alert, then TCP FIN.

What TLS protects and what it does **not**:

- **Protected:** the HTTP method, path, headers, body, cookies — all encrypted.
- **Leaked to a network observer:** the destination **IP address**, the **port**, the
  approximate **size/timing** of traffic, and (historically) the **server name via SNI** in
  the ClientHello (mitigated by ECH — see "SNI, ESNI and ECH"). DNS lookups also leak the
  hostname unless DoH/DoT is used.

> [!WARNING]
> A common misconception: "HTTPS hides which site you visit." It hides the *content* and
> (with ECH) the SNI, but the destination IP is always visible to your ISP, and plain DNS
> reveals the hostname. Privacy requires DoH/DoT + ECH, not just HTTPS.

---

## Symmetric vs asymmetric cryptography in the handshake

**Core idea interviewers probe:** TLS uses **asymmetric (public-key) crypto only during the
handshake** to authenticate the server and agree on a shared secret, then switches to **fast
symmetric crypto** for bulk data. Asymmetric operations (RSA, ECDSA, Diffie-Hellman) are
orders of magnitude slower than symmetric ciphers (AES, ChaCha20), so using them only for key
establishment is a deliberate performance trade-off.

| Phase | Crypto type | Purpose | Examples |
|---|---|---|---|
| Authentication | Asymmetric (signatures) | Prove server identity | RSA, ECDSA, EdDSA |
| Key agreement | Asymmetric (key exchange) | Derive a shared secret | ECDHE, DHE |
| Bulk data | Symmetric (AEAD) | Encrypt/authenticate records | AES-GCM, ChaCha20-Poly1305 |
| Integrity | MAC / AEAD tag | Detect tampering | GCM tag, Poly1305, HMAC |

- The **shared symmetric key is never sent on the wire.** With (EC)DHE, both sides exchange
  public key-share values and independently compute the same secret — an eavesdropper who
  records everything still cannot derive it. This is the basis of **forward secrecy**.
- The server's **certificate** contains its long-term *public* key. In TLS 1.3 and modern
  1.2 that key is used to **sign** the handshake (proving possession of the private key), not
  to encrypt the secret.

> [!KEY-TAKEAWAY]
> Asymmetric crypto = authentication + key agreement (slow, used briefly). Symmetric crypto =
> bulk encryption of application data (fast, used for the whole session). The session key is
> derived, never transmitted.

---

## TLS 1.2 handshake

**Why it matters.** TLS 1.2 (RFC 5246, 2008) is still widely deployed, and comparing it with
1.3 is a favourite interview question. Its full handshake takes **two round trips (2-RTT)**
before application data flows.

Full TLS 1.2 handshake (abbreviated, ECDHE key exchange):

```
Client                                               Server
  | ---- ClientHello (versions, ciphers, random) ------> |
  |                                                       |
  | <--- ServerHello (chosen cipher, random) ----------- |
  | <--- Certificate (server cert chain) --------------- |
  | <--- ServerKeyExchange (ECDHE params, signed) ------ |
  | <--- ServerHelloDone -------------------------------- |
  |                                                       |
  | ---- ClientKeyExchange (client ECDHE pubkey) -------> |
  | ---- ChangeCipherSpec -------------------------------> |
  | ---- Finished (encrypted) --------------------------> |
  |                                                       |
  | <--- ChangeCipherSpec ------------------------------- |
  | <--- Finished (encrypted) --------------------------- |
  |                                                       |
  | <=========== Application Data (encrypted) ==========> |
```

Key points and gotchas:

- **2-RTT** before the client can send its request.
- **Cipher negotiation is explicit:** the ClientHello lists cipher suites; the server picks
  one and echoes it in ServerHello.
- TLS 1.2 supported **two families of key exchange**: **static RSA** (client encrypts the
  premaster secret with the server's RSA public key — **no forward secrecy**) and
  **(EC)DHE** (ephemeral Diffie-Hellman — forward secrecy). RSA key transport is a liability:
  if the server's private key ever leaks, all past recorded sessions can be decrypted.
- TLS 1.2 also carries known weaknesses if misconfigured: CBC-mode padding oracles (Lucky13,
  POODLE on SSLv3), RC4 bias, weak `EXPORT` ciphers (FREAK/Logjam). Modern config disables
  all of these.

---

## TLS 1.3 handshake

**Why it matters.** TLS 1.3 (RFC 8446, 2018) is the current best practice. It is faster,
simpler, and secure-by-default. The headline change: the full handshake is **1-RTT**, and
resumed connections can be **0-RTT**.

Full TLS 1.3 handshake (1-RTT):

```
Client                                               Server
  | -- ClientHello (+ key_share, supported groups) ----> |
  |                                                       |
  | <- ServerHello (+ key_share) ----------------------- |
  | <- {EncryptedExtensions}                              |
  | <- {Certificate}                                      |
  | <- {CertificateVerify}  (signature over transcript)   |
  | <- {Finished} -------------------------------------- |
  |                                                       |
  | -- {Finished} -------------------------------------> |
  | == Application Data (client can send after 1-RTT) === |
```
`{...}` = encrypted under handshake keys. Everything after ServerHello is encrypted,
including the certificate.

What changed from 1.2 → 1.3 (classic interview list):

- **1-RTT** full handshake (vs 2-RTT); **0-RTT** resumption possible.
- **Forward secrecy is mandatory** — only (EC)DHE key exchange is allowed. **Static RSA key
  exchange was removed entirely.**
- **The certificate is encrypted** (sent under handshake keys), unlike 1.2 where it's in the
  clear.
- **Cipher suites were slimmed** to five AEAD-only suites (e.g. `TLS_AES_128_GCM_SHA256`) and
  they no longer bundle the key-exchange/auth method — those are negotiated separately via
  `supported_groups` and `signature_algorithms`.
- **Removed legacy/broken features:** static RSA, CBC-mode ciphers, RC4, MD5/SHA-1
  signatures, compression, renegotiation, custom DHE groups. This drastically shrinks the
  attack surface.
- The client **guesses** the server's likely group and sends a `key_share` in the very first
  message; if wrong, the server sends a `HelloRetryRequest` (adds one RTT).

> [!INTERVIEW]
> "Name three things TLS 1.3 changed." Strong answer: (1) cut the handshake to 1-RTT, (2)
> made forward secrecy mandatory by removing static RSA key exchange, (3) encrypted the
> certificate and reduced cipher suites to AEAD-only. Bonus: added 0-RTT with replay caveats.

---

## Cipher suites

**Definition.** A cipher suite is the negotiated bundle of cryptographic algorithms used for
a connection. Reading a suite name is a classic interview drill.

TLS 1.2 suite name anatomy:

```
TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
 |    |     |        |      |    |
 |    |     |        |      |    +-- PRF/hash (SHA-256)
 |    |     |        |      +------- AEAD mode (GCM)
 |    |     |        +-------------- bulk cipher + key size (AES-128)
 |    |     +----------------------- authentication / signature (RSA cert)
 |    +----------------------------- key exchange (ephemeral ECDH = forward secrecy)
 +---------------------------------- protocol
```

So `TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256` = ECDHE key agreement, RSA server-cert
authentication, AES-128-GCM bulk encryption, SHA-256 for the handshake PRF/HMAC.

**TLS 1.3 suites are shorter** because they specify only the AEAD + hash — key exchange and
authentication are negotiated in separate extensions:

- `TLS_AES_128_GCM_SHA256`
- `TLS_AES_256_GCM_SHA384`
- `TLS_CHACHA20_POLY1305_SHA256`
- `TLS_AES_128_CCM_SHA256`
- `TLS_AES_128_CCM_8_SHA256`

Notes:

- **AEAD** (Authenticated Encryption with Associated Data) combines confidentiality and
  integrity in one primitive; TLS 1.3 mandates AEAD, eliminating the encrypt-then-MAC vs
  MAC-then-encrypt footguns of CBC.
- **ChaCha20-Poly1305** is preferred on devices without AES hardware (AES-NI) — e.g. many
  phones — because it's fast in software and constant-time.
- The **server picks** the suite from the client's offered list; a well-configured server
  orders by security/performance and disables weak suites.

---

## Certificates and the PKI chain of trust

**Why it matters.** Authentication is the part of TLS that stops an active man-in-the-middle.
It rests on **X.509 certificates** and a **Public Key Infrastructure (PKI)** anchored in
**root Certificate Authorities (CAs)** that your OS/browser trusts.

An **X.509 certificate** binds an identity (domain name(s)) to a public key, and is **signed
by a CA**. Key fields:

- **Subject** / **Subject Alternative Name (SAN)** — the domain(s) the cert is valid for.
  Modern clients use the SAN, *not* the legacy CN, to match the hostname.
- **Issuer** — the CA that signed it.
- **Validity** — `notBefore` / `notAfter` (expiry).
- **Public key** — the server's public key.
- **Signature** — the issuer's signature over the cert contents.

**Chain of trust:**

```
Root CA (self-signed, in OS/browser trust store, kept offline)
   └── signs → Intermediate CA
                  └── signs → Leaf/end-entity cert (example.com)
```

- The server sends the **leaf + intermediate(s)** during the handshake. The client already
  has the **root** in its local **trust store**. The client verifies each signature up the
  chain until it reaches a trusted root.
- **Roots are kept offline** and their private keys are heavily protected; intermediates do
  the day-to-day signing so a compromised intermediate can be revoked without replacing the
  root.
- A **self-signed** certificate has no CA above it, so clients reject it unless it's manually
  trusted (common in dev/internal use).

> [!TIP]
> A frequent production bug: "works in curl, fails in browser" or vice-versa. Usually the
> server forgot to send the **intermediate certificate**. The client can't build the chain to
> a trusted root, so it fails. Always serve the full chain (leaf + intermediates), never the
> root.

**CA validation levels:** Domain Validation (DV, just proves control of the domain — most
common, e.g. Let's Encrypt), Organization Validation (OV), and Extended Validation (EV).
Browsers no longer show special EV UI, so the practical difference is mostly trust process,
not user-visible security.

---

## Certificate validation

**What the client checks** before trusting a server certificate (interviewers love the full
checklist):

1. **Signature chain** — each cert is validly signed by the next, up to a trusted root in the
   local store.
2. **Hostname match** — the requested hostname matches a `SAN` entry (wildcards like
   `*.example.com` match one label). CN-only matching is deprecated.
3. **Validity window** — current time is between `notBefore` and `notAfter` (not expired, not
   future-dated).
4. **Revocation status** — the cert hasn't been revoked (CRL/OCSP — see next section).
5. **Key usage / basic constraints** — the cert is used for its intended purpose; CA certs
   have the `CA:TRUE` basic constraint, leaf certs don't (this stops a leaf cert from signing
   others — the flaw exploited before basic-constraints enforcement).
6. **Signature-in-CertificateVerify** — in the handshake the server signs the transcript with
   its private key, proving it actually **holds** the private key matching the cert's public
   key (not just possessing a copy of someone's cert).

Common validation failures and their real cause:

- `NET::ERR_CERT_AUTHORITY_INVALID` — chain doesn't reach a trusted root (self-signed, or
  missing intermediate, or private/enterprise CA not installed).
- `NET::ERR_CERT_DATE_INVALID` — expired cert or **client clock wrong**.
- `SSL_ERROR_BAD_CERT_DOMAIN` / `ERR_CERT_COMMON_NAME_INVALID` — hostname not in SAN.

> [!WARNING]
> Possessing a valid certificate is **not** proof of identity — anyone can download a site's
> public cert. Identity is proven by the server **signing the handshake with the private
> key** (CertificateVerify). That's why stealing a cert file alone is useless without the
> private key.

---

## Certificate expiry and revocation (CRL, OCSP, stapling)

**Why it matters.** Certificates expire, and sometimes must be **revoked early** (private key
compromised, CA mis-issuance, domain sold). Revocation is one of the messiest parts of PKI.

**Expiry.** Every cert has a hard `notAfter`. Certificate lifetimes have shrunk dramatically
(public TLS certs are capped at ~398 days today and trending shorter), which is why automated
issuance/renewal (ACME / Let's Encrypt) is now standard. An **expired cert** is the single
most common cause of sudden site outages.

**Revocation mechanisms:**

| Mechanism | How it works | Problem |
|---|---|---|
| **CRL** (Certificate Revocation List) | CA publishes a signed list of revoked serial numbers; client downloads it | Lists get huge; clients rarely fetch them in time |
| **OCSP** (Online Certificate Status Protocol) | Client asks the CA's OCSP responder "is serial X still valid?" in real time | Latency + **privacy leak** (CA learns which sites you visit); if responder is down, clients "soft-fail" and accept |
| **OCSP stapling** | The **server** fetches a signed, time-stamped OCSP response and **staples** it into the TLS handshake (`status_request` extension) | Fixes privacy + latency; needs server support. `Must-Staple` cert flag forces it |

- **OCSP stapling** is the modern preferred approach: the client gets fresh revocation proof
  without contacting the CA itself. The stapled response is signed by the CA and short-lived,
  so it can't be replayed indefinitely.
- Because of soft-fail and reliability issues, browsers increasingly rely on **pushed
  revocation sets** (e.g. CRLite / OneCRL / CRLSets) baked into browser updates rather than
  live OCSP. Notably, **Let's Encrypt is phasing out OCSP in favour of CRLs (2025)**.
- **Short lifetimes** are themselves a revocation strategy: a 90-day cert limits the damage
  window so heavyweight revocation matters less.

> [!INTERVIEW]
> "Why is certificate revocation hard?" Because live checks (OCSP) add latency and leak
> browsing history to the CA, CRLs are too big to fetch reliably, and soft-fail means a
> down responder is treated as "valid" — so a network attacker can just block the check.
> The industry's answer: OCSP stapling + short-lived certs + browser-pushed revocation sets.

---

## Session resumption and 0-RTT

**Why it matters.** A full handshake is expensive (asymmetric crypto + a round trip).
**Session resumption** lets a returning client skip most of it, and TLS 1.3 adds **0-RTT**
("early data") to send the request in the very first flight — with a notable security caveat.

**TLS 1.2 resumption:** two mechanisms — **Session IDs** (server keeps state, client presents
the ID) and **Session Tickets** (RFC 5077 — the server encrypts the session state into an
opaque ticket the *client* stores; server is stateless). Resumption is **1-RTT** (an
abbreviated handshake).

**TLS 1.3 resumption:** uses a **pre-shared key (PSK)** derived from the previous session and
delivered in a `NewSessionTicket` message. On return the client offers the PSK in its
ClientHello. This is also 1-RTT, or **0-RTT** if the client also sends **early data**.

**0-RTT (early data):**

- The client sends application data (e.g. a GET request) **encrypted with the resumption PSK
  in the first flight**, before the handshake completes. Latency = 0 extra round trips.
- **Replay risk:** 0-RTT early data has **no forward secrecy** for that data and, crucially,
  can be **captured and replayed** by an attacker — the server can't guarantee it hasn't seen
  this exact early-data before. Therefore **only idempotent, non-state-changing requests**
  (safe GETs) should be allowed in 0-RTT. A replayed `POST /transfer-money` would be a
  disaster.

> [!WARNING]
> 0-RTT is the one place TLS 1.3 knowingly trades security for speed. Servers must implement
> anti-replay (single-use tickets, freshness windows) and restrict 0-RTT to idempotent
> requests. Never let 0-RTT trigger side effects.

---

## SNI, ESNI and ECH

**SNI (Server Name Indication, RFC 6066).** Because many sites (virtual hosts) share one IP,
the server needs to know **which** hostname the client wants *before* it can send the right
certificate. SNI is a TLS extension in the **ClientHello** carrying the target hostname in
**cleartext**.

- Without SNI, a server hosting `a.com` and `b.com` on one IP couldn't pick the right cert.
- **The problem:** SNI is sent *before* encryption is established, so it's visible to anyone
  on the path. It leaks *which site* you're connecting to even over HTTPS — a censorship and
  surveillance vector.

**ESNI → ECH.** The fix evolved:

- **ESNI** (Encrypted SNI) was an early experimental attempt to encrypt just the SNI field.
  It had weaknesses and is **deprecated**.
- **ECH (Encrypted Client Hello)** is the current IETF approach: it encrypts the **entire
  ClientHello** (including SNI, ALPN, etc.) using a public key the client fetches from **DNS**
  (an `HTTPS`/SVCB resource record). An outer, unencrypted ClientHello carries only a generic
  "public name," so an observer sees the fronting/provider name but not the real hostname.

> [!TIP]
> ECH needs a helper: the client must learn the server's ECH public key out-of-band, which is
> published in **DNS HTTPS records**. So ECH is most effective combined with **DoH/DoT** —
> otherwise the plaintext DNS query leaks the same hostname you were trying to hide.

---

## ALPN (Application-Layer Protocol Negotiation)

**Definition.** ALPN (RFC 7301) is a TLS extension that lets client and server **agree on
which application protocol** to speak *inside* the TLS session — in the **same handshake**,
with **no extra round trip**.

- The client offers a list of protocol IDs in the ClientHello `application_layer_protocol_
  negotiation` extension (e.g. `h2`, `http/1.1`, `h3`); the server picks one and echoes it in
  the ServerHello.
- Standard identifiers: **`http/1.1`**, **`h2`** (HTTP/2), **`h3`** (HTTP/3 over QUIC).
- **Why it matters:** HTTP/2 negotiation over TLS is done *entirely* via ALPN — there's no
  Upgrade dance like cleartext `h2c`. Without ALPN, upgrading protocols would cost an extra
  round trip.
- ALPN is also used beyond HTTP — e.g. to distinguish protocols on the same port.

> [!KEY-TAKEAWAY]
> ALPN = "which protocol will we speak?" negotiated for free during the TLS handshake. It's
> how browsers and servers settle on HTTP/2 (`h2`) or fall back to HTTP/1.1 without a round
> trip. QUIC uses ALPN to select `h3`.

---

## mTLS (mutual TLS)

**Definition.** In ordinary TLS only the **server** presents a certificate; the client stays
anonymous at the TLS layer (it authenticates later, e.g. with a password or token). In
**mutual TLS (mTLS)** the **client also presents a certificate**, so both parties
cryptographically authenticate each other.

How it differs on the wire:

- The server sends a **`CertificateRequest`** message during the handshake, asking the client
  for a cert (optionally restricting to certain CAs).
- The client responds with its **Certificate** + a **CertificateVerify** signature proving it
  holds the private key.
- The server validates the client cert against a trusted CA (often a **private/internal CA**).

**Where it's used and trade-offs:**

- **Service-to-service auth** in zero-trust / microservice meshes (e.g. service meshes like
  Istio/Linkerd, SPIFFE/SPIRE) — every workload gets a short-lived cert identity.
- IoT device authentication, high-security APIs, and internal admin planes.
- **Trade-off:** strong, credential-less authentication, but you must run a **client-cert PKI**
  — issuing, rotating, and revoking client certs at scale is operationally heavy. That's why
  mTLS is common inside infrastructure but rare for public consumer web traffic.

> [!INTERVIEW]
> "How does mTLS differ from regular TLS?" Regular TLS authenticates only the server. mTLS
> adds a `CertificateRequest` so the client also presents a cert and proves key possession —
> mutual authentication. It's the backbone of zero-trust service meshes but requires managing
> a client PKI.

---

## TLS over TCP vs QUIC

**Why it matters.** HTTP/1.1 and HTTP/2 run TLS **over TCP**; HTTP/3 runs over **QUIC**, which
**integrates** TLS 1.3 rather than layering it on top. Understanding the difference is a
common HTTP/3 interview thread.

**TLS over TCP (HTTP/1.1, HTTP/2):**

- Separate, **sequential** handshakes: TCP 3-way handshake **then** the TLS handshake. So a
  fresh connection costs TCP-RTT **+** TLS-RTT before any HTTP flows (≈ 2–3 RTTs total with
  TLS 1.2, fewer with 1.3).
- TLS records ride on TCP's single ordered byte stream, so a lost TCP segment stalls
  **everything** (TCP head-of-line blocking).

**QUIC (HTTP/3):**

- QUIC runs over **UDP** and **builds TLS 1.3 into the transport** (RFC 9001) — it uses the
  TLS 1.3 handshake messages to negotiate keys, but there is **no separate TLS record layer**;
  QUIC encrypts its own packets.
- The transport + crypto handshakes are **combined**, giving **1-RTT** connection setup and
  **0-RTT** on resumption.
- QUIC provides **independent streams**, so packet loss only stalls the affected stream — no
  transport-level HOL blocking.
- Encryption is **mandatory** in QUIC/HTTP/3 (there is no cleartext mode), unlike TCP where
  TLS is technically optional.

| | TLS over TCP | QUIC (HTTP/3) |
|---|---|---|
| Underlying transport | TCP | UDP |
| TLS relationship | TLS layered *on top* of TCP | TLS 1.3 *integrated* into QUIC |
| Record/packet crypto | TLS record layer | QUIC packet protection |
| Handshake RTTs (fresh) | TCP-RTT + TLS-RTT | 1-RTT combined |
| HOL blocking | TCP-level (all streams) | per-stream only |
| Encryption | optional (in spec) | mandatory |
| Connection migration | breaks on IP change | survives via Connection ID |

> [!WARNING]
> "HTTP/3 uses TLS over UDP" is imprecise. QUIC doesn't run the TLS *record layer* over UDP —
> it uses the TLS 1.3 **handshake** for key agreement but does packet encryption itself. Say
> "QUIC integrates the TLS 1.3 handshake," not "TLS-over-UDP."

---

## Common follow-up questions

- **Is SSL the same as TLS?** No — SSL is the obsolete predecessor (SSL 2.0/3.0, all broken).
  What people call "SSL" today is really TLS. Current: TLS 1.2 and TLS 1.3.
- **Why is TLS 1.3 faster?** 1-RTT full handshake (vs 2-RTT in 1.2), 0-RTT on resumption, and
  fewer round trips because the client sends a key_share in the first message.
- **What is forward secrecy and how does TLS 1.3 guarantee it?** Compromising the server's
  long-term private key later can't decrypt past sessions, because keys come from *ephemeral*
  (EC)DHE. TLS 1.3 mandates it by removing static RSA key exchange.
- **What does a cipher suite specify?** Key exchange, authentication, bulk cipher, and hash
  (in 1.2). TLS 1.3 suites specify only the AEAD cipher + hash; key exchange/auth are separate.
- **Why not use asymmetric crypto for everything?** It's far too slow for bulk data; TLS uses
  it only to authenticate and agree on a symmetric key.
- **Server sends a valid cert — is that enough?** No; it must also **sign the handshake**
  (CertificateVerify) to prove it holds the matching private key, and the client must verify
  chain + hostname + validity + revocation.
- **Why is the certificate encrypted in TLS 1.3 but not 1.2?** Privacy — the cert reveals the
  server identity, so 1.3 sends it under handshake keys.
- **Why can't you just run TLS over UDP for HTTP/3?** TLS's record/handshake state machine
  needs reliable, ordered delivery; QUIC provides that per-stream and integrates the TLS 1.3
  handshake directly.
- **What leaks even over HTTPS?** Destination IP, port, traffic size/timing, DNS query
  (unless DoH/DoT), and SNI (unless ECH).
- **When is 0-RTT unsafe?** For non-idempotent requests — early data can be replayed, so
  restrict 0-RTT to safe GETs.
- **How do client and server agree on HTTP/2?** ALPN in the TLS handshake (`h2`).

---

## References

- RFC 8446 — The Transport Layer Security (TLS) Protocol Version 1.3
- RFC 5246 — The Transport Layer Security (TLS) Protocol Version 1.2
- RFC 6066 — TLS Extensions (Server Name Indication)
- RFC 7301 — Application-Layer Protocol Negotiation Extension (ALPN)
- RFC 5077 — TLS Session Resumption without Server-Side State (Session Tickets)
- RFC 6960 — Online Certificate Status Protocol (OCSP)
- RFC 6961 — TLS Multiple Certificate Status Request (OCSP stapling / Must-Staple context)
- RFC 5280 — X.509 Public Key Infrastructure Certificate and CRL Profile
- RFC 8555 — Automatic Certificate Management Environment (ACME)
- RFC 9001 — Using TLS to Secure QUIC
- RFC 9000 — QUIC: A UDP-Based Multiplexed and Secure Transport
- RFC 9460 — Service Binding via DNS (SVCB/HTTPS records; used by ECH)
- draft-ietf-tls-esni — TLS Encrypted Client Hello (ECH)
- Mozilla / MDN Web Docs — TLS, HTTPS, Transport Layer Security
- Cloudflare Learning Center — What is TLS, SSL certificates, mTLS, ECH, QUIC
