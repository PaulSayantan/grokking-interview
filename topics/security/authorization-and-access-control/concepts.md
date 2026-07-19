# Authorization & Access Control Models

Authorization is the part of security that decides **"is this authenticated principal
allowed to do this specific thing to this specific resource, right now?"** It is the
single most exploited class of web vulnerability: OWASP put **Broken Access Control** at
**#1 (A01:2021)** in the 2021 Top 10, and object/function-level authorization failures
(BOLA/BFLA) are #1 and #5 in the OWASP **API** Security Top 10 (2023). Unlike injection or
XSS, access-control bugs usually cannot be caught by a WAF or a scanner because the request
is perfectly well-formed — it is just *not allowed*, and only your own business logic knows
that.

This document is framework-agnostic. It teaches the **models** (DAC, MAC, RBAC, ABAC,
ReBAC), the **principles** (least privilege, deny by default), the **enforcement
architecture** (PEP/PDP, centralized policy), and the **attack classes** (privilege
escalation, IDOR/BOLA, BFLA, confused deputy, TOCTOU, tenant bleed). Each attack section
follows a **vulnerable pattern → concrete exploit → correct defense** shape.

> [!KEY-TAKEAWAY]
> AuthN proves *who you are*; authZ decides *what you may do*. Access control must be
> enforced **server-side, on every request, for every object and every function**, and it
> must **deny by default**. Everything else in this file is an elaboration of that sentence.

---

## Authorization versus authentication

**Definition.** *Authentication (AuthN)* answers **"who are you?"** — it establishes and
verifies identity (password + MFA, a session cookie, an OIDC ID token). *Authorization
(AuthZ)* answers **"what are you allowed to do?"** — it decides whether the already-identified
principal may perform an action on a resource. AuthN happens first and produces a trusted
identity; AuthZ consumes that identity plus context to make an allow/deny decision.

**Why it matters.** Conflating the two is a classic root cause of breaches. A common bug:
"the user is logged in, therefore they can see `/orders/12345`." Being *authenticated* says
nothing about whether *this* user owns order 12345 — that is an *authorization* check, and
skipping it is exactly IDOR/BOLA.

**HTTP status codes encode the distinction.**

| Situation | Status | Meaning |
|---|---|---|
| Not logged in / bad credentials | **401 Unauthorized** | "Authenticate first" (misnamed — it's about AuthN) |
| Logged in but not permitted | **403 Forbidden** | "I know who you are; you still can't" |

> [!WARNING]
> `401` is historically misnamed — it means *unauthenticated*. Returning `403` where you
> should return `401` (or vice versa) can leak whether a resource *exists* to an
> unauthenticated attacker. To avoid resource-existence disclosure, some APIs deliberately
> return `404` instead of `403` for objects the caller may not even know about.

**Trade-off / gotcha.** Identity is necessary but never sufficient. A valid JWT or session
means AuthN passed; the token's *claims* (roles, scopes, tenant) are **inputs** to AuthZ,
not the decision itself. Never treat "has a valid token" as "is authorized."

---

## Access control models overview: DAC and MAC

Access control models are the *policy paradigms* for expressing rules. The two oldest,
from the classic security literature (and the NIST/Orange-Book tradition), are **DAC** and
**MAC**.

**Discretionary Access Control (DAC).** The **owner** of a resource decides who else can
access it, at their discretion. Unix file permissions (`chmod`, owner/group/other), most
"share this document with…" features, and ACLs are DAC. It is flexible and intuitive but
**dangerous at scale**: any owner can widen access, permissions sprawl, and a compromised
or careless user can leak data (a trojan running as you can re-share your files).

**Mandatory Access Control (MAC).** A **central authority** sets policy that users
**cannot override**. Access is decided by comparing *security labels* (e.g.,
Unclassified < Confidential < Secret < Top Secret) attached to both subjects and objects,
enforced by the system. Classic models: **Bell–LaPadula** (confidentiality: "no read up,
no write down") and **Biba** (integrity: "no write up, no read down"). SELinux and AppArmor
are MAC-style enforcement on Linux. MAC is rigid but strong — the user simply *cannot*
grant themselves or others more access than the label lattice permits.

| | DAC | MAC |
|---|---|---|
| Who sets policy | Resource owner | Central authority |
| Flexibility | High | Low |
| User can override | Yes | No |
| Typical use | File systems, doc sharing | Military/gov, SELinux |
| Weakness | Sprawl, trojans widen access | Rigid, admin overhead |

**Interview framing.** DAC = "owner's discretion"; MAC = "mandated by policy, immutable by
users." Real systems usually layer **RBAC/ABAC on top** for day-to-day app authorization
and reserve MAC-style controls for OS/infra hardening.

---

## Role-Based Access Control (RBAC)

**Definition.** RBAC grants permissions to **roles**, and assigns **roles to users**.
Users never get permissions directly; they inherit them via role membership. This is the
dominant model in enterprise apps (and the NIST RBAC standard, ANSI INCITS 359).

```
users ──many-to-many──> roles ──many-to-many──> permissions ──> operations on resources
```

- **Permission** = an allowed *operation* on a *resource type* (e.g., `invoice:read`,
  `invoice:approve`).
- **Role** = a named bundle of permissions (e.g., `accountant`, `auditor`, `admin`).
- **Role hierarchy** (optional): `senior_accountant` inherits `accountant`'s permissions.
- **Constraints / SoD:** *Separation of Duties* prevents one user holding conflicting
  roles (you can't be both `requester` and `approver` of the same payment).

**Why it matters.** RBAC scales administration: onboard a new accountant → assign one role,
not fifty individual grants. It maps cleanly to org structure and audits well ("who has
`admin`?").

**Trade-offs / limits.**
- **Role explosion.** When rules depend on context (region, department, project, time),
  teams create `accountant_us_west_readonly_2024`-style combinatorial roles. This is the
  smell that you actually need ABAC/ReBAC.
- **Coarse for per-object rules.** RBAC says "accountants can read invoices" — it does not
  natively say "this accountant can read *only invoices for their own branch*." That
  object-scoping must be layered on (often via ABAC attributes or ownership checks), and
  forgetting it is how RBAC apps still get IDOR.

> [!INTERVIEW]
> "What's the difference between a role and a permission?" A **permission** is an atomic
> allowed action (`document:delete`); a **role** is a reusable *set* of permissions you
> assign to users. Roles are for humans/administration; permission *checks* in code should
> be against **permissions/capabilities**, not role names, so you can re-shuffle roles
> without touching code (`if user.can('document:delete')`, not `if user.role == 'admin'`).

---

## Attribute-Based Access Control (ABAC)

**Definition.** ABAC makes decisions by evaluating **attributes** of the *subject*,
*resource*, *action*, and *environment* against **policies**, rather than static role
membership. It is sometimes called *policy-based access control* and is described in
**NIST SP 800-162**. The reference architecture is **XACML** (subject/resource/action/
environment attributes → PDP evaluates policy → permit/deny).

- **Subject attributes:** department = "finance", clearance = "secret", employeeId.
- **Resource attributes:** owner, classification, branchId, cost > $10k.
- **Action:** read / approve / delete.
- **Environment:** time of day, IP/geo, device posture, MFA-completed?

Example policy (English): *"Permit `approve` on an `invoice` if subject.department ==
resource.branch AND subject.role == manager AND invoice.amount < subject.approvalLimit AND
current time is business hours."*

**Why it matters / trade-offs.**
- **Gain:** extremely fine-grained and dynamic; expresses context-dependent rules RBAC
  can't without role explosion. One policy replaces thousands of roles.
- **Give up:** complexity and *analyzability*. It's hard to answer "who can access X?"
  (reverse queries) and to test/audit policies. Attribute sourcing must be trustworthy —
  a spoofable attribute (e.g., a client-supplied `isAdmin` header) becomes a privilege-
  escalation vector.
- **Performance:** decisions may need to fetch attributes from multiple sources at request
  time; cache carefully.

**RBAC vs ABAC in one line:** RBAC = "*who you are* (your role)"; ABAC = "*the properties
of you, the thing, the action, and the moment*." Modern systems commonly combine them:
roles as coarse attributes inside ABAC policies.

---

## Relationship-Based Access Control (ReBAC) and Google Zanzibar

**Definition.** ReBAC decides access based on **relationships in a graph** between subjects
and objects: *"Alice can edit doc123 because Alice is a member of group-eng, and group-eng
is an editor of folder-X, and doc123 is in folder-X."* Authorization becomes a **graph
reachability** question. This is the natural model for "Google Docs-style" sharing,
GitHub repo/org/team access, and social-graph visibility.

**Google Zanzibar** is Google's global authorization system (2019 paper) that popularized
ReBAC. Key ideas interviewers probe:

- **Relation tuples** of the form `⟨object#relation@user⟩`, e.g.
  `doc:readme#viewer@user:anne` ("anne is a viewer of doc:readme") or
  `doc:readme#viewer@group:eng#member` (userset rewrite: members of group eng are viewers).
- **Namespace configs** define relations and **userset rewrite rules** (e.g., "an `editor`
  is also implicitly a `viewer`"; "a viewer of a folder is a viewer of docs in it").
- **Zookies** — consistency tokens that solve the "new enemy" problem: they ensure a
  permission check reflects an ACL update at least as fresh as some prior state, preventing
  a race where a just-revoked user still sees data because a replica was stale.
- Built for **massive scale and low latency** with heavy caching and a globally distributed
  store (Spanner). Open-source implementations inspired by it: **OpenFGA**, **SpiceDB**,
  **Ory Keto**.

**Why it matters / trade-offs.**
- **Gain:** models nested groups, inheritance, and sharing naturally; answers "who can
  access X" and "what can Y access" as graph traversals; centralizes authz data.
- **Give up:** you now run a distributed, strongly-consistency-sensitive system; keeping
  the tuple store in sync with your app's source of truth is real work; deep graphs can be
  expensive to evaluate.

> [!TIP]
> Interview signal: if the requirement is *"users share individual resources with other
> users/groups with inheritance"* (Docs, GitHub), that's **ReBAC/Zanzibar**. If it's
> *"access depends on user role/attributes and resource attributes/policy"*, that's
> **RBAC/ABAC**. They're combinable.

---

## Principle of least privilege

**Definition.** Every principal (user, service, process, token) should have the **minimum
privileges needed to do its job, and no more** — for the **shortest time** needed. It is a
foundational security principle (Saltzer & Schroeder, 1975) and appears throughout OWASP
ASVS and NIST guidance (and is core to *zero-trust*).

**Why it matters.** Least privilege **shrinks blast radius**. When (not if) a credential
leaks or a component is compromised, the damage is bounded by what that principal could do.
An over-privileged service account is how a single SSRF or leaked key turns into a full
data-plane breach.

**Concrete applications.**
- **Deny by default**, grant explicitly (see next section).
- **Scoped tokens:** an OAuth access token for a read-only widget gets `read:profile`, not
  `admin`. Short TTLs + refresh rotation limit replay windows.
- **Just-in-time / time-boxed elevation:** grant `admin` for 30 minutes with approval,
  then auto-revoke, instead of standing admin.
- **Per-service DB users** with only the tables/operations they need; not one superuser
  connection string shared across the fleet.
- **Separate roles for separate duties** (SoD), avoiding one omnipotent role.

**Related principles.** *Need to know* (data), *privilege separation* (split a process into
low- and high-privilege parts — see confused deputy), and *defense in depth* (least
privilege at network, OS, app, and data layers).

> [!WARNING]
> The most common least-privilege failure in practice is **wildcard IAM/permission
> grants** (`*:*`, `Action: *`) attached "temporarily" and never tightened, plus
> **standing admin** accounts. Both violate least privilege and dramatically enlarge blast
> radius.

---

## Privilege escalation: horizontal versus vertical

**Definition.** *Privilege escalation* is gaining access beyond what you were granted.
Two flavors:

- **Horizontal escalation** — accessing resources/data of **another user at the same
  privilege level**. Example: user A reads user B's messages by changing an ID. This is the
  IDOR/BOLA family.
- **Vertical escalation** — gaining a **higher privilege level** than assigned. Example: a
  regular user invokes an admin-only function and becomes able to delete any account. This
  is the BFLA family / missing function-level checks.

```
             same level, other user's data  →  HORIZONTAL   (IDOR / BOLA)
you ─────────────────────────────────────────────────────────────────────>
             higher privilege / admin funcs  →  VERTICAL     (BFLA / privilege elevation)
```

**Concrete vectors.**
- **Horizontal:** `GET /api/users/1002/invoices` when you are user 1001; changing
  `account_id` in a request body; guessing another user's UUID from a leaked list.
- **Vertical:** calling `POST /admin/deleteUser` as a normal user because the endpoint only
  checked authentication; setting `"role":"admin"` in a profile-update payload that the
  server trusts (mass assignment); flipping a hidden `isAdmin` form field.

**Defense.** Enforce authorization on **every request** using **server-side identity**
(from the session/token, never from a client-supplied ID), check both **object ownership**
(horizontal) and **required capability/role** (vertical), and **deny by default**. Never
rely on the UI hiding a button — attackers call the API directly.

---

## BOLA and IDOR: broken object-level authorization

**What it is.** *Insecure Direct Object Reference (IDOR)* / *Broken Object Level
Authorization (BOLA)* is failing to verify that the **authenticated caller is allowed to
act on the specific object** identified in the request. It is **OWASP API Security Top 10
#1 (API1:2023)** and a core part of Broken Access Control (A01:2021). It is a **horizontal**
escalation.

**Vulnerable pattern.** The endpoint uses a client-supplied identifier to fetch the object
and returns it after only checking that the user is *logged in*:

```http
GET /api/v1/orders/57231 HTTP/1.1
Authorization: Bearer <valid token for user 1001>
```
```python
# VULNERABLE: authenticates, but never checks ownership
order = db.orders.find(id=request.path_params["id"])
return order            # returns ANY order to ANY logged-in user
```

**Concrete exploit.** Attacker (user 1001) enumerates IDs: `/orders/57231`, `/orders/57232`,
… and harvests every customer's order. Sequential integer IDs make this trivial; even UUIDs
are not a fix if they leak (in URLs, referrers, other endpoints).

**Correct defense.** Scope the query to the caller, or verify ownership explicitly:

```python
# FIXED: bind the object to the authenticated subject
order = db.orders.find(id=request.path_params["id"],
                       owner_id=current_user.id)   # server-side identity
if order is None:
    return 404          # don't confirm existence to non-owners
return order
```

Key rules:
- Derive the acting identity from the **session/token server-side**, never from a body/query
  parameter.
- Enforce a **per-object** check on **every** object accessed (including nested and batch
  operations, and *write* paths, not just reads).
- Prefer scoping the DB query (`WHERE owner_id = :me`) so "not yours" and "not found"
  collapse — this is harder to forget than a post-fetch `if`.
- **Random UUIDs are defense-in-depth, not authorization.** "Unguessable ID" ≠ "authorized."

> [!WARNING]
> BOLA is invisible to WAFs and scanners because the request is legitimate and the ID is
> valid — only your business logic knows user 1001 doesn't own order 57231. This is why
> it's the #1 API risk and needs test coverage per object type.

---

## BFLA: broken function-level authorization

**What it is.** *Broken Function Level Authorization (BFLA)* is failing to check that the
caller is allowed to invoke a **function/operation** — typically administrative or
privileged endpoints exposed without a role/capability check. It is **OWASP API Security
Top 10 #5 (API5:2023)** and a **vertical** escalation. Where BOLA is "wrong *object*", BFLA
is "wrong *function*."

**Vulnerable patterns.**
- **Security through obscurity / hidden UI:** the admin endpoint exists and only checks
  authentication; the app "protects" it by not showing the button. Attacker guesses/reads
  the JS bundle and calls it directly.
- **Method/verb gaps:** `GET /api/users/{id}` is protected but `DELETE /api/users/{id}` is
  not; or `/api/v2` added a check but legacy `/api/v1` didn't.
- **Predictable admin routes:** swapping `/user/...` for `/admin/...` works because the
  admin handler forgot the role check.

```http
POST /api/v1/admin/users/1002/promote HTTP/1.1
Authorization: Bearer <token for an ordinary user>
```
If this succeeds for a non-admin, that's BFLA → vertical escalation.

**Correct defense.**
- Enforce the **required capability/role at the function boundary** for *every* privileged
  endpoint (ideally via a centralized middleware/policy so it can't be forgotten
  endpoint-by-endpoint), and **deny by default** for unlisted routes.
- Regular users should be **denied by default** to admin functions unless a specific grant
  says otherwise — don't rely on route obscurity.
- Cover **all HTTP methods** and **all API versions** for every resource.
- Separate admin functionality cleanly and gate the whole surface, not each handler ad hoc.

**BOLA vs BFLA cheat sheet:**

| | BOLA / IDOR | BFLA |
|---|---|---|
| Question | "Can this user touch *this object*?" | "Can this user call *this function*?" |
| Escalation | Horizontal (other users' data) | Vertical (higher privilege) |
| OWASP API 2023 | **API1** | **API5** |
| Fix | Per-object ownership/scoping check | Per-function role/capability check |

---

## Deny by default (fail closed)

**Definition.** In a secure design, the **default answer is "deny"**; access is granted only
by an explicit matching rule. Equivalently: **fail closed** — if a check errors, times out,
or the policy is missing/ambiguous, treat it as *denied*, not *allowed*. This is a core
Saltzer & Schroeder principle ("fail-safe defaults") and appears in OWASP ASVS and the
Access Control Cheat Sheet.

**Why it matters.** Deny-by-default means a *new* endpoint, a *new* resource type, or a
*forgotten* rule is inaccessible until someone deliberately opens it — the failure mode is
"nobody can use it," which gets noticed and fixed, rather than "everybody can use it," which
gets exploited silently.

**Anti-patterns (fail open / allow by default):**
- A route not listed in an *allowlist* of protected routes is served without any check.
- `try { checkAccess() } catch { /* proceed */ }` — an exception in the authz service
  results in access being *granted*.
- CORS/`Access-Control-Allow-Origin` reflecting any `Origin` because there's no explicit
  allowlist.
- A permission map where "unknown action" falls through to permit.

```python
# FAIL OPEN (bad): unknown/unhandled ⇒ allowed
if action in DENY_LIST: reject()
proceed()

# FAIL CLOSED (good): must be explicitly permitted
if not policy.permits(subject, action, resource):
    reject()
proceed()
```

> [!KEY-TAKEAWAY]
> Design with **allowlists, not denylists**, and make the *absence* of a decision mean
> **deny**. Denylists are always incomplete; the request you didn't think of is the one
> that gets through.

---

## Centralized policy: PEP, PDP and OPA/Rego

**The problem.** If every endpoint hand-rolls its own `if user.role == ...` checks,
authorization logic is scattered, inconsistent, untestable, and easy to forget — which is
exactly how BOLA/BFLA slip in. The fix is to **externalize and centralize** the decision.

**The reference architecture (XACML/NIST terms):**

- **PEP — Policy Enforcement Point.** Sits in the request path (a middleware, gateway,
  sidecar). It *intercepts* the request, asks the PDP "may this happen?", and **enforces**
  the answer (allow/deny). It does not contain the rules.
- **PDP — Policy Decision Point.** *Evaluates* policy against the request's attributes and
  returns permit/deny. This is where the rules live.
- **PAP — Policy Administration Point.** Where policies are authored/managed.
- **PIP — Policy Information Point.** Supplies extra attributes the PDP needs (e.g., fetch
  the resource's owner or the user's department).

```
request ─▶ [ PEP ] ──"can subject do action on resource?"──▶ [ PDP ] ──▶ permit/deny
             │                                                  ▲
          enforce                                            [ PIP ] attributes
```

**OPA / Rego.** *Open Policy Agent* is a popular general-purpose PDP: policies are written
in the declarative **Rego** language and OPA answers decisions via API (often deployed as a
sidecar for microservices/Kubernetes admission control). Decoupling policy from code lets
you version, test, and audit rules centrally, and change them without redeploying every
service.

```rego
package authz
default allow = false                      # deny by default
allow {
    input.action == "read"
    input.resource.owner == input.subject.id     # object-level check
}
allow {
    input.subject.roles[_] == "admin"            # capability check
}
```

**Trade-offs.**
- **Gain:** consistency, auditability, single place to reason about "who can do what,"
  reuse across services, testable policies, easier to prove deny-by-default.
- **Give up:** the PDP is now a dependency in the hot path (latency, availability — cache
  and **fail closed** if it's unreachable), and you must reliably feed it the right
  attributes; a bug in central policy affects everything at once.
- **Data-heavy relationship decisions** ("is X in a group that owns Y?") may need a
  Zanzibar-style store rather than a stateless policy engine.

---

## The confused deputy problem

**Definition.** A *confused deputy* is a privileged program (the "deputy") that is tricked
by a less-privileged caller into **misusing its authority** on the caller's behalf. The
deputy has legitimate access; the attacker doesn't — but the attacker gets the deputy to act
for them. Coined by Norm Hardy (1988).

**Classic examples.**
- **SSRF is a confused deputy.** Your server can reach the internal metadata service
  (`http://169.254.169.254/…`) and internal admin panels. An attacker who can make your
  server fetch an attacker-chosen URL borrows the server's network position to reach things
  *they* can't. The server is the confused deputy.
- **CSRF is a confused deputy.** The victim's browser is the deputy: it holds the victim's
  session cookie and is tricked by a malicious page into sending an authenticated
  state-changing request. The browser has authority (the cookie) and is confused into using
  it for the attacker.
- **Compiler/billing-file example (Hardy's original):** a shared compiler service had write
  access to a system billing file; a user could name that (or another privileged) file as the
  compiler's output target, tricking the deputy into overwriting a file they couldn't touch
  directly.

**Why it matters / defenses.** The root cause is **ambient authority** — the deputy acts
with its *own* privileges, decoupled from the *requester's* intent. Defenses:

- **Capability-based / handle-passing security:** the requester must present a *capability*
  (an unforgeable token/handle) for the specific resource, so the deputy can only act within
  what the requester was actually authorized for. The authority travels *with the request*,
  not ambiently.
- **Pass and check the original principal's authorization** ("on-behalf-of" tokens, OAuth
  token exchange / RFC 8693) rather than acting purely with the deputy's own rights.
- **Constrain the deputy:** allowlist destinations (SSRF), require anti-CSRF tokens +
  `SameSite` cookies (CSRF), drop unneeded privileges.

> [!INTERVIEW]
> If asked "why is SSRF so dangerous even though the attacker can't reach the internal
> network?" — the phrase to say is **confused deputy**: the attacker borrows the server's
> ambient authority/network position. That framing links SSRF, CSRF, and privilege design
> into one idea.

---

## TOCTOU: time-of-check to time-of-use race conditions

**Definition.** A *Time-Of-Check to Time-Of-Use (TOCTOU)* flaw is a **race condition**
where the state that was validated at *check* time changes before *use* time, so the
authorization/validation no longer holds when the action actually runs. It's an atomicity
failure between "verify allowed" and "do it." (CWE-367.)

**Classic filesystem example.** A privileged program does `access(path)` to check the user
may read a file, then `open(path)` to read it. Between the two calls the attacker swaps
`path` (via a symlink) to point at `/etc/shadow`. The check passed for the innocent file;
the *use* hit the sensitive one.

**Web/app examples.**
- **Double-spend / balance:** check `balance >= amount`, then two concurrent requests both
  pass the check and both debit — account goes negative. (Also the basis of many "redeem
  coupon twice / withdraw twice" bugs.)
- **Authorization revoked mid-flight:** permission checked at request start, but a
  long-running job keeps using it after the grant was revoked.
- **State validation:** "is this order still `PENDING`?" then act — but it changed to
  `CANCELLED` between check and act.

**Defenses.**
- **Make check-and-act atomic.** Use transactions with proper isolation, `SELECT … FOR
  UPDATE` / row locks, **conditional/compare-and-swap updates**
  (`UPDATE accounts SET balance = balance - :amt WHERE id = :id AND balance >= :amt`), or
  optimistic concurrency with version numbers.
- **Use handles, not names/paths** you re-resolve (e.g., operate on an open file descriptor,
  not the path string) to kill symlink races.
- **Re-check authorization at the moment of use** for long-lived operations; don't cache an
  allow decision across a state change.
- **Idempotency keys** to make retried/duplicated requests safe.

---

## Multi-tenancy isolation

**Definition.** In a multi-tenant system many customers (tenants) share the same
application/infrastructure. **Tenant isolation** ensures one tenant can never read, modify,
or exhaust another tenant's data or resources. A broken tenant boundary ("tenant bleed") is
a catastrophic BOLA at the *organization* scale — one customer sees another's data.

**Isolation models (spectrum):**

| Model | Data separation | Isolation strength | Cost/complexity |
|---|---|---|---|
| **Silo** (DB/instance per tenant) | Separate DB/schema | Strongest | Highest |
| **Bridge** (shared DB, schema/partition per tenant) | Logical | Medium | Medium |
| **Pool** (shared tables, `tenant_id` column) | Row-level | Weakest (all in app logic) | Lowest |

**The pool-model trap (most common bug).** With a shared table keyed by `tenant_id`, **every
single query must be scoped by the tenant** derived from the authenticated context. Forget
it once and you leak across tenants:

```sql
-- VULNERABLE: no tenant scoping — returns rows from ALL tenants
SELECT * FROM documents WHERE id = :doc_id;

-- FIXED: always constrain by the authenticated tenant
SELECT * FROM documents WHERE id = :doc_id AND tenant_id = :ctx_tenant_id;
```

**Defenses / best practices.**
- Derive `tenant_id` **from the authenticated principal (token/session) server-side**, never
  from a request parameter the client controls (that's just BOLA again).
- **Enforce isolation below the app layer where possible:** database **Row-Level Security
  (RLS)** policies, a query layer/ORM scope that *cannot* be bypassed, or separate
  connections/schemas per tenant — so a forgotten `WHERE` can't leak.
- Isolate **all** resources: object storage prefixes/buckets, cache keys (namespace by
  tenant so cache doesn't cross-serve), search indices, message queues, file paths, and
  logs.
- Prevent **noisy-neighbor / resource-exhaustion** cross-tenant DoS with per-tenant rate
  limits and quotas.
- Watch **shared caches and connection pools** — a cache key without the tenant, or a
  pooled DB session that carries one tenant's context into another's request, causes
  cross-tenant bleed.
- Include cross-tenant access attempts in your **test suite** (tenant A's token against
  tenant B's object must 403/404).

> [!WARNING]
> The single most dangerous multi-tenant mistake is trusting a **client-supplied tenant
> identifier** (`X-Tenant-Id` header, `?org=` query param) instead of the one bound to the
> authenticated session. An attacker just changes it. Bind tenant to the verified identity.

---

## Common follow-up questions

- **"Difference between authentication and authorization?"** AuthN = who you are (verified
  identity); AuthZ = what you may do (allow/deny per action/resource). AuthN first, then
  AuthZ using the identity + context.
- **"401 vs 403?"** 401 = not authenticated (misnamed "Unauthorized"); 403 = authenticated
  but not permitted. Sometimes 404 is returned to avoid disclosing a resource's existence.
- **"RBAC vs ABAC — when do you pick each?"** RBAC for stable, role-shaped orgs and easy
  audit; ABAC when access depends on dynamic subject/resource/environment attributes and
  RBAC would explode into thousands of roles. Often combined.
- **"When would you reach for ReBAC/Zanzibar?"** When access is defined by *relationships*
  and *sharing/inheritance* (Docs, GitHub, folders/groups), and you need "who can access X"
  answered at scale.
- **"BOLA vs BFLA?"** BOLA/IDOR = wrong *object* (horizontal); BFLA = wrong *function*
  (vertical). Fix BOLA with per-object ownership checks; fix BFLA with per-function
  capability checks. Both must be server-side and deny-by-default.
- **"Why isn't a random UUID enough to stop IDOR?"** Unguessable ≠ authorized; IDs leak
  (URLs, logs, other endpoints), and authorization is still your job.
- **"How do you avoid scattering authz checks?"** Centralize with a PEP/PDP (e.g., OPA/Rego)
  so checks are consistent, testable, auditable, and enforced by default.
- **"Why is SSRF a 'confused deputy'?"** The server misuses its own network authority on the
  attacker's behalf; the attacker borrows ambient authority.
- **"How do you prevent a double-spend?"** Make check-and-act atomic: conditional update /
  row lock / transaction / optimistic concurrency — that's the TOCTOU defense.
- **"How do you isolate tenants in a shared DB?"** Scope every query by an authenticated
  `tenant_id`, ideally enforced by RLS or an un-bypassable query layer; never trust a
  client-supplied tenant id.
- **"What is principle of least privilege and how do you apply it to a service?"** Minimum
  rights for minimum time: scoped tokens, per-service DB users, JIT elevation, no wildcard
  grants — to shrink blast radius.

## References

- OWASP Top 10 2021 — **A01:2021 Broken Access Control**: https://owasp.org/Top10/A01_2021-Broken_Access_Control/
- OWASP API Security Top 10 2023 — **API1:2023 BOLA**: https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
- OWASP API Security Top 10 2023 — **API5:2023 BFLA**: https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/
- OWASP Cheat Sheet — **Authorization**: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Cheat Sheet — **Insecure Direct Object Reference Prevention**: https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html
- OWASP Cheat Sheet — **Multitenant / cross-tenant** guidance (Authorization Cheat Sheet, tenant isolation section)
- OWASP WSTG — **Testing for Authorization** (IDOR, privilege escalation, function-level): https://owasp.org/www-project-web-security-testing-guide/
- OWASP ASVS v4 — **V4 Access Control Verification Requirements**: https://owasp.org/www-project-application-security-verification-standard/
- NIST **SP 800-162** — Guide to Attribute Based Access Control (ABAC): https://csrc.nist.gov/pubs/sp/800/162/upd1/final
- NIST **RBAC** / ANSI INCITS 359 — Role-Based Access Control model
- Saltzer & Schroeder (1975) — *The Protection of Information in Computer Systems* (least privilege, fail-safe defaults)
- Bell–LaPadula & Biba models — MAC confidentiality/integrity lattices
- Google **Zanzibar**: Google's Consistent, Global Authorization System (2019): https://research.google/pubs/pub48190/
- **Open Policy Agent** / Rego: https://www.openpolicyagent.org/docs/latest/
- **XACML** reference architecture (PEP/PDP/PAP/PIP)
- **CWE-367** — Time-of-check Time-of-use (TOCTOU) Race Condition: https://cwe.mitre.org/data/definitions/367.html
- Norm Hardy (1988) — *The Confused Deputy*
- **RFC 8693** — OAuth 2.0 Token Exchange (on-behalf-of / delegation)
