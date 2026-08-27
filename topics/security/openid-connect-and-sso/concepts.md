# OpenID Connect & Federated SSO

OpenID Connect (OIDC) is a thin **identity layer built on top of OAuth 2.0**. OAuth 2.0
(RFC 6749) is a *delegated authorization* framework — it answers "may this app act on the
resource owner's behalf?" It says nothing standard about *who* the user is. OIDC (OpenID
Connect Core 1.0) adds a standard way to **authenticate the end-user and convey their
identity** to a client as a signed JSON Web Token called the **ID Token**.

This topic covers OIDC and federated Single Sign-On (SSO) at the **protocol and threat**
level: what an ID Token is and how to validate it, `nonce` vs `state`, discovery and JWKS,
the SAML-vs-OIDC contrast (including XML Signature Wrapping), IdP- vs SP-initiated flows,
logout, and audience-confusion attacks. The mechanics of OAuth grant flows themselves
(PKCE, redirect-URI validation, refresh-token rotation) live in `oauth2-and-oauth21`, and
JWT signature/algorithm attacks (`alg:none`, key confusion) live in `jwt-and-token-security`
— here we reference them and focus on the *identity-federation* angle.

> [!KEY-TAKEAWAY]
> OAuth 2.0 = **authorization** (access to APIs). OIDC = **authentication** (proving who the
> user is) layered on the same authorization-code machinery. The ID Token proves identity to
> the *client*; the access token grants access to a *resource server*. They have different
> audiences and must never be swapped.

## OIDC as an Identity Layer on Top of OAuth 2.0

OAuth 2.0 was widely (and dangerously) abused for "login with X" before OIDC existed. Apps
would send the user through an OAuth flow, get an **access token**, call some
provider-specific `/me` endpoint, and treat "I got a profile back" as "the user is logged
in." This is broken: an access token is a **bearer credential for an API**, not proof of
authentication. It carries no standard information about *who* authorized it, *which client*
it was issued to, or *when* the user actually logged in. This gap enabled real attacks (see
audience confusion below).

OIDC fixes this by standardizing three things on top of OAuth 2.0:

1. **The `openid` scope.** A client requests `scope=openid ...`. This signals "I want to
   authenticate the user," and the provider (now called an **OpenID Provider / OP**) returns
   an ID Token.
2. **The ID Token** — a signed JWT (RFC 7519) with standard identity claims (`iss`, `sub`,
   `aud`, `exp`, `iat`, `nonce`, ...). It is the authentication assertion.
3. **Standard endpoints and metadata** — a `UserInfo` endpoint, a discovery document at
   `/.well-known/openid-configuration`, and a JWKS endpoint for signing keys.

Terminology mapping (interviewers test this):

| OAuth 2.0 term | OIDC term |
|---|---|
| Authorization Server | OpenID Provider (OP) |
| Client | Relying Party (RP) |
| Resource Owner | End-User |
| (n/a) | ID Token |

> [!INTERVIEW]
> "Why not just use the OAuth access token to log users in?" Because the access token is
> opaque to the client, has the *resource server* as its audience, and says nothing about the
> authentication event. Using it for login leads to token-substitution / "confused deputy"
> attacks. OIDC's ID Token is explicitly audience-bound to the client and carries the
> authentication context.

## ID Token vs Access Token

These two tokens are the single most-confused pair in the topic. They serve different
purposes, have different audiences, and different consumers.

| | ID Token | Access Token |
|---|---|---|
| **Defined by** | OIDC Core | OAuth 2.0 (RFC 6749) |
| **Purpose** | Authenticate the user to the client | Authorize access to an API/resource |
| **Audience (`aud`)** | The **client** (RP) — its `client_id` | The **resource server(s)** |
| **Consumed by** | The **client** (RP validates it) | The **resource server** |
| **Format** | Always a **signed JWT** | Opaque string *or* JWT — OAuth doesn't mandate |
| **Contains** | Identity claims (`sub`, `email`, `nonce`, ...) | Scopes / permissions; format issuer-defined |

The cardinal rules:

- **A client must NOT use the ID Token to call resource-server APIs.** The API's audience is
  not the client. Sending an ID Token as a bearer token to an API is a bug.
- **A client must NOT treat the access token as proof of login.** It's often opaque to the
  client and not audience-bound to it.
- **A resource server must NOT accept an ID Token as an access token,** and must validate the
  access token's `aud`/scope for itself.

> [!WARNING]
> The most common OIDC integration bug: the client validates that *a* signature is valid but
> forgets to check that `aud` equals its own `client_id`. Then an ID Token minted for a
> *different* app at the same OP is accepted — a cross-client token-substitution login bypass.

## ID Token Structure and Standard Claims

An ID Token is a JWS-signed JWT: `base64url(header).base64url(payload).base64url(signature)`.
A decoded payload looks like:

```json
{
  "iss": "https://op.example.com",
  "sub": "248289761001",
  "aud": "s6BhdRkqt3",
  "exp": 1718000000,
  "iat": 1717996400,
  "auth_time": 1717996390,
  "nonce": "n-0S6_WzA2Mj",
  "acr": "urn:mace:incommon:iap:silver",
  "amr": ["pwd", "otp"],
  "azp": "s6BhdRkqt3",
  "email": "jane@example.com",
  "email_verified": true
}
```

Key standard claims:

- **`iss`** — issuer identifier (must be an exact string match to the expected OP).
- **`sub`** — subject: the **stable, unique, non-reassignable** identifier for the user *at
  this OP*. This is the join key, **not** email (emails change and get reused). `sub` is only
  guaranteed unique within an `iss`, so applications key users on the `(iss, sub)` pair.
- **`aud`** — audience: the `client_id`(s) the token is for.
- **`exp` / `iat`** — expiry and issued-at (NumericDate, seconds since epoch).
- **`nonce`** — echoes the client's request nonce (replay defense; see below).
- **`auth_time`** — when the user actually authenticated (drives `max_age` re-auth).
- **`azp`** — authorized party; the `client_id` of the party the token was issued to (used
  when `aud` has multiple values).
- **`acr` / `amr`** — Authentication Context Class Reference and Methods References (e.g.
  `["pwd","otp"]` means password + OTP; useful to prove MFA happened).

Standard **claims** are grouped under **scopes**: `profile` (name, picture, ...), `email`,
`address`, `phone`. Claims can be delivered in the ID Token or from UserInfo.

> [!TIP]
> Never use `email` as the primary user key. Use `(iss, sub)`. `email` can be unverified,
> can change, and can be reassigned to a different person. Always check `email_verified: true`
> before trusting an email for account matching.

## Validating the ID Token (iss, aud, exp, signature)

Receiving an ID Token is not enough — the client (RP) **must fully validate it** per OIDC
Core §3.1.3.7. A checklist an interviewer expects:

1. **Signature.** Verify the JWS signature using the OP's public key from its JWKS
   (matched by the `kid` in the JWT header). Confirm the `alg` is an *expected asymmetric*
   algorithm (e.g. `RS256`, `ES256`) — **reject `none`** and reject a symmetric `HS256`
   verification against a public key (see key-confusion in `jwt-and-token-security`).
2. **`iss`** — must exactly equal the issuer from discovery.
3. **`aud`** — must contain the client's own `client_id`. If multiple audiences are present,
   `azp` must be the client's `client_id` and every `aud` must be acceptable.
4. **`exp`** — token must not be expired (with small allowed clock skew, e.g. ≤ a few
   minutes). Check `iat` for freshness / reasonableness.
5. **`nonce`** — must equal the value the client sent in the authentication request (bind to
   the session; single-use).
6. If `max_age` was requested (or re-auth needed), check **`auth_time`**.

Vulnerable pattern:

```
// BAD: trusts the token because it decodes and isn't expired
claims = decodeJwt(id_token)          // no signature check!
if (claims.exp > now) loginAs(claims.sub)
```

Concrete exploit: attacker forges a token with `{"alg":"none"}` or self-signs one, sets
`sub` to the victim, and logs in as them. Or presents a genuine ID Token from a *sibling
client* at the same OP (valid signature, wrong `aud`) and is accepted.

Correct defense:

```
claims = verifyJws(id_token, jwks, allowedAlgs=["RS256","ES256"])  // signature + alg
assert claims.iss == EXPECTED_ISS
assert MY_CLIENT_ID in asList(claims.aud)
assert claims.exp > now - SKEW and claims.iat < now + SKEW
assert claims.nonce == session.nonce   // single-use
```

> [!WARNING]
> Prefer a vetted OIDC library over hand-rolling validation. The classic mistakes — skipping
> signature verification, not pinning `alg`, ignoring `aud`, and reusing `nonce` — have all
> shipped in real products.

## nonce vs state (Replay and CSRF Defenses)

`state` and `nonce` are both random values the client generates, but they defend against
**different attacks** and live in **different places**.

- **`state`** is an OAuth 2.0 parameter. The client puts it in the **authorization request**
  and the OP reflects it back on the **redirect** (the query string). The client checks it
  matches what it stored in the session. This defends against **CSRF on the redirect / code
  injection** — it binds the callback to the browser session that started the flow. `state`
  is *not* in the token.
- **`nonce`** is an OIDC parameter. The client puts it in the authorization request and the
  OP embeds it **inside the ID Token**. The client checks the token's `nonce` matches the
  session value. This defends against **ID Token replay** — a stolen/old ID Token from a
  different flow won't carry the current session's nonce.

```
Authorization request:  ...&state=xyz789&nonce=n-0S6_WzA2Mj&...
Redirect back:          .../cb?code=SplxlOB...&state=xyz789     <- check state here
ID Token payload:       { ..., "nonce": "n-0S6_WzA2Mj" }        <- check nonce here
```

| | `state` | `nonce` |
|---|---|---|
| Spec | OAuth 2.0 | OIDC |
| Returned in | Redirect query param | Inside the ID Token |
| Defends | CSRF / callback binding | ID Token replay |
| Verified against | Session-stored value | Session-stored value |

Both should be **cryptographically random, single-use, per-request** values. Reusing them, or
using a predictable value, defeats the defense. Note PKCE (`code_verifier`/`code_challenge`,
RFC 7636) protects the **authorization code** against interception and is complementary — it
does not replace `state`/`nonce`.

> [!INTERVIEW]
> "What's the difference between `state` and `nonce`?" Crisp answer: `state` is reflected on
> the redirect and stops CSRF/callback confusion; `nonce` is baked into the ID Token and stops
> ID Token replay. Different location, different threat.

## The Authorization Code Flow in OIDC

OIDC defines three response types, but the **Authorization Code flow** (`response_type=code`)
is the recommended, most secure one and is what OAuth 2.1 mandates (with PKCE) for all
clients, including SPAs and mobile apps.

Steps:

```
1. RP -> browser -> OP  (authorization request)
   GET /authorize?response_type=code
       &client_id=s6BhdRkqt3
       &redirect_uri=https://rp.example.com/cb
       &scope=openid%20profile%20email
       &state=xyz789
       &nonce=n-0S6_WzA2Mj
       &code_challenge=...&code_challenge_method=S256

2. User authenticates & consents at the OP.

3. OP -> browser -> RP  (redirect with code)
   302 https://rp.example.com/cb?code=SplxlOB...&state=xyz789

4. RP -> OP  (back-channel token request, over TLS, client authenticates)
   POST /token
   grant_type=authorization_code&code=SplxlOB...
   &redirect_uri=https://rp.example.com/cb&code_verifier=...

5. OP -> RP  (token response)
   { "access_token":"...", "token_type":"Bearer",
     "id_token":"eyJ...", "expires_in":3600 }
```

Why the code flow wins: tokens are delivered over the **back channel** (server-to-server
`/token` call), never exposed in the browser URL/history/referrer, and the client
authenticates itself when redeeming the code.

Legacy/deprecated variants:

- **Implicit flow** (`response_type=id_token token`) returned tokens directly in the URL
  fragment. It leaks tokens to browser history, `Referer`, and logs, and can't use PKCE
  properly. OAuth 2.1 **removes** the implicit grant; do not use it.
- **Hybrid flow** (`response_type=code id_token`) returns an ID Token on the front channel
  plus a code — used in some OP-detach scenarios; the front-channel ID Token then requires
  `c_hash`/`at_hash` validation to bind it to the code/access token.

> [!WARNING]
> "Login with the implicit flow" is a legacy anti-pattern. Modern guidance (OAuth 2.1, OAuth
> for Browser-Based Apps BCP) is: authorization code + PKCE for everyone, tokens off the front
> channel.

## UserInfo Endpoint

The **UserInfo endpoint** is an OAuth-protected resource that returns claims about the
authenticated user. The client calls it with the **access token** (not the ID Token):

```
GET /userinfo HTTP/1.1
Host: op.example.com
Authorization: Bearer SlAV32hkKG

HTTP/1.1 200 OK
Content-Type: application/json
{ "sub": "248289761001", "name": "Jane Doe", "email": "jane@example.com" }
```

ID Token vs UserInfo — when to use which:

- The **ID Token** is a compact, self-contained authentication assertion delivered at login;
  putting *every* claim in it bloats it and puts PII in browser-reachable places.
- **UserInfo** lets the client fetch a richer/fresher claim set on demand, keeping the ID
  Token small. Which claims land where is issuer-configurable.

Critical validation gotcha: per OIDC Core §5.3.2, the client **MUST verify that the `sub`
returned by UserInfo exactly matches the `sub` in the ID Token**. Otherwise a malicious
resource / token substitution could splice one user's identity onto another's session. If
the UserInfo response is signed/encrypted (a JWT), also validate `iss`/`aud`.

> [!TIP]
> Rule of thumb: **ID Token → the client** (audience = client), **access token → resource
> servers and UserInfo** (audience = APIs). If you're sending an ID Token to `/userinfo`
> you've mixed them up.

## Discovery and JWKS (.well-known)

OIDC standardizes **provider metadata discovery** so a client can configure itself from one
URL. The client fetches:

```
GET https://op.example.com/.well-known/openid-configuration
```

which returns a JSON document (OpenID Connect Discovery 1.0) with fields like:

```json
{
  "issuer": "https://op.example.com",
  "authorization_endpoint": "https://op.example.com/authorize",
  "token_endpoint": "https://op.example.com/token",
  "userinfo_endpoint": "https://op.example.com/userinfo",
  "jwks_uri": "https://op.example.com/jwks.json",
  "response_types_supported": ["code","id_token","code id_token"],
  "id_token_signing_alg_values_supported": ["RS256","ES256"],
  "scopes_supported": ["openid","profile","email"]
}
```

The **`jwks_uri`** returns the OP's public **JSON Web Key Set** (RFC 7517) — the keys used
to verify ID Token signatures:

```json
{ "keys": [
  { "kty":"RSA", "use":"sig", "kid":"abc123", "alg":"RS256",
    "n":"0vx7...", "e":"AQAB" }
]}
```

The JWT header carries a **`kid`** so the verifier picks the right key; this enables **key
rotation** — the OP publishes new keys before signing with them, clients re-fetch and cache
the JWKS (respecting cache headers). Security notes:

- The `issuer` value in the discovery doc **must** match the URL you fetched from (prevents
  swapping in a rogue issuer). RFC 8414 defines the well-known location rules.
- Cache the JWKS but refresh on unknown `kid`; **rate-limit** JWKS refetches so an attacker
  can't trigger unbounded outbound requests with bogus `kid`s.
- Never fetch `jwks_uri` / discovery over plain HTTP; TLS is mandatory. A tampered JWKS lets
  an attacker substitute their own signing key.

> [!WARNING]
> `openid-configuration` and `jwks_uri` are attacker-interesting SSRF/trust pivots if the
> issuer base URL is ever attacker-influenced. Pin the expected issuer; don't let a token's
> `iss` claim dictate which discovery/JWKS URL you trust.

## Single Sign-On (SSO) Concepts

**Single Sign-On** lets a user authenticate **once** at a central Identity Provider (IdP) and
access **multiple** applications without re-entering credentials. The IdP holds a session; each
app trusts the IdP's assertion of identity.

Why it matters: fewer passwords (less phishing surface and reuse), centralized policy (MFA,
lockout, conditional access all enforced in one place), fast de-provisioning (disable at IdP →
access gone everywhere), and better UX.

How the "single" sign-on happens: the IdP maintains its own **browser session** (typically a
cookie on the IdP's domain). When App B redirects the already-logged-in user to the IdP, the
IdP sees its session cookie and can issue a fresh assertion **without prompting** — that's the
seamless part. OIDC exposes `prompt=none` to attempt silent authentication (fail if
interaction would be required) and `prompt=login`/`max_age` to force re-authentication.

Trade-offs and risks:

- **Single point of failure / blast radius.** IdP outage = can't log into anything; IdP
  compromise = every connected app is compromised. Mitigate with strong IdP MFA
  (phishing-resistant, e.g. WebAuthn/FIDO2), monitoring, and high availability.
- **Session-lifetime coupling.** A long IdP session means apps stay reachable long after the
  user walked away; balance SSO convenience against re-auth for sensitive actions
  (step-up auth).

> [!KEY-TAKEAWAY]
> SSO centralizes the *authentication event* at the IdP. The apps never see the password; they
> see a signed assertion (SAML) or token (OIDC). This is federation: trust is delegated to the
> IdP.

## SAML vs OIDC

Both SAML 2.0 and OIDC solve federated SSO, but they come from different eras and use different
technology. Interviewers love the contrast.

| | SAML 2.0 | OIDC |
|---|---|---|
| Era / base | 2005, XML | 2014, JSON/REST on OAuth 2.0 |
| Assertion format | XML **SAML Assertion** | **ID Token** (JWT) |
| Signature | XML Digital Signature (XML-DSig) | JWS (compact, over base64url) |
| Transport | Browser POST/Redirect of XML; SOAP | HTTP redirects + JSON; bearer tokens |
| Roles | IdP + SP (Service Provider) | OP + RP |
| Mobile / SPA / API | Awkward (XML, no bearer-token model) | First-class (JSON, OAuth access tokens) |
| Metadata | XML metadata exchange | `.well-known/openid-configuration` + JWKS |
| Typical use | Enterprise web SSO (Okta, ADFS) | Consumer + modern app/API auth |

Key points:

- SAML predates and is separate from OAuth; it bundles authentication *and* the "attribute"
  (claims) delivery in one XML assertion. OIDC deliberately layers on OAuth so the same flow
  yields both an identity token *and* API access tokens.
- OIDC is generally simpler for mobile/SPA/API scenarios because JSON + bearer tokens fit
  HTTP APIs; SAML's XML + browser-POST model is clunky outside server-rendered web apps.
- Both rely on the **RP/SP validating signatures and audience/recipient restrictions** — the
  failure modes rhyme (audience confusion, replay, signature bypass) even though the encodings
  differ.

> [!INTERVIEW]
> One-liner: "SAML is XML assertions signed with XML-DSig, great for enterprise web SSO; OIDC
> is JWTs on top of OAuth 2.0, better for mobile/SPA/API. Both federate identity to an IdP."

## XML Signature Wrapping Attacks (SAML)

SAML's use of **XML Digital Signatures** creates a class of vulnerability that OIDC's compact
JWS largely avoids: **XML Signature Wrapping (XSW)**. It exploits the gap between the element
the signature *covers* and the element the application logic actually *reads*.

Vulnerable pattern: the SP verifies "there is a valid signature over *an* assertion somewhere
in the document," then separately its business logic selects an assertion by tag name or
XPath. If those two steps look at **different elements**, an attacker can wrap the legitimately
signed assertion and inject an unsigned forged one that the logic reads.

Concrete exploit (simplified):

```xml
<Response>
  <!-- attacker's forged, UNSIGNED assertion the app logic reads -->
  <Assertion ID="evil"><Subject>admin@corp.com</Subject>...</Assertion>
  <!-- original, validly SIGNED assertion, moved/wrapped so the verifier still finds it -->
  <Wrapper>
    <Assertion ID="orig"><Subject>attacker@corp.com</Subject>
      <Signature>...valid signature over ID=orig...</Signature>
    </Assertion>
  </Wrapper>
</Response>
```

The signature check passes (the `orig` assertion is genuinely signed); the app reads the first
`<Assertion>` and logs the attacker in as `admin`. This is a real, repeatedly-found class of
bug (e.g. the 2012 SAML XSW research affecting many frameworks; the 2018 Ruby/Python/other SAML
libraries `SAMLResponse` comment-injection and canonicalization bugs).

Correct defenses:

- Verify the signature and then **operate only on the exact element that was signed** — resolve
  the `Reference URI`/`ID` the signature covers and read *that* assertion, not a re-queried one.
- Use **schema validation** and reject documents with multiple/duplicate assertion IDs.
- Prefer battle-tested, maintained SAML libraries; enforce strict XML canonicalization and
  disable dangerous XML features (also mitigates XXE — see `injection-attacks`).
- Pin `Issuer`, validate `Audience`/`Recipient`, `NotBefore`/`NotOnOrAfter`, and use
  `InResponseTo` + one-time-use to stop replay.

> [!WARNING]
> XSW is why "signature verified = trustworthy" is false for XML. The question is *what* was
> signed and whether that's what you consumed. JWS avoids the class by signing a flat
> base64url string, but the analogous JWT pitfalls (`alg:none`, `kid` injection) live in
> `jwt-and-token-security`.

## IdP-Initiated vs SP-Initiated SSO

There are two ways an SSO flow can *start*:

- **SP-initiated (RP-initiated):** the user goes to the application first; the app has no
  session, so it **redirects the user to the IdP** to authenticate, then the IdP sends them
  back. This is the normal, recommended flow. It has request context — a `state`/`nonce`/
  `RelayState` and (in SAML) an `AuthnRequest` with an `InResponseTo` correlation ID — so the
  app can bind the response to a request it actually made.
- **IdP-initiated:** the user starts at the IdP portal (e.g. an app dashboard) and clicks an
  app tile; the IdP **pushes an unsolicited assertion/token** to the app. Common in enterprise
  SAML portals.

Why IdP-initiated is riskier: the assertion is **unsolicited** — there's no `InResponseTo`
(SAML) / no `nonce`/`state` the SP generated, so the SP cannot verify the response corresponds
to a request from *this* browser. This opens **login CSRF / assertion replay**: an attacker can
capture or craft an IdP-initiated assertion and POST it to the victim's browser session,
logging the victim into an account the attacker controls (or vice-versa).

- In OIDC, there is no standardized "IdP-initiated login" primitive; the secure pattern is that
  the IdP triggers an **SP-initiated flow** (redirect to `/authorize`) so `state`/`nonce`/PKCE
  are present. Truly IdP-initiated OIDC is discouraged.
- If IdP-initiated SAML is required, mitigate with unsolicited-response replay protection
  (one-time-use assertion IDs, tight `NotOnOrAfter`), and treat the landing as unauthenticated
  until a fresh confirmation.

> [!INTERVIEW]
> "Why is IdP-initiated SSO considered less secure?" Because the assertion is unsolicited — no
> `InResponseTo`/`state`/`nonce` ties it to a request the SP made, enabling login CSRF and
> assertion replay. SP-initiated flows carry that request context.

## Logout: Front-Channel and Back-Channel

With SSO, logout is harder than login: killing one app's session doesn't end the IdP session or
sibling apps' sessions. OIDC defines several logout specs:

- **RP-Initiated Logout:** the app redirects the user to the OP's `end_session_endpoint`
  (with `id_token_hint`, `post_logout_redirect_uri`) to end the **OP session**.
- **Front-Channel Logout:** the OP logs the user out of each RP by loading each RP's logout URL
  in **hidden iframes** in the browser. Simple, but fragile — it depends on the browser loading
  third-party iframes, which modern **third-party-cookie blocking / ITP** frequently breaks, and
  it can't confirm success.
- **Back-Channel Logout:** the OP sends a **server-to-server POST** to each RP's
  `backchannel_logout_uri` carrying a signed **Logout Token** (a JWT). It's more reliable (no
  browser dependency) but the RP must map the logout to its session store (via `sid` or `sub`).

The **Logout Token** must be validated much like an ID Token, with extra rules (OIDC
Back-Channel Logout §2.6):

```json
{ "iss":"https://op.example.com", "aud":"s6BhdRkqt3", "iat":1718000000,
  "jti":"bWJq...", "sid":"08a5019c-...",
  "events": { "http://schemas.openid.net/event/backchannel-logout": {} } }
```

- Validate signature, `iss`, `aud`, `iat`; require the **`events`** claim with the logout event.
- **Reject a Logout Token that contains a `nonce`** (that would indicate it's an ID Token
  being misused) and require `sub` and/or `sid`.
- Use `jti` for replay protection.

> [!WARNING]
> "Single Logout" (SLO) is notoriously unreliable in practice — front-channel iframes break
> under third-party-cookie restrictions, and not all RPs implement back-channel. Design for
> best-effort logout plus **short access-token lifetimes** so revocation converges quickly.

## Federation Trust and Token Audience Confusion

Federation means an app **trusts a third party (the IdP/OP)** to authenticate users. That trust
must be scoped precisely, or you get **audience confusion / token substitution** — a top-tier
OIDC attack class.

The core rule: a token is only valid **for the audience it was minted for, at the issuer that
minted it.** Two failure modes:

1. **Wrong-audience acceptance.** OP `example.com` issues an ID Token with `aud=AppA` for a
   user. If AppB (or a resource server) accepts it without checking `aud == its own id`, an
   attacker who can obtain an AppA token replays it to AppB → cross-app login bypass. Defense:
   every consumer checks `aud` (and `azp`) matches itself.

2. **Wrong-issuer / mix-up attack.** A client that supports **multiple OPs** starts a flow with
   an honest OP, but the attacker causes the authorization code to be returned/redeemed against
   a *different* (attacker-controlled or victim) OP. If the client doesn't track *which* OP a
   response belongs to, it redeems the code at the wrong token endpoint or trusts an ID Token
   whose `iss` it didn't expect. This is the **OAuth/OIDC Mix-Up Attack**. Defenses: pin the
   expected `iss` per authorization request, use the `iss` response parameter (RFC 9207), and
   validate the token's `iss` matches the OP you started with.

Additional audience hygiene:

- **Access-token audience.** When one API calls another on the user's behalf, don't forward the
  same access token blindly — its `aud` is the first API. Use token exchange (RFC 8693) or a
  fresh audience-scoped token. A token with `aud=API_A` presented to `API_B` must be rejected by
  `API_B`.
- **Sender-constrained tokens** (DPoP / mTLS-bound, see `oauth2-and-oauth21`) reduce the impact
  of theft/replay by binding a token to a client key.

Vulnerable vs fixed:

```
// BAD (resource server): accept any validly-signed token from the trusted OP
if (verifyJws(tok, jwks)) allow();

// GOOD: also bind issuer and audience to THIS service
claims = verifyJws(tok, jwks, allowedAlgs=[...]);
assert claims.iss == EXPECTED_ISS;
assert THIS_API_AUDIENCE in asList(claims.aud);
assert requiredScope in claims.scope.split(" ");
```

> [!KEY-TAKEAWAY]
> "Valid signature" ≠ "for me." Every relying party and resource server must independently pin
> **issuer** and check **audience** (and scope). Audience confusion and mix-up attacks are the
> defining threats of federated identity.

## at_hash / c_hash and Hybrid-Flow Token Substitution

In the code flow, the ID Token arrives on the **back channel** together with the code/access
token, so nothing can be swapped in transit. In the **hybrid** (`response_type=code id_token`)
and implicit-with-token flows, the ID Token travels on the **front channel** (URL fragment)
*alongside* a `code` and/or `access_token`. The browser is a hostile relay here: an attacker
who controls the front channel can **substitute a different `code` or `access_token`** while
leaving the honest, correctly-signed ID Token untouched. This is OIDC Core §16.11
**Token Substitution** (a.k.a. code substitution / cut-and-paste attack).

The **only** thing that binds the front-channel ID Token to the artifacts delivered with it
is the `c_hash` and `at_hash` claims. Their computation (OIDC Core §3.3.2.11):

1. Take the **ASCII octets** of the value (the `access_token` string for `at_hash`, the
   authorization `code` string for `c_hash`).
2. Hash them with the hash function that matches the ID Token's JWS `alg` — `RS256`/`ES256`/
   `PS256` → SHA-256, `ES384` → SHA-384, `ES512`/`RS512` → SHA-512.
3. Take the **left-most half** of the digest (e.g. left 128 bits of a 256-bit hash).
4. **base64url-encode** that half. The result must equal the claim.

```
at_hash =? base64url( LEFTMOST_HALF( SHA-256( ascii(access_token) ) ) )   // for RS256
c_hash  =? base64url( LEFTMOST_HALF( SHA-256( ascii(code) ) ) )
```

If the RP skips these, an attacker swaps in a `code`/`access_token` of their own (or one
belonging to another session) and the RP happily binds the honest identity to the attacker's
token — enabling account-mixing / token injection. **A hybrid-flow RP MUST validate `c_hash`
against the received code and `at_hash` against the received access token, in addition to
pinning `aud`.** (In the pure code flow these are optional because the back channel already
provides the binding.)

> [!WARNING]
> The classic "which fix is correct?" trap: an RP validates ID-Token signature + `iss` + `exp`
> + `nonce` but not `aud`, in a hybrid flow, and an attacker substitutes a `code`. The correct
> fix is **both** — validate `c_hash`/`at_hash` AND pin `aud`. Fixing only one leaves the
> substitution open.

## Request Objects, request_uri and JAR (SSRF & Validation Bypass)

OIDC/JAR (RFC 9101, "JWT-Secured Authorization Request") lets authorization-request parameters
ride **inside a signed JWT** instead of (or in addition to) plain query parameters, using two
mechanisms advertised in discovery (`request_parameter_supported`,
`request_uri_parameter_supported`):

- **`request`** — the Request Object JWT passed **by value** in the query string.
- **`request_uri`** — a **URL the OP fetches server-side** to retrieve the Request Object JWT.

Two attack classes fall out of this:

1. **SSRF via `request_uri`.** If the OP fetches an attacker-supplied `request_uri` without an
   allowlist, the attacker points it at internal metadata endpoints (cloud IMDS
   `169.254.169.254`, internal admin URLs) — a classic server-side request forgery pivot. The
   OP must restrict `request_uri` to pre-registered values and/or an allowlist, block internal
   address ranges, and cap response size.
2. **Parameter-precedence / validation bypass.** Parameters may appear **both** in the query
   string and inside the signed Request Object. If the server validates the query-string
   `redirect_uri` (e.g. checks it against the allowlist) but then **honors a different
   `redirect_uri` smuggled inside the JWT**, an attacker bypasses redirect-URI validation and
   steals the code. Per JAR, when a Request Object is used, parameters **inside** it take
   precedence and query-string copies should be ignored — but implementations that mix the two
   get this wrong. (PortSwigger "Hidden OAuth attack vectors".)

## Dynamic Client Registration Abuse & Second-Order SSRF

OIDC Dynamic Client Registration (RFC 7591 / OpenID Connect Registration) lets a client
`POST /register` its own metadata and receive a `client_id`. When the endpoint is
**unauthenticated**, an attacker self-registers a malicious client — and several metadata
fields are **URLs the OP fetches server-side**, turning registration into a second-order SSRF
(and sometimes stored-XSS) primitive:

- **`jwks_uri`** — fetched by the OP when the client authenticates with a signed JWT; an SSRF
  and a key-injection vector (attacker controls the "trusted" signing keys).
- **`logo_uri`** — fetched by the OP to render on the **consent screen**; SSRF, and if the
  content-type is not validated, **stored XSS** on the consent page. Real CVE:
  **CVE-2021-26715** (MITREid Connect `logo_uri` SSRF/XSS).
- **`sector_identifier_uri`** — fetched to resolve pairwise subject grouping (see PPID below).
- **`request_uris`** — pre-registered Request Object URLs.

Distinguish **server-fetched** URIs (above — must be allowlisted / host-validated / size-capped
/ content-type-checked, internal ranges blocked) from **client-side-only** URIs the OP merely
stores or hands to the browser (`redirect_uri`, `client_uri`, `policy_uri`, `tos_uri`,
`initiate_login_uri`). Defenses: authenticate/gate registration (software statements, initial
access tokens), validate every server-fetched URL, and never fetch arbitrary attacker URLs at
registration time.

## "Sign in with X" Account Takeover via Unverified Email

The single most common federated-login ATO class. An RP that supports "Sign in with Google/
GitHub/…" and **matches federated logins to local accounts by `email`** is exposed to two
distinct attacks:

1. **Unverified-email / pre-hijack.** The attacker signs up at an OP that does **not verify
   email ownership**, using the *victim's* address. If the RP keys accounts on `email` (and
   doesn't check `email_verified`), the attacker's federated login lands in the victim's
   account — or, conversely, the attacker pre-registers so the victim's later real login merges
   into the attacker-controlled account.
2. **Account-linking / merge attacks.** The RP auto-links a new federated identity to an
   existing local account whenever the emails match, without re-proving ownership. An attacker
   who can obtain *any* token asserting the victim's email gets linked in.

Defenses:

- Key accounts on the **`(iss, sub)`** pair, never on `email` alone.
- Require **`email_verified: true`** before using an email for anything sensitive, and trust
  it only from OPs you know actually verify email.
- **Never auto-merge** a federated identity into a local account by email; require the user to
  log into the existing account (or complete an ownership-proof / verification step) before
  linking.
- Treat linking as a sensitive operation (re-auth / step-up).

## SAML Parser-Differential Auth Bypass (CVE-2025-25291/292) and Response Validation

The 2012/2018 XSW research is the historical anchor; the **2025 Ruby-SAML** vulnerabilities
(**CVE-2025-25291** and **CVE-2025-25292**) are the modern one interviewers reach for. Root
cause: Ruby-SAML used **two different XML parsers** — REXML for one purpose and Nokogiri
(added for canonicalization) for another — and the two **interpret the same document
differently**. A second `<Signature>` hidden inside a `StatusDetail` element is visible to one
parser but not the other, so the signature check and the assertion the app consumes are on
different bytes. Because **hash verification and signature verification were not linked**, each
step passed independently: a single valid signed assertion for *any* user could be used to
impersonate *anyone* — a full authentication bypass. (GitHub's own SAML implementation was
affected.) The generalizable lesson: XML-DSig + canonicalization is dangerous precisely because
"what was signed" and "what was consumed" can diverge, and parser differentials are a whole
class of that.

Beyond XSW, a SAML SP must validate more than Issuer/Audience/timestamps to stop
**cross-SP assertion replay**:

- **`Destination`** on the `<Response>` must match this SP's ACS (Assertion Consumer Service)
  URL — stops an assertion minted for another SP being replayed here.
- **`<SubjectConfirmationData>`** `Recipient` must match the ACS URL, `NotOnOrAfter` must be in
  the future, and `InResponseTo` must match a request this SP issued.
- Reject **SHA-1** signatures; require ≥ RSA-SHA-256.

Also distinct from XSW: the **2018 SAML XML-comment / canonicalization truncation** bug, where
a comment injected into the NameID (`admin@example.com<!---->.evil.com`) caused some libraries'
text extraction to read only `admin@example.com` after canonicalization stripped the comment —
letting an attacker who controlled `...evil.com` impersonate `admin@example.com`. And
**`RelayState`** is unsigned deep-link state: if the SP reflects it as a post-login redirect
without validation it becomes an **open redirect** — treat it as opaque and validate against an
allowlist. (XXE is yet another distinct SAML XML risk — see `injection-attacks`.)

Concrete XSW defenses (OWASP SAML cheat sheet): never select security elements with
`getElementsByTagName`; use **absolute XPath**; verify the `<ds:Reference URI>` actually covers
the consumed `<saml:Assertion>`; schema-validate against **local trusted schemas** (never
auto-download); ignore in-document `KeyInfo` and use a pinned key selector (`StaticKeySelector`/
`X509KeySelector`).

## OIDC Session Management (check_session_iframe / session_state)

OIDC **Session Management 1.0** lets an RP detect that the user's session at the OP **changed**
(e.g. they logged out or switched accounts) *without* constantly redirecting. Mechanism:

- The auth response returns a **`session_state`** value — a salted hash of `client_id` +
  origin + the OP's User-Agent session state.
- The OP publishes a **`check_session_iframe`** (an OP-origin iframe). The RP loads it in a
  hidden iframe, and its own RP iframe **`postMessage`s** the current `session_state` to the OP
  iframe on a polling interval. The OP iframe replies `unchanged`, `changed`, or `error`.
- On **`changed`**, the RP performs a silent re-auth (`prompt=none` with `id_token_hint`) to
  learn the new state or re-establish the session.

Security notes:

- **Origin validation on `postMessage` is mandatory** — accepting messages from any origin is
  an XSS/spoofing vector.
- The session-state cookie the OP iframe reads **cannot be `HttpOnly`** (JS needs it), so it
  MUST contain no PII — only opaque state.
- **Third-party-cookie blocking / ITP breaks the OP iframe** (it's cross-site), which can throw
  the RP into an **infinite silent re-auth loop**; defensive code must cap retries and fall
  back gracefully. This is the same fragility that makes front-channel Single Logout unreliable.

## Assurance Levels, Bearer vs Holder-of-Key (NIST 800-63C)

NIST **SP 800-63C** defines **Federation Assurance Levels (FAL)** for how strongly an assertion
is protected (note: 800-63C was **superseded by SP 800-63-4, finalized July 2025** — worth
flagging for currency, though the FAL concepts carry over):

- **FAL1** — assertion is **signed** by the IdP (bearer). Integrity/authenticity but anyone in
  possession can present it.
- **FAL2** — assertion is signed **and encrypted to the RP** (bearer). Encryption is **required
  for front-channel presentation** (the assertion passes through the browser). Confidentiality
  plus authenticity.
- **FAL3** — **holder-of-key**: the subscriber must **prove possession of a key** bound to the
  assertion directly to the RP; assertion is signed and encrypted.

**Bearer vs holder-of-key** is the central distinction and the SSO analog of sender-constrained
tokens (DPoP/mTLS in `oauth2-and-oauth21`):

- **Bearer** — possession = use. Steal it and replay it and you *are* the subject.
- **Holder-of-key** — the assertion is bound to a key the subscriber proves they hold, so a
  stolen assertion alone is useless. (A merely *referenced* key that isn't proven degrades back
  to bearer; the key SHALL NOT be transmitted unencrypted.)

800-63C also mandates that the RP **SHALL check the audience**, and that assertions carry
Subject, Issuer, Audience, issuance & expiry times, a unique identifier, and a signature; and
that a **back-channel assertion reference SHALL be single-use and bound to one RP**.

**Front-channel vs back-channel assertion *presentation*** (generalizes SAML POST vs Artifact
Binding, and complements the logout-channel material): in **back-channel** presentation the
subscriber passes only an **artifact/reference** through the browser and the RP fetches the
real assertion directly from the IdP over a server-to-server channel — smaller attack surface,
artifact single-use. In **front-channel** presentation the **full assertion** travels through
the browser — visible, replayable, and "multi-RP use is not recommended," which is exactly why
front-channel assertions must be encrypted (FAL2).

## Pairwise vs Public Subject Identifiers (PPID)

OIDC lets an OP issue two kinds of `sub` (the `subject_type` discovery/registration setting):

- **`public`** — the OP returns the **same `sub`** for a given user to **every** RP. Simple,
  but colluding RPs can correlate the same person across services.
- **`pairwise`** (PPID — Pairwise Pseudonymous Identifier) — the OP returns a **different `sub`
  per RP** (or per group of RPs), so two unrelated RPs cannot tell they're seeing the same user.
  This is the privacy-preserving / anti-correlation option (a GDPR and NIST PPID consideration).

Clients that should share the same pairwise `sub` are grouped via a **`sector_identifier_uri`**
(a URL listing the RP's redirect URIs; the OP derives the pairwise `sub` from the sector host
rather than per-client). Gotcha: if an RP's **sector identifier changes**, its users' `sub`
values **change too**, and accounts keyed on `(iss, sub)` appear to "reset." Interview scenario:
"two RPs from different teams must correlate the same user; a third must *not* be
correlatable" → put the two in the same sector (shared pairwise `sub`) and give the third its
own sector, using `subject_type=pairwise`.

## Step-Up Authentication and Assertion Strength (acr, amr, max_age)

OIDC gives the RP levers to **request and verify** authentication strength — essential for
"force MFA for a wire transfer" scenarios:

- **`prompt`** — `prompt=none` attempts silent auth and returns `error=login_required` /
  `interaction_required` if any UI would be needed; `prompt=login` forces re-authentication;
  `prompt=consent` re-prompts consent.
- **`max_age`** — maximum acceptable age (seconds) since the last authentication; the OP
  re-authenticates if exceeded and the RP verifies the resulting **`auth_time`**.
- **`acr_values`** — the RP **requests** one or more Authentication Context Class References
  (e.g. an MFA level, or `phr` = phishing-resistant). The OP returns the achieved level in the
  **`acr`** claim, which the RP **must verify meets its requirement**.
- **`amr`** — Authentication Methods References (e.g. `["pwd","otp"]`, `["hwk"]`) let the RP
  confirm *which* methods were used.
- **`id_token_hint` / `login_hint`** — carry a prior ID Token / a username hint into a re-auth
  or silent-auth request.

**Step-up pattern** for a sensitive action: re-run `/authorize` with `acr_values` (or a lower
`max_age`) demanding the stronger level; on return, verify `acr`/`amr`/`auth_time` in the fresh
ID Token and **reject or re-prompt** if the assertion doesn't meet the bar. Merely *requesting*
`acr_values` and not *verifying* the returned `acr` is a common bug.

## Redirect_uri Validation in the OIDC Login Context

Redirect-URI validation mechanics live in `oauth2-and-oauth21`, but the **login-bypass /
code-theft** angle belongs here too. Parsing discrepancies between the OP's registration check
and the browser's actual navigation let an attacker land the `code` on a URL they control:
path append/traversal (`/callback/../../evil`), duplicate `redirect_uri` parameters, deceptive
hosts (`localhost.evil.com`, `rp.example.com.evil.com`), `response_mode` swap (query→fragment),
and prefix- vs exact-match registration. **Exact-match** registration is the robust default.

Crucially, **`state` and `nonce` do NOT save you from code theft** when the attacker generates
their own values: in a login-CSRF / redirect-hijack the attacker runs their own flow with their
own `state`/`nonce`, so those checks pass on the attacker's side. Redirect-URI exact matching
(plus PKCE binding the code to the legitimate client) is what actually closes it.

## Common follow-up questions

- What is the difference between authentication and authorization, and which does OIDC add to
  OAuth? OAuth = authorization (delegated API access); OIDC adds authentication (proving who
  the user is) via the ID Token.
- Why can't I just use the access token to log the user in? It's a bearer credential for an
  API, often opaque to the client, audience-bound to a resource server, and says nothing about
  the authentication event — leading to token-substitution bugs.
- `state` vs `nonce`? `state` is reflected on the redirect (CSRF/callback binding); `nonce`
  is embedded in the ID Token (replay defense).
- How do you validate an ID Token? Verify signature (correct `kid`, expected asymmetric
  `alg`, reject `none`), then `iss`, `aud`==client_id, `exp`/`iat`, and `nonce`.
- What's in the discovery document and JWKS, and how does key rotation work? Endpoints +
  supported params; JWKS holds public signing keys keyed by `kid`; rotation = publish new key,
  clients match `kid` and refresh.
- SAML vs OIDC? XML assertions + XML-DSig vs JWT on OAuth 2.0; SAML for enterprise web SSO,
  OIDC for mobile/SPA/API.
- What is XML Signature Wrapping? Injecting an unsigned forged assertion while keeping the
  original signed one so the verifier passes but the app reads the forged element.
- Why is IdP-initiated SSO risky? Unsolicited assertion, no `InResponseTo`/`state`/`nonce`,
  enabling login CSRF and replay.
- Front-channel vs back-channel logout? Iframe-based browser logout (fragile under 3P-cookie
  blocking) vs server-to-server signed Logout Token (reliable).
- What is a mix-up attack and how do you prevent it? Attacker steers a multi-OP client's
  response to the wrong OP; pin expected `iss` per request, use the `iss` response param
  (RFC 9207).
- How are `c_hash`/`at_hash` computed and why? Hash the ASCII value with the hash matching
  the ID Token's JWS `alg`, take the left-most half, base64url-encode. They bind a
  front-channel ID Token to the code/access token to stop hybrid-flow token substitution.
- Why is matching "Sign in with X" users by email dangerous? Unverified-email / pre-hijack
  ATO and merge attacks; key on `(iss, sub)`, require `email_verified`, never auto-link by email.
- Name a recent SSO CVE and its root cause. Ruby-SAML CVE-2025-25291/292 — parser
  differential (REXML vs Nokogiri) with signature and hash verification not linked → full auth
  bypass from one valid signed assertion.
- What can go wrong if your OP fetches `logo_uri`/`jwks_uri`/`sector_identifier_uri`?
  Second-order SSRF (and stored XSS for `logo_uri`); allowlist and validate server-fetched URLs
  (CVE-2021-26715).
- Public vs pairwise `sub`? Public = same `sub` to all RPs; pairwise (PPID) = different
  `sub` per RP/sector to prevent cross-RP correlation, grouped by `sector_identifier_uri`.
- Bearer vs holder-of-key assertion? Bearer = possession is use (replayable); holder-of-key
  binds the assertion to a key the subscriber proves — the FAL3 / sender-constrained analog.
- How do you prove MFA and enforce step-up via OIDC? Request `acr_values`/`max_age`, then
  verify `acr`/`amr`/`auth_time` in the returned ID Token and re-prompt if insufficient.

## References

- OpenID Connect Core 1.0 — https://openid.net/specs/openid-connect-core-1_0.html
- OpenID Connect Discovery 1.0 — https://openid.net/specs/openid-connect-discovery-1_0.html
- OpenID Connect Front-Channel Logout 1.0 — https://openid.net/specs/openid-connect-frontchannel-1_0.html
- OpenID Connect Back-Channel Logout 1.0 — https://openid.net/specs/openid-connect-backchannel-1_0.html
- OpenID Connect RP-Initiated Logout 1.0 — https://openid.net/specs/openid-connect-rpinitiated-1_0.html
- RFC 6749 — OAuth 2.0 Authorization Framework — https://www.rfc-editor.org/rfc/rfc6749
- RFC 7636 — PKCE — https://www.rfc-editor.org/rfc/rfc7636
- RFC 7519 — JSON Web Token (JWT) — https://www.rfc-editor.org/rfc/rfc7519
- RFC 7515 — JSON Web Signature (JWS) — https://www.rfc-editor.org/rfc/rfc7515
- RFC 7517 — JSON Web Key (JWK/JWKS) — https://www.rfc-editor.org/rfc/rfc7517
- RFC 8414 — OAuth 2.0 Authorization Server Metadata — https://www.rfc-editor.org/rfc/rfc8414
- RFC 8693 — OAuth 2.0 Token Exchange — https://www.rfc-editor.org/rfc/rfc8693
- RFC 9207 — OAuth 2.0 Authorization Server Issuer Identification — https://www.rfc-editor.org/rfc/rfc9207
- RFC 9101 — JWT-Secured Authorization Request (JAR) — https://www.rfc-editor.org/rfc/rfc9101
- RFC 7591 — OAuth 2.0 Dynamic Client Registration — https://www.rfc-editor.org/rfc/rfc7591
- OpenID Connect Session Management 1.0 — https://openid.net/specs/openid-connect-session-1_0.html
- NIST SP 800-63-4 — Digital Identity Guidelines (supersedes 800-63-3/63C, Jul 2025) — https://pages.nist.gov/800-63-4/
- CVE-2025-25291 / CVE-2025-25292 — Ruby-SAML parser-differential auth bypass — https://github.com/advisories/GHSA-jw9c-mfg7-9rx2
- CVE-2021-26715 — MITREid Connect logo_uri SSRF/XSS — https://nvd.nist.gov/vuln/detail/CVE-2021-26715
- PortSwigger — Hidden OAuth attack vectors / OAuth & OIDC authentication vulnerabilities — https://portswigger.net/web-security/oauth
- OAuth 2.0 Security Best Current Practice — https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics
- SAML 2.0 (OASIS) core & Web Browser SSO Profile — https://docs.oasis-open.org/security/saml/v2.0/
- OWASP SAML Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html
- OWASP Cheat Sheet Series (Authentication, JWT, Session) — https://cheatsheetseries.owasp.org/
- NIST SP 800-63C — Federation & Assertions — https://pages.nist.gov/800-63-3/sp800-63c.html
