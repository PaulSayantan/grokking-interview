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
- OWASP Cheat Sheet — OAuth 2.0 / Authorization: <https://cheatsheetseries.owasp.org/>
