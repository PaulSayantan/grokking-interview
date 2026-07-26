# devops-cicd — Content Audit

**Executive summary.** The devops-cicd domain is in strong shape: across all 21 subtopics the writing is clear, intuition-first, and genuinely senior-aware (average clarity 4.8/5, depth 4.2/5). Every subtopic leads with a plain-language mental model before formalism, carries `[!INTERVIEW]`/`[!WARNING]` gotcha callouts, and ends with a "Common follow-up questions" section — the interview-depth bar is largely met. The domain's single systemic weakness is **worked examples**: the average example score is just 3.0/5, and the same failure recurs everywhere — concepts that beg for a numbers-in/numbers-out trace (DORA arithmetic, error-budget minutes, canary abort math, CIDR subnetting, expand/contract SQL, OIDC trust-policy JSON, `git reset` variants, Terraform plan/state output) are taught abstractly in prose. **Priority counts: 0 high, 21 medium, 0 low.** No subtopic is a rewrite candidate; every one is a targeted-refinement candidate. That said, **16 of 21 subtopics carry at least one high-severity issue** despite their medium overall rating, and 4 subtopics score only 2/5 on examples (artifact-and-dependency-management, cloud-platforms-and-managed-services, devops-fundamentals-and-culture, devops-system-design-and-scenarios). **Headline takeaways:** (1) a single domain-wide "add a worked example" pass would move the needle more than anything else; (2) DORA metrics are re-taught in ~8 subtopics, all abstractly and several with stale/broken bands — fix once, propagate; (3) 18 of 21 files flag `needs_web_verification` for drifting version/pricing/threshold facts.

## Scorecard

Sorted high-priority first (none), then lowest combined (clarity+examples+depth) first.

| Subtopic | Clarity (/5) | Examples (/5) | Depth (/5) | Priority | Verdict |
|---|---|---|---|---|---|
| devops-system-design-and-scenarios | 4 | 2 | 4 | medium | Strong method/trade-off playbook, but almost all abstract prose — migration walkthrough, error-budget minutes, CI/DR numbers missing. |
| artifact-and-dependency-management | 5 | 2 | 4 | medium | Clear and interview-aware, but zero worked examples and omits the classic version-conflict/diamond-dependency probe. |
| cloud-platforms-and-managed-services | 5 | 2 | 4 | medium | Excellent operating-model spectrum, but the central serverless-crossover heuristic is asserted 3x, never computed. |
| devops-fundamentals-and-culture | 5 | 2 | 4 | medium | Excellent culture/framing, but DORA bands table is broken (blank/duplicated cells) and no metric is ever computed. |
| cicd-tooling-actions-gitlab-jenkins | 4 | 3 | 4 | medium | Polished tool reference, but reads like reference prose and skips the self-hosted-vs-hosted cost breakeven math. |
| cicd-pipeline-concepts | 5 | 3 | 4 | medium | Clear CI/CD concept map; DORA not computed, flaky tests absent, security acronyms unexpanded. |
| configuration-management-ansible | 5 | 3 | 4 | medium | Great trade-offs, but variable precedence and idempotency (the two tested things) never traced; scaling/forks hand-waved. |
| deployment-strategies | 5 | 3 | 4 | medium | Exceptionally clear; needs canary metric math, maxSurge pod trace, traced expand/contract, sticky-session gotcha. |
| git-and-branching-strategies | 5 | 3 | 4 | medium | Sharp isolation-vs-integration spine; reset/merge-base/rebase mechanics untraced; bisect absent. |
| incident-management-and-troubleshooting | 5 | 3 | 4 | medium | Excellent sequencing; availability formula cited twice but never computed; bisection troubleshooting untraced. |
| infrastructure-as-code-terraform | 5 | 3 | 4 | medium | Strong mental model; no traced plan output or state JSON; count-vs-for_each and create_before_destroy gotchas skipped. |
| linux-scripting-and-os-fundamentals | 4 | 3 | 5 | medium | Outstanding depth/gotchas; examples are one-line snippets, not traced (awk `$5+0`, redirect ordering, `set -e`). |
| monitoring-and-observability | 5 | 3 | 4 | medium | Clear, well-scoped; error-budget minutes, PromQL trace, canary-vs-baseline numbers all missing. |
| platform-engineering-and-idp | 5 | 3 | 4 | medium | Excellent concepts; DORA/ROI/cognitive-load taught abstractly; no end-to-end golden-path trace. |
| secrets-management | 5 | 3 | 4 | medium | Excellent framing; OIDC trust policy, Vault dynamic-secret trace, rotation state machine only in prose. |
| software-supply-chain-security | 4 | 3 | 5 | medium | Senior-grade threat framing; unexpanded VEX/OIDC/OCI/TUF and command-snippet (not traced) examples. |
| devsecops-and-pipeline-security | 5 | 4 | 4 | medium | Strong SAST/DAST/IAST/SCA anchor; OIDC trust policy and dependency-confusion still lack the concrete payload. |
| gitops | 5 | 4 | 4 | medium | Genuinely excellent; lacks failure-mode/scale depth and one traced drift/self-heal walkthrough. |
| networking-and-dns-for-devops | 5 | 3 | 5 | medium | Excellent ops-networking reference; CIDR subnetting, failover timing, TTL cutover never walked with numbers. |
| sre-sla-slo-sli-reliability | 5 | 4 | 4 | medium | Excellent with real math tables; missing the "valid events" nuance and a numbers-in burn-rate example. |
| testing-strategy-in-cicd | 5 | 3 | 5 | medium | Deep on pipeline-testing mechanics; sharding math, cost×failure ranking, contract/mutation examples thin. |

## Systemic issues

These are the cross-subtopic patterns. The first two account for the bulk of the domain's remaining value and should be fixed as coordinated passes rather than per-file.

### 1. Missing numbers-in / numbers-out worked examples (pervasive — ~all 21 subtopics; 18 carry an explicit `example-gap` issue)
The dominant, domain-defining weakness and the reason the examples average sits at 3.0 while clarity/depth sit ~4–5. Concepts that only click when traced are taught as prose or a lone config snippet. High-severity instances: `deployment-strategies` (canary abort math, maxSurge/maxUnavailable pod trace), `infrastructure-as-code-terraform` (no plan output, no state JSON), `git-and-branching-strategies` (`reset --soft/--mixed/--hard`, three-way merge base), `networking-and-dns-for-devops` (CIDR subnetting, failover timing), `testing-strategy-in-cicd` (sharding crossover math), `monitoring-and-observability` (PromQL success-rate trace). **Fix as one themed pass:** for each subtopic add 1–3 small traced blocks (inputs → arithmetic/diff → result), reusing a single scenario across variants where possible.

### 2. DORA metrics: re-taught abstractly, never computed, and bands are stale or broken (~8 subtopics)
DORA appears in `cicd-pipeline-concepts`, `deployment-strategies`, `devops-fundamentals-and-culture`, `devops-system-design-and-scenarios`, `incident-management-and-troubleshooting`, `monitoring-and-observability`, `platform-engineering-and-idp`, and `sre-sla-slo-sli-reliability`. In none of them is a single key (CFR, lead time, MTTR) actually computed from raw events. Worse: `devops-fundamentals-and-culture` has a **broken bands table** (blank Medium CFR cell, duplicated "<1 day" recovery cells that can't distinguish High from Medium), and multiple files state exact Elite/High thresholds that drift yearly across State of DevOps reports. **Fix once, propagate:** write one canonical worked DORA example + a corrected, monotonic, dated bands table, then reuse it; add "quote as approximate, bands recalibrate yearly" hedging everywhere.

### 3. Error-budget "minutes" never converted from the percentage (3 subtopics)
`devops-system-design-and-scenarios`, `monitoring-and-observability`, and `sre-sla-slo-sli-reliability` all define error budget algebraically (`1 - SLO`) but the visceral "99.9% = ~43 min/month; a 30-min incident burns ~70%" arithmetic is missing or partial. Burn-rate is defined in words but not traced. **Fix:** standardize on the ~43.2 min/month (99.9%) figure and one burn-rate ratio example.

### 4. OIDC trust policy shown only in prose — the vulnerability lives in the JSON that's never shown (3 subtopics)
`cicd-tooling-actions-gitlab-jenkins`, `devsecops-and-pipeline-security`, and `secrets-management` all describe "restrict the trust to the exact repo/ref" but none shows the actual IAM trust-policy `Condition` block (safe `sub`/`aud` vs the dangerous `repo:org/*` wildcard). This is a top interview probe ("show me the trust policy"). **Fix:** add one shared good-vs-dangerous JSON snippet.

### 5. Dependency confusion explained without a version-number trace (3 subtopics)
`artifact-and-dependency-management`, `devsecops-and-pipeline-security`, and `software-supply-chain-security` each describe "attacker publishes a higher version publicly" abstractly. The famous, high-signal mechanism never gets the `acme-utils@1.2.0` (internal) vs `acme-utils@99.0.0` (public) → resolver picks highest → runs install script trace. **Fix:** one shared 3-step trace + mitigation mapping (scoped names, registry pinning).

### 6. Unexpanded jargon/acronyms on first use (~7 subtopics)
Recurring offenders: SAST/DAST/SCA/IaC (`cicd-pipeline-concepts`, `devops-fundamentals-and-culture`, `devops-system-design-and-scenarios`), VEX/OIDC/OCI/TUF (`software-supply-chain-security`), "sink" in taint analysis (`devsecops-and-pipeline-security`), "valid events" (`sre-sla-slo-sli-reliability`), DAG/"hermetic" (`testing-strategy-in-cicd`), toil/ChatOps (`devops-fundamentals-and-culture`). **Fix:** a one-parenthetical-per-first-use sweep.

### 7. Version/pricing/threshold facts that drift — `needs_web_verification=true` in 18 of 21 subtopics
A dedicated web-verification pass is warranted. Concrete claims to check: Terraform native S3-lockfile locking making DynamoDB optional (`devops-system-design`, and cross-check `infrastructure-as-code-terraform`), Argo CD sync-wave default delay + env var (`gitops`), Let's Encrypt 90-day/6-day cert profiles + certbot renewal threshold + Linux ephemeral port range (`networking-and-dns-for-devops`), GitHub Actions minute multipliers (Windows 2x/macOS 10x) + free-tier quota + Jenkins plugin count (`cicd-tooling-actions-gitlab-jenkins`), Reserved/Spot discount % (`cloud-platforms-and-managed-services`), Gartner "80% by 2026" (date now passed) + DORA fifth-metric/reliability (`platform-engineering-and-idp`), reflog expiry defaults + SHA-256 migration status + Accelerate branching thresholds (`git-and-branching-strategies`), Semgrep `returntocorp` → `semgrep/semgrep` rebrand (`devsecops-and-pipeline-security`), SLSA GitHub-generator attainable level + Scorecard weights (`software-supply-chain-security`). The 3 files NOT needing verification: `artifact-and-dependency-management`, `linux-scripting-and-os-fundamentals`, `testing-strategy-in-cicd`.

### 8. Canary/progressive-delivery mechanics stay abstract; two classic gotchas missing (3 subtopics)
`deployment-strategies`, `devops-system-design-and-scenarios`, and `monitoring-and-observability` all lean on canary + auto-rollback but never give traffic-step %, bake window, or the statistical-significance decision. Two senior gotchas recur as gaps: **session stickiness** (per-request routing bounces a user between v1/v2) and **low-traffic services can't canary** (too few samples). **Fix:** one shared canary mechanics block (1%→5%→25%→100%, bake, canary-vs-concurrent-baseline) + both gotchas.

### 9. Expand/contract DB migration taught as an abstract arrow sequence — no SQL, no release boundaries (2 subtopics)
`deployment-strategies` and `devops-system-design-and-scenarios` both call this "the single most-asked schema-migration question" yet give only `add → dual-write → backfill → switch → drop`. **Fix:** one shared concrete rename walkthrough (SQL per release + which release is rollback-safe), plus the "additive isn't free on large tables" lock gotcha.

## High-priority subtopics

No subtopic is rated `refine_priority: high` — the whole domain is medium. However, 16 of 21 carry at least one **high-severity issue**, and the following are the **highest-need** subtopics (lowest scores and/or two high-severity issues). These are where a refinement pass should start.

### devops-system-design-and-scenarios (2/5 examples; lowest combined score; two high-severity)
1. **[high] Expand/contract taught purely as prose steps** ("the single most common gotcha scenario") — add a concrete `users.username → users.handle` rename traced across 4 releases with SQL, showing why collapsing any two breaks the old/new overlap and which releases are rollback-safe.
2. **[high] Error budget defined as `1 - SLO` but never converted to minutes** — add "99.9% → ~43.2 min/month; 99.99% → ~4.3 min; a 30-min incident burns ~70% → freeze risky releases," plus burn-rate alerting mention.
3. **[medium] Scaling-CI hook ("45 min / too expensive") never uses its own numbers** — add a numeric trace decomposing the 45 min (queue/build/test/deploy) and showing shard + cache targeting the dominant term.
4. **[medium] RTO/RPO table never tied to backup cadence** — map nightly snapshot → ~24h RPO, 6h snapshot → 6h, async replication → seconds, sync → ~0, and which RTO/RPO pair forces which recovery tier.
5. **[medium] Canary/auto-rollback mechanics never explained** — add traffic-%/bake/SLO-gate/auto-abort detail + low-traffic gotcha.

### artifact-and-dependency-management (2/5 examples; two high-severity; no web-verify needed)
1. **[high] Zero worked examples anywhere** — add SemVer precedence ordering exercise, a floating-range (`^1.4.0`) two-day divergence trace, and a small transitive-tree diagram making "10 → 300" tangible.
2. **[high] Version-conflict/diamond-dependency resolution entirely absent** — add a subsection contrasting npm nested `node_modules` vs Maven nearest-wins vs pip single-global backtracking vs Go MVS, with each ecosystem's failure mode.
3. **[medium] Dependency confusion abstract** — add the `acme-utils@1.2.0` vs `@99.0.0` 3-step trace + mitigation mapping.
4. **[medium] "Stale/poisoned caches" named but mechanism unexplained** — explain branch-name-keyed cache serving yesterday's resolved deps, and lockfile-hash keying as the fix.

### cloud-platforms-and-managed-services (2/5 examples; one high-severity)
1. **[high] Serverless-crossover heuristic asserted 3x, never computed** — price out a 512MB/200ms Lambda at 1M vs 100M invocations (GB-seconds + per-request) against a t3.small/medium 24/7 and show where the lines cross.
2. **[medium] "Cold start" used 4x as a decision criterion but never defined** — add what it is, what inflates it (deps, VPC ENI, runtime), magnitude, and provisioned-concurrency mitigation.
3. **[medium] Managed-vs-self-hosted cost stays abstract** — add RDS Multi-AZ line item vs self-managed EC2 + engineer on-call hours showing the salary term dominates.

### devops-fundamentals-and-culture (2/5 examples; broken bands table)
1. **[high] DORA four keys defined only in prose, never computed** — add a worked month (50 deploys, 6 hotfixes → CFR 12%; commit 09:00 → live 11:30 → lead time 2.5h; MTTR from 3 incidents).
2. **[medium/correctness] Bands table has blank + duplicated cells** — fill every cell with monotonic non-overlapping ranges; verify current numbers.
3. **[medium] "Why doesn't everyone do Continuous Deployment?" unanswered** — add preconditions (comprehensive tests, progressive delivery, auto-rollback, flags) and the manual-gate trade-off.
4. **[low] Jargon** — gloss toil, ChatOps; expand SAST/SCA once.

### configuration-management-ansible (two high-severity)
1. **[high] Variable precedence called "a classic gotcha" but dispatched in 2 sentences** — add the traced `http_port` example across defaults/group_vars/host_vars/`-e` resolving different values for web1 vs web2.
2. **[high] Idempotency never shown with run output** — show two `PLAY RECAP` lines (changed=3 then changed=0), a third after manual `systemctl stop` (changed=1 self-heal), contrasted with a `shell:` task changing every run.
3. **[medium] Scaling/`forks` hand-waved** — add a Performance-and-scale subsection (forks default 5, SSH RTT per task, pipelining/ControlPersist/free strategy/fact caching).
4. **[medium] Tags and block/rescue/always missing** — add brief coverage.

### deployment-strategies (two high-severity)
1. **[high] Canary "automated analysis" has no numbers** — add a traced abort: 10k rps, 5% canary, 10m bake, `successCondition >= 0.99`, 1.8% errors over 300k requests → auto-abort.
2. **[high] maxSurge/maxUnavailable never traced** — walk a 4-pod rolling update step by step for `maxSurge=25%/maxUnavailable=0` vs `maxUnavailable=1/maxSurge=0`.
3. **[medium] Session stickiness + low-traffic canary gotchas absent** — add both.
4. **[medium] Expand/contract rename has no SQL** — add per-deploy SQL walkthrough.

### infrastructure-as-code-terraform (two high-severity)
1. **[high] count vs for_each never explained — the index-shift failure is a top senior probe** — trace removing the middle of a 3-element `count` list forcing destroy/recreate of everything after it; contrast keyed `for_each`.
2. **[high] No traced plan output, no state JSON** — add a real `~ update in-place` / `-/+ forces replacement` diff + "Plan: 1 to add… 1 to destroy" line, and a trimmed `terraform.tfstate` snippet showing the `id → i-0abc123` binding.
3. **[medium] `create_before_destroy`/`prevent_destroy` reasoning missing** — explain default destroy-then-create downtime, the unique-name requirement, and `prevent_destroy` erroring the plan.
4. **[medium] State refactoring absent** — add `moved` blocks / `state mv` and `-replace` (superseding `taint`).

### monitoring-and-observability (two high-severity)
1. **[high] Error budget defined only algebraically** — add the ~43 min/month worked line.
2. **[high] PromQL success-rate query shown but never traced** — walk "10,000 requests, 150 5xx → ratio 0.985 < 0.99 → fails; failureLimit:2 → abort."
3. **[medium] Canary-vs-baseline comparison abstract** — add a baseline/canary p99+error table showing a halt decision.
4. **[medium] Lead time / recovery time never computed from events** — add a one-line trace.

### networking-and-dns-for-devops (two high-severity)
1. **[high] CIDR/subnetting only a static table** — add a worked `10.0.0.0/16` split into 4 `/24`s across 2 AZs with first/last usable addresses and the 5-reserved subtraction, plus the bit math once.
2. **[high] Failover recovery "bounded by interval + TTL" never computed** — add `10s × 3 = ~30s to detect + 60s TTL = ~90s worst case`, with the over-caching-resolver caveat.
3. **[medium] TTL cutover playbook + stateless NACL ephemeral-return bug** — add a clock-time timeline and a traced connection showing the outbound ephemeral allow the handshake needs.

### platform-engineering-and-idp (two high-severity)
1. **[high] DORA keys named but no numbers/thresholds** — add a worked team classified against Elite/High/Medium/Low.
2. **[high] Golden path never traced end-to-end** — add a numbered Backstage-form → scaffold → CI/Dockerfile/Terraform → catalog-info → Argo sync → SLO dashboard/Vault path sequence.
3. **[medium] Buy-vs-build (Backstage vs Port/Cortex vs Humanitec/Crossplane) not reasoned; ROI/migration missing** — add a "pick X when Y" paragraph + a headcount-justification ROI framing.
4. **[low/correctness] Gartner "80% by 2026" now reads stale** — reword; verify DORA fifth-metric status.

**Single-high-severity subtopics** (address after the above; each has one high-severity gap): `cicd-tooling-actions-gitlab-jenkins` (self-hosted-vs-hosted cost breakeven), `cicd-pipeline-concepts` (compute a DORA key), `devsecops-and-pipeline-security` (OIDC trust-policy JSON), `git-and-branching-strategies` (`reset` variants + three-way merge trace), `secrets-management` (OIDC trust-policy JSON), `sre-sla-slo-sli-reliability` ("valid events" definition + a 400-excluded worked SLI).

**Medium-only subtopics** (polish tier — strongest in the domain): `gitops`, `incident-management-and-troubleshooting`, `linux-scripting-and-os-fundamentals`, `software-supply-chain-security`, `testing-strategy-in-cicd`.

## Refinement plan

Recommended order of attack, sequenced to maximize shared-work leverage:

1. **Domain-wide "worked example" pass (systemic issue #1).** Highest ROI. Hit the four 2/5-examples files first (devops-system-design, artifact-and-dependency-management, cloud-platforms, devops-fundamentals), then the two-high-severity files (configuration-management-ansible, deployment-strategies, infrastructure-as-code-terraform, monitoring, networking, platform-engineering, git-and-branching).

2. **Canonical DORA fix (systemic #2), authored once and propagated.** Write one worked DORA example + one corrected/dated bands table; fix the broken `devops-fundamentals-and-culture` table first, then reuse across the other ~7 DORA-touching files. Fold in the error-budget-minutes standard (systemic #3).

3. **Shared security-snippet pass (systemic #4, #5).** One good-vs-dangerous OIDC trust-policy JSON reused across cicd-tooling / devsecops / secrets-management; one dependency-confusion version trace reused across artifact / devsecops / software-supply-chain.

4. **Canary + expand/contract shared blocks (systemic #8, #9).** Author each once, reuse across deployment-strategies / devops-system-design / monitoring (canary) and deployment-strategies / devops-system-design (migration).

5. **Jargon sweep (systemic #6).** Fast, mechanical first-use-expansion pass across the ~7 affected files.

6. **Web-verification pass (systemic #7) — LAST, so numbers are checked once, right before publish.** `needs_web_verification=true` for **18 of 21** subtopics; verify all except `artifact-and-dependency-management`, `linux-scripting-and-os-fundamentals`, and `testing-strategy-in-cicd`. Prioritize the version/pricing/threshold claims enumerated in systemic issue #7 (Terraform S3 locking, Argo sync-wave delay, Let's Encrypt cert lifetimes, GitHub Actions multipliers + Jenkins plugin count, Reserved/Spot discounts, Gartner/DORA figures, reflog/SHA-256, Semgrep rebrand, SLSA/Scorecard).

**Note:** 0 files were missing or unreadable — all 21 audit objects were parsed successfully.
