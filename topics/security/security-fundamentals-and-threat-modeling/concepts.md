# Security Fundamentals, CIA Triad & Threat Modeling

Application security is the discipline of *reasoning about an adversary*. Before you can
defend a system you need a shared vocabulary (what are we protecting, from whom, and why),
a set of design principles that hold across languages and frameworks, and a repeatable
method for finding weaknesses *before* attackers do. This topic builds that foundation:
the CIA triad, the AAA model, the classic design principles, zero trust, trust boundaries
and attack surface, the precise meanings of threat/vulnerability/risk/exploit, the main
threat-modeling methodologies (STRIDE, DREAD, PASTA, attack trees), how risk is rated, and
how CVSS turns a vulnerability into a comparable score. Everything here is
language/framework-agnostic — it is the mental model an interviewer expects a security-aware
engineer to carry into *any* design discussion.

> [!INTERVIEW]
> The single most common opening question in an appsec interview is "what does security
> mean to you?" A strong answer is *not* "encryption and firewalls" — it is the CIA triad
> plus a couple of design principles (least privilege, defense in depth) and the admission
> that security is about *managing risk*, not eliminating it. Lead with a model, not a list
> of tools.

## The CIA Triad

**Beginner — what it is.** The CIA triad names the three properties security aims to
preserve:

| Property | Definition | Violated by | Typical control |
|---|---|---|---|
| **Confidentiality** | Data is disclosed only to authorized parties | Data breach, eavesdropping, IDOR | Encryption, access control, least privilege |
| **Integrity** | Data/code is not modified in an unauthorized or undetected way | Tampering, MITM injection, race conditions | Hashing, digital signatures, MACs, input validation |
| **Availability** | Systems and data are usable when authorized users need them | DoS/DDoS, ransomware, resource exhaustion | Rate limiting, redundancy, autoscaling, backups |

"CIA" here is *Confidentiality, Integrity, Availability* — nothing to do with the agency.
Every concrete requirement you write ("only the account owner can read this record",
"an audit log entry cannot be altered", "checkout stays up under load") maps to one of
these three.

**Why it matters.** The triad forces you to name *which* property a threat attacks and
*which* control defends it. A control for one property rarely helps another: TLS gives you
confidentiality and integrity in transit but does nothing for availability; a backup helps
availability but not confidentiality.

**Intermediate — the tensions.** The three pull against each other:

- Strong confidentiality (e.g. encrypt-everything, lock accounts after 3 failed logins)
  can *reduce* availability (lost keys = lost data; lockouts = self-inflicted DoS).
- Aggressive availability (caching, replication) can *weaken* confidentiality (stale
  cached data served to the wrong tenant) or integrity (replicas diverge).

Security is choosing the *right balance for the asset*, guided by risk — not maxing out one
axis.

**Advanced — extensions.** Two properties are often added:

- **Authenticity** — the data really comes from who it claims (overlaps integrity; provided
  by signatures/MACs).
- **Non-repudiation** — the originator cannot later deny the action (see AAA below).

The **Parkerian hexad** extends CIA to six elements (adds *possession/control*,
*authenticity*, *utility*). You rarely need it in interviews, but knowing it exists signals
depth. If asked "is CIA enough?", the honest answer is "it's the core; authenticity and
non-repudiation matter for transactions and audit."

> [!KEY-TAKEAWAY]
> When you analyze *any* threat, first say which of C, I, or A it attacks. That single habit
> makes the rest of the analysis fall out — the control you pick and the way you test it both
> follow from the property at stake.

## AAA and Non-Repudiation

**Beginner.** AAA is the access-control lifecycle:

- **Authentication (AuthN)** — *who are you?* Proving identity (password, TOTP, WebAuthn,
  client cert). Answers "is this really Alice?"
- **Authorization (AuthZ)** — *what are you allowed to do?* Deciding whether the
  authenticated principal may perform an action on a resource (RBAC/ABAC, scopes).
- **Accounting (Accountability / Auditing)** — *what did you do?* Recording actions in a
  tamper-evident log for detection, forensics, and compliance.

The classic bug is conflating the first two: "the user is logged in" (AuthN) is treated as
"the user may do this" (AuthZ). That confusion is the root of **Broken Access Control**,
the #1 category in the OWASP Top 10 (2021).

**Intermediate — order and failure modes.** AuthN happens first, AuthZ on every
request/action, accounting continuously. A subtle point: you *authorize actions, not
users* — a user with an active session can still be denied a specific operation. Authorize
at the point of use (per request), not once at login, because permissions change and
sessions are long-lived.

**Advanced — non-repudiation.** Non-repudiation is the guarantee that a party *cannot
credibly deny* having performed an action. It is stronger than an audit log:

- An audit log the service writes proves nothing to a third party — the service could have
  forged it (it holds the same secret it uses to authenticate the user, e.g. an HMAC key).
- **True non-repudiation requires asymmetric digital signatures**: only the holder of the
  *private* key could have produced the signature, and anyone with the *public* key can
  verify it. A symmetric MAC (HMAC) gives integrity/authenticity but **not**
  non-repudiation, because both parties share the key — either could have created the tag.

That distinction (MAC = no non-repudiation, signature = non-repudiation) is a favorite
interview probe.

> [!WARNING]
> "AAA" also names the *authentication protocol family* RADIUS/TACACS+/Diameter and, in
> some texts, the third A is "Availability." In an appsec interview, AAA = Authentication,
> Authorization, Accounting. Clarify if the interviewer seems to mean the network-protocol
> sense.

## Core Security Design Principles

These are the timeless principles (rooted in Saltzer & Schroeder's 1975 paper "The
Protection of Information in Computer Systems"). Interviewers love to hear you *name* the
principle a given fix embodies.

**Defense in depth.** Layer independent controls so one failure doesn't breach the system.
A WAF *and* parameterized queries *and* least-privilege DB accounts *and* egress filtering:
if the WAF misses an injection, the prepared statement still blocks it. No single layer is
trusted to be perfect.

**Least privilege.** Every principal (user, service, process, token) gets the *minimum*
permissions needed, for the *minimum* time. A report-generation service should have a
read-only DB credential scoped to two tables — not `db_owner`. Least privilege limits *blast
radius*: if that service is popped, the attacker inherits only its narrow rights.

**Fail-secure (fail-closed) vs fail-safe.** On error, *deny by default*. If the
authorization service is unreachable, deny the request rather than allowing it. The classic
vulnerable pattern:

```python
# VULNERABLE: fails OPEN — any exception grants access
try:
    allowed = authz.check(user, resource)
except Exception:
    allowed = True          # "don't block users if authz is flaky"  <-- bug
if allowed: serve(resource)
```

```python
# FIXED: fail-closed — default deny, only an explicit allow proceeds
allowed = False
try:
    allowed = authz.check(user, resource)   # returns True only on explicit grant
except Exception:
    allowed = False         # error => deny
if allowed: serve(resource)
```

("Fail-safe" is the general term; for *security* the safe state is usually *closed/denied*.
Note life-safety systems fail-*open* — a locked door must unlock in a fire — so "safe"
depends on the asset. In access control, fail-secure = fail-closed.)

**Complete mediation.** *Every* access to *every* object is checked, every time — no
cached "you were allowed a second ago" and no unchecked back doors. TOCTOU (time-of-check
to time-of-use) races and "check on the first page but not on the API endpoint behind it"
are complete-mediation failures.

**Separation of duties (SoD).** No single person/component can complete a sensitive action
alone. The developer who writes a payment change cannot also approve and deploy it;
requiring two people to authorize a wire transfer prevents unilateral fraud and contains
insider threat.

**Secure defaults (secure by default).** The out-of-the-box configuration is the safe one;
security is opt-*out*, not opt-*in*. Deny-by-default firewall rules, TLS on by default,
no default/blank admin passwords, features off until explicitly enabled. Users rarely change
defaults, so the default *is* the security posture.

**Economy of mechanism (KISS).** Keep the design/implementation as simple as possible —
complex code has more places to hide bugs and is harder to review.

**Least common mechanism.** Minimize shared state/mechanisms between principals; shared
resources are channels for interference and side-channel leaks.

**Open design (no security through obscurity).** Security must not depend on the design being
secret — assume the attacker knows the algorithm (Kerckhoffs's principle). Secrecy belongs
in *keys and credentials*, not in the mechanism. Obscurity can be a thin extra layer but is
never a control on its own.

**Psychological acceptability.** If a control is too painful, users route around it (writing
passwords on sticky notes, sharing accounts). Usable security is more secure in practice.

> [!INTERVIEW]
> Interviewers often give a scenario and ask "which principle is violated here?" Practice the
> reverse mapping: hardcoded default admin password → secure defaults; one over-privileged
> service account → least privilege; a bug that grants access on exception → fail-secure;
> auth checked at the gateway but not the microservice → complete mediation.

## Zero Trust Architecture

**Beginner.** Zero Trust discards the old "castle-and-moat" model where anything *inside*
the network perimeter is trusted. Its mantra is **"never trust, always verify"**: no
implicit trust is granted based on network location. Every request is authenticated,
authorized, and encrypted *regardless of whether it originates inside or outside the
corporate network* (NIST SP 800-207).

**Why it matters.** Perimeter security fails against (a) phishing/VPN compromise that puts
an attacker "inside," (b) lateral movement — one breached host reaching flat internal
services, and (c) cloud/remote work where "inside the network" barely means anything. The
2020s baseline assumes breach: design as if the attacker is already on the internal network.

**Intermediate — the core tenets (NIST SP 800-207).**

- Every resource access is authenticated and authorized *per request* (not once per session
  at the perimeter).
- Access decisions are **dynamic** and based on *context*: identity, device posture,
  location, behavior, time — evaluated continuously, not just at login.
- Enforce **least privilege** per session; grants are just-in-time and just-enough.
- **Micro-segmentation**: the network is carved into small zones so a compromise in one
  cannot freely reach others (contrast a flat network where one host talks to everything).
- Assume the environment is hostile; encrypt internal traffic (mTLS between services).

**Advanced — mechanics and misconceptions.** A Zero Trust system has a **Policy Decision
Point (PDP)** that evaluates policy and a **Policy Enforcement Point (PEP)** that gates the
connection (the PEP↔PDP split mirrors XACML). Common misconceptions to correct in interview:

- Zero Trust is *not* a product you buy; it's an architecture/strategy. BeyondCorp (Google)
  is the canonical implementation.
- It does *not* mean "no trust ever" — it means no *implicit* trust from network position;
  trust is established explicitly, per request, and continually re-evaluated.
- mTLS/service mesh, short-lived credentials, device attestation, and strong identity
  (phishing-resistant MFA) are the building blocks.

## Attack Surface and Trust Boundaries

**Attack surface** is the sum of all points where an attacker can *try* to enter data into,
extract data from, or otherwise interact with a system: every network port, API endpoint,
input field, file upload, environment variable, third-party dependency, and human. Reducing
attack surface — disabling unused features, closing ports, removing dead endpoints, dropping
unnecessary dependencies — is one of the cheapest, highest-leverage defenses. You cannot be
attacked through an interface that does not exist.

**Trust boundary** is a line across which the *level of trust changes* — where data or
control passes from a less-trusted zone to a more-trusted one (or vice versa). Classic
boundaries: browser → server, internet → DMZ, application → database, one microservice →
another, user-space → kernel, your code → a third-party API.

**The rule that matters:** *validate/sanitize/authorize at every trust boundary, and treat
all data crossing inward as hostile until proven otherwise.* "The frontend already
validated it" is a trust-boundary fallacy — the client is outside your trust boundary and
its checks can be bypassed with a raw HTTP request. Server-side validation is mandatory;
client-side validation is only a UX convenience.

```
[ Internet ] --(boundary 1)--> [ Load balancer / WAF ]
             --(boundary 2)--> [ App server ]  <- validate & authZ here
             --(boundary 3)--> [ Database ]     <- parameterize, least-priv creds
```

In a **data flow diagram (DFD)** — the standard threat-modeling artifact — trust boundaries
are drawn as dashed lines crossing the data flows. Every place a flow crosses a boundary is
where you enumerate threats (this is exactly where STRIDE gets applied). Elements are:
*external entities, processes, data stores, data flows*, plus the boundaries between them.

> [!KEY-TAKEAWAY]
> "Where are the trust boundaries?" is the first question of threat modeling. Draw the DFD,
> mark the dashed boundary lines, and every crossing becomes a place to ask "what can go
> wrong here?"

## Vulnerability vs Threat vs Risk vs Exploit

These four are constantly confused and interviewers deliberately test the distinction. Learn
the precise definitions and the relationship:

| Term | Definition | Example |
|---|---|---|
| **Asset** | Something of value worth protecting | Customer PII database |
| **Threat** | A potential *cause* of an unwanted incident; the actor or event that *could* cause harm | A cybercriminal group; a malicious insider; a flood |
| **Vulnerability** | A *weakness* that a threat can exploit | Unpatched SQL injection flaw; weak password policy |
| **Exploit** | The *technique/code* that actually takes advantage of a vulnerability | A specific SQLi payload / Metasploit module |
| **Risk** | The *potential for loss* = likelihood a threat exploits a vulnerability × impact | "High risk of PII breach via SQLi" |

**The relationship:** a **threat** exploits a **vulnerability** (using an **exploit**) to
harm an **asset**, and the expected loss is the **risk**.

- A vulnerability with *no threat* to exploit it carries little risk (a flaw in a feature no
  one can reach).
- A threat with *no vulnerability* to exploit also yields little risk (a skilled attacker
  facing a hardened system).
- **Risk exists only when a threat and a vulnerability meet over a valuable asset.** That's
  why patching a vulnerability, removing the asset's exposure, or reducing impact all reduce
  risk.

**Threat vs threat actor / threat vector:** a *threat actor* is the entity (person, group),
a *threat vector* (attack vector) is the path/means they use (phishing email, exposed API),
and the *threat* is the potential event itself. A **zero-day** is a vulnerability with no
available patch (defenders have "zero days" to fix it before exploitation).

**Common misconception:** "we have a vulnerability so we have a breach." No — a vulnerability
is *potential*; it becomes an incident only when a threat successfully exploits it. This is
why risk-based prioritization (fix the *reachable, high-impact* vulns first) beats trying to
fix everything.

## Threat Modeling and the Four Questions

**Beginner — what it is.** Threat modeling is a *structured, proactive* process of
identifying what can go wrong with a system *while you're designing it*, so you can build in
defenses instead of bolting them on after a breach. It shifts security *left* (earlier), when
fixes are cheapest.

**Adam Shostack's four questions** frame any threat-modeling exercise (and are the answer
interviewers want for "how do you threat model?"):

1. **What are we building?** — Model the system: draw a data flow diagram, mark trust
   boundaries, list assets and entry points.
2. **What can go wrong?** — Enumerate threats against the model (this is where STRIDE / attack
   trees / abuse cases come in).
3. **What are we going to do about it?** — Decide a response per threat: *mitigate*
   (add a control), *eliminate* (remove the feature), *transfer* (insurance, shift to a
   provider), or *accept* (document and move on).
4. **Did we do a good job?** — Validate: review the model, verify mitigations exist and are
   tested, iterate as the system changes.

**Intermediate — when and how.** Threat modeling is most valuable at design time but should
be *iterative* — revisit when architecture, data flows, or the threat landscape change.
Whiteboard + STRIDE is often enough; heavyweight documents that no one updates are an
anti-pattern. Include developers, not just security specialists — the people who build the
system understand its data flows.

**Advanced — outputs and pitfalls.** Good threat modeling produces a *prioritized* list of
threats mapped to concrete mitigations and test cases, feeding the backlog. Pitfalls:
boiling the ocean (model the whole company at once), treating it as a one-time gate, and
enumerating threats with no owner or follow-through. The goal is *actionable* risk reduction,
not a pretty diagram.

## STRIDE

**Beginner.** STRIDE (Microsoft) is the most widely taught threat *enumeration* framework.
It's a mnemonic for six threat categories, and — crucially — **each category is the negation
of a desirable security property**:

| Threat | Definition (attacker...) | Property violated | Example mitigation |
|---|---|---|---|
| **S**poofing | ...pretends to be someone/something else | Authentication | Strong auth, MFA, signed tokens, mTLS |
| **T**ampering | ...modifies data or code | Integrity | Hashing, signatures/MACs, input validation, WORM logs |
| **R**epudiation | ...denies performing an action | Non-repudiation | Signed audit logs, secure timestamps |
| **I**nformation disclosure | ...reads data they shouldn't | Confidentiality | Encryption, access control, least privilege |
| **D**enial of service | ...makes the system unavailable | Availability | Rate limiting, quotas, redundancy, autoscaling |
| **E**levation of privilege | ...gains capabilities they weren't granted | Authorization | Least privilege, complete mediation, input validation |

Notice the mapping: Spoofing↔AuthN, Tampering↔Integrity, Repudiation↔Non-repudiation,
Info disclosure↔Confidentiality, DoS↔Availability, EoP↔Authorization. This is why STRIDE and
the CIA/AAA models fit together — STRIDE is basically "the ways to break each property."

**Intermediate — STRIDE-per-element.** The standard technique is to take your DFD and apply
STRIDE to *each element*, because different element types are susceptible to different
threats:

- **External entities** — Spoofing, Repudiation.
- **Processes** — all six (S, T, R, I, D, E).
- **Data stores** — Tampering, Repudiation, Info disclosure, DoS.
- **Data flows** — Tampering, Info disclosure, DoS.

Walking the diagram element-by-element makes enumeration systematic instead of ad hoc.
STRIDE-per-interaction is a variant that analyzes each (source, destination, flow) tuple.

**Advanced — strengths and limits.** STRIDE is *comprehensive* and great for teaching, but
it (a) can generate a large, noisy list of threats, (b) says *what* can go wrong but not *how
likely* or *how bad* — you still need a rating step (CVSS, risk = L×I), and (c) depends on
the quality of the model; missing elements = missed threats. Pair STRIDE (find threats) with
a risk-rating method (prioritize them).

> [!KEY-TAKEAWAY]
> If you remember one framework for "what can go wrong?", make it STRIDE — and be able to
> recite each letter *with the property it attacks*. That property mapping is the answer to
> both "what is STRIDE?" and "how does it relate to CIA?"

## DREAD and Its Critique

**Beginner.** DREAD is an older Microsoft framework for *rating/ranking* a threat's severity
by scoring five factors (historically 1–10 each) and combining them:

- **D**amage — how bad if exploited?
- **R**eproducibility — how reliably can it be reproduced?
- **E**xploitability — how much effort/skill to exploit?
- **A**ffected users — how many users are impacted?
- **D**iscoverability — how easy to discover the flaw?

Risk score = (D + R + E + A + D) / 5, giving a rough priority ordering.

**Intermediate/Advanced — why it fell out of favor.** DREAD is largely deprecated (even
Microsoft moved away from it) because:

- **Subjectivity/inconsistency** — the 1–10 scores are arbitrary; two analysts rate the same
  threat very differently, and results aren't reproducible across teams.
- **Discoverability is problematic** — it rewards *security through obscurity* ("attackers
  won't find it, so score it low"), which is a discredited assumption; you must assume flaws
  will be discovered.
- **Averaging distorts** — summing/averaging can mask a critical single factor (a low
  "affected users" can pull down a catastrophic "damage").

The interview point: DREAD is worth *knowing* and *critiquing*. Modern practice prefers
**CVSS** (standardized, reproducible, industry-wide) for scoring vulnerabilities, and often
drops discoverability entirely. Naming why DREAD is deprecated demonstrates maturity.

## PASTA and Attack Trees

**PASTA** (Process for Attack Simulation and Threat Analysis) is a **risk-centric,
attacker-focused** seven-stage methodology. Unlike STRIDE (which starts from the system),
PASTA starts from *business objectives* and simulates a real attacker, aligning security with
business risk. The seven stages:

1. **Define objectives** — business goals, compliance, risk appetite.
2. **Define technical scope** — architecture, dependencies, boundaries.
3. **Application decomposition** — DFDs, trust boundaries, entry points.
4. **Threat analysis** — threat intelligence, actual attacker TTPs.
5. **Vulnerability analysis** — map weaknesses to the threats.
6. **Attack modeling** — build attack trees, simulate exploits.
7. **Risk & impact analysis** — quantify business risk, prioritize mitigations.

PASTA is heavier than STRIDE and suited to *risk-driven, business-aligned* modeling on
significant systems; STRIDE is lighter and better for fast, developer-run enumeration. Other
methodologies to name-drop: **OCTAVE** (organizational/operational risk focus), **Trike**
(requirements/audit focus), and **VAST** (scales via automation across many teams).

**Attack trees** (popularized by Bruce Schneier) are a graphical, hierarchical way to model
*how* a specific goal could be achieved:

- The **root node** is the attacker's goal (e.g. "read another user's messages").
- **Child nodes** are sub-goals / methods; leaves are concrete attacker actions.
- Nodes combine with **AND** (all children required) and **OR** (any child suffices) logic.
- You can annotate nodes with cost, skill, probability, or detectability, then compute the
  cheapest/easiest path to prune (the attacker takes the path of least resistance).

```
GOAL: Read victim's private messages   (OR)
├── Steal session cookie                (OR)
│   ├── XSS to exfiltrate cookie
│   └── Network sniff (no TLS)          <- mitigated by HTTPS + HttpOnly + Secure
├── Compromise victim's password        (OR)
│   ├── Phishing
│   └── Credential stuffing             <- mitigated by MFA + breached-password check
└── Exploit IDOR on /messages/{id}      <- mitigated by object-level authZ
```

Attack trees complement STRIDE/PASTA: STRIDE finds *categories* of threats; an attack tree
explores *paths* to a chosen goal in depth, which is great for reasoning about a critical
asset and where to place mitigations.

## Risk Rating: Likelihood times Impact

**Beginner.** The universal risk formula is:

```
Risk = Likelihood × Impact
```

- **Likelihood** — the probability the threat successfully exploits the vulnerability
  (factors: attacker skill needed, ease of discovery, ease of exploit, exposure).
- **Impact** — the harm if it happens (both *technical* impact — loss of C/I/A — and
  *business* impact — financial, reputational, legal/regulatory).

A high-impact but near-impossible attack and a trivial-but-harmless bug are both *low* risk;
you prioritize the ones that are *both* likely and damaging. This product is what turns a raw
threat list (from STRIDE) into a *prioritized* action list.

**Intermediate — the OWASP Risk Rating Methodology** formalizes this. Likelihood is estimated
from *threat-agent factors* (skill, motive, opportunity, size) and *vulnerability factors*
(ease of discovery, ease of exploit, awareness, intrusion detection); impact from *technical*
factors (loss of confidentiality/integrity/availability/accountability) and *business*
factors (financial damage, reputation, non-compliance, privacy violation). Each is scored,
averaged into Low/Medium/High, and combined in a matrix:

```
              IMPACT
           Low   Med   High
    High    Med  High  Crit
LIKE Med    Low  Med   High
LIHD Low    Note Low   Med
```

**Advanced — qualitative vs quantitative.** Most teams use *qualitative* ratings
(Low/Med/High or a heat map) because probabilities are hard to estimate. *Quantitative* risk
uses money: **SLE** (Single Loss Expectancy) = Asset Value × Exposure Factor, and **ALE**
(Annualized Loss Expectancy) = SLE × ARO (Annualized Rate of Occurrence). ALE lets you
justify a control ("this $50k control prevents $200k/yr of expected loss"), but the inputs are
often guesses. Know the trade-off: qualitative is fast and communicable; quantitative is
defensible when you have real data. Whatever the method, risk is *managed* — mitigate,
transfer, avoid, or accept — never assumed to be zero.

## CVSS Scoring Basics

**Beginner.** CVSS (Common Vulnerability Scoring System) is the industry-standard, *vendor-
neutral* framework for scoring the severity of a vulnerability on a **0.0–10.0** scale,
maintained by FIRST. It's what NVD/CVE entries use, so it makes vulnerabilities comparable
across products. Standard severity bands (CVSS v3.x):

| Score | Severity |
|---|---|
| 0.0 | None |
| 0.1 – 3.9 | Low |
| 4.0 – 6.9 | Medium |
| 7.0 – 8.9 | High |
| 9.0 – 10.0 | Critical |

**Intermediate — the three metric groups.** A CVSS score is built from metrics in three
groups:

- **Base** — intrinsic, constant characteristics of the vulnerability. This is the score you
  usually see quoted. In v3.1 it splits into:
  - *Exploitability metrics*: **Attack Vector** (Network/Adjacent/Local/Physical),
    **Attack Complexity**, **Privileges Required**, **User Interaction**.
  - *Impact metrics*: **Confidentiality**, **Integrity**, **Availability** impact (the CIA
    triad again!), plus **Scope** (does exploitation affect resources beyond the vulnerable
    component's security authority?).
- **Temporal** (v3.1) / **Threat** (v4.0) — changes over time: exploit maturity, remediation
  level, report confidence.
- **Environmental** — how the vuln matters *in your specific environment* (you can raise/
  lower CIA requirements and re-weight based on your deployment).

The **Base score alone is not your risk.** A "9.8 Critical" on a component you don't expose,
or have compensating controls for, may be low *actual* risk — that's what the Environmental
metrics (and your own risk assessment) are for.

**Advanced — v3.1 vs v4.0 and misuse.** CVSS **v4.0** (released 2023) refines v3.1: it
renames Temporal to **Threat**, splits impact into **Vulnerable System** and **Subsequent
System** (a cleaner replacement for the confusing Scope metric), adds **Attack Requirements**,
and introduces **Supplemental** metrics (Safety, Automatable, Recovery, etc.) plus nomenclature
like CVSS-B / CVSS-BT / CVSS-BTE for which groups you included.

The key interview caveat: **CVSS measures technical severity, not risk or exploitability-in-
the-wild.** People routinely misuse the Base score as a prioritization queue. Better practice
pairs CVSS with signals like **EPSS** (Exploit Prediction Scoring System — probability of
exploitation in the next 30 days) and **CISA KEV** (Known Exploited Vulnerabilities catalog —
what's *actually* being exploited) to prioritize patching. A CVSS 7.5 that's on the KEV list
usually beats a CVSS 9.8 that has no known exploit.

> [!WARNING]
> Don't say "CVSS is our risk score." CVSS Base = *severity* of the flaw in the abstract.
> Risk to *you* = severity contextualized by exposure, exploitability (EPSS/KEV), and business
> impact (Environmental metrics). Treating a raw Base score as a work queue drowns teams in
> "critical" tickets that pose little real risk.

## Shift-Left and the Secure SDLC

**Beginner.** "Shift-left" means moving security activities *earlier* (leftward) in the
software development lifecycle — into design and coding — instead of testing for security only
right before release or after deployment. The motivation is economic: **the cost to fix a
defect rises by roughly an order of magnitude at each later stage** (a flaw caught in design
is far cheaper than one caught in production). Threat modeling *is* a shift-left activity.

**Intermediate — the Secure SDLC (SSDLC).** Security is woven into every phase, not bolted on:

| SDLC phase | Security activity |
|---|---|
| Requirements | Security/abuse-case requirements, define risk appetite, compliance needs |
| Design | **Threat modeling**, secure architecture review, choose secure defaults |
| Implementation | Secure coding standards, **SAST** (static analysis), secret scanning, secure code review |
| Testing | **DAST** (dynamic scanning), **SCA** (dependency/SBOM scanning), fuzzing, pen testing |
| Deployment | Hardened config, IaC scanning, least-privilege, secrets management |
| Operations | Monitoring, logging, incident response, patch management, **RASP**/WAF |

Testing-technique cheat sheet interviewers probe:

- **SAST** — Static Application Security Testing: analyzes *source code* without running it;
  finds injection/crypto misuse patterns early; prone to false positives.
- **DAST** — Dynamic: tests the *running* app from the outside (black-box); finds runtime/
  config issues; can't see code paths it doesn't reach.
- **IAST** — Interactive: instruments the running app to combine both views.
- **SCA** — Software Composition Analysis: finds known-vulnerable *dependencies* (CVEs) and
  license issues; the answer to the OWASP "Vulnerable and Outdated Components" category.

**Advanced — DevSecOps and frameworks.** Shift-left is operationalized as **DevSecOps**:
security automated into CI/CD (gates that fail the build on critical findings), "security as
code," and *everyone* owning security rather than a gatekeeping team at the end. Authoritative
frameworks to cite: **OWASP SAMM** and **BSIMM** (measure/mature an org's security program),
**Microsoft SDL** (the original secure-development lifecycle), and **NIST SSDF (SP 800-218)**
(Secure Software Development Framework). A modern nuance is "shift *everywhere*" — security in
design *and* continuously in operations (runtime protection, monitoring) — because you can't
find every issue pre-production.

## LINDDUN Privacy Threat Modeling

**Beginner.** STRIDE finds *security* threats; **LINDDUN** (KU Leuven, 2010) is its privacy
dual — a systematic method for finding *privacy* threats against a system's data subjects.
Where privacy-by-design and GDPR/CCPA are in scope, a senior engineer is expected to say
"STRIDE for security, LINDDUN for privacy." Its seven threat types (linddun.org):

| Letter | Threat type | Attacker/system... |
|---|---|---|
| **L** | **Linking** | associates data items or actions to learn more about an individual/group |
| **I** | **Identifying** | learns the identity behind data through leaks, deduction, or inference |
| **N** | **Non-repudiation** | can *undeniably* attribute a claim/action to an individual |
| **D** | **Detecting** | deduces an individual's involvement merely by observing (e.g. a response exists) |
| **D** | **Data disclosure** | excessively collects, stores, processes, or shares personal data |
| **U** | **Unawareness & unintervenability** | fails to inform/involve/empower the data subject |
| **N** | **Non-compliance** | deviates from privacy legislation, standards, and best practice |

**Intermediate — the STRIDE inversion that trips people up.** In STRIDE, **repudiation is a
threat** and **non-repudiation is a desirable property**. In LINDDUN it is the *opposite*:
**non-repudiation is the threat** — being unable to plausibly deny an action harms privacy
(e.g. a whistleblower or voter who cannot deny having submitted something). This inversion is
a favorite interview probe: the same word is a goal in security and a harm in privacy.

**Advanced — variants and countermeasures.** LINDDUN comes in three flavors:
**LINDDUN GO** (a lightweight card deck for quick brainstorming), **LINDDUN PRO** (the
systematic DFD-driven analysis with per-element/per-interaction mapping tables and threat
trees), and **LINDDUN MAESTRO** (model-driven/automated). Mitigations lean on **PETs**
(privacy-enhancing technologies): **data minimization**, **pseudonymization**,
**k-anonymity**, and **differential privacy**, plus consent/transparency mechanisms. It maps
to GDPR privacy-by-design (Art. 25) and ISO 31700. The senior test question — "model privacy,
not just security, for an analytics pipeline" — wants Linking + Identifying + Non-compliance
called out and data minimization/PETs proposed, *not* just "encrypt it" (which is a
confidentiality control, not a privacy one).

## Adversary-Centric Analysis: Kill Chain, MITRE ATT&CK, Diamond Model

Threat modeling (STRIDE/LINDDUN) is *system-centric*. The complementary lens is
*adversary-centric*: model the attacker's behaviour. Three frameworks form the standard trio —
know how they differ.

**Lockheed Martin Cyber Kill Chain.** A **linear, 7-stage** model of an intrusion:
**Reconnaissance → Weaponization → Delivery → Exploitation → Installation → Command & Control
(C2) → Actions on Objectives.** Its defender value is that breaking *any single link* stops
the attack. Its recognized weaknesses (why it's no longer the last word): it is
**perimeter- and malware-centric**, assumes a linear intrusion-from-outside, and largely
ignores **insider threat** and **post-compromise lateral movement** — exactly the modern attack
patterns. This is why ATT&CK and the Unified Kill Chain superseded it.

**MITRE ATT&CK.** A continuously-updated, real-world **knowledge base of adversary TTPs** —
**Tactics** (the *why* / adversarial goal), **Techniques & sub-techniques** (the *how*, e.g.
T1566 Phishing), and **Procedures** (a specific actor's implementation). ATT&CK Enterprise
has **14 tactics**: Reconnaissance, Resource Development, Initial Access, Execution,
Persistence, Privilege Escalation, Defense Evasion, Credential Access, Discovery, Lateral
Movement, Collection, Command & Control, Exfiltration, Impact. Unlike the kill chain it is a
**non-linear matrix** with deep **post-exploitation** coverage — the lingua franca of detection
engineering, purple-teaming, and threat-informed defense. Seniors map their controls/detections
to ATT&CK technique IDs.

**Diamond Model of Intrusion Analysis** (Caltagirone, Pendergast, Betz, 2013). Every intrusion
event has four vertices — **Adversary, Capability, Infrastructure, Victim** — plus meta-features
(timestamp, phase, result, direction, methodology, resources). You *pivot* along edges (e.g.
from an observed Infrastructure IP to other Victims it touched) to correlate events into
campaigns. It answers "how are these intrusions related?" rather than "what stage?" (kill chain)
or "what technique?" (ATT&CK) — the three are complementary, not competing.

> [!KEY-TAKEAWAY]
> "Place this breach in the kill chain vs ATT&CK" — the kill chain gives you the *phase* but
> falls apart once the attacker is inside (lateral movement, living-off-the-land, insiders);
> ATT&CK gives you the *technique* and covers the post-compromise depth the kill chain misses.
> Diamond Model links events across a campaign. Use all three, for different questions.

## Quantitative Risk with FAIR

The doc already covers SLE/ALE point estimates and the qualitative L×I heat map. **FAIR**
(Factor Analysis of Information Risk, an Open Group standard — O-RA) is the rigorous
*quantitative* alternative that fixes two problems with both: heat-map subjectivity and the
false precision of a single ALE number.

**The decomposition.** FAIR expresses:

```
Risk = Loss Event Frequency (LEF) × Loss Magnitude (LM)
  LEF = Threat Event Frequency (TEF) × Vulnerability
  Vulnerability = f(Threat Capability  vs  Resistance/Control Strength)
  LM  = Primary Loss + Secondary Loss (fines, legal, reputation, response)
```

**Why it matters (the senior nuance).** FAIR does not produce a single number; you feed
**distributions** (min/most-likely/max) for each factor and run a **Monte Carlo simulation**
to get a **loss-exceedance curve** — "80% chance annual loss is under \$2M, 5% chance it exceeds
\$10M." That is defensible to a CFO in a way a "High/Red" heat-map cell or a single
"\$200k/yr ALE" is not, because it makes the uncertainty explicit and comparable across risks.
Contrast with NIST SP 800-30, which is primarily qualitative. The interview framing — "quantify
this risk defensibly for the CFO" — wants FAIR's LEF×LM with ranges, and an acknowledgement that
qualitative heat maps mislead because two "High" risks can differ 100× in expected loss.

## Scaling Threat Modeling: Threat-Modeling-as-Code, VAST, and the Manifesto

**The problem.** Whiteboard STRIDE per service does not scale to 200+ microservices shipping
daily. The senior answer to "how do you threat model at scale?" is **not** "hire more security
engineers" — it is to make threat modeling *continuous* and *codified*.

**Threat-modeling-as-code / continuous TM.** Represent the system in a text DSL that lives in
the repo and runs in CI, so the model updates with the code and diffs in code review:

- **OWASP pytm** — a Python DSL; you declare elements/dataflows/boundaries and it
  auto-generates the DFD and a STRIDE findings report.
- **Threagile** — a YAML model processed in CI to produce a threat model and risk report.
- **OWASP Threat Dragon** and the **Microsoft Threat Modeling Tool** — GUI diagram-driven
  tools; **IriusRisk** — commercial, questionnaire/pattern-driven with control libraries.

**VAST** (Visual, Agile, Simple Threat modeling — from ThreatModeler) is the *enterprise-scale*
methodology: it distinguishes **application threat models** (DFD-based, for developers) from
**operational threat models** (attacker/process-flow view, for infra/ops), so both audiences
scale across an Agile organization from reusable components rather than bespoke per-service
sessions.

**Threat Modeling Manifesto (2020).** A values/principles statement by leading practitioners —
values such as *"a culture of finding and fixing design issues over checkbox compliance"* and
*"doing threat modeling over talking about it."* Cite it as the philosophy behind lightweight,
continuous, developer-owned threat modeling.

## Supply-Chain Security: SBOM, SLSA, and Provenance

The doc mentions **SCA**; a 2024-2025 senior bar expects the fuller supply-chain picture,
because the dependency-ingestion point is a **trust boundary** most teams never modeled. Maps to
**OWASP A06 (Vulnerable & Outdated Components)** and **A08 (Software & Data Integrity Failures)**,
and to **NIST SSDF (SP 800-218)**.

**SBOM (Software Bill of Materials).** A machine-readable inventory of every component/dependency
in a build, so that when the next Log4Shell drops you can answer "are we affected?" in minutes.
Two dominant formats: **CycloneDX** (OWASP) and **SPDX** (Linux Foundation/ISO).

**SLSA v1.0 (Supply-chain Levels for Software Artifacts, slsa.dev)** — Build track L0-L3, each
raising the bar against build tampering:

- **L0** — no guarantees.
- **L1** — **provenance exists** (documents how the artifact was built), but may be unsigned and
  is easy to forge; it mainly prevents mistakes and enables expectations.
- **L2** — build runs on a **hosted build platform** that **signs** the provenance; protects
  against tampering *after* the build and lets consumers verify authenticity.
- **L3** — **hardened, isolated builds**: runs can't influence each other and the provenance
  **signing key is inaccessible to user-defined build steps**, so forging provenance requires a
  serious exploit. L3 is what actually resists an *in-build* backdoor.

**Provenance & attestations** are captured with **in-toto** (signed statements about build steps
and materials). Verifying signed provenance at deploy time is the control that catches a tampered
build.

**Landmark incidents** to cite: **SolarWinds/SUNBURST** (malicious code injected into the *build
pipeline* — the poster child for why L3 build isolation matters), **Log4Shell**
(**CVE-2021-44228**, a transitive-dependency RCE — SBOM answers "am I affected?"),
**xz-utils backdoor** (**CVE-2024-3094**, a multi-year social-engineering supply-chain
compromise of a maintainer), plus **event-stream** and **Codecov**. The interview mapping: the
weakness lives at the **dependency-ingestion trust boundary**; category is **A08/A06**; the
control that would have caught it is **SLSA L3 + signed provenance verification + SBOM +
dependency pinning/review**.

## Assurance vs Security, and the ASVS Ladder

A staff-level distinction the doc did not draw: **security** is the set of protective properties
a system *actually has*; **assurance** is the **justified confidence — the evidence — that those
properties hold**. You can be *secure without assurance* (correct by luck, but nobody can
demonstrate it) and, more dangerously, have *assurance without security* (a passed checklist over
a flawed system). "Trust but verify" becomes, in modern security, just **verify** — and the thing
you produce is *assurance evidence*.

Grounds for assurance, weakest to strongest: testing → SAST/DAST → **penetration testing** →
**formal verification**; and, as an assurance *ladder*, **OWASP ASVS Levels 1/2/3** (L1 basic /
opportunistic, L2 the standard for most apps handling sensitive data, L3 for the highest-value
systems) and **Common Criteria EAL** levels. Provenance/attestations (above) are *supply-chain*
assurance evidence. When an interviewer asks "can a system be secure without assurance?" — yes,
but you cannot *defend* the claim or catch regressions, which is why regulated/high-value systems
demand assurance artifacts, not just good intentions.

## CWE vs CVE vs CAPEC, and SSVC

Seniors are expected to speak these fluently and not conflate them:

- **CVE** (Common Vulnerabilities and Exposures) — a specific, identified **instance** of a
  vulnerability in a particular product/version (e.g. CVE-2021-44228 = Log4Shell).
- **CWE** (Common Weakness Enumeration) — the **class of weakness** behind instances (e.g.
  **CWE-89** SQL Injection, **CWE-79** XSS). The OWASP Top 10 categories map to CWEs; a single
  CWE spawns many CVEs.
- **CAPEC** (Common Attack Pattern Enumeration and Classification) — the **attacker's method**
  used to exploit weaknesses (e.g. CAPEC-66 SQL Injection *pattern*). ATT&CK is TTP-level;
  CAPEC is application-attack-pattern-level.

Relationship: a **CAPEC** attack pattern exploits a **CWE** weakness class, which manifests as a
concrete **CVE** instance.

**SSVC** (Stakeholder-Specific Vulnerability Categorization, CISA) is a **decision-tree**
alternative to CVSS-numeric prioritization: instead of a 0-10 score it walks qualitative
decision points (Exploitation status, Exposure, Automatable, Mission/Well-being impact) to a
categorical action — **Track / Track\* / Attend / Act**. It complements the EPSS/KEV signals
already covered: CVSS = severity, EPSS = probability, KEV = known-exploited, SSVC = a structured
*decision* about what to do.

## Threat Actors and Threat Intelligence

Beyond the one-line "threat actor" definition, know the taxonomy, because "who are we defending
against?" shapes likelihood and which controls are worth their cost:

- **Script kiddies** — low skill, opportunistic, run others' tools; stopped by basic hygiene.
- **Hacktivists** — ideologically motivated (defacement, DoS, leaks).
- **Organized cybercrime** — financially motivated, professional (ransomware, fraud); the bulk
  of real-world volume.
- **Nation-state / APTs** (Advanced Persistent Threats) — well-resourced, patient, stealthy,
  goal-driven (espionage, sabotage); assume they can burn a zero-day. You rarely "stop" an APT —
  you raise cost, detect, and limit blast radius.
- **Insiders** — **malicious** (disgruntled, bribed) or **negligent** (misconfiguration, phishing
  victim); bypass the perimeter entirely, which is a core argument for Zero Trust and separation
  of duties.

Their **capability** feeds the FAIR *Threat Capability* factor and OWASP's threat-agent skill/
motive/opportunity likelihood inputs. Overpaying to defeat a nation-state when your realistic
adversary is commodity crimeware is as wrong as the reverse.

## Common follow-up questions

- **"Which is more important, C, I, or A?"** — It depends on the asset: a public news site
  prioritizes availability and integrity over confidentiality; a health record system
  prioritizes confidentiality; a financial ledger prioritizes integrity. Security is choosing
  the balance the asset requires.
- **"Authentication vs authorization — one-liner?"** — AuthN proves *who you are*; AuthZ
  decides *what you may do*. AuthN happens once (per session); AuthZ is checked on every
  action.
- **"Does an HMAC give non-repudiation?"** — No. Both parties share the key, so either could
  have produced the tag. Non-repudiation needs an asymmetric *digital signature*.
- **"STRIDE vs DREAD?"** — STRIDE *finds* threats (categorization/enumeration); DREAD *rates*
  their severity. STRIDE is current; DREAD is largely deprecated in favor of CVSS.
- **"STRIDE vs PASTA?"** — STRIDE is system-centric, lightweight, developer-run; PASTA is
  risk/attacker-centric, business-aligned, seven-stage and heavier.
- **"Is a CVSS 9.8 always the first thing to patch?"** — No. CVSS Base is *severity*, not
  *risk*. Prioritize by exposure + EPSS (exploit probability) + CISA KEV (known exploited) +
  business impact. A patched 9.8 nobody can reach may wait; a 7.5 on the KEV list won't.
- **"What's the difference between a vulnerability and a risk?"** — A vulnerability is a
  weakness; risk is the *expected loss* (likelihood × impact) when a threat can exploit that
  weakness against a valuable asset. No threat/asset ⇒ little risk.
- **"How do you threat model in 30 seconds?"** — Answer Shostack's four questions: what are we
  building (DFD + trust boundaries), what can go wrong (STRIDE per element), what do we do
  about it (mitigate/eliminate/transfer/accept), did we do a good job (validate & iterate).
- **"Fail-open or fail-closed?"** — For security controls, fail-*closed* (deny by default).
  The exception is life-safety systems, where "safe" may mean fail-open (unlock doors in a
  fire).
- **"What is zero trust — is the internal network trusted?"** — No implicit trust based on
  network location; authenticate/authorize every request, per session, using dynamic context.
  Assume breach and micro-segment.
- **"STRIDE vs LINDDUN?"** — STRIDE finds security threats; LINDDUN finds *privacy* threats
  (Linking, Identifying, Non-repudiation, Detecting, Data disclosure, Unawareness,
  Non-compliance). Note the inversion: non-repudiation is *desired* in STRIDE but is a *threat*
  in LINDDUN.
- **"Kill chain vs ATT&CK?"** — Kill chain = linear phases, perimeter/malware-centric, weak on
  insiders and lateral movement; ATT&CK = a non-linear TTP matrix with deep post-compromise
  coverage. Diamond Model links events across a campaign.
- **"Quantify risk for the CFO — heat map or something better?"** — FAIR: Risk = LEF × LM with
  input distributions and Monte Carlo, giving a loss-exceedance curve, not a single ALE or a
  subjective "High." Two "High" cells can differ 100× in expected loss.
- **"How do you threat model 200 microservices?"** — Threat-modeling-as-code (pytm/Threagile in
  CI) + reusable component libraries + VAST's application vs operational split — not per-service
  whiteboards.
- **"CWE vs CVE?"** — CWE is the weakness *class* (CWE-89 SQLi); CVE is a specific *instance* in a
  product. CAPEC is the attack *pattern* that exploits the CWE.
- **"Is defense-in-depth one of Saltzer & Schroeder's principles?"** — No. Defense in depth and
  secure defaults are later additions; the canonical eight are economy of mechanism, fail-safe
  defaults, complete mediation, open design, separation of privilege, least privilege, least
  common mechanism, and psychological acceptability (plus work factor and compromise recording
  as bonus items).
- **"Security vs assurance?"** — Security = the properties a system has; assurance = the evidence
  that they hold. You can be secure without assurance (unprovable) or have assurance without
  security (a passed checklist over a flawed system). ASVS L1/2/3 is an assurance ladder.
- **"What control would have caught xz-utils / Log4Shell?"** — Treat dependency ingestion as a
  trust boundary (A06/A08): SBOM to know what you ship, SLSA L3 build isolation + signed
  provenance verification to detect in-build tampering, and dependency pinning/review.

## References

- OWASP — [Threat Modeling](https://owasp.org/www-community/Threat_Modeling) and
  [Threat Modeling Process](https://owasp.org/www-community/Threat_Modeling_Process)
- OWASP — [Threat Modeling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html)
- OWASP — [Risk Rating Methodology](https://owasp.org/www-community/OWASP_Risk_Rating_Methodology)
- OWASP — [Top 10 (2021)](https://owasp.org/Top10/) (A01 Broken Access Control, A06 Vulnerable & Outdated Components)
- OWASP — [Application Security Verification Standard (ASVS)](https://owasp.org/www-project-application-security-verification-standard/)
- Microsoft — [STRIDE / The Threats To Our Products](https://learn.microsoft.com/en-us/security/engineering/threat-modeling-security-fundamentals) and the [Security Development Lifecycle (SDL)](https://www.microsoft.com/en-us/securityengineering/sdl)
- Adam Shostack — *Threat Modeling: Designing for Security* (the "four questions")
- Bruce Schneier — [Attack Trees](https://www.schneier.com/academic/archives/1999/12/attack_trees.html)
- Tony UcedaVélez & Marco Morana — *Risk Centric Threat Modeling* (PASTA)
- NIST SP 800-207 — [Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final)
- NIST SP 800-218 — [Secure Software Development Framework (SSDF)](https://csrc.nist.gov/pubs/sp/800/218/final)
- NIST SP 800-30 — [Guide for Conducting Risk Assessments](https://csrc.nist.gov/pubs/sp/800/30/r1/final)
- FIRST — [CVSS v3.1 Specification](https://www.first.org/cvss/v3-1/specification-document) and [CVSS v4.0 Specification](https://www.first.org/cvss/v4-0/specification-document)
- FIRST — [EPSS (Exploit Prediction Scoring System)](https://www.first.org/epss/) · CISA — [Known Exploited Vulnerabilities (KEV) Catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)
- Saltzer & Schroeder — *The Protection of Information in Computer Systems* (1975) — classic design principles
- LINDDUN — [Privacy threat modeling](https://linddun.org/) (GO / PRO / MAESTRO, 7 threat types)
- MITRE — [ATT&CK](https://attack.mitre.org/) · [CWE](https://cwe.mitre.org/) · [CAPEC](https://capec.mitre.org/) · [CVE](https://www.cve.org/)
- Lockheed Martin — [Cyber Kill Chain](https://www.lockheedmartin.com/en-us/capabilities/cyber/cyber-kill-chain.html)
- Caltagirone, Pendergast, Betz — [The Diamond Model of Intrusion Analysis](https://www.activeresponse.org/the-diamond-model/) (2013)
- The Open Group — [FAIR (O-RA) / Open FAIR](https://www.opengroup.org/open-fair) risk taxonomy and analysis
- [SLSA v1.0](https://slsa.dev/spec/v1.0/levels) (Build track L0-L3) · [in-toto](https://in-toto.io/) · SBOM formats [CycloneDX](https://cyclonedx.org/) & [SPDX](https://spdx.dev/)
- [Threat Modeling Manifesto](https://www.threatmodelingmanifesto.org/) (2020) · [OWASP pytm](https://github.com/OWASP/pytm) · [OWASP Threat Dragon](https://owasp.org/www-project-threat-dragon/) · [Threagile](https://threagile.io/)
- CISA — [SSVC (Stakeholder-Specific Vulnerability Categorization)](https://www.cisa.gov/ssvc) · [Zero Trust Maturity Model](https://www.cisa.gov/zero-trust-maturity-model)
- OWASP — [ASVS](https://owasp.org/www-project-application-security-verification-standard/) (assurance levels L1/L2/L3)
