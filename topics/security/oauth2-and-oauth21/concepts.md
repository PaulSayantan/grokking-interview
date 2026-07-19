# OAuth 2.0 / 2.1 Delegated Authorization

OAuth is a **delegated authorization** framework: it lets a resource owner (a user)
grant a third-party application *limited* access to their resources on another service
**without sharing their password**. The user delegates a scoped, revocable permission —
represented by an **access token** — instead of handing over credentials.

This document teaches OAuth at the **protocol and threat level**: how the grant flows
work on the wire, what attacks target each step (interception, redirect/mix-up, CSRF,
token theft and replay), and the defenses OAuth 2.1 bakes in (PKCE by default, exact
redirect matching, refresh-token rotation, sender-constrained tokens). It is grounded in
**RFC 6749** (OAuth 2.0), the **OAuth 2.1 draft** (`draft-ietf-oauth-v2-1`),
**RFC 7636** (PKCE), **RFC 6819** and **RFC 9700** (Security BCP), **RFC 8628** (Device
Grant), **RFC 6750** (Bearer tokens), **RFC 9449** (DPoP), and **RFC 8705** (mTLS
sender-constraining).

> [!KEY-TAKEAWAY]
> OAuth answers "**what is this app allowed to do on the user's behalf?**" — it is
> *authorization*, not *authentication*. Proving *who the user is* is the job of OpenID
> Connect, a thin identity layer built on top of OAuth (its own topic).

---

## OAuth is delegated authorization, not authentication

**Beginner:** The whole point of OAuth is to avoid the "password anti-pattern" — where
an app asks for your Gmail password to read your contacts. Instead, you're redirected to
Google, you approve a *specific* permission ("this app may read your contacts"), and the
app receives a **token** that only grants that permission. It never sees your password,
and you can revoke the token later without changing your password.

**Why it matters:** An access token is *scoped* (limited to specific operations),
*time-boxed* (expires), and *revocable* independently of the user's credentials. If the
app is breached, the blast radius is the token's scope, not the user's full account.

**Intermediate — the classic mistake:** An access token says **nothing** reliable about
*who the user is*. It is a bearer of authorization, not an assertion of identity. Using a
plain OAuth access token to "log a user in" is a well-known anti-pattern:

- The token is opaque to the client and carries no verified identity claims.
- The **confused-deputy / token-substitution** problem: an attacker can take a token
  their own app legitimately obtained for User A and present it to a naive "Login with
  X" endpoint that just calls the provider's userinfo endpoint. Without audience
  binding, the relying app can be tricked about which client the token was issued to.

**Advanced:** This exact gap is why **OpenID Connect (OIDC)** exists. OIDC adds an
**ID token** — a signed JWT with an `aud` (audience = your client_id), `iss`, `sub`,
`nonce`, and `exp` — that is *meant* to be consumed by the client as proof of
authentication. The rule of thumb interviewers want: **access tokens are for calling
resource servers; ID tokens are for authenticating the user to the client.** Never
authenticate a user from an access token alone.

| Concern | Answered by | Artifact |
|---|---|---|
| What can this app do for the user? | OAuth authorization | Access token |
| Who is the user (to the client)? | OpenID Connect | ID token (JWT) |
| Is the user allowed to do X in *my* app? | Your app's authz logic | Your session/roles |

---

## The four roles and the endpoints

OAuth defines four roles (RFC 6749 §1.1):

- **Resource Owner** — the user who owns the data and can grant access.
- **Client** — the application requesting access on the user's behalf (a web app, SPA,
  mobile app, or backend service). Clients are **confidential** (can keep a secret,
  e.g. a server) or **public** (cannot, e.g. SPA/mobile).
- **Authorization Server (AS)** — authenticates the resource owner and issues tokens.
  Exposes the **authorization endpoint** (browser-facing, where the user consents) and
  the **token endpoint** (back-channel, where codes/credentials are exchanged for
  tokens).
- **Resource Server (RS)** — the API that holds the protected resources and accepts
  access tokens (validated per RFC 6750 / introspection RFC 7662).

**Front channel vs back channel** — a distinction interviewers love:

- The **front channel** is the browser redirect path (authorization endpoint). Anything
  that travels here is visible in the URL, browser history, `Referer` headers, and
  server logs. Assume it can leak. This is why the modern flow returns only a
  short-lived, single-use **authorization code** here — never tokens directly.
- The **back channel** is a direct server-to-server HTTPS call (token endpoint). It is
  not visible to the browser, so the actual tokens are exchanged here.

> [!TIP]
> "Why is the authorization code returned on the front channel but tokens on the back
> channel?" → because the front channel leaks, so you only expose a value that is
> useless without a second, authenticated back-channel exchange (and, in 2.1, a PKCE
> secret the attacker doesn't have).

---

## Authorization Code grant with PKCE (the 2.1 default)

**Beginner:** The authorization code flow is the primary, most secure grant. Instead of
handing the client a token in the redirect, the AS hands it a one-time **code**, which
the client swaps for tokens over the back channel. In **OAuth 2.1, this flow with PKCE
is the default for *all* client types** — public and confidential alike.

**The flow (with PKCE):**

1. Client generates a random `code_verifier` and computes
   `code_challenge = BASE64URL(SHA-256(code_verifier))` (method `S256`).
2. Browser is redirected to the authorization endpoint:

   ```http
   GET /authorize?response_type=code
       &client_id=s6BhdRkqt3
       &redirect_uri=https://app.example.com/callback
       &scope=contacts.read
       &state=xyz123
       &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
       &code_challenge_method=S256 HTTP/1.1
   Host: as.example.com
   ```

3. User authenticates and consents. AS redirects back with a **code** and the `state`:

   ```http
   HTTP/1.1 302 Found
   Location: https://app.example.com/callback?code=SplxlOBeZQ&state=xyz123
   ```

4. Client exchanges the code at the token endpoint, sending the original
   `code_verifier` (and, if confidential, its client secret):

   ```http
   POST /token HTTP/1.1
   Host: as.example.com
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code
   &code=SplxlOBeZQ
   &redirect_uri=https://app.example.com/callback
   &client_id=s6BhdRkqt3
   &code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
   ```

5. AS verifies `SHA-256(code_verifier) == stored code_challenge`, then returns tokens.

**Advanced gotchas interviewers probe:**

- The **authorization code is single-use and short-lived** (≈ ≤ 60s recommended). If a
  code is presented twice, the AS SHOULD revoke all tokens already issued for it —
  double redemption signals interception.
- The AS **must bind the code to the `redirect_uri`** used in the request and require
  the same value at token exchange (RFC 6749 §4.1.3), closing certain injection paths.
- PKCE replaces the *need* for the front channel to carry a secret; the code alone is
  worthless without the matching `code_verifier`.

---

## PKCE and the authorization code interception attack

**Beginner:** PKCE ("pixy", **Proof Key for Code Exchange**, RFC 7636) protects the
authorization code from being stolen and used by an attacker. It was created for public
clients (mobile apps) but OAuth 2.1 requires it everywhere.

**The attack it stops — authorization code interception:** On mobile, a client
registers a **custom URL scheme** (e.g. `myapp://callback`) to receive the redirect.
A **malicious app on the same device can register the same scheme** and intercept the
redirect containing the code. Without PKCE, the attacker replays that code to the token
endpoint and gets the victim's tokens — the code was the only secret, and public clients
have no client secret to bind it.

**Vulnerable pattern → exploit → defense:**

```
Vulnerable (no PKCE):
  code arrives at myapp://callback?code=ABC
  malicious app also handles myapp:// → grabs ABC
  attacker: POST /token grant_type=authorization_code code=ABC  → gets tokens ✗

Defense (PKCE):
  legit app sent code_challenge = SHA256(verifier) at /authorize
  attacker intercepts code=ABC but has NO verifier
  attacker: POST /token code=ABC code_verifier=???  → AS rejects (hash mismatch) ✓
```

**How PKCE works cryptographically:** The `code_verifier` is a high-entropy random
string (43–128 chars, RFC 7636 §4.1). The `code_challenge` sent on the front channel is
its SHA-256 hash. Because SHA-256 is one-way, an attacker who intercepts the challenge
(and the code) cannot derive the verifier. The verifier is revealed only on the
protected back channel, at exchange time.

- **Always use `S256`, never `plain`.** With `method=plain`, the challenge *equals* the
  verifier, so intercepting the front-channel request leaks the secret. OAuth 2.1: *"If
  the client is capable of using S256, it MUST use S256."* An AS should reject `plain`
  from any client capable of SHA-256.
- **PKCE also defends confidential web clients** against code injection (an attacker
  injecting a stolen code into their own session), which is why 2.1 mandates it broadly
  rather than just for public clients.

> [!WARNING]
> A downgrade risk: if the AS ignores `code_challenge_method` or accepts a token
> exchange with **no** `code_verifier` for a request that had a challenge, PKCE is
> silently bypassed. The AS MUST enforce that a code created with a challenge is only
> redeemable with a matching verifier.

---

## Client Credentials grant

**Beginner:** The client credentials grant is for **machine-to-machine** access where
there is **no user** — a backend service calling another service on its *own* behalf.
The client authenticates with its own credentials and gets an access token:

```http
POST /token HTTP/1.1
Host: as.example.com
Authorization: Basic czZCaGRSa3F0MzpnWDFmQmF0M2JW
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=reports.read
```

**Intermediate:** Because there is no resource owner and no user consent, this grant is
**only for confidential clients** — never a browser/SPA/mobile app, which cannot keep a
secret. There is **no refresh token** (the client can just re-authenticate with its
credentials any time). Tokens represent the *application's* authority, so scopes should
be tightly bound to what that service actually needs.

**Advanced:** Prefer stronger client authentication than a shared secret:
`private_key_jwt` (client signs a JWT assertion with its private key, RFC 7523) or
**mTLS** (RFC 8705), which additionally sender-constrains the token to the client's
certificate. Rotate client secrets and scope tokens to a specific audience/resource
(RFC 8707 `resource` parameter) so a leaked token can't be replayed against other APIs.

---

## Device Authorization grant

**Beginner:** The device grant (RFC 8628) is for **input-constrained devices** — smart
TVs, CLIs, IoT — that can't show a browser or accept typing. The device shows a short
`user_code` and a URL; the user completes login on their *phone or laptop*.

**The flow:**

1. Device `POST`s to the device authorization endpoint and gets back a `device_code`,
   a human-friendly `user_code`, a `verification_uri`, and an `interval`.
2. Device displays: *"Go to example.com/device and enter code WDJB-MJHT."*
3. User visits the URL on a second device, authenticates, and approves.
4. Device **polls** the token endpoint with `grant_type=urn:ietf:params:oauth:grant-type:device_code`
   until it gets `authorization_pending` → then tokens (or `slow_down`/`expired_token`).

**Advanced — threats specific to this grant:**

- **Phishing / social engineering:** because approval happens on a different device, an
  attacker can display *their* `user_code` to a victim ("enter this code to activate")
  and capture the victim's authorization. Mitigations: short expiry, clear consent
  screens naming the device/app, and rate-limiting `user_code` entry.
- **Polling abuse:** the device must respect `interval` and back off on `slow_down`;
  the AS rate-limits to prevent brute-forcing `user_code`s (hence high-entropy or
  attempt-limited codes).

---

## Deprecated grants: Implicit and ROPC (removed in 2.1)

Two OAuth 2.0 grants are **removed in OAuth 2.1** and should never be used in new work.

**Implicit grant (`response_type=token`) — removed.** It returned the access token
*directly in the front-channel redirect fragment*:

```
https://app.example.com/callback#access_token=2YotnFZF...&token_type=bearer
```

Why it's dangerous:

- The token travels on the **front channel** → exposed in browser history, `Referer`
  headers, logs, and to any script that can read the URL fragment.
- **No client authentication and no PKCE-style proof** — a token leaked from the URL is
  immediately replayable.
- It was created as a workaround for browsers lacking CORS; that constraint is gone.
  Modern SPAs use **authorization code + PKCE** instead.

**Resource Owner Password Credentials (ROPC, `grant_type=password`) — removed.** The
client collects the user's *username and password directly* and sends them to the token
endpoint:

```http
POST /token
grant_type=password&username=alice&password=hunter2&scope=...
```

Why it's an anti-pattern:

- It **reintroduces the password anti-pattern** OAuth was invented to eliminate — the
  client sees and could store the raw credentials.
- It is **incompatible with MFA, federated login, and step-up auth** (there's no
  interactive browser step).
- It trains users to type their password into arbitrary apps, defeating phishing
  resistance.

> [!INTERVIEW]
> "A team wants to use ROPC / implicit because it's simpler." Correct answer: both are
> **removed in OAuth 2.1** and discouraged by the Security BCP (RFC 9700). Migrate to
> **authorization code + PKCE**, even for first-party SPAs and mobile apps. ROPC's only
> narrow legacy justification (fully-trusted first-party clients that can't do
> redirects) is essentially obsolete.

---

## redirect_uri exact matching, open-redirect and mix-up attacks

The `redirect_uri` is where the AS sends the code back — and it is a prime attack
surface. **OAuth 2.1 requires exact string matching** against pre-registered URIs:
*"authorization servers MUST reject authorization requests that specify a redirect URI
that doesn't exactly match one that was registered"* (loopback ports on native apps are
the one exception).

**Attack 1 — open redirect via loose matching.** If the AS allows pattern/prefix/
wildcard matching (`https://app.example.com/*` or matches only the host), an attacker
crafts a request whose `redirect_uri` points to a page they control or to an open
redirector on the legitimate domain:

```
Registered loosely as host = app.example.com
Attacker sends: redirect_uri=https://app.example.com/redirect?next=https://evil.com/steal
→ code is delivered, then bounced by the open redirector to evil.com  ✗
```

Defense: **exact match**, no wildcards; register the full URI including path; ban open
redirectors on OAuth-hosting domains.

**Attack 2 — mix-up attack (multiple ASes).** When a client supports several ASes/IdPs,
an attacker can start a flow at an *honest* AS but trick the client into sending the code
(and PKCE verifier) to a *different, attacker-controlled* AS's token endpoint, or trick
the client into treating a code from the attacker's AS as coming from the honest one.
Defenses (RFC 9700):

- The AS returns an **`iss`** (issuer) parameter in the authorization response
  (RFC 9207); the client verifies it matches the AS it started with.
- Use **distinct redirect URIs per AS**, and track which AS a given `state` belongs to.

**Attack 3 — redirect_uri manipulation to steal the code.** Even with PKCE, if the AS
lets the attacker vary the redirect target, the code can be delivered to the attacker.
Exact matching plus binding the code to the redirect_uri at exchange time closes this.

> [!WARNING]
> A single **open redirect** on any OAuth-participating domain can be chained to
> exfiltrate authorization codes even when redirect matching is "close enough."
> Treat open redirects as a serious OAuth vulnerability, not a low-severity nuisance.

---

## The state parameter and CSRF on the callback

**Beginner:** `state` is an opaque, unguessable value the client generates, sends on the
`/authorize` request, and checks when the callback returns. It ties the callback to the
browser session that started the flow.

**The attack it stops — CSRF / login-CSRF on the callback.** Without `state`, an
attacker can perform an authorization flow with *their own* account, capture the
resulting **code**, and then trick the victim's browser into hitting the client's
callback URL with the *attacker's* code:

```
attacker gets code=ATTACKER_CODE for attacker's account
attacker lures victim to: https://app.example.com/callback?code=ATTACKER_CODE
victim's client exchanges it → victim is now silently logged into / linked to the
attacker's account (e.g. victim's uploads go to attacker's storage)  ✗
```

**Defense:** generate a random `state`, bind it to the user's session (store server-side
or in a signed cookie), and **reject any callback whose `state` doesn't match** the one
issued for that session. This guarantees the callback belongs to a flow *this* browser
initiated.

**Intermediate — `state` vs `nonce`:**

- `state` (OAuth) → CSRF protection on the **authorization response / callback**;
  correlates request and response.
- `nonce` (OIDC) → replay protection on the **ID token**; the client puts a random
  `nonce` in the request and verifies the same value appears inside the signed ID token.

**Advanced:** With **PKCE**, the `code_verifier` is per-session too, and modern guidance
notes PKCE also provides CSRF protection on the callback (a foreign code won't match the
session's verifier). RFC 9700 still recommends `state` (or PKCE) — and using `state` for
its intended CSRF purpose, not to smuggle app data. Don't put secrets in `state`; it
travels on the front channel.

---

## Access tokens vs refresh tokens

**Beginner:**

- An **access token** is presented to the resource server to call the API. It is
  **short-lived** (minutes) and usually a **bearer** token (RFC 6750): whoever holds it
  can use it, like cash. Sent as `Authorization: Bearer <token>`.
- A **refresh token** is a **long-lived** credential the client uses to obtain new
  access tokens *without* re-prompting the user. It is sent only to the **token
  endpoint** (back channel), never to resource servers.

```http
GET /v1/contacts HTTP/1.1
Host: api.example.com
Authorization: Bearer 2YotnFZFEjr1zCsicMWpAA
```

**Why the split matters:** short access-token lifetimes limit the damage window if one
leaks; the refresh token lets you keep sessions alive without frequent user interaction,
while remaining revocable server-side.

**Intermediate — bearer risk:** because a bearer access token needs no proof of
possession, a stolen one is fully usable until it expires. Defenses: keep lifetimes
short, scope narrowly, transmit only over TLS, and consider **sender-constraining**
(DPoP/mTLS, below). Validate tokens at the RS by signature+claims (JWT) or introspection
(RFC 7662) — check `aud`, `iss`, `exp`, `scope`.

**Advanced:** OAuth 2.1 / RFC 6750 forbid putting access tokens in the **query string**
(`?access_token=...`) precisely because URLs leak. Use the `Authorization` header. For
public clients, refresh tokens **must be sender-constrained or rotated** (next section),
because a public client can't protect a long-lived credential with a secret.

---

## Refresh token rotation and reuse detection

**Beginner:** **Rotation** means every time a client uses a refresh token, the AS issues
a **new** refresh token and **invalidates the old one**. So a refresh token is
effectively one-time-use.

**Why — detecting theft.** If an attacker steals a refresh token and uses it, then the
legitimate client later uses its (now-stale) copy — or vice versa — the AS sees an
**already-consumed refresh token being replayed**. That is a strong signal of
compromise. The AS then **revokes the entire token family** (the whole rotation chain),
forcing re-authentication and cutting off the attacker.

```
Issue RT1 → client uses RT1, gets RT2 (RT1 revoked)
Attacker stole RT1, replays it → AS sees RT1 already used
  → REUSE DETECTED → revoke RT2/RT3/... entire family  ✓
```

**Intermediate:** OAuth 2.1 requires that refresh tokens for public clients be either
**sender-constrained** or **rotated with reuse detection**. Rotation is the standard
answer for SPAs/mobile that hold refresh tokens. Refresh tokens must also be **bound to
the scope and audience** consented by the user (2.1: *"MUST be bound to the scope and
resource servers as consented by the resource owner"*) — a refresh can't be used to
escalate scope.

**Advanced gotchas:**

- **Race conditions:** legitimate clients with concurrent requests can accidentally
  replay a rotating token (two tabs refresh at once). Implementations add a short grace
  window / allow the immediately-preceding token briefly, but must still catch genuine
  reuse. Poor handling causes false-positive lockouts.
- Rotation limits the value of a stolen refresh token to a single use *and* gives you a
  detection tripwire — it does not by itself stop the *first* malicious use, which is
  why sender-constraining (DPoP) is stronger for high-value scenarios.

---

## Scopes and least privilege

**Beginner:** A **scope** is a space-delimited list of permissions the client requests
(`scope=contacts.read files.write`). The AS shows them on the consent screen; the issued
token is limited to the granted scopes. Scopes implement **least privilege** for
delegated access.

**Intermediate:**

- Request the **minimum** scopes needed, and request them **incrementally** (ask for
  more only when a feature needs it) rather than a giant upfront grant — better consent
  UX and smaller blast radius.
- The **granted** scope can differ from the **requested** scope; the token response
  includes a `scope` field when it does. Clients must handle down-scoping gracefully.
- Scopes are **coarse authorization for the RS**, not a substitute for the RS's own
  fine-grained access control. A `files.write` scope says the client *may* write files;
  the RS still must check *which* files this user owns. Scope != object-level authz
  (this is where API broken-object-level-authorization bugs live — owned by API
  security, but the boundary matters).

**Advanced:** Combine scopes with the `resource`/`audience` parameter (RFC 8707) so a
token is valid only at the intended resource server. Downscope tokens per audience
(token exchange, RFC 8693) instead of minting one god-token that every service accepts —
that limits replay if one RS is compromised.

---

## Token leakage via referrer, logs and browser history

**Beginner:** Tokens and authorization codes are secrets. If they end up in a **URL**,
they leak through channels most people forget about.

**Leak channels:**

| Channel | How the secret escapes |
|---|---|
| `Referer` header | Browser sends the current URL (with `?code=`/`#access_token=`) to any resource/link on the page → third-party JS, images, analytics see it |
| Browser history | Front-channel URLs with tokens/codes persist in history and sync |
| Server / proxy / CDN logs | Query strings are logged by default at every hop |
| Shared / bookmarked links | A URL with a token pasted into chat grants access to anyone |
| Open redirects | Bounce a code-bearing URL to an attacker domain (see redirect section) |

**Defenses:**

- **Never put tokens or codes in the query string / fragment for the RS.** Access tokens
  go in the `Authorization` header (RFC 6750 bans the query string). The implicit grant's
  fragment delivery is removed in 2.1 for exactly this reason.
- The authorization code is the *only* secret allowed on the front channel, and it's
  single-use, short-lived, and (with PKCE) useless without the verifier.
- Set **`Referrer-Policy: no-referrer`** (or `strict-origin`) on OAuth callback pages so
  the code isn't leaked via `Referer` to third-party content.
- **Strip codes from the URL** after handling the callback (redirect to a clean URL /
  `history.replaceState`) so they don't linger in history.
- Scrub query strings from access logs; TLS everywhere (TLS protects the wire, not the
  logs at the endpoints).

> [!WARNING]
> The `Referer` leak is why the implicit grant was fundamentally unsafe: the access
> token sat in the URL fragment, and any third-party script or resource loaded by the
> callback page could exfiltrate it.

---

## Sender-constrained tokens: DPoP and mTLS

**Beginner:** A **bearer** token has a fatal property — *anyone who holds it can use
it.* **Sender-constrained** (proof-of-possession) tokens fix this: the token is
cryptographically bound to a key the legitimate client holds, so a stolen token is
useless without the private key.

**Two mechanisms:**

- **mTLS-bound tokens (RFC 8705):** the token is bound to the client's TLS **client
  certificate**. The RS checks that the certificate on the current TLS connection
  matches the certificate thumbprint (`cnf: { "x5t#S256": ... }`) embedded in the token.
  Strong, but needs certificate infrastructure — common in server-to-server / regulated
  (FAPI, open banking) contexts.

- **DPoP — Demonstrating Proof-of-Possession (RFC 9449):** an application-layer scheme
  for public clients (SPAs/mobile) that can't easily do mTLS. The client holds a
  key pair and sends a signed **DPoP proof JWT** with each request:

  ```http
  GET /v1/contacts HTTP/1.1
  Host: api.example.com
  Authorization: DPoP <access_token>
  DPoP: <signed JWT: htm=GET, htu=https://api.example.com/v1/contacts,
         iat=..., jti=..., signed by the client's private key>
  ```

  The access token carries a `cnf` claim with the **thumbprint of the client's public
  key (`jkt`)**. The RS verifies the DPoP proof signature and that its thumbprint matches
  the token's `cnf`. A stolen access token alone is now useless — the attacker lacks the
  private key needed to mint a valid DPoP proof.

**Advanced:** DPoP proofs include `htm` (HTTP method), `htu` (URL), `iat`, and a unique
`jti` so the RS can bind the proof to *this* request and reject replays (nonce/`jti`
caching). OAuth 2.1 *recommends* sender-constraining access tokens (DPoP or mTLS) and
*requires* refresh tokens for public clients to be sender-constrained **or** rotated with
reuse detection. This is the strategic answer to "bearer tokens can be replayed."

---

## Public vs confidential clients and token storage

**Beginner:** A **confidential** client (server-side app) can safely store a client
secret and use it to authenticate to the token endpoint. A **public** client (SPA,
native/mobile) **cannot** keep a secret — the code ships to the user's device/browser —
so it authenticates with **PKCE** instead of a secret.

**Intermediate — where do SPAs store tokens?** A genuine tradeoff interviewers probe:

- **`localStorage`** — readable by any JS on the page → **any XSS steals every token**.
  Convenient but the weakest for token secrecy.
- **In-memory (JS variable)** — lost on refresh, but not persisted where XSS can grab it
  later; still stealable by active XSS during the session.
- **`HttpOnly`, `Secure`, `SameSite` cookie** (via a lightweight backend / BFF) — not
  readable by JS, so XSS can't exfiltrate the token, but you must add CSRF defenses.

**Advanced — the BFF pattern:** The current recommendation for browser apps (per the
OAuth for Browser-Based Apps BCP) is a **Backend-For-Frontend**: a server-side component
holds the tokens, the browser holds only a normal `HttpOnly` session cookie, and the BFF
attaches the access token to API calls. This keeps tokens entirely out of reach of
front-end JS/XSS. When a token *must* live in the browser, keep it in memory, use
authorization-code+PKCE, short lifetimes, refresh-token rotation, and DPoP.

> [!KEY-TAKEAWAY]
> The choice isn't "which grant is easiest" — it's **can this client keep a secret?**
> Public clients → auth-code + PKCE, rotated/sender-constrained refresh tokens, and
> ideally a BFF so raw tokens never touch front-end JavaScript.

---

## Authorization code injection (distinct from interception)

**Intermediate:** *Code injection* (RFC 9700 §4.5) is a named attack that is **distinct
from code interception** (the mobile-scheme theft PKCE was born for) and from the
login-CSRF code-swap covered in the `state` section. In injection, the attacker has
somehow obtained a **valid authorization code for the victim** (via a leak channel —
`Referer`, logs, an open redirect, a mix-up) and injects it into **the attacker's own
otherwise-legitimate session** on the client, so the victim's authorization/identity gets
bound to the attacker — or, in the reverse direction, the attacker forces the victim's
client to redeem a code, binding the victim to attacker-controlled data.

**Why PKCE stops it:** the code is only redeemable together with the `code_verifier`
generated by the browser instance that **started** that specific flow. An injected code
arriving in a session that started with a *different* `code_verifier` fails the
`SHA-256(verifier) == challenge` check. In OIDC, the `nonce` inside the ID token provides
the equivalent binding for the identity leg. So PKCE (or `nonce`) binds the code to the
originating user agent — this is precisely why RFC 9700 mandates PKCE for **confidential**
clients too, not only public ones.

> [!INTERVIEW]
> "PKCE is just for mobile code interception, right?" No. PKCE also stops **code
> injection** into a confidential web client — the code is worthless without the
> per-session verifier. Interception (attacker steals the code before redemption) and
> injection (attacker replays a leaked code into a session) are separate RFC-named
> attacks; PKCE addresses both.

---

## PAR, JAR and JARM: hardening the request and response

Three complementary specs harden the authorization *request* and *response* against
front-channel tampering. FAPI 2.0 (financial-grade) profiles require them.

**PAR — Pushed Authorization Requests (RFC 9126).** Instead of putting request
parameters in the browser URL, the client **POSTs them to a `/par` endpoint over the
back channel** (authenticating itself), and receives a one-time
`request_uri` (a URN like `urn:ietf:params:oauth:request_uri:bwc4JK-...`) with a short
`expires_in` (typically 5–600s). The browser then hits
`GET /authorize?client_id=...&request_uri=...` carrying only that reference. Benefits:

- **Request integrity/confidentiality** — parameters never traverse the browser, so they
  can't be tampered with, logged, or leaked in the URL.
- **Early, strong client authentication** at request time.
- **Kills front-channel `redirect_uri` tampering:** because the request was submitted by
  an *authenticated* client, the AS binds it to that client; an attacker can't smuggle a
  rogue `redirect_uri` or swap parameters on the URL.

**JAR — JWT-Secured Authorization Request (RFC 9101).** The request parameters are packed
into a **signed (optionally encrypted) JWT** passed as the `request` value (or referenced
by `request_uri`). The signature gives the AS integrity/authenticity of the parameters so
front-channel values can't be altered. PAR and JAR compose: you can push a signed request
object to `/par`.

**JARM — JWT Secured Authorization Response Mode (OpenID).** Signs the **response**:
`response_mode=query.jwt | fragment.jwt | form_post.jwt` wraps the authorization response
(including the code) in a JWT carrying `iss`, `aud`, `exp`. This gives response integrity
and adds **mix-up** and **code-leak/injection** defense on the *return* leg (the client
verifies the issuer and audience of the signed response). JARM protects the response; it
does **not** replace PKCE (which binds the code to the browser instance).

> [!TIP]
> The FAPI-grade "request/push/response" triad: **JAR** signs the request, **PAR** pushes
> it over the back channel, **JARM** signs the response. Combined with PKCE `S256`,
> `private_key_jwt`/mTLS client auth, and sender-constrained tokens, this is the
> high-assurance flow interviewers ask you to design.

---

## JWT validation attacks at the resource server

When access/ID tokens are JWTs, the resource server (or client, for ID tokens) becomes a
JWS/JWA verifier — and inherits classic JWT attacks. (The JWT/JOSE primitives have their
own topic; here is the OAuth-RS validation angle.)

- **`alg: none`** — the JWS "unsecured" algorithm. If the verifier accepts `none`, an
  attacker strips the signature and forges arbitrary claims. Defense: never accept
  `none`; pin an allowlist of expected algorithms.
- **RS256 → HS256 algorithm/key confusion.** The AS signs with RSA (RS256) and publishes
  the **public** key (via JWKS). If the RS calls a naive `verify(token, key)` that picks
  the algorithm from the *token header*, an attacker changes `alg` to `HS256` and signs a
  forged token using the **RSA public key bytes as the HMAC secret** — which the verifier
  then "verifies" with that same public key. Defense: **pin the expected algorithm**
  server-side (don't trust the header `alg`); use separate keys per algorithm; prefer
  libraries that require you to specify the algorithm.
- **`jwk` / `jku` header injection.** The attacker embeds their own public key in the
  token's `jwk` header, or points `jku` at a URL they control, so the token "verifies"
  against an attacker key. Defense: ignore token-supplied keys; resolve keys only from the
  AS's pre-configured `jwks_uri`, and pin/allowlist that origin.
- **`kid` abuse.** `kid` (key id) is attacker-influenced input used to select a key —
  vulnerable to **path traversal** (e.g. pointing at a predictable file like an empty
  `/dev/null` to force an empty/known key) and **SQL injection** if used in a query.
  Defense: treat `kid` as an opaque lookup key against a fixed keyset; never interpolate
  it into paths or queries.
- **Weak HMAC secret brute-force.** A short/guessable `client_secret_jwt` HMAC key can be
  cracked offline (e.g. hashcat mode 16500). Defense: high-entropy secrets, or asymmetric
  signing.
- **Decode vs verify confusion.** Reading claims (`decode`) is not the same as
  cryptographically **verifying** the signature. Trusting decoded claims without
  verification is a frequent real-world bug.

Mandatory RS claim checks regardless: signature (via JWKS), `iss`, `aud` (must equal *this*
RS/client), `exp`, `nbf`, `iat`, and `scope`.

---

## Access-token audience confusion and confused-deputy login

**Advanced:** The single most common "Login with Facebook/Google" account-takeover class
is accepting an **access token whose audience was never verified**. Salt Labs' 2023
"OhAuth" research found major sites (affecting 100M+ users across services like
Grammarly, Vidio, Bukalapak) whose social-login **backends accepted an `access_token`
without checking it was issued for their own app/`client_id`/`aud`**.

**The exploit:** the attacker registers their *own* app with the same IdP, has a victim
use that app (or otherwise mints a token for the victim), then **injects that token into
the victim-site's social-login endpoint** (often just an `access_token` parameter). The
victim site calls the IdP's userinfo/profile endpoint, gets the victim's email, and logs
the attacker in as the victim. Some sites used a `code` but still accepted an
`access_token` parameter that was discoverable by **brute-forcing the parameter name**.

**The one-line fix:** before trusting a social-login access token, **verify its
audience** — Facebook's `debug_token` (returns the `app_id` the token was minted for),
Google's `tokeninfo`, or RFC 7662 introspection — and reject tokens not issued for your
own app. Then **link accounts by the provider's immutable `sub`**, never by mutable email.
This is exactly why an access token is not proof of authentication (see the delegated-authz
section) and why OIDC ID tokens carry an `aud` bound to your `client_id`.

---

## Consent phishing and illicit application grants

**Advanced:** *Consent phishing* (a.k.a. illicit consent grant / illicit application
grant) attacks the human consent step rather than any redirect flaw. The attacker
registers a malicious OAuth app with a **plausible name** and sends the victim a genuine
provider consent link requesting sensitive scopes (mailbox, contacts, files). The victim
approves; the app receives a **real token** and long-lived offline access — **no password
is stolen and MFA is not bypassed but is irrelevant**, because the user willingly delegated
access. The canonical incident is the **2017 Google Docs worm**, where an app literally
named "Google Docs" harvested Gmail/contacts consent and self-propagated.

Defenses are organizational/consent-integrity, not protocol tweaks:

- **Publisher verification** and app allowlisting; block/limit user consent to
  unverified third-party apps (admin consent workflow).
- **Scope review** and least-privilege consent screens that clearly name the app and
  scopes.
- **Anomalous-consent detection** (unusual apps, mass grants, risky scopes) and easy
  grant revocation.

This attack survives MFA and password managers, which is why it is treated as a
first-class threat distinct from redirect/token attacks.

---

## 307 vs 303, clickjacking, and client impersonation

Three RFC 9700 edge cases interviewers use as quick discriminators.

**307 vs 303 credential leak (§4.12).** After the user submits the login/consent **form
(a POST)**, the AS redirects the browser to the client's `redirect_uri`. If it uses HTTP
**307 Temporary Redirect**, the browser **re-sends the POST body — including the user's
credentials — to the client**. The AS **MUST use 303 See Other**, which forces the
follow-up request to be a GET with no body. Answer to "which status code and why": 303,
because 307 replays the credential POST to the redirect target.

**Clickjacking the consent screen (§4.16).** If the authorization/consent UI can be
**framed**, an attacker overlays it and tricks the user into approving. Defense: send
`X-Frame-Options: DENY` (or `SAMEORIGIN`) and/or CSP `frame-ancestors 'none'` on the
authorization endpoint so the consent page cannot be embedded.

**Client impersonation / `client_id` confusion (§4.15).** The AS **SHOULD NOT** let a
client influence `client_id`, `sub`, or other identifiers such that a client could collide
with a genuine resource owner or another client — a multi-tenant AS pitfall. Identity and
client identifiers must come from trusted server state, not attacker-supplied parameters.

---

## redirect_uri parser bypasses

Exact-string matching is necessary but implementers still get it wrong. A "validated"
matcher can be defeated by:

- **Prefix/suffix append** when the AS does a prefix or `startsWith` check:
  `https://legit.com/cb` "matches," so does `https://legit.com/cb.evil.com` or
  `https://legit.com/cb/../../evil`.
- **URL-parser discrepancies** between the validator and the browser, e.g.
  `https://legit.com&@evil.net#@evil.net/` or userinfo/`@` tricks where the two parsers
  disagree on the host.
- **Parameter pollution** — duplicate `redirect_uri` params
  (`?redirect_uri=legit&redirect_uri=evil`) where validator and consumer pick different
  occurrences.
- **Domain-suffix / subdomain tricks** — `localhost.evil.com`, or treating a registered
  suffix loosely so `evilapp.example.com` passes.
- **`response_mode` swap** (query → fragment / `web_message`) to widen what subdomains or
  handlers receive the response.
- **Directory traversal** `.../../` to reach an open-redirect or proxy page on the
  legitimate host, then bounce the code out.
- **`Referer` / HTML-injection exfiltration** — inject an `<img src=//evil>` on the
  landing page so the code (still in the URL) leaks via the `Referer` header.

Defense: **byte-for-byte exact match** against the full registered URI, canonicalize with
one well-tested parser, forbid duplicate params, and eliminate open redirectors on any
OAuth-participating host. PAR (above) removes browser-supplied `redirect_uri` tampering
entirely by binding the request to an authenticated client.

---

## Scope escalation at the token endpoint

**Advanced:** The `scope` parameter appears on both `/authorize` and `/token`. A weak AS
lets a client **add scopes at exchange time** (in the code→token request, or on a refresh)
that the user never consented to — or, in the old implicit/`/userinfo` pattern, request a
broadened token. RFC 6749 §3.3 requires the granted scope to be **⊆ the originally
consented scope**; refresh MUST NOT escalate (the refresh may narrow scope but never widen
it). This is a staple PortSwigger lab.

Defense: bind the issued token's scope to what was actually **consented at
authorization**; validate any `scope` on `/token` is a subset; and for refresh, cap at the
originally granted set. Pair with audience (`resource`, RFC 8707) so a token can't be
replayed at an unintended RS.

---

## Account-linking takeover via unverified identifiers

**Advanced:** When "Login with X" **links to a pre-existing local account by email**, an
IdP that lets users register an **unverified** email address enables takeover: the
attacker registers the victim's email at a sloppy IdP, logs into the target site via that
IdP, and the site links them to the victim's existing account. Root cause: trusting a
**mutable, unverified identifier** for account linking.

Defenses: require `email_verified == true` before using an email for anything security
relevant; **link accounts on the provider's immutable `sub`**, never on email; and when
linking to an existing local account, require the user to prove control (re-authenticate
with the local password or verify the email out of band). This pairs with the
audience-confusion fix — verify the token/`aud` *and* link by `sub`.

---

## Cross-device consent phishing (device-code phishing)

**Advanced:** The device grant's phishing risk (noted earlier) generalizes to
**Cross-Device Consent Phishing (CDCP)**, formalized in
`draft-ietf-oauth-cross-device-security`. The BCP distinguishes:

- **CDCP** — the attacker gets the victim to **grant consent** for a flow the attacker
  initiated (device-code / QR / CIBA style).
- **CDSP** — cross-device *session* phishing (transferring an authenticated session).

**Root cause:** there is **no authenticated, proximity-bound channel** between the two
devices — the user can't tell that the code they're approving originated from the attacker
rather than the device in front of them. Because the victim authenticates normally on
their own trusted device, **MFA does not stop it**. The 2025 **Microsoft Entra
device-code phishing** campaigns (attributed to **Storm-2372**) emailed victims a real
Microsoft device code and asked them to enter it at the genuine
`microsoft.com/devicelogin`, harvesting tokens.

Mitigation menu (BCP): **establish proximity** (Bluetooth/NFC/QR that proves co-location),
**authenticate-then-initiate**, **request-initiation verification** (show the user *what*
device/app started this), **out-of-band request binding**, restrict to **trusted
devices/networks** (Conditional Access), **short one-time codes**, **limited scope**, and
**rate-limiting** (also counters MFA-fatigue/push-bombing). Admins should scope or disable
the device-code flow where it isn't needed.

---

## XSS threat model for browser apps: BFF vs token-mediating vs SPA

**Advanced:** The Browser-Based Apps BCP enumerates four XSS attack scenarios against a
browser client that holds (or can obtain) tokens:

1. **Single-shot token theft** — XSS reads the current token from memory/storage and
   exfiltrates it once.
2. **Persistent token theft** — malicious script keeps stealing freshly-issued tokens;
   this **defeats short lifetimes and refresh rotation**, because the attacker keeps
   getting the new tokens.
3. **Silent-iframe / new-token acquisition** — the script runs a *fresh* authorization
   flow (hidden iframe / silent renew) using the app's own session, minting brand-new
   tokens. The BCP states there is **"no practical mechanism"** to fully counter this
   while tokens live in the browser.
4. **Request proxying** — the script simply issues authenticated API calls *through the
   victim's own browser*, riding the app's live session.

**The senior insight:** because the attacker executes in the app's own origin,
**DPoP and refresh-token rotation do NOT stop scenarios 3 and 4** — the attacker can mint
new sender-constrained tokens or just proxy requests using the legitimate key/session.
The only architecture that mitigates them is a **confidential-client BFF** where tokens
**never reach the browser** at all (the browser holds only an `HttpOnly` session cookie).
The BCP's three patterns, from strongest to weakest: **BFF** (tokens server-side) >
**token-mediating backend** (backend brokers tokens, still exposes some to JS) >
**browser-only SPA** (tokens in JS — accept the residual XSS risk with PKCE, short
lifetimes, rotation, DPoP). Bottom line to state in an interview: **XSS defeats
client-side token protections; only keeping tokens off the browser truly helps.**

---

## Client authentication methods

**Advanced:** A confidential client authenticates to the token (and PAR) endpoint using
one of these registered methods (OIDC/RFC 7591 `token_endpoint_auth_method`):

| Method | Mechanism | Notes |
|---|---|---|
| `none` | (public client) | No secret; relies on PKCE. |
| `client_secret_basic` | shared secret in HTTP Basic header | Common default; secret at rest on both sides. |
| `client_secret_post` | shared secret in POST body | Equivalent trust to basic; body vs header. |
| `client_secret_jwt` | HMAC-signed JWT assertion (shared secret as key) | Secret never sent on the wire, but weak secrets are brute-forceable. |
| `private_key_jwt` | client signs a JWT assertion with its **private key** (RFC 7523) | **AS stores only the public key — no shared secret at rest.** |
| `tls_client_auth` | mTLS with a CA-issued client cert (RFC 8705) | PKI-based; also enables cert-bound tokens. |
| `self_signed_tls_client_auth` | mTLS with a self-signed cert (RFC 8705) | Client registers the cert/thumbprint; no CA. |

**Ranking:** asymmetric methods (`private_key_jwt`, mTLS) are preferred because the AS
never holds a replayable shared secret and the client can rotate keys independently; both
support proof-of-possession. Shared-secret methods are simpler but the secret is a
theft/leak target on both sides. FAPI 2.0 requires `private_key_jwt` or mTLS.

---

## Token validation: JWT vs introspection, JWKS and revocation

**Advanced:** Two ways an RS validates a token, with a real tradeoff:

- **Self-contained JWT (local validation):** fast, stateless, no network hop — the RS
  verifies the signature against the AS's **JWKS** (fetched from `jwks_uri`, key selected
  by `kid`, cached and refreshed on **key rotation**) and checks `iss`/`aud`/`exp`/`nbf`/
  `scope`. **Downside: you cannot revoke a JWT before its `exp`** — it's valid until it
  expires no matter what.
- **Introspection (RFC 7662):** the RS calls the AS's `/introspect` on each token,
  getting a real-time `active: true/false`. This supports **immediate revocation** and
  **opaque tokens**, at the cost of a network round-trip and coupling/load on the AS.

**"Can you revoke a JWT access token?"** Not before expiry, given local validation. Mitigate
with **short lifetimes**, a **`jti` denylist / revocation list** checked at the RS, or
switching that RS to introspection. Key-rotation handling (multiple valid `kid`s in JWKS
during rollover) and caching JWKS with a sane TTL are the operational details interviewers
probe.

---

## DPoP and mTLS binding internals

Deepening the sender-constraining section with the depth signals.

**DPoP (RFC 9449) edge cases:**

- **DPoP nonce.** To stop an attacker **pre-generating** or replaying proofs, the AS/RS
  can require a server-chosen nonce: it returns `401` with `DPoP-Nonce:` and error
  `use_dpop_nonce`; the client must include that `nonce` claim in the next proof. This
  binds the proof to a server-controlled freshness value.
- **`jti` + `iat` replay defense.** The RS caches proof `jti`s and enforces a small `iat`
  clock-skew window so a captured proof can't be replayed.
- **`ath` claim.** The proof includes `ath` = base64url(SHA-256(access token)), binding
  *this* proof to *this* access token so a proof can't be paired with a different token.
- **DPoP-bound refresh tokens.** For public clients, the refresh token itself can be
  DPoP-bound, so a stolen refresh token is useless without the private key.

**mTLS binding (RFC 8705):** the cert-bound access token carries
`cnf: { "x5t#S256": <base64url SHA-256 of the client cert> }`. On each call the RS compares
that thumbprint to the client certificate presented on the **current mutually-authenticated
TLS connection**. Two flavors: **PKI mutual-TLS** (`tls_client_auth`, CA-issued cert
matching registered subject) and **self-signed** (`self_signed_tls_client_auth`, matches a
registered cert/thumbprint). DPoP is `cnf.jkt` (public-key thumbprint); mTLS is
`cnf.x5t#S256` (certificate thumbprint).

---

## OAuth 2.1: the exact delta

**Intermediate:** OAuth 2.1 (`draft-ietf-oauth-v2-1`) is a consolidation, not new
protocol. The precise checklist of changes vs 2.0:

1. **PKCE is mandatory for the authorization code grant for ALL clients** — including
   confidential ones.
2. **Implicit grant removed.**
3. **Resource Owner Password Credentials (ROPC) removed.**
4. **`redirect_uri` must be compared by exact string match** (no wildcards; loopback
   ports on native apps excepted).
5. **Bearer tokens forbidden in the query string** (must use the `Authorization` header).
6. **Refresh tokens for public clients must be sender-constrained OR rotated** with reuse
   detection.
7. **`iss` returned in the authorization response** (RFC 9207) to defend mix-up.

It **folds in** RFC 6749/6750 (core + bearer), RFC 7636 (PKCE), RFC 8252 (native apps),
the Browser-Based Apps BCP, and the Security BCP (RFC 9700). "List what changed in 2.1" is
a guaranteed opener — this is the answer.

---

## Native app security (RFC 8252)

**Advanced:** RFC 8252 ("OAuth 2.0 for Native Apps," folded into 2.1) governs mobile/
desktop clients:

- **Use the system browser or an in-app browser tab (e.g. `SFAuthenticationSession` /
  Custom Tabs) — NEVER an embedded WebView.** A WebView is controlled by the app, so it
  can **read the user's credentials as they type**, defeats phishing resistance, and can't
  share the system SSO session. Embedded-WebView is the classic wrong answer.
- **Prefer claimed HTTPS redirects (App Links / Universal Links)** over custom schemes
  (`myapp://`). Custom schemes can be **hijacked** by another app registering the same
  scheme — the exact interception risk PKCE mitigates; claimed HTTPS URIs are
  cryptographically bound to the app's domain and can't be silently claimed by another app.
- **Desktop apps use a loopback redirect** (`http://127.0.0.1:<random-port>/...`), the one
  case where the AS allows a variable port with exact-host matching.
- Public native clients always use **authorization code + PKCE** (no client secret can be
  protected on the device).

---

## Common follow-up questions

- **"Is OAuth authentication?"** No — it's delegated authorization. For authentication
  use OpenID Connect's ID token, which carries verified identity claims (`aud`, `sub`,
  `nonce`) meant for the client.
- **"Why PKCE if the client already has a secret?"** PKCE defends against code
  interception/injection independently of client auth, which is why 2.1 mandates it for
  confidential clients too, not just public ones.
- **"Why not just use the implicit flow for my SPA?"** Implicit is removed in 2.1;
  tokens in the URL fragment leak via history/Referer and are instantly replayable. Use
  auth-code + PKCE.
- **"What stops someone replaying a stolen access token?"** By default, nothing until it
  expires (bearer). Keep lifetimes short and use sender-constraining (DPoP/mTLS).
- **"What's the difference between `state` and `nonce`?"** `state` = CSRF protection on
  the OAuth callback; `nonce` = replay protection on the OIDC ID token.
- **"Refresh token rotation vs sliding session?"** Rotation issues a new refresh token
  each use and revokes the family on reuse — it's a theft *tripwire*, not just lifetime
  extension.
- **"Client credentials for a mobile app?"** No — mobile is a public client and can't
  hold the secret; client credentials is for confidential machine-to-machine only.
- **"How does the resource server validate a token?"** JWT: verify signature via JWKS +
  check `iss`/`aud`/`exp`/`scope`. Opaque: call the AS introspection endpoint (RFC 7662).
- **"Can you revoke a JWT access token before it expires?"** Not with local validation —
  it's valid until `exp`. Mitigate with short lifetimes, a `jti` denylist, or introspection.
- **"307 or 303 after the consent form POST, and why?"** 303 See Other — 307 would re-send
  the credential POST body to the client's redirect_uri (RFC 9700 §4.12).
- **"SPA under XSS but I use DPoP and rotating refresh tokens — safe?"** No — the attacker
  in your origin can silently mint new tokens (iframe) or proxy requests; only a BFF that
  keeps tokens off the browser mitigates it.
- **"What changed in OAuth 2.1?"** PKCE mandatory for all clients; implicit + ROPC removed;
  exact redirect_uri match; no bearer tokens in query string; public-client refresh tokens
  sender-constrained or rotated; `iss` in the response.
- **"Which client authentication is best?"** `private_key_jwt` or mTLS — the AS holds no
  shared secret and both support proof-of-possession; FAPI 2.0 requires them.
- **"Why not an embedded WebView for a mobile OAuth flow?"** The app controls the WebView
  and can read the typed credentials; use the system browser / in-app tab (RFC 8252).

## References

- RFC 6749 — The OAuth 2.0 Authorization Framework: <https://datatracker.ietf.org/doc/html/rfc6749>
- OAuth 2.1 draft (`draft-ietf-oauth-v2-1`): <https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1>
- RFC 7636 — Proof Key for Code Exchange (PKCE): <https://datatracker.ietf.org/doc/html/rfc7636>
- RFC 9700 — Best Current Practice for OAuth 2.0 Security: <https://datatracker.ietf.org/doc/html/rfc9700>
- RFC 6819 — OAuth 2.0 Threat Model and Security Considerations: <https://datatracker.ietf.org/doc/html/rfc6819>
- RFC 6750 — OAuth 2.0 Bearer Token Usage: <https://datatracker.ietf.org/doc/html/rfc6750>
- RFC 8628 — OAuth 2.0 Device Authorization Grant: <https://datatracker.ietf.org/doc/html/rfc8628>
- RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP): <https://datatracker.ietf.org/doc/html/rfc9449>
- RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Tokens: <https://datatracker.ietf.org/doc/html/rfc8705>
- RFC 9207 — OAuth 2.0 Authorization Server Issuer Identification: <https://datatracker.ietf.org/doc/html/rfc9207>
- RFC 8707 — Resource Indicators for OAuth 2.0: <https://datatracker.ietf.org/doc/html/rfc8707>
- RFC 7662 — OAuth 2.0 Token Introspection: <https://datatracker.ietf.org/doc/html/rfc7662>
- OAuth 2.0 for Browser-Based Apps (BCP draft): <https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps>
- RFC 9126 — OAuth 2.0 Pushed Authorization Requests (PAR): <https://datatracker.ietf.org/doc/html/rfc9126>
- RFC 9101 — JWT-Secured Authorization Request (JAR): <https://datatracker.ietf.org/doc/html/rfc9101>
- JARM — JWT Secured Authorization Response Mode (OpenID): <https://openid.net/specs/oauth-v2-jarm.html>
- RFC 7523 — JWT Profile for Client Authentication (private_key_jwt): <https://datatracker.ietf.org/doc/html/rfc7523>
- RFC 8252 — OAuth 2.0 for Native Apps: <https://datatracker.ietf.org/doc/html/rfc8252>
- RFC 7519 / 7515 / 7517 / 7518 — JWT / JWS / JWK / JWA: <https://datatracker.ietf.org/doc/html/rfc7519>
- OAuth 2.0 Cross-Device Flows BCP (draft): <https://datatracker.ietf.org/doc/html/draft-ietf-oauth-cross-device-security>
- Salt Labs "OhAuth" social-login research (2024): <https://salt.security/blog>
- Microsoft Storm-2372 device-code phishing (2025): <https://www.microsoft.com/security/blog/>
- OWASP Cheat Sheet — OAuth 2.0 / Authorization: <https://cheatsheetseries.owasp.org/>
