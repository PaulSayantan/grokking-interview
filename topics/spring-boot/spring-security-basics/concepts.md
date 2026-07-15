# Spring Security Basics

Spring Security is the de-facto authentication and authorization framework for
Spring applications. It is built as a chain of **servlet filters** that sit in
front of your `DispatcherServlet`, plus a rich set of authentication and
authorization abstractions. Spring Boot auto-configures a sensible default
(everything locked down, HTTP Basic + form login, a generated password) which
you then override with a `SecurityFilterChain` bean.

> **Spring Boot 3.x / Spring Security 6** run on **Spring Framework 6** and
> **Jakarta EE 9+**: the servlet API is `jakarta.servlet.*` (not
> `javax.servlet.*`), minimum Java 17. `WebSecurityConfigurerAdapter` was
> **deprecated in Spring Security 5.7 and removed in 6.0** — you now expose a
> `SecurityFilterChain` bean and use the **lambda DSL**. The old
> `and()`-chaining style was **deprecated in 6.1** (and removed in 7.0) in favor
> of lambdas.

---

## Authentication vs authorization

**Authentication** ("authn") answers *"who are you?"* — verifying an identity
(username/password, token, certificate). **Authorization** ("authz") answers
*"what are you allowed to do?"* — deciding whether an authenticated principal
may access a resource.

Authentication always happens first; authorization uses the resulting
`Authentication` (with its `authorities`) to make access decisions.

| | Authentication | Authorization |
|---|---|---|
| Question | Who are you? | What can you do? |
| Input | credentials | authenticated principal + its authorities |
| Failure HTTP status | **401 Unauthorized** | **403 Forbidden** |
| Spring pieces | `AuthenticationManager`, `AuthenticationProvider`, `UserDetailsService` | `AuthorizationManager`, `@PreAuthorize`, `authorizeHttpRequests` |

A common trap: **401 vs 403**. 401 means "you are not (validly) authenticated —
authenticate and retry"; 403 means "you *are* authenticated but lack
permission". Sending 401 for an authorization failure (or 403 for a missing
token) is a frequent bug.

---

## Security filter chain and request flow

Spring Security plugs into the servlet container through a **single** filter
registered by Boot named `springSecurityFilterChain`, wrapped in a
`DelegatingFilterProxy`. That delegate forwards to a `FilterChainProxy`, which
holds one or more `SecurityFilterChain` instances. Each `SecurityFilterChain`
has a `RequestMatcher` and an **ordered list of security filters**; the *first*
chain whose matcher matches is used (and **only that one** — chains are not
combined).

Request flow (happy path, form/basic):

1. `DelegatingFilterProxy` → `FilterChainProxy` picks the matching
   `SecurityFilterChain`.
2. Filters run in order. Key ones:
   - `SecurityContextHolderFilter` (formerly `SecurityContextPersistenceFilter`)
     — loads any existing `SecurityContext` (e.g. from the session).
   - `CsrfFilter`, `CorsFilter`, `HeaderWriterFilter`.
   - `UsernamePasswordAuthenticationFilter` (form login) /
     `BasicAuthenticationFilter` / a custom JWT filter — perform authentication.
   - `ExceptionTranslationFilter` — catches `AuthenticationException` (→ 401 /
     entry point) and `AccessDeniedException` (→ 403).
   - `AuthorizationFilter` (Security 6; replaced `FilterSecurityInterceptor`) —
     the **last** filter; enforces `authorizeHttpRequests` rules.
3. If authorization passes, the request proceeds to the `DispatcherServlet` and
   your controller.

Advanced gotchas:
- Ordering matters. `AuthorizationFilter` runs last so authentication filters
  have already populated the context. A custom auth filter is typically added
  with `addFilterBefore(myFilter, UsernamePasswordAuthenticationFilter.class)`.
- `web.ignoring()` / a permitAll chain: prefer `permitAll()` inside
  `authorizeHttpRequests` over `WebSecurity.ignoring()` because `ignoring()`
  bypasses the whole chain (no security headers, no CSRF), which is rarely what
  you want for anything but truly static assets.

---

## SecurityFilterChain and the lambda DSL

In Boot 3 you configure security by declaring a `SecurityFilterChain` **bean**
(no more subclassing `WebSecurityConfigurerAdapter`). The DSL is **lambda-based**;
`http.build()` returns the chain.

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

  @Bean
  SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
      .authorizeHttpRequests(auth -> auth
        .requestMatchers("/public/**", "/login").permitAll()
        .requestMatchers("/admin/**").hasRole("ADMIN")   // needs ROLE_ADMIN
        .anyRequest().authenticated())
      .formLogin(Customizer.withDefaults())
      .httpBasic(Customizer.withDefaults())
      .csrf(csrf -> csrf.disable());               // e.g. stateless API
    return http.build();
  }
}
```

Notes / traps:
- `authorizeHttpRequests` (the `AuthorizationFilter` API) **replaced** the older
  `authorizeRequests` (`FilterSecurityInterceptor`), which is deprecated.
- `hasRole("ADMIN")` automatically prepends the `ROLE_` prefix and checks for
  authority `ROLE_ADMIN`. `hasAuthority("ROLE_ADMIN")` is the explicit
  equivalent. Mixing them up is a classic bug: `hasRole("ROLE_ADMIN")` looks for
  `ROLE_ROLE_ADMIN`.
- Rules are evaluated **top-down, first match wins** — put specific matchers
  before `anyRequest()`.
- You can define **multiple** `SecurityFilterChain` beans; annotate with
  `@Order` and give each a `securityMatcher(...)` so a stateless `/api/**` chain
  and a session-based UI chain coexist.
- `@EnableWebSecurity` is auto-applied by Boot, but it is common to add it
  explicitly on the config class.

---

## SecurityContext and SecurityContextHolder

The current authentication is stored in a `SecurityContext`, accessed through the
static `SecurityContextHolder`:

```java
Authentication auth = SecurityContextHolder.getContext().getAuthentication();
String username = auth.getName();
Collection<? extends GrantedAuthority> authorities = auth.getAuthorities();
```

- `SecurityContextHolder` uses a **strategy**; the default is
  `MODE_THREADLOCAL`, so the context is bound to the **current thread**. That is
  why security info is *not* automatically visible in a new thread you spawn
  (`@Async`, manual threads) — you must propagate it
  (`MODE_INHERITABLETHREADLOCAL`, `DelegatingSecurityContextExecutor`, or
  `SecurityContext` copy).
- The `Authentication` holds the **principal** (often a `UserDetails`),
  **credentials** (usually erased after auth), and **authorities**.
- **Persistence:** in stateful apps the context is saved to the `HttpSession`
  via `HttpSessionSecurityContextRepository`. In Security 6 the
  `SecurityContextHolderFilter` no longer eagerly saves; you must save
  explicitly for programmatic login
  (`securityContextRepository.saveContext(...)`), a behavior change from 5.x's
  `SecurityContextPersistenceFilter`.
- The context is **cleared** at the end of each request to avoid leaking
  identity across pooled threads.

---

## UserDetailsService and UserDetails

`UserDetailsService` is the SPI that loads user data by username:

```java
public interface UserDetailsService {
  UserDetails loadUserByUsername(String username) throws UsernameNotFoundException;
}
```

`UserDetails` describes the loaded user: `getUsername()`, `getPassword()` (the
**encoded** hash), `getAuthorities()`, plus account flags (`isEnabled`,
`isAccountNonLocked`, `isAccountNonExpired`, `isCredentialsNonExpired`).

- The framework-provided `DaoAuthenticationProvider` calls
  `loadUserByUsername`, then delegates password comparison to the
  `PasswordEncoder`.
- Return `UsernameNotFoundException` when the user doesn't exist; by default it
  is translated to `BadCredentialsException` (to avoid **user enumeration** —
  leaking which usernames exist).
- `User.withUsername(...).password(...).roles("USER").build()` is a convenient
  `UserDetails` builder. `InMemoryUserDetailsManager` and
  `JdbcUserDetailsManager` are built-in implementations; for real apps you write
  a custom `UserDetailsService` backed by your repository.
- Do **not** confuse `UserDetailsService` (loads users, part of authentication)
  with `UserDetails` (the loaded user data structure).

---

## AuthenticationManager and AuthenticationProvider

`AuthenticationManager` is the entry point for authentication:

```java
Authentication authenticate(Authentication authentication) throws AuthenticationException;
```

Its standard implementation is `ProviderManager`, which holds a **list of
`AuthenticationProvider`s** and tries each until one supports the token type and
succeeds (Chain of Responsibility). Each provider's `supports(Class)` decides if
it handles a given `Authentication` subtype (e.g. `DaoAuthenticationProvider`
handles `UsernamePasswordAuthenticationToken`).

Flow for username/password:
1. A filter builds an **unauthenticated** `UsernamePasswordAuthenticationToken`.
2. `ProviderManager` → `DaoAuthenticationProvider` → `UserDetailsService.loadUserByUsername`
   → `PasswordEncoder.matches(raw, encoded)`.
3. On success, an **authenticated** token (credentials erased, authorities set)
   is returned and placed in the `SecurityContext`.

Advanced:
- `ProviderManager` can have a **parent** manager (global `AuthenticationManager`
  shared across chains).
- In Boot 3 you obtain the `AuthenticationManager` via
  `AuthenticationConfiguration.getAuthenticationManager()` or by building it from
  an `AuthenticationManagerBuilder`; you commonly expose it as a bean for
  programmatic (e.g. JWT login endpoint) use.
- `eraseCredentials` is true by default — the raw password is removed from the
  authentication after success.

---

## PasswordEncoder and BCrypt

Passwords must be stored as **salted, adaptive one-way hashes**, never plaintext
or fast hashes (MD5/SHA-256). `PasswordEncoder` abstracts this:

```java
@Bean
PasswordEncoder passwordEncoder() {
  return new BCryptPasswordEncoder();          // or PasswordEncoderFactories.createDelegatingPasswordEncoder()
}
```

- **BCrypt** is adaptive (configurable **strength/cost** factor, default 10 =
  2^10 rounds) and embeds a random **salt** inside the hash string
  (`$2a$10$...`), so you don't store salt separately. `matches()` re-derives with
  the embedded salt.
- **`DelegatingPasswordEncoder`** (the Spring Boot default) stores an
  **`{id}` prefix** — e.g. `{bcrypt}$2a$10$...`, `{argon2}...`, `{noop}...` — so
  you can migrate algorithms over time and verify legacy hashes. `{noop}` means
  plaintext (test only).
- **`NoOpPasswordEncoder`** is deprecated and unsafe. Alternatives to BCrypt for
  new systems: **Argon2**, **scrypt**, **PBKDF2** (all memory/CPU-hard).
- Trap: if you store `{bcrypt}...`-prefixed hashes but wire a bare
  `BCryptPasswordEncoder` (not delegating), matching fails because it treats the
  `{bcrypt}` prefix as part of the hash. Match the encoder to your stored format.
- Never log or return the encoded password; higher cost = slower login (a DoS
  vs brute-force trade-off).

---

## Form login vs HTTP Basic vs stateless

| | Form login | HTTP Basic | Stateless (token/JWT) |
|---|---|---|---|
| Credentials sent | POST to `/login` once | `Authorization: Basic base64(user:pass)` on **every** request | `Authorization: Bearer <token>` per request |
| State | server `HttpSession` + `JSESSIONID` cookie | none server-side, but creds resent each call | none server-side |
| Best for | browser UIs | scripts, simple internal APIs | SPAs, mobile, microservices |
| CSRF concern | yes (cookie-based) | typically over HTTPS; browsers cache creds | usually N/A if token in header |
| Logout | invalidate session | no real logout (browser caches) | discard token / short expiry / revoke |

- **Form login** is stateful: after login the server creates a session and the
  browser holds `JSESSIONID`; subsequent requests are authenticated via the
  session, not credentials.
- **HTTP Basic** resends base64 (NOT encrypted) credentials every request — only
  safe over TLS.
- **Stateless** auth carries all identity in a self-contained token so the
  server keeps no session — enabling horizontal scaling. Configure with
  `sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))`.

---

## JWT stateless authentication

A **JWT** (JSON Web Token) is a compact, URL-safe token with three
Base64URL-encoded parts joined by dots: **`header.payload.signature`**.

- **Header**: token type + signing algorithm, e.g. `{"alg":"HS256","typ":"JWT"}`.
- **Payload**: **claims** (e.g. `sub`, `iat`, `exp`, `roles`). Base64 is
  **encoded, not encrypted** — anyone can read it. Never put secrets in the
  payload of a signed-only (JWS) token.
- **Signature**: `HMACSHA256(base64(header) + "." + base64(payload), secret)`
  for HS256, or an RSA/EC signature for RS256/ES256. It guarantees
  **integrity/authenticity** — the server verifies it and rejects tampered
  tokens. It does **not** provide confidentiality.

**Access vs refresh token:**
- **Access token**: short-lived (minutes), sent on every API call, carries
  claims/authorities. If stolen, damage window is small.
- **Refresh token**: long-lived (days/weeks), stored securely, used *only* to
  obtain a new access token from the auth server. Lets access tokens stay short
  without forcing frequent re-login.

**Expiry & revocation (the hard part):** because a signed JWT is *self-validating*,
the server does not need to look it up — which means a valid, unexpired token
**cannot be revoked** by default (logout doesn't invalidate it). Mitigations:
- Keep access tokens **short-lived** so expiry does the revocation for you.
- Maintain a server-side **denylist/blocklist** of revoked token IDs (`jti`)
  until they expire (reintroduces state — a trade-off against pure statelessness).
- **Rotate** refresh tokens and revoke the refresh token on logout / detected
  reuse.
- Bump a per-user token version / `passwordChangedAt` and reject older tokens.

In Boot 3 the modern approach uses `spring-boot-starter-oauth2-resource-server`
with `http.oauth2ResourceServer(o -> o.jwt(...))`, which validates the signature
via a `JwtDecoder` (JWK set or shared secret) — you rarely hand-roll JWT parsing.

**JWT trap:** never accept `alg: none`; always validate `exp`, issuer (`iss`),
audience (`aud`), and signature. Storing JWT in `localStorage` exposes it to XSS;
an `HttpOnly` cookie avoids XSS reads but reintroduces CSRF concerns.

---

## CSRF protection (and why disabled for stateless APIs)

**CSRF** (Cross-Site Request Forgery) tricks a logged-in user's browser into
sending a state-changing request using **ambient credentials** (cookies) the
browser attaches automatically. It only works because the browser auto-sends the
session cookie — the attacker never sees it.

- Spring Security enables CSRF protection **by default** and requires a CSRF
  token (synchronizer-token pattern) on unsafe methods (POST/PUT/PATCH/DELETE).
  Safe, idempotent methods (GET/HEAD/OPTIONS/TRACE) are exempt.
- **Why disable it for a stateless API?** If your API authenticates via a
  **token in the `Authorization` header** (not a cookie), the browser does not
  auto-attach that credential to a forged cross-site request, so CSRF is not
  applicable — hence `csrf(csrf -> csrf.disable())` is common and acceptable for
  header-token APIs. **But** if you authenticate via a **cookie** (session or
  JWT-in-cookie), CSRF is still a real threat and must stay enabled.
- Security 6 changed the CSRF token loading (`CsrfTokenRequestAttributeHandler`,
  deferred token loading) — SPAs typically use the
  `CookieCsrfTokenRepository.withHttpOnlyFalse()` so JS can read the token and
  echo it in a header.

---

## CORS

**CORS** (Cross-Origin Resource Sharing) is a *browser* mechanism that relaxes
the **same-origin policy**, letting a page on origin A call an API on origin B
when the server opts in via `Access-Control-*` response headers. It is
**authorization of cross-origin reads by the browser**, not a server-side
protection.

- Configure via a `CorsConfigurationSource` bean + `http.cors(Customizer.withDefaults())`.
  Spring's `CorsFilter` runs **early** (before authentication) so **preflight**
  `OPTIONS` requests aren't rejected as unauthorized.
- **Preflight**: for "non-simple" requests the browser first sends an `OPTIONS`
  with `Access-Control-Request-*` headers; the server must answer with allowed
  origins/methods/headers.
- Traps: `allowedOrigins("*")` **cannot** be combined with
  `allowCredentials(true)` (spec forbids wildcard + credentials) — use
  `allowedOriginPatterns` instead. CORS ≠ CSRF; disabling CORS does not protect
  against CSRF and vice-versa. CORS is enforced by the browser, so it is not a
  defense against non-browser clients (curl, servers).

---

## Session management

- `sessionManagement(sm -> sm.sessionCreationPolicy(...))` controls sessions:
  - `ALWAYS`, `IF_REQUIRED` (default), `NEVER`, `STATELESS` (never create *or*
    use an `HttpSession`; SecurityContext lives only for the request).
- **Session fixation protection** is on by default (`changeSessionId` in servlet
  3.1+): on login Spring changes the session id so a pre-auth session id an
  attacker planted becomes useless.
- **Concurrent session control**: `maximumSessions(1)` limits simultaneous
  sessions per user (needs `HttpSessionEventPublisher`).
- For stateless JWT APIs use `STATELESS` so no `JSESSIONID` is created; then the
  `SecurityContext` must be re-established from the token on every request by a
  filter.

---

## Method security

Enable with `@EnableMethodSecurity` (Boot 3; replaces the deprecated
`@EnableGlobalMethodSecurity`). By default `@EnableMethodSecurity` turns on
`prePostEnabled=true`.

| Annotation | Source | Expression? | Enabled by |
|---|---|---|---|
| `@PreAuthorize` / `@PostAuthorize` | Spring Security | **Yes** — full SpEL (`hasRole`, `#arg`, `authentication`, `returnObject`) | `@EnableMethodSecurity(prePostEnabled=true)` (default) |
| `@Secured` | Spring Security | No — list of role strings only | `@EnableMethodSecurity(securedEnabled=true)` |
| `@RolesAllowed` | Jakarta (JSR-250) | No — list of role strings | `@EnableMethodSecurity(jsr250Enabled=true)` |

- `@PreAuthorize("hasRole('ADMIN')")` runs **before** the method;
  `@PostAuthorize("returnObject.owner == authentication.name")` runs **after**,
  and can inspect/deny based on the return value.
- `@Secured("ROLE_ADMIN")` and `@RolesAllowed("ADMIN")` are simpler, non-SpEL,
  and mainly exist for compatibility. Prefer `@PreAuthorize` for real logic.
- Note the **role prefix**: `@Secured` requires the full `ROLE_` prefix
  (`@Secured("ROLE_ADMIN")`); `hasRole('ADMIN')` and `@RolesAllowed("ADMIN")`
  add it for you.
- **Proxy gotcha (same as `@Transactional`):** method security is enforced by an
  **AOP proxy**, so a `@PreAuthorize` method called via **`this` (internal
  self-invocation)** bypasses the check — the call must go through the proxy.
  Also, methods must be **public** (Spring AOP proxies) unless AspectJ mode.
- `@PostAuthorize` throwing after the method already ran means side effects may
  have occurred — don't rely on it for methods that mutate state.

---

## RBAC vs ABAC

- **RBAC (Role-Based Access Control):** permissions are attached to **roles**;
  users are assigned roles. "Is the user an ADMIN?" This is what
  `hasRole`/`@Secured` express — simple, coarse-grained, easy to audit, but
  suffers **role explosion** as fine-grained needs grow.
- **ABAC (Attribute-Based Access Control):** decisions use **attributes** of the
  subject, resource, action, and environment — "can this user edit *this*
  document because they own it and it's business hours?" More flexible and
  fine-grained, harder to reason about/audit.
- Spring supports ABAC-style rules through **SpEL** in `@PreAuthorize`/
  `@PostAuthorize` (e.g. `@PreAuthorize("#doc.owner == authentication.name")`) and
  custom `PermissionEvaluator` / `AuthorizationManager`.
- Related trap: **role vs authority**. A *role* is just an authority conventionally
  prefixed `ROLE_`. `hasRole('X')` ⇔ `hasAuthority('ROLE_X')`. Fine-grained
  permissions (e.g. `document:read`) are usually modeled as **authorities**, not
  roles.

---

## OAuth2 grant types and PKCE

**OAuth2** is a delegated **authorization** framework (not authentication —
OpenID Connect adds identity/authn on top). Key roles: resource owner (user),
client (app), authorization server (issues tokens), resource server (hosts the
API).

Grant types:
- **Authorization Code**: the standard for web apps — client redirects user to
  auth server, gets a one-time **code**, then exchanges it (server-side, with
  client secret) for tokens. Tokens never pass through the browser URL.
- **Authorization Code + PKCE** (`code_challenge`/`code_verifier`): the modern
  default for **public clients** (SPAs, mobile) that can't keep a secret. The
  client sends a hashed `code_challenge` up front and the plain `code_verifier`
  at exchange, preventing **authorization-code interception** attacks.
- **Client Credentials**: machine-to-machine (no user) — client authenticates
  with its own credentials to get a token.
- **Refresh Token**: exchange a refresh token for a new access token.
- **Implicit** and **Resource Owner Password Credentials (ROPC)** grants are
  **deprecated** by OAuth 2.1 (implicit leaked tokens via the URL fragment; ROPC
  requires the app to handle raw passwords). Interview trap: don't recommend
  implicit/password grant for new apps.

In Spring: `spring-boot-starter-oauth2-client` for acting as a client
(`http.oauth2Login(...)`), and `spring-boot-starter-oauth2-resource-server`
(`http.oauth2ResourceServer(o -> o.jwt(...))`) for validating incoming access
tokens on an API.

---

## Common follow-up questions

- **Why do I get a generated password / everything is secured by default?**
  Boot's `SecurityAutoConfiguration` locks all endpoints and creates a `user`
  with a random logged password until you define your own `SecurityFilterChain`
  or user details.
- **How do I have both a stateless `/api/**` chain and a session UI chain?**
  Two `SecurityFilterChain` beans with `@Order` + `securityMatcher`.
- **Why doesn't `@PreAuthorize` work on a method called from within the same
  bean?** AOP proxy self-invocation bypass — the internal call skips the proxy.
- **`hasRole('ADMIN')` fails even though my user has `ROLE_ADMIN` — why?** Usually
  the reverse: you granted `ADMIN` without the `ROLE_` prefix, or used
  `hasAuthority('ADMIN')` vs `hasRole('ADMIN')` inconsistently.
- **Is it safe to disable CSRF?** Only when you don't authenticate via cookies
  (i.e. bearer-token stateless APIs). Cookie-based auth still needs CSRF.
- **Can I revoke a JWT?** Not natively; use short expiry + a denylist / refresh
  rotation / token versioning.
- **Where should a SPA store its JWT?** `HttpOnly` cookie (XSS-safe, but needs
  CSRF handling) vs memory/localStorage (XSS-exposed). Trade-off question.
- **401 vs 403?** 401 = not authenticated; 403 = authenticated but not authorized.
- **Difference between `authorizeHttpRequests` and `authorizeRequests`?** The
  former (new, `AuthorizationManager`/`AuthorizationFilter`) replaces the
  deprecated latter (`FilterSecurityInterceptor`).

---

## References

- Spring Security Reference — Architecture: https://docs.spring.io/spring-security/reference/servlet/architecture.html
- Spring Security — Authentication: https://docs.spring.io/spring-security/reference/servlet/authentication/index.html
- Spring Security — Authorization / Method Security: https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html
- Spring Security — CSRF: https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html
- Spring Security — CORS: https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html
- Spring Security — Password storage / `PasswordEncoder`: https://docs.spring.io/spring-security/reference/features/authentication/password-storage.html
- Spring Security 6 migration (removal of `WebSecurityConfigurerAdapter`): https://docs.spring.io/spring-security/reference/migration-7/index.html
- Spring Boot — OAuth2 Resource Server: https://docs.spring.io/spring-boot/reference/web/spring-security.html
- Baeldung — Spring Security: https://www.baeldung.com/security-spring
- Baeldung — SecurityFilterChain: https://www.baeldung.com/spring-security-migrate-to-securityfilterchain
- RFC 7519 (JWT): https://datatracker.ietf.org/doc/html/rfc7519
- RFC 7636 (PKCE): https://datatracker.ietf.org/doc/html/rfc7636
- OAuth 2.1 draft: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1
