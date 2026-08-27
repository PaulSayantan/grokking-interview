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

**The Diffie-Hellman intuition (mixing paint).** How can two public values yield a shared
secret an eavesdropper can't reconstruct? Think of mixing paint. Both sides agree on a
public base colour. Each side secretly picks its own colour and *mixes* it with the base,
then sends the mixture across the wire. Mixing is easy; **un-mixing a blended colour back
into its components is hard.** Each side now adds its own secret colour to the *other's*
mixture — and both arrive at the identical final blend (base + secretA + secretB). The
eavesdropper saw the two public mixtures but can't separate out either secret colour, so
can't produce the final blend. Modular exponentiation is the "mixing": easy forward, but
reversing it (the discrete-log problem) is computationally infeasible.

**Worked toy example.** Public parameters `g = 5`, `p = 23`. Alice's secret `a = 6`, Bob's
secret `b = 15`.

1. Alice sends `A = g^a mod p = 5^6 mod 23`. Compute: `5^2 = 25 ≡ 2`, `5^4 ≡ 2^2 = 4`,
   `5^6 = 5^4·5^2 ≡ 4·2 = 8`. **A = 8** goes on the wire.
2. Bob sends `B = g^b mod p = 5^15 mod 23`. Compute: `5^8 ≡ 16`, so
   `5^15 = 5^8·5^4·5^2·5^1 ≡ 16·4·2·5`; `16·4 = 64 ≡ 18`, `18·2 = 36 ≡ 13`,
   `13·5 = 65 ≡ 19`. **B = 19** goes on the wire.
3. Alice computes `B^a mod p = 19^6 mod 23`. Since `19 ≡ −4`, this is `4^6`;
   `4^3 = 64 ≡ 18`, `18^2 = 324 ≡ 2`. **Shared secret = 2.**
4. Bob computes `A^b mod p = 8^15 mod 23 ≡ 2` (same value, arrived at independently).

Both sides now hold **2** without ever transmitting it. The wire only carried `g`, `p`,
`A = 8`, `B = 19`; recovering `a` or `b` from those requires solving a discrete log. (Real
TLS uses X25519 or 256-bit+ groups, not `p = 23`, but the mechanic is identical.)

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

**Worked latency example — where the round trips actually go.** Take a client in London
hitting a server in New York: real-world RTT ≈ **40 ms**. "Time to first HTTP byte on the
wire" is just (number of setup round trips) × RTT:

| Scenario | Round trips before first request | Time @ 40 ms RTT |
|---|---|---|
| **TCP + TLS 1.2 fresh** | 1 (TCP SYN/SYN-ACK) + 2 (TLS 1.2 full) = **3** | **120 ms** |
| **TCP + TLS 1.3 fresh** | 1 (TCP) + 1 (TLS 1.3) = **2** | **80 ms** |
| **TCP + TLS 1.3 0-RTT resume** | 1 (TCP); request rides the first TLS flight = **1** | **40 ms** |
| **QUIC fresh** | TCP+TLS folded into one = **1** | **40 ms** |
| **QUIC 0-RTT resume** | request ships in the very first packet = **~0** | **~0 ms** |

So the "TLS 1.3 saves a round trip" claim is concretely **120 → 80 ms = 40 ms saved** on a
fresh connection, and 0-RTT resumption saves *another* 40 ms (80 → 40). QUIC's win is that
it removes the separate TCP handshake entirely: a fresh QUIC connection (40 ms) matches a
*resumed* TLS-over-TCP connection. Multiply by the number of connections a page opens and
the difference is very visible to users.

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

**Traced chain verification.** Concretely, suppose `example.com` serves two certs and the
client trusts Let's Encrypt's root:

- Leaf: `Subject = example.com`, `Issuer = R3`, signed by R3's private key.
- Intermediate: `Subject = R3`, `Issuer = ISRG Root X1`, signed by X1's private key.
- Client's trust store contains: `ISRG Root X1` (self-signed root).

Verification walks **bottom-up**: (1) take the leaf, look at its `Issuer = R3`, find the R3
cert in what the server sent, use **R3's public key to verify the leaf's signature** — valid.
(2) Take R3, its `Issuer = ISRG Root X1`, use **X1's public key to verify R3's signature** —
valid. (3) X1 is present **in the local trust store** → anchor reached → **chain trusted.**
(The client also checks hostname/validity/revocation on top of this.)

Now the missing-intermediate failure: the server sends **only the leaf** (a very common
misconfig). The client reads `Issuer = R3` on the leaf but has no R3 cert to continue from,
and R3 is *not* a trusted root — so it can't link the leaf to any anchor. Result:
`NET::ERR_CERT_AUTHORITY_INVALID`. `curl` may still succeed if it happens to have R3 cached
or fetches it via the leaf's AIA URL, which is exactly why "works in curl, fails in browser"
appears.

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
| **OCSP stapling** | The **server** fetches a signed, time-stamped OCSP response and **staples** it into the TLS handshake (`status_request` extension, RFC 6066) | Fixes privacy + latency; needs server support. `Must-Staple` cert flag forces it |

- **OCSP stapling** is the modern preferred approach: the client gets fresh revocation proof
  without contacting the CA itself. The stapled response is signed by the CA and short-lived,
  so it can't be replayed indefinitely. Single-cert stapling uses the `status_request`
  extension (**RFC 6066**); the multi-cert variant `status_request_v2` is **RFC 6961**, and
  **Must-Staple** is the separate TLS Feature extension (**RFC 7633**) — these are three
  distinct things people often conflate.
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

> [!TIP]
> The full "is resumption safe / forward-secret?" picture is assembled from four places in
> this file: the **0-RTT replay caveat** below, the **`psk_ke` vs `psk_dhe_ke`** distinction
> under "Signature algorithms and named groups," the **STEK rotation** caveat, and the
> **0-RTT anti-replay in depth** section. Read them together before answering a resumption
> follow-up.

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

## TLS 1.3 key schedule and HKDF

**Why it matters.** A staff-level probe is "walk me through, key by key, how both sides
end up with the same application-traffic keys." TLS 1.3 answers this with a deterministic
**HKDF (RFC 5869) key ladder** (RFC 8446 §7.1). Both peers feed the same inputs (PSK,
(EC)DHE shared secret, and the running **transcript hash**) into the same functions, so
they derive identical keys without ever transmitting them.

**What Extract and Expand each do (plain words).** HKDF has two steps with opposite jobs.
**Extract = whiten:** it takes messy, non-uniform input entropy (the raw (EC)DHE shared
secret, whose bits aren't perfectly random-looking) and blends it into **one** uniform,
high-quality pseudorandom secret — think of it as a randomness laundering step. **Expand =
stretch:** it takes that single good secret and deterministically stretches it into **many**
independent, purpose-labelled keys (a client key, a server key, an IV, a Finished key, …),
each tagged with a distinct label so they can never collide. The ladder below is just
**Extract** (mix in a new keying input) alternating with **Expand** (derive named traffic
secrets from the current stage). Because each Extract folds in fresh input (PSK, then the DHE
secret) and each Expand binds to the transcript, the keys are chained — you can't compute a
later key without every earlier input.

Two helper functions build everything:

- `HKDF-Expand-Label(secret, label, context, len)` — a wrapper over `HKDF-Expand` whose
  info string is a structured `HkdfLabel` containing the length, the label **prefixed with
  `"tls13 "`**, and the context. The label prefix domain-separates TLS 1.3 key material
  from any other HKDF usage.
- `Derive-Secret(secret, label, messages) = HKDF-Expand-Label(secret, label,
  Transcript-Hash(messages), Hash.length)` — expands a secret while **binding it to the
  handshake transcript hash** up to that point.

The ladder (each `HKDF-Extract` mixes in a new keying input):

```
        0
        |
PSK -> HKDF-Extract = Early Secret
        |  +--> Derive-Secret(., "ext binder"|"res binder", "")  = binder keys
        |  +--> Derive-Secret(., "c e traffic", ClientHello)      = 0-RTT client early key
        |  +--> Derive-Secret(., "e exp master", ClientHello)
        v
   Derive-Secret(., "derived", "")
        |
(EC)DHE -> HKDF-Extract = Handshake Secret
        |  +--> Derive-Secret(., "c hs traffic", CH..SH) = client handshake traffic secret
        |  +--> Derive-Secret(., "s hs traffic", CH..SH) = server handshake traffic secret
        v
   Derive-Secret(., "derived", "")
        |
   0    -> HKDF-Extract = Master Secret
           +--> Derive-Secret(., "c ap traffic", CH..server Finished) = client app secret
           +--> Derive-Secret(., "s ap traffic", CH..server Finished) = server app secret
           +--> Derive-Secret(., "exp master",  CH..server Finished)  = exporter master
           +--> Derive-Secret(., "res master",  CH..client Finished)  = resumption master
```

- When there is **no PSK**, the Early Secret's input is a string of zeros; when there is
  **no (EC)DHE** (a `psk_ke` resumption), the Handshake Secret's input is zeros instead.
- From each `*_traffic_secret`, the actual AEAD key and IV come from
  `HKDF-Expand-Label(secret, "key"/"iv", "", len)`. The `finished_key` for the Finished MAC
  is `HKDF-Expand-Label(handshake_traffic_secret, "finished", "", Hash.length)`.
- Because the app-traffic secrets are derived over the transcript **through the server
  Finished**, and the resumption secret through the **client Finished**, both keys are
  cryptographically bound to the entire negotiation — any tampering changes the hash and
  breaks key agreement.

> [!KEY-TAKEAWAY]
> TLS 1.3 keys are never sent — they are *derived* by both sides via the HKDF ladder from
> (optional PSK) + (EC)DHE secret + transcript hash. `Derive-Secret` folds the transcript
> into every stage, which is why the whole handshake is authenticated and downgrade/tamper
> resistant.

---

## TLS 1.3 message semantics (EncryptedExtensions, CertificateVerify, Finished)

**Why it matters.** The 1.3 diagram lists messages; seniors are expected to know what each
one *does*.

- **EncryptedExtensions** — the first encrypted message after ServerHello. It carries all
  server responses to extensions that are **not** needed to establish keys (e.g. ALPN
  selection, SNI acknowledgement, `max_fragment_length`, QUIC transport params). Moving
  them here hides them from passive observers; only the key-establishment extensions
  (`key_share`, `supported_versions`, `pre_shared_key`) stay in the cleartext ServerHello.
- **CertificateVerify** — a **signature over the transcript hash** of everything sent so far
  (RFC 8446 §4.4.3), using the private key matching the leaf cert's public key. It proves
  two things at once: (1) proof of possession of the private key, and (2) that the signer
  observed the *exact* handshake the client sent — binding the identity to this specific
  negotiation. It is **not** a signature over a mere nonce.
- **Finished** — an HMAC computed with the `finished_key` over the transcript hash. It is
  the integrity check over the **entire** negotiation, so any downgrade, cipher stripping,
  or bit-flip anywhere in the handshake makes the two sides' Finished values disagree and
  aborts the connection. Both client and server send one; each verifies the peer's.

> [!INTERVIEW]
> "How does TLS stop an attacker tampering with the ClientHello to strip strong ciphers?"
> The Finished MAC covers the full transcript hash, so a modified ClientHello yields a
> mismatched Finished and the handshake fails. Combined with the CertificateVerify signature
> over the transcript, the whole negotiation is tamper-evident.

---

## Downgrade protection

**Why it matters.** "How does TLS stop an active attacker forcing a client and modern server
down to TLS 1.0?" is a standard senior probe. TLS 1.3 has two distinct mechanisms.

**ServerHello.random downgrade sentinels (RFC 8446 §4.1.3).** A TLS 1.3-capable server that
ends up negotiating a lower version writes a fixed canary into the **last 8 bytes** of
`ServerHello.random`:

- Negotiating TLS 1.2: `44 4F 57 4E 47 52 44 01` — ASCII `DOWNGRD` + `0x01`.
- Negotiating TLS 1.1 or below: `44 4F 57 4E 47 52 44 00` (`...00`).

A client that itself supports 1.3 checks these bytes. If it sees the sentinel but expected a
higher version, an on-path attacker must have edited the version negotiation, so the client
aborts with `illegal_parameter`. The sentinel is inside `ServerHello.random`, which is
covered by the server's signature/Finished, so the attacker cannot forge or strip it.

**TLS_FALLBACK_SCSV (RFC 7507).** Historically, when a handshake failed, browsers would
*retry* with a lower max version (a "downgrade dance"), and an attacker could deliberately
break the first handshake to force the retry (the POODLE-era problem). `TLS_FALLBACK_SCSV`
is a pseudo-cipher-suite the client includes **only on a fallback retry**. A server that
supports a higher version than the client is offering on that retry knows a downgrade dance
is happening and aborts with `inappropriate_fallback`. This is a 1.2-era defense; TLS 1.3's
built-in version negotiation (`supported_versions`) largely removes the need for the dance.

> [!KEY-TAKEAWAY]
> Two downgrade defenses: the `DOWNGRD` sentinel in ServerHello.random (a 1.3 server tells a
> 1.3 client "I was forced down") and `TLS_FALLBACK_SCSV` (a client tells the server "this is
> a fallback retry, reject it if you can do better"). Both defeat active version-downgrade MITM.

---

## Certificate Transparency and SCTs

**Why it matters.** CT (RFC 6962) is now **mandatory** for public certs in Chrome and
Safari. It is how mis-issuance is detected after the fact, and it replaced HPKP. Expect
"how would you find out a CA mis-issued a cert for your domain?"

- **Append-only Merkle-tree logs.** CAs (or submitters) publish every issued cert to public,
  cryptographically verifiable, append-only logs. The log's current state is a signed
  **Signed Tree Head (STH)**.
- **SCT (Signed Certificate Timestamp).** A log returns an SCT: a signed promise to include
  the certificate in its Merkle tree within the **Maximum Merge Delay (MMD, typically 24h)**.
  The browser policy requires a leaf to carry **enough SCTs from qualifying logs** (roughly
  ≥2, scaled by certificate lifetime) or it is rejected.
- **Three SCT delivery methods:** (1) embedded in the certificate as an **X.509v3 extension**
  (by far the most common), (2) via a **TLS extension** (`signed_certificate_timestamp`) in
  the handshake, (3) inside a **stapled OCSP response**.
- **Precertificate + poison extension.** To embed an SCT inside the cert, the log must sign
  it *before* the cert is finalized — a chicken-and-egg problem. The CA first logs a
  **precertificate** carrying a critical **poison extension** (making it unusable for TLS);
  the log returns SCTs, which the CA embeds into the real certificate.
- **Monitors and auditors.** Monitors watch logs for certs naming their domains (mis-issuance
  detection); auditors use **inclusion proofs** (a cert is in the tree) and **consistency
  proofs** (the tree only grew, never rewrote history) to keep logs honest.

> [!INTERVIEW]
> "You suspect a CA mis-issued a cert for your domain — how do you find out, and what stops
> it being used?" You monitor CT logs (e.g. crt.sh, or a CT monitor) for certs naming your
> domain; every publicly-trusted cert must be logged with SCTs or browsers reject it. CAA
> records + short lifetimes + MPIC reduce the chance of mis-issuance in the first place.

---

## HSTS and SSL stripping

**Why it matters.** HSTS (HTTP Strict Transport Security, RFC 6797) is the protocol-level
mechanism that makes HTTPS actually *enforced* rather than merely available. "How do you
guarantee a browser NEVER speaks plaintext HTTP to you, even on the first visit?" leads here.

- The server sends `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`.
  `max-age` (seconds) tells the browser to auto-upgrade all future `http://` requests to
  `https://` for that host and to **forbid click-through** on certificate errors (no "proceed
  anyway"). `includeSubDomains` extends this to every subdomain.
- **SSL stripping** is the attack HSTS defeats: an on-path attacker intercepts the initial
  cleartext `http://` request (or a mixed-content link) and proxies it, keeping the user on
  plaintext while talking HTTPS to the origin. HSTS makes the browser refuse plaintext to a
  known-HSTS host outright, issuing a browser-internal **`307 Internal Redirect`** to HTTPS
  before any packet leaves the machine.
- **TOFU gap.** A plain HSTS header is trust-on-first-use: the very first visit (before any
  header is seen) is still vulnerable. The **HSTS preload list** (hstspreload.org) closes
  this — domains meeting `max-age >= 31536000` + `includeSubDomains` + `preload` are compiled
  **into the browser binary**, so even the first-ever request is forced to HTTPS.

> [!WARNING]
> `preload` is hard to undo — removal from the baked-in list ships only with future browser
> releases and propagates slowly. Preload a domain only when every subdomain can serve HTTPS
> indefinitely.

---

## Certificate pinning and why HPKP was abandoned

**Why it matters.** "How do you pin certificates, and why doesn't the web pin anymore?" is a
classic.

- **HPKP (HTTP Public Key Pinning)** let a site send `Public-Key-Pins` headers listing hashes
  of allowed public keys; browsers would then refuse any chain not matching a pin.
- It was **deprecated and removed** because of two failure modes: **HPKP suicide** (a site
  pins keys it then loses/rotates incorrectly and bricks itself for the pin's lifetime with
  no recovery) and **ransom pinning / hostile pinning** (an attacker who briefly controls a
  response pins an attacker key to lock out the real owner). The blast radius and
  irreversibility were unacceptable.
- The replacement is **Certificate Transparency** (detect mis-issuance globally) plus the
  now-also-retired **Expect-CT** transitional header. **Native app pinning** (pinning in a
  mobile app you control, where you can ship updates) is still legitimate — it is *browser*
  header-based pinning that died.

---

## Post-quantum key exchange

**Why it matters.** This is the hottest 2024/25 TLS interview topic. "An attacker records all
your TLS traffic today — what can they read in 10 years?"

- **Store-now-decrypt-later (harvest-now-decrypt-later).** A future large quantum computer
  running **Shor's algorithm** breaks ECDHE/RSA, so ciphertext captured today could be
  retroactively decrypted once such a machine exists. This makes **PQ key exchange urgent
  now**, even though the quantum computer does not yet exist. PQ **signatures** are less
  urgent, because forging a signature requires an *active* attacker present at handshake time
  (you cannot retroactively forge authentication on already-completed handshakes).
- **Hybrid key exchange.** Deployments use a hybrid group such as **`X25519MLKEM768`** (the
  finalized code point; the earlier experiment was `X25519Kyber768`), which concatenates a
  classical X25519 share with a PQ **ML-KEM-768** share and mixes both secrets into the key
  schedule. **ML-KEM is FIPS 203** (standardized from CRYSTALS-Kyber). Hybrid is used as a
  **hedge**: security holds if *either* algorithm survives, protecting against both future
  quantum attacks and implementation bugs in the young PQ code (e.g. KyberSlash timing bugs).
- **Ossification cost.** ML-KEM key shares are large (~1.1 KB), so the ClientHello no longer
  fits in a single TCP/QUIC initial packet. This exposes **middlebox ossification** (boxes
  that assumed a small ClientHello) and interacts with QUIC's anti-amplification limits;
  clients may "fast-send" and fall back to HelloRetryRequest if the big hello is dropped.
- **Status (2025).** Chrome, Firefox, and Cloudflare ship `X25519MLKEM768` widely; it is
  effectively the default for new connections between updated clients and major CDNs.

> [!KEY-TAKEAWAY]
> Forward secrecy protects recorded traffic against *later key theft*, but not against a
> *future quantum computer*. Hybrid `X25519MLKEM768` (X25519 + FIPS 203 ML-KEM) addresses
> store-now-decrypt-later today, at the cost of a larger ClientHello that stresses
> middleboxes.

---

## Certificate lifetimes, CAA and MPIC

**Why it matters.** A current-events question that shows the candidate tracks the ecosystem.
Public certificate max validity is collapsing.

- **47-day certificates.** The CA/Browser Forum ballot **SC-081 (2025)** phases the maximum
  certificate validity down: **398 → 200 days (2026-03-15) → 100 days (2027-03-15) → 47 days
  (2029-03-15)**. In parallel, the reuse window for **domain control validation (DCV)** data
  shrinks toward **10 days by 2029**. The net effect: **ACME automation becomes mandatory** —
  manual renewal at these cadences is infeasible.
- **CAA records (RFC 8659).** A DNS `CAA` record lets a domain owner list **which CAs are
  permitted to issue** for the domain (e.g. `example.com. CAA 0 issue "letsencrypt.org"`). A
  compliant CA must refuse issuance if CAA forbids it, limiting mis-issuance surface.
- **MPIC (Multi-Perspective Issuance Corroboration).** CAs must now perform domain validation
  from **multiple network vantage points** and require agreement, so a localized BGP hijack or
  on-path attacker near the CA cannot spoof domain control from a single perspective.

---

## TLS record layer wire format

**Why it matters.** "What does an eavesdropper actually see per record — can they tell a
handshake record from application data?" is a wire-level question. (RFC 8446 §5.)

The `TLSPlaintext`/`TLSCiphertext` record header on the wire is 5 bytes:

```
struct {
  ContentType type;                 // 1 byte
  uint16 legacy_record_version;     // 2 bytes, always 0x0303 in TLS 1.3
  uint16 length;                    // 2 bytes: length of the following fragment
  opaque fragment[length];
}
```

- **Content types:** `handshake(22)`, `application_data(23)`, `alert(21)`,
  `change_cipher_spec(20)`. Max plaintext per record is **2^14 (16384) bytes**.
- **TLS 1.3 `TLSInnerPlaintext`.** For every *encrypted* record, the real content type is
  moved **inside** the encrypted payload, followed by optional **zero padding**:
  `content || type || zeros`. The outer header's `opaque_type` is therefore **always
  `application_data(23)`** for protected records, regardless of whether the plaintext is a
  handshake message, alert, or app data. The `legacy_record_version` is pinned to `0x0303`
  (TLS 1.2) for middlebox compatibility.
- **Consequence:** a passive observer of a TLS 1.3 connection sees only `application_data`
  records after ServerHello and cannot tell handshake-continuation, alerts, or app data
  apart, nor learn true message boundaries (the zero padding hides plaintext length).

---

## AEAD nonces, sequence numbers, and KeyUpdate

**Why it matters.** Explains why GCM nonce reuse is catastrophic and why long connections
must rekey. (RFC 8446 §5.3, §4.6.3.)

- **Per-record nonce.** There is **no explicit per-record IV on the wire**. Each side keeps a
  64-bit **record sequence number** that starts at 0 and increments per record. The AEAD
  nonce is `write_iv XOR (seq padded to iv length)`, where `write_iv` is the static
  per-direction IV from the key schedule. Both peers track the counter independently, so it
  need not be transmitted.
- **Why this matters.** AES-GCM catastrophically loses confidentiality *and* integrity if a
  (key, nonce) pair is ever reused. Deriving the nonce from a monotonic counter guarantees
  uniqueness for the lifetime of a key.

**Worked nonce trace.** Say the key schedule produced a 12-byte
`write_iv = 00 11 22 33 44 55 66 77 88 99 AA BB`. The 64-bit sequence number is left-padded
to 12 bytes and XORed in:

- **Record seq = 0:** `seq` padded = `00 00 00 00 00 00 00 00 00 00 00 00`. Nonce =
  `write_iv XOR 0` = `00 11 22 33 44 55 66 77 88 99 AA BB` (the IV unchanged).
- **Record seq = 1:** `seq` padded = `…00 00 00 01`. Only the last byte flips:
  `BB XOR 01 = BA`. Nonce = `00 11 22 33 44 55 66 77 88 99 AA BA`.
- **Record seq = 2:** last byte `BB XOR 02 = B9`. Nonce = `…AA B9`.

Each record gets a **distinct** nonce, derived identically by both peers with nothing extra
on the wire. Now the failure mode: the sequence number is 64-bit and **must never wrap or
reset under the same key**. If a buggy implementation reset the counter to 0 without
rekeying, record seq=0 would reuse nonce `…AA BB` under the same key — and a repeated
(key, nonce) in AES-GCM lets an attacker XOR the two ciphertexts to strip the keystream *and*
recover the GCM authentication subkey `H`, forging arbitrary records. That is exactly why
**KeyUpdate** rekeys (resetting the sequence number *and* changing the key together) long
before the 64-bit space is at risk.
- **KeyUpdate (`key_update(24)`).** A post-handshake message that rekeys the traffic keys
  mid-connection: the sender derives a new `*_ap_traffic_secret` via
  `HKDF-Expand-Label(secret, "traffic upd", "", len)` and resets its sequence number. This is
  used to stay under AEAD usage limits (AES-GCM has a record-count safety bound) and to
  provide forward secrecy *within* a long-lived connection. `NewSessionTicket(4)` is likewise
  sent **after** the handshake completes, and `post_handshake_auth` enables a later
  `CertificateRequest` (client auth after the connection is already up).

---

## Signature algorithms and named groups

**Why it matters.** Cipher-suite anatomy covers bulk crypto, but "what actually signs
CertificateVerify?" and "does resumption keep forward secrecy?" need the signature and
key-exchange extensions. (RFC 8446 §4.2.3, §4.2.7–4.2.9.)

- **`signature_algorithms` extension.** Separately from the cipher suite, the client
  advertises which signature schemes it accepts for CertificateVerify and for cert
  signatures. TLS 1.3 **mandates RSA-PSS** (`rsa_pss_rsae_*`) for RSA signatures and forbids
  legacy **PKCS#1 v1.5** signatures in the handshake (they remain only for old cert-chain
  signatures via a distinct code point). Other schemes: **ECDSA** (`ecdsa_secp256r1_sha256`,
  P-384), **Ed25519/Ed448**. **SHA-1 and MD5 signature schemes are banned.** This is distinct
  from the certificate's own key type — key-exchange authentication and cert signatures are
  negotiated independently.
- **`supported_groups` extension.** Lists the (EC)DHE named groups the client offers: **X25519**
  (common default), **secp256r1/secp384r1** (P-256/P-384), and finite-field **ffdhe2048+**.
  `key_share` carries the actual public value(s) for the guessed group(s).
- **`psk_key_exchange_modes` extension** (resumption): **`psk_ke`** = PSK-only resumption with
  **no fresh (EC)DHE, therefore NO forward secrecy** for the resumed session; **`psk_dhe_ke`**
  = PSK **combined with a fresh ECDHE exchange**, which **restores forward secrecy**. This is
  the subtle trap: a resumed connection is forward-secret only if `psk_dhe_ke` was used.

> [!INTERVIEW]
> "A client resumes with a session ticket — is that connection forward-secret?" Trick
> question. Only if the resumption used `psk_dhe_ke` (PSK + fresh ECDHE). With `psk_ke` there
> is no new DH, so a later PSK/ticket-key compromise exposes it. Also, even with ECDHE, an
> un-rotated Session Ticket Encryption Key (STEK) undermines forward secrecy — see resumption.

---

## Renegotiation and the secure-renegotiation extension

**Why it matters.** TLS 1.3 removed renegotiation; seniors should know *why*, not just *that*.

- **The 2009 renegotiation attack.** In TLS 1.2 and earlier, either side could trigger a fresh
  handshake within an existing connection. An MITM could open a connection, send an
  attacker-chosen prefix (e.g. an HTTP request fragment), then splice in the client's
  renegotiation — the server treated the attacker's prefix and the client's authenticated data
  as one stream (**prefix injection**), because the two handshakes were not cryptographically
  linked.
- **Fix: `renegotiation_info` (RFC 5746).** The secure-renegotiation extension (and the
  `TLS_EMPTY_RENEGOTIATION_INFO_SCSV` signaling suite) binds each renegotiation to the previous
  handshake's Finished values, so a renegotiation cannot be spliced onto an unrelated prior
  context.
- **TLS 1.3 removes renegotiation entirely**, replacing its use cases with **KeyUpdate**
  (rekeying) and **post-handshake authentication** (client auth after connect). Removing the
  feature removes the whole class of footguns.

---

## Middlebox compatibility mode and GREASE

**Why it matters.** The gotcha "why does a Wireshark capture of a TLS 1.3 connection show a
ChangeCipherSpec record if 1.3 removed it?" (RFC 8446 §D.4, RFC 8701.)

- To traverse middleboxes that were ossified around TLS 1.2's on-the-wire shape, TLS 1.3
  **disguises itself as 1.2**: `legacy_version` in ClientHello/record headers is pinned to
  **`0x0303`** and the *real* version travels in the **`supported_versions`** extension.
- The client sends a **non-empty `legacy_session_id`** and both sides emit a **dummy
  ChangeCipherSpec record** (`change_cipher_spec(20)`) even though 1.3 has no CCS semantics —
  purely so middleboxes expecting the classic pattern do not choke. Hence CCS appears in
  captures.
- **GREASE (RFC 8701)** reserves random-looking dummy values (cipher suites, extensions,
  versions, groups) that clients advertise so servers/middleboxes learn to **ignore unknown
  values** — preventing future ossification that would block real new extensions.

---

## HelloRetryRequest and the cookie extension

**Why it matters.** Deepens the HRR mention with the DoS/stateless-server angle. (RFC 8446
§4.2.2.)

- **HelloRetryRequest (HRR)** reuses the ServerHello structure with a **fixed magic random**
  (`CF 21 AD 74 ...`) so it is recognizable as an HRR rather than a real ServerHello. The
  server sends it when the client's `key_share` group is unacceptable (asking the client to
  resend with a supported group) — costing one extra RTT.
- **The `cookie` extension** serves two purposes: (1) a **reachability / DoS check** —
  forcing the client to echo a server-provided cookie proves it can receive at its claimed
  address before the server commits resources; (2) it lets the server stay **stateless across
  the HRR** by encoding a hash of the first ClientHello (and its own HRR) into the cookie,
  rather than holding connection state in memory between the two client flights.

---

## 0-RTT anti-replay in depth

**Why it matters.** "How would you actually make 0-RTT safe for a checkout API?" needs the
named mechanisms, not just "restrict to idempotent." (RFC 8446 §8.)

- **Single-use tickets (§8.1).** The server records each resumption ticket and accepts it for
  0-RTT at most once; a replay presents the same ticket and is rejected (falls back to a full
  1-RTT handshake). Requires server-side state, so it is hard across a distributed fleet.
- **ClientHello recording (§8.2).** The server remembers recently seen ClientHellos (within a
  window) and rejects duplicates. Also stateful and bounded by memory/time.
- **Freshness checks (§8.3).** The client sends `obfuscated_ticket_age`; the server compares
  the reported age against the expected age from when it issued the ticket, accepting early
  data only inside a narrow window. This bounds how long a captured 0-RTT flight is useful.
- **Design answer.** 0-RTT is **not forward-secret** and is replayable, so: allow it only for
  **idempotent** paths, combine single-use tickets + a tight freshness window, and route any
  non-idempotent request (checkout POST) through the full handshake (server rejects early data
  for those endpoints). In QUIC, 0-RTT also interacts with **address validation /
  anti-amplification** limits.

---

## Session-ticket forward-secrecy caveat (STEK rotation)

**Why it matters.** A subtle FS gotcha that resumption sections often miss.

- Session tickets (TLS 1.2) and PSK tickets (TLS 1.3 with `psk_dhe_ke`) are encrypted by the
  server under a **Session Ticket Encryption Key (STEK)**. If that STEK is **long-lived and
  then compromised**, an attacker can decrypt every ticket it protected and thereby recover
  the resumed sessions' secrets — undermining forward secrecy **even though ECDHE was used**.
- The mitigation is **frequent STEK rotation** (and secure distribution across a server
  fleet). A leaked-key exposure window then only spans one rotation period. This is why
  large-scale ticket-based resumption needs disciplined key management.

---

## Legacy TLS attack catalog

**Why it matters.** "Name TLS vulnerabilities and the design lesson each taught" is a staple.
A key meta-lesson: distinguish **protocol flaws** from **implementation bugs**.

| Attack | Target | Lesson / fix |
|---|---|---|
| **BEAST** | CBC IV predictability in TLS 1.0 | Per-record explicit IVs (1.1+); AEAD in 1.3 |
| **POODLE** | SSLv3 CBC padding | Kill SSLv3; AEAD-only |
| **Lucky13** | CBC MAC-then-encrypt timing | Constant-time or AEAD |
| **CRIME / BREACH** | TLS / HTTP compression + secrets | **Compression removed from TLS** |
| **Heartbleed** | OpenSSL heartbeat buffer over-read | *Implementation* bug, not a protocol flaw |
| **ROBOT / Bleichenbacher** | RSA PKCS#1 v1.5 padding oracle | Why static RSA is gone and RSA-**PSS** is mandated |
| **Sweet32** | 64-bit block ciphers (3DES) birthday bound | Retire 64-bit-block ciphers |
| **DROWN** | SSLv2 cross-protocol on shared key | Never enable SSLv2 anywhere |
| **Logjam / FREAK** | Downgrade to EXPORT-grade DH/RSA | Remove export ciphers; validate DH params |
| **Raccoon** | DH shared-secret timing (leading-zero) | Prefer ECDHE; constant-time handling |

> [!INTERVIEW]
> The distinction interviewers want: **Heartbleed was an OpenSSL implementation bug**
> (a missing bounds check on the heartbeat extension), *not* a weakness in the TLS protocol
> itself. CRIME/BREACH are why TLS-level compression was removed. ROBOT is why static-RSA key
> transport and PKCS#1 v1.5 signatures were dropped in favour of ECDHE + RSA-PSS.

---

## Chain building and famous root-expiry outages

**Why it matters.** "The leaf cert is valid but an old Android device can't connect — why?"
is a real debugging scenario. (Extends the "serve intermediates" advice.)

- **Path building is not linear.** With **cross-signing**, a single leaf can chain to a
  trusted root via **multiple valid paths** (e.g. one path to a newer root, another via an
  older cross-signed root that old devices trust). Clients build a path using **AIA (Authority
  Information Access)** fetching to retrieve missing issuer certs, and different clients pick
  different paths — which is why "works in curl, fails on old Android" happens.
- **AddTrust / Sectigo root expiry (May 2020).** The `AddTrust External CA Root` expired;
  clients that anchored on it (many older/OpenSSL 1.0.x stacks) broke even though a newer valid
  path existed, because their path-building preferred the expired anchor.
- **Let's Encrypt DST Root CA X3 expiry (Sept 2021).** The old cross-signing root expired;
  modern devices trusted the newer ISRG Root X1, but **old Android (<7.1.1)** lacked X1 and
  relied on the expired cross-sign — so those devices broke despite a technically valid leaf.
- **Debugging takeaway:** a valid leaf is not enough; the client must build a path to a root
  **it** trusts and that **hasn't expired**. Old clients fail on modern chains due to missing
  roots, expired anchors, or unsupported ciphers/curves.

---

## Debugging TLS on the wire

**Why it matters.** Seniors are expected to reach for concrete tools, not just theory.

- **"curl works, browser fails" (or the inverse).** Likely causes: missing intermediate
  (some clients cache it, others don't), missing/insufficient **SCTs** (browsers enforce CT,
  curl does not), a **private CA** not in the client's store, or a **SHA-1 / weak** chain a
  browser rejects but a lenient client accepts.
- **`openssl s_client`.** Inspect the served chain and negotiation:
  `openssl s_client -connect host:443 -servername host -showcerts` shows every cert the
  server sent (verify the intermediate is present); add **`-status`** to see the **stapled
  OCSP** response. Look at `Verify return code` and the negotiated version/cipher.
- **`SSLKEYLOGFILE` + Wireshark.** Point a browser/curl at `SSLKEYLOGFILE=/path` and it logs
  the per-session secrets; Wireshark reads that file to **decrypt** a captured TLS session for
  inspection — the standard way to debug TLS 1.3 traffic without the server's private key
  (which wouldn't help anyway under ECDHE).

---

## Certificate SAN, name constraints and EKU detail

**Why it matters.** mTLS and internal-CA design questions probe X.509 naming rules beyond
"use the SAN." (RFC 5280.)

- **SAN entry types.** The `subjectAltName` can hold **`dNSName`** (hostnames), **`iPAddress`**
  (for certs issued to IPs), and others. **Wildcards** match only the **single left-most
  label** — `*.example.com` matches `a.example.com` but **not** `example.com`, not
  `a.b.example.com`, and never `*.*` or a partial label like `f*.example.com`.
- **Name Constraints (on intermediates).** A `nameConstraints` extension on a CA cert
  restricts the namespaces it may issue for (e.g. permit only `*.corp.example.com`). This lets
  an org delegate a constrained sub-CA that provably cannot issue for arbitrary domains — key
  for internal-CA and mTLS trust design.
- **EKU (Extended Key Usage).** OIDs like **`serverAuth`** and **`clientAuth`** scope what a
  cert may be used for. mTLS client certs carry `clientAuth`; a server cert carries
  `serverAuth`. Chains are also validated for EKU consistency.

---

## Common follow-up questions

- Is SSL the same as TLS? No — SSL is the obsolete predecessor (SSL 2.0/3.0, all broken).
  What people call "SSL" today is really TLS. Current: TLS 1.2 and TLS 1.3.
- Why is TLS 1.3 faster? 1-RTT full handshake (vs 2-RTT in 1.2), 0-RTT on resumption, and
  fewer round trips because the client sends a key_share in the first message.
- What is forward secrecy and how does TLS 1.3 guarantee it? Compromising the server's
  long-term private key later can't decrypt past sessions, because keys come from *ephemeral*
  (EC)DHE. TLS 1.3 mandates it by removing static RSA key exchange.
- What does a cipher suite specify? Key exchange, authentication, bulk cipher, and hash
  (in 1.2). TLS 1.3 suites specify only the AEAD cipher + hash; key exchange/auth are separate.
- Why not use asymmetric crypto for everything? It's far too slow for bulk data; TLS uses
  it only to authenticate and agree on a symmetric key.
- Server sends a valid cert — is that enough? No; it must also **sign the handshake**
  (CertificateVerify) to prove it holds the matching private key, and the client must verify
  chain + hostname + validity + revocation.
- Why is the certificate encrypted in TLS 1.3 but not 1.2? Privacy — the cert reveals the
  server identity, so 1.3 sends it under handshake keys.
- Why can't you just run TLS over UDP for HTTP/3? TLS's record/handshake state machine
  needs reliable, ordered delivery; QUIC provides that per-stream and integrates the TLS 1.3
  handshake directly.
- What leaks even over HTTPS? Destination IP, port, traffic size/timing, DNS query
  (unless DoH/DoT), and SNI (unless ECH).
- When is 0-RTT unsafe? For non-idempotent requests — early data can be replayed, so
  restrict 0-RTT to safe GETs.
- How do client and server agree on HTTP/2? ALPN in the TLS handshake (`h2`).

---

## References

- RFC 8446 — The Transport Layer Security (TLS) Protocol Version 1.3
- RFC 5246 — The Transport Layer Security (TLS) Protocol Version 1.2
- RFC 6066 — TLS Extensions (Server Name Indication; `status_request` single-cert OCSP stapling)
- RFC 7301 — Application-Layer Protocol Negotiation Extension (ALPN)
- RFC 5077 — TLS Session Resumption without Server-Side State (Session Tickets)
- RFC 6960 — Online Certificate Status Protocol (OCSP)
- RFC 6961 — TLS Multiple Certificate Status Request (`status_request_v2`)
- RFC 7633 — TLS Feature Extension (`Must-Staple`)
- RFC 5280 — X.509 Public Key Infrastructure Certificate and CRL Profile
- RFC 8555 — Automatic Certificate Management Environment (ACME)
- RFC 9001 — Using TLS to Secure QUIC
- RFC 9000 — QUIC: A UDP-Based Multiplexed and Secure Transport
- RFC 9460 — Service Binding via DNS (SVCB/HTTPS records; used by ECH)
- draft-ietf-tls-esni — TLS Encrypted Client Hello (ECH)
- RFC 5869 — HMAC-based Extract-and-Expand Key Derivation Function (HKDF)
- RFC 6962 — Certificate Transparency
- RFC 6797 — HTTP Strict Transport Security (HSTS)
- RFC 7507 — TLS Fallback Signaling Cipher Suite Value (SCSV) for downgrade prevention
- RFC 5746 — TLS Renegotiation Indication Extension (secure renegotiation)
- RFC 8701 — Applying GREASE to TLS Extensibility
- RFC 8879 — TLS Certificate Compression
- RFC 9345 — TLS Delegated Credentials
- RFC 8659 / RFC 8657 — DNS Certification Authority Authorization (CAA)
- FIPS 203 — Module-Lattice-Based Key-Encapsulation Mechanism (ML-KEM)
- draft-ietf-tls-hybrid-design — Hybrid key exchange (X25519MLKEM768)
- CA/Browser Forum ballot SC-081 — 47-day certificate lifetimes
- Mozilla / MDN Web Docs — TLS, HTTPS, Transport Layer Security
- Cloudflare Learning Center — What is TLS, SSL certificates, mTLS, ECH, QUIC
