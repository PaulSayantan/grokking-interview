export const meta = {
  name: 'devops-cicd-authoring',
  description: 'Author interview-grade concepts.md + a 40-60 MCQ questions.yaml for all 21 DevOps & CI/CD topics, then verify each for factual accuracy and schema compliance',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact-check + schema-check each topic, fix in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/devops-cicd`

const SCOPE_NOTE = `
DOMAIN SCOPE — "DevOps & CI/CD" for BACKEND + SENIOR developer interviews. Teach the delivery/
operations discipline concretely with tool grounding EXPECTED (GitHub Actions, GitLab CI, Jenkins,
Terraform, Ansible, Argo CD/Flux, Vault) — how pipelines, IaC, and deployment automation actually
work. Concept-first, then tool specifics.

BOUNDARY vs already-authored / upcoming domains — give the DEVOPS/PIPELINE angle and CROSS-REFERENCE,
do NOT duplicate:
- observability (AUTHORED, dedicated domain): owns metrics/logs/traces/OTel/Prometheus/SLO mechanics.
  The 'monitoring-and-observability' topic here = how observability fits the DELIVERY pipeline
  (deploy markers, pipeline metrics, smoke/synthetic checks post-deploy) + a pointer. Do NOT
  re-teach PromQL/OTel internals.
- testing (AUTHORED): owns the testing discipline. 'testing-strategy-in-cicd' here = WHERE tests run
  in the pipeline (stages, gates, parallelization, fail-fast, test selection, flaky quarantine at
  pipeline level) + pointer. Do NOT re-teach test-double taxonomy/JUnit.
- security (AUTHORED): owns secrets-management-and-key-lifecycle, OWASP, crypto. 'secrets-management'
  here = secrets IN DEPLOYS/PIPELINES (Vault/External-Secrets/sealed-secrets/SOPS, CI secret
  injection, OIDC-to-cloud, rotation-in-deploy) + pointer. 'devsecops-and-pipeline-security' =
  SAST/DAST/SCA/IaC-scanning IN the pipeline.
- networking (AUTHORED): owns TCP/DNS/TLS/HTTP internals. 'networking-and-dns-for-devops' here =
  the OPS-practitioner view (DNS records for deploys/failover, load balancer config, firewall/
  security-groups, CIDR for infra, cert/ACME automation) + pointer to networking for wire details.
- UPCOMING reliability-and-operations will own the deep incident/on-call/postmortem/chaos PROCESS.
  Here 'sre-sla-slo-sli-reliability' and 'incident-management-and-troubleshooting' give the DevOps
  framing (error budgets gating releases, DORA metrics, basic incident flow) — keep it and note the
  deep dive is coming; cross-link observability's SLO topic for the alerting math.
- UPCOMING operating-systems will own OS internals. 'linux-scripting-and-os-fundamentals' here =
  the practical ops TOOLKIT (bash scripting, file perms, systemd, package mgmt, common CLI:
  top/ps/df/du/grep/sed/awk/journalctl, exit codes, cron) — the hands-on DevOps skill, not OS theory.
- UPCOMING docker + kubernetes are separate domains — reference them, don't author container/K8s
  internals here (this domain's cloud/IaC/deploy topics may MENTION containers, pointing onward).

Ground claims in authoritative sources: the DORA / Accelerate research (four keys, elite metrics),
the Google SRE books, Terraform/Ansible/Argo CD docs, GitHub Actions/GitLab CI/Jenkins docs, SLSA
framework, the 12-Factor App, Trunk-Based Development (Paul Hammant/DORA), OpenSSF. Verify specifics
(Terraform state/locking, Argo CD pull model, DORA metric definitions, deployment-strategy mechanics).
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (MCQ anchor targets — keep stable).
   - Layered interview-grade answers (beginner def+why -> intermediate trade-offs -> advanced gotchas).
   - Concrete examples: pipeline YAML snippets, Terraform HCL, a deployment-strategy walkthrough,
     DORA-metric definitions, comparison tables. Tool-grounded, concept-first.
   - If a diagram helps (pipeline stages, blue-green/canary flow, GitOps reconciliation loop, branch
     model), use a \`\`\`mermaid fenced block (flowchart/sequenceDiagram/gitGraph). NO ASCII-art.
     Keep code/YAML/HCL in normal fenced code blocks.
   - End with "## Common follow-up questions" and "## References".
   - Factual accuracy is critical.

2) questions.yaml — top-level keys:
     topic: "<Topic Name>"
     domain: devops-cicd
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001    # unique, zero-padded 3-digit seq; prefix == slug
         difficulty: beginner     # beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options: ["<0>","<1>","<2>","<3>"]
         answer: 2                # 0-BASED index
         explanation: |
           <why correct; teach the concept>
         ref: "concepts.md#<anchor>"  # resolves to a real "## " heading (GitHub slug rules)

   RULES: 40-60 questions (min 40); cover EVERY subtopic; 3-5 options, exactly one correct, 0-based
   answer; VARY the correct index (no clustering, no trivially-guessable repeating cycle); mixed
   difficulty (Pass 1 — don't over-index on expert); INCLUDE scenario-style questions ("given this
   pipeline / this Terraform / this deploy strategy / these DORA numbers, what's true / what's
   wrong / which fixes it?"); distractors plausible but wrong for a real reason; no all/none-of-the-
   above; every 'ref' resolves to a real "## " heading; id prefix == slug.

Use the Write tool. Do your own web research. Return: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'devops-fundamentals-and-culture', name: 'DevOps Fundamentals & Culture', hints: "what DevOps is (culture + practice + tools bridging dev & ops, breaking silos); CALMS (Culture/Automation/Lean/Measurement/Sharing); the Three Ways (flow, feedback, continual learning — Phoenix Project/DevOps Handbook); CI vs CD vs CD (continuous integration/delivery/deployment distinction); DORA four key metrics (deployment frequency, lead time for changes, change failure rate, MTTR) + elite/high/med/low; you-build-it-you-run-it; blameless culture; shift-left; DevOps vs SRE vs Platform Engineering; Conway's law; the wall-of-confusion." },
  { slug: 'git-and-branching-strategies', name: 'Git & Branching Strategies', hints: "core git model (commits/refs/HEAD, merge vs rebase, fast-forward, cherry-pick, reset vs revert, stash, reflog); branching strategies — Git Flow (feature/develop/release/hotfix — heavy), GitHub Flow (main + short branches), GitLab Flow (env branches), and TRUNK-BASED DEVELOPMENT (short-lived branches/direct-to-main + feature flags — DORA-recommended for CI); merge conflicts; PR/MR review flow; semantic versioning & conventional commits; monorepo vs polyrepo; protecting main (required checks); why long-lived branches hurt CI." },
  { slug: 'cicd-pipeline-concepts', name: 'CI/CD Pipeline Concepts', hints: "pipeline stages (build->test->package->scan->deploy); pipeline-as-code; CI principles (integrate often, keep build green, fast feedback, fail fast); artifacts flowing between stages; build once/deploy many (promote same artifact across envs); gates/approvals; parallel vs sequential stages, fan-out/fan-in, matrix builds; caching dependencies & build cache; idempotent/reproducible builds; ephemeral build agents/runners; environments & promotion (dev->staging->prod); pipeline triggers (push/PR/tag/schedule/manual); the deployment pipeline (Humble/Farley Continuous Delivery)." },
  { slug: 'cicd-tooling-actions-gitlab-jenkins', name: 'CI/CD Tooling: GitHub Actions, GitLab CI & Jenkins', hints: "GitHub Actions (workflows/jobs/steps/actions, runners hosted vs self-hosted, matrix, reusable workflows, OIDC to cloud, secrets/environments); GitLab CI (.gitlab-ci.yml stages/jobs, runners, needs/DAG, includes); Jenkins (declarative vs scripted Pipeline, Jenkinsfile, agents, plugins ecosystem, shared libraries, the older master/agent model); comparison & when each; self-hosted vs cloud runners (security, cost, scale); pipeline reuse/templating (DRY); ephemeral runners; common patterns; secrets handling in each (pointer to secrets topic)." },
  { slug: 'testing-strategy-in-cicd', name: 'Testing Strategy in CI/CD', hints: "WHERE tests fit in the pipeline (fast unit early/fail-fast -> integration -> e2e -> smoke post-deploy); quality gates & coverage thresholds as gates; parallelization/sharding & test-splitting; test selection / test-impact-analysis (run only affected); flaky-test quarantine at pipeline level & retry policy; contract tests in the pipeline (can-i-deploy gate); staging smoke/synthetic tests; performance/security tests in pipeline; test result reporting/trends; keeping the suite fast; POINTER to the dedicated testing domain for the discipline itself." },
  { slug: 'artifact-and-dependency-management', name: 'Artifact & Dependency Management', hints: "build artifacts & artifact repositories (Artifactory, Nexus, GitHub Packages, container registries); immutable artifacts & versioning (semantic version + build metadata, immutable tags vs mutable 'latest'); build-once-promote-many (same artifact through envs); dependency management (lockfiles, transitive deps, version pinning, reproducible builds); dependency caching in CI; vulnerability scanning of deps (SCA — pointer to devsecops); artifact retention/cleanup; provenance/attestations (pointer to supply-chain); package registries & proxies; artifact promotion." },
  { slug: 'deployment-strategies', name: 'Deployment Strategies', hints: "recreate (downtime), rolling update (gradual, surge/maxUnavailable), BLUE-GREEN (two envs, instant switch + instant rollback, DB migration challenge), CANARY (small % first, monitor, progressive rollout, automated analysis/rollback), shadow/mirror (prod traffic to new version, no user impact), A/B testing (routing by attribute for experiments — vs canary which is about safety); feature-flag decoupling deploy from release; progressive delivery (Argo Rollouts/Flagger); rollback vs roll-forward; bake time; zero-downtime + backward-compatible schema (expand/contract); traffic shifting; health checks gating rollout." },
  { slug: 'infrastructure-as-code-terraform', name: 'Infrastructure as Code (Terraform)', hints: "IaC benefits (versioned/repeatable/reviewable infra, no snowflakes); declarative vs imperative; Terraform core (HCL, providers, resources, data sources, plan/apply/destroy, the dependency graph); STATE (why state exists, remote state backends, state locking to prevent concurrent apply, sensitive data in state); modules (reuse, composition, registry); variables/outputs/locals; workspaces vs directory-per-env; drift detection; provisioners as last resort; import; immutable vs mutable infra; Terraform vs Pulumi/CloudFormation/CDK; plan-in-CI/apply-on-merge; state as the source of truth vs real world." },
  { slug: 'configuration-management-ansible', name: 'Configuration Management (Ansible)', hints: "config management vs provisioning (Ansible configures existing hosts; Terraform provisions infra — complementary); Ansible model (agentless over SSH, push-based, inventory, playbooks/tasks/roles, modules, idempotency of modules, handlers, facts, templates/Jinja2, vault for secrets); IDEMPOTENCY (declare desired state, safe to re-run); Ansible vs Chef/Puppet/Salt (agentless push vs agent pull, declarative-ish); when config mgmt vs immutable images (bake vs configure); ad-hoc commands; roles & Galaxy; mutable-infra config drift; where config mgmt fits vs containers/immutable infra." },
  { slug: 'cloud-platforms-and-managed-services', name: 'Cloud Platforms & Managed Services for DevOps', hints: "IaaS vs PaaS vs SaaS vs FaaS (responsibility spectrum); shared responsibility model; compute options (VMs vs containers vs serverless) trade-offs; managed vs self-hosted (DB, queues, k8s — ops burden vs control/cost); the big three overview (AWS/GCP/Azure) & core equivalents (compute/storage/network/identity); cloud-agnostic vs lock-in trade-off; regions/AZs for HA; managed CI/CD & IaC services; cost/FinOps basics (tagging, rightsizing, spot/reserved, egress traps); pointer to the AWS system-design group for AWS depth; multi-cloud reality." },
  { slug: 'gitops', name: 'GitOps', hints: "GitOps principles (declarative desired state in Git = single source of truth, Git as the audit log, automated reconciliation to close drift, pull vs push); Argo CD & Flux (in-cluster agent watches Git, reconciles cluster to match); PULL model vs traditional push-deploy (credentials stay in cluster, more secure); app-of-apps; sync waves/hooks; drift detection & self-heal; rollback = git revert; environment promotion via PRs/branches or overlays (Kustomize); the reconciliation loop; secrets in GitOps (sealed-secrets/SOPS/external-secrets); GitOps vs traditional CD; progressive delivery on GitOps." },
  { slug: 'monitoring-and-observability', name: 'Monitoring & Observability (DevOps view)', hints: "how observability serves DELIVERY (this is the DevOps framing — the dedicated observability domain owns the deep mechanics, POINT to it): deployment markers/annotations tying deploys to metric changes; pipeline & DORA metrics (deploy frequency, lead time, CFR, MTTR); post-deploy smoke & synthetic monitoring as a release gate; automated rollback on SLO breach; the four golden signals as a release health check; monitoring the pipeline itself (build times, flaky rate, queue time); alerting routing to on-call (pointer); health checks/readiness for deploy gating; brief three-pillars recap with a pointer to observability domain." },
  { slug: 'sre-sla-slo-sli-reliability', name: 'SRE: SLA, SLO, SLI & Reliability', hints: "SRE overview (Google's approach, ops as a software problem, toil reduction, error-budget-driven); SLI (a good ratio metric) vs SLO (internal target) vs SLA (external contract w/ penalty); error budgets & the error-budget POLICY (freeze features when budget exhausted, balance velocity vs reliability); availability math (nines -> minutes); toil (definition, <50% cap); the SRE role vs DevOps; embedded vs central SRE; reducing toil via automation; blameless postmortems (intro — deep dive in upcoming reliability-ops); cross-link observability's SLO-alerting topic for the burn-rate math." },
  { slug: 'incident-management-and-troubleshooting', name: 'Incident Management & Troubleshooting', hints: "the incident lifecycle (detect->triage->mitigate->resolve->learn); incident severity levels (SEV1-4); incident command roles (IC, comms, ops lead); MTTR/MTTD/MTBF; escalation & paging; mitigate-before-diagnose (stop the bleeding: rollback/failover/scale first); systematic troubleshooting (bisection, recent-change-first, read the logs/metrics/traces); the '5 whys' / root-cause analysis; blameless postmortems & action items; status pages/comms; runbooks; on-call basics; note the deep incident/on-call/chaos PROCESS is the upcoming reliability-ops domain; cross-link observability for signals." },
  { slug: 'linux-scripting-and-os-fundamentals', name: 'Linux, Shell Scripting & OS Fundamentals (DevOps toolkit)', hints: "the practical DevOps Linux TOOLKIT (OS theory is the upcoming operating-systems domain — keep this hands-on): bash scripting (variables, conditionals, loops, functions, exit codes $?, set -euo pipefail, pipes/redirection, command substitution); essential CLI (ls/cd/grep/sed/awk/find/xargs/cut/sort/uniq/tail -f/less); process & resource tools (ps/top/htop/kill/nice, df/du/free, lsof, ss/netstat); file permissions & ownership (chmod/chown, rwx, sudo); systemd & services (systemctl, journalctl, unit files); package managers (apt/yum/dnf); cron & scheduled jobs; SSH & keys; env vars & PATH; signals (SIGTERM/SIGKILL); log locations. Brief pointer to OS domain for internals." },
  { slug: 'networking-and-dns-for-devops', name: 'Networking & DNS for DevOps', hints: "the OPS-practitioner networking view (wire-level internals are the networking domain — POINT to it): DNS records for ops (A/AAAA/CNAME/MX/TXT/SRV, TTL & propagation, DNS-based failover/GeoDNS/weighted routing, split-horizon); load balancers in practice (L4 vs L7, health checks, target groups, sticky sessions config); firewalls/security groups/NACLs & least-privilege network rules; CIDR/subnetting for infra layout (public/private subnets, NAT gateway); VPN/bastion/jump hosts; TLS certs & ACME/Let's Encrypt automation, cert rotation; reverse proxies (nginx/Envoy config basics); ingress/egress; ports & common services; troubleshooting (dig/curl/traceroute pointer)." },
  { slug: 'devsecops-and-pipeline-security', name: 'DevSecOps & Pipeline Security', hints: "shift-left security (security in the pipeline, not after); SAST (static code analysis), DAST (dynamic/running-app scan), IAST, SCA (software composition analysis / dependency CVE scanning), secret scanning (pre-commit + CI), IaC scanning (tfsec/Checkov), container image scanning (Trivy/Grype); security gates (fail build on critical CVE) vs advisory; policy-as-code (OPA/Conftest); least-privilege for CI (OIDC short-lived creds vs long-lived keys, scoped tokens); protecting the pipeline itself (poisoned pipeline execution, dependency confusion, protecting runners); DevSecOps culture; pointer to security domain for the vuln classes themselves." },
  { slug: 'software-supply-chain-security', name: 'Software Supply Chain Security', hints: "the supply-chain threat (SolarWinds, Log4Shell, dependency confusion, typosquatting, compromised build); SLSA framework (levels, provenance, build integrity, hermetic/reproducible builds); SBOM (software bill of materials — SPDX/CycloneDX, why, generation); artifact signing & verification (Sigstore/cosign, in-toto attestations, provenance); dependency pinning/lockfiles & verification; trusted sources & registry security; the build system as attack surface; verifying third-party actions/images by digest not tag; OpenSSF Scorecard; distinguishing supply-chain security from general devsecops; admission control verifying signatures." },
  { slug: 'secrets-management', name: 'Secrets Management (in deploys & pipelines)', hints: "secrets in the DELIVERY context (the security domain owns the crypto/key-lifecycle theory — POINT to it): never in code/git (git-history leaks, scanning); CI/CD secret injection (masked vars, environments, OIDC federation to cloud avoiding stored keys); secret stores (HashiCorp Vault — dynamic/short-lived secrets, leasing; cloud secret managers); Kubernetes secrets & the sealed-secrets / External-Secrets-Operator / SOPS patterns for GitOps (encrypted secrets in git); secret rotation without redeploy; least-privilege access; the secret-zero/bootstrapping problem; env-var vs file vs API injection; detecting leaked secrets & rotate-on-leak; short-lived over long-lived credentials." },
  { slug: 'platform-engineering-and-idp', name: 'Platform Engineering & Internal Developer Platforms', hints: "platform engineering as the evolution of DevOps (reduce cognitive load, self-service golden paths); Internal Developer Platform (IDP) & portals (Backstage); the 'platform as a product' mindset (developers are customers); golden paths / paved roads (opinionated, supported defaults vs full freedom); self-service infra (templates, scaffolding, IaC modules behind a UI/API); DevEx metrics; team topologies (stream-aligned vs platform teams, enabling teams); when platform engineering makes sense (scale threshold); platform vs SRE vs DevOps; the 'you build it you run it' tension with cognitive load; abstraction without hiding too much." },
  { slug: 'devops-system-design-and-scenarios', name: 'DevOps System Design & Scenario Questions', hints: "scenario/design questions for DevOps interviews: design a CI/CD pipeline for a microservices app (build/test/scan/deploy, monorepo vs polyrepo, promotion); design zero-downtime deployment (strategy + DB migration + rollback); design a multi-environment infra with IaC (modules, state, promotion); design incident response for an outage; design secrets management for a fleet; migrate from manual deploys to automated CD; design a self-service platform; how to reduce deploy time / increase deploy frequency safely; disaster recovery runbook; scaling CI (runner fleet, caching, parallelization); trade-off articulation. Reference the specific topics above; this is the integrative/judgment topic." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior platform/DevOps engineer and interview coach authoring interview-grade study material for the DevOps & CI/CD topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / frequently-asked subtopics to cover for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . This is Pass 1 — aim for 40-60 solid MCQs.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer verifying interview content for the DevOps & CI/CD topic "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `The files are at ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml . Read BOTH.\n\n` +
    `Check and FIX IN PLACE (using Edit/Write) any of:\n` +
    `1) FACTUAL ERRORS in concepts.md or MCQ answers/explanations. Web-research anything uncertain — DORA four-key definitions & elite thresholds, deployment-strategy mechanics (blue-green vs canary vs rolling, shadow vs A/B), Terraform state/locking/plan-apply, Ansible agentless-push/idempotency vs Terraform, GitOps pull-model & reconciliation, SLSA levels, SLI/SLO/SLA + error-budget-policy, trunk-based-development. A wrong 'answer' index or a mischaracterized deploy strategy / IaC concept is the WORST defect — fix it.\n` +
    `2) SCOPE DRIFT / DUPLICATION: this domain gives the DEVOPS/pipeline angle. If it re-teaches the dedicated domains' depth — observability internals (PromQL/OTel), the testing discipline (test doubles/JUnit), security crypto/key-lifecycle theory, networking wire internals (TCP/TLS), OS internals, or Docker/K8s internals — TRIM to a cross-reference pointer. Keep secrets-management at the deploy/pipeline level, linux at the ops-toolkit level, networking at the ops-practitioner level.\n` +
    `3) SCHEMA violations: valid YAML; top-level keys topic/domain(devops-cicd)/topic_slug(${t.slug})/version/questions; ids (prefix '${t.slug}-', unique, 3-digit seq); difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based 'answer' in range; explanation; correct-option position VARIED (rebalance if any index >40% OR a trivially-guessable repeating cycle).\n` +
    `4) Every 'ref: concepts.md#anchor' resolves to a real '## ' heading (GitHub slug rules). Any Mermaid blocks valid (watch for semicolons in sequenceDiagram message text — they break the parser; use commas).\n` +
    `5) COVERAGE: >=40 questions, every subtopic represented, mixed difficulty, scenario-style questions present. Add if thin.\n\n` +
    `After fixing, return a one-line verdict: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
