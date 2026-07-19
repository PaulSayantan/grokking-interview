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
  **RFC 6598** (CGNAT `100.64.0.0/10`).
