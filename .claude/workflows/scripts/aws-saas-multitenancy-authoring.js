export const meta = {
  name: 'aws-saas-multitenancy-authoring',
  description: 'Research + author deep, trade-off-focused concepts.md + a large all-tier MCQ questions.yaml for 5 new AWS SaaS / multi-tenancy architecture topics (foundations, the 6 isolation architecture patterns, tenant identity & routing, data partitioning, metering/tiering/throttling) into the AWS System Design group, then verify',
  phases: [
    { title: 'Research', detail: 'one agent per topic gathers current AWS SaaS Factory / SaaS Lens / re:Invent material into structured notes' },
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml from the research' },
    { title: 'Verify', detail: 'fact-check + schema-check + trade-off coverage, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`

// Seed context: the article the user anchored on, plus the canonical AWS SaaS body of knowledge.
const SEED = `
This content is the AWS-SPECIFIC companion to the existing vendor-neutral core topic
"multi-tenancy-and-saas-isolation" (silo/pool/bridge, RLS, noisy neighbors) — do NOT duplicate that;
here everything is expressed in concrete AWS primitives and architectural patterns.

USER-PROVIDED ANCHOR ARTICLE (Nagarro, "Architectural Design Patterns for AWS multi-tenancy"):
it enumerates SIX tenant-isolation architecture patterns along an isolation spectrum:
 1) Governance model via AWS Organizations / OUs + consolidated billing (max isolation, OU limits, premium tenants).
 2) Account-per-tenant (full silo; complete separation & per-tenant billing; loses volume discounts, mgmt overhead).
 3) VPC-per-tenant within one account (logical isolation; watch per-region VPC limits; reserved-instance utilization).
 4) Subnet-level isolation in a single VPC (own public/private subnets, no VPC peering; tedious NACL/SG mgmt; shared DHCP/VPC settings affect all).
 5) Container-layer isolation (ECS/EKS namespaces, RBAC/IAM, SELinux; extensible, but shared worker nodes widen attack surface; cross-namespace traffic risk; database-per-service).
 6) Data-layer isolation with four sub-models in a 3-tier app: (a) full instance isolation, (b) single instance + separate databases via a metadata/tenant-map store (e.g. DynamoDB), (c) single database + separate tables/schemas, (d) single database + shared schema with a tenant-id column (pool; best economies of scale, shared attack surface).

GO BEYOND the article using the canonical AWS SaaS body of knowledge: the AWS Well-Architected
SaaS Lens; AWS SaaS Factory reference architectures & whitepapers ("SaaS Architecture Fundamentals",
"SaaS Tenant Isolation Strategies", "SaaS Storage Strategies", "Multi-tenant SaaS on EKS/serverless");
the control-plane vs application-plane model; tenant context / SaaS Identity (Cognito + JWT tenant claims,
"pooled" identity); tenant routing & context propagation; tenant onboarding/provisioning automation;
tier-based throttling & metering; per-tenant cost attribution (cost allocation tags, AWS Cost & Usage
Report); noisy-neighbor mitigation; and relevant re:Invent SaaS talks (ARC/SVS/SAS tracks).
`

const RESEARCH = `
RESEARCH FIRST (accuracy is critical — AWS features/limits change): use web search to gather CURRENT,
accurate material. Prioritize: AWS Well-Architected SaaS Lens; AWS SaaS Factory content & whitepapers
(tenant isolation strategies, storage strategies, control plane / application plane, SaaS identity,
tenant routing); the AWS Prescriptive Guidance & Architecture Center SaaS reference architectures;
relevant re:Invent deep-dive talks; and the user-anchor Nagarro article for the 6-pattern framing.
Cross-check concrete AWS facts that constrain SaaS designs (e.g. AWS Organizations OU/account soft
limits; default VPCs per region = 5, subnets per VPC = 200, SGs & rules limits; ECS/EKS namespace &
node constraints; DynamoDB 400 KB item, ~3000 RCU/1000 WCU per partition; Cognito user-pool limits;
RDS/Aurora connection limits & RDS Proxy for pooling; API Gateway usage plans/throttling; Postgres RLS).
Name the REAL trade-offs an interviewer probes: isolation strength vs cost vs operational complexity;
silo vs pool vs bridge PER LAYER (compute/network/data/identity); blast radius & noisy neighbors;
per-tenant cost attribution; onboarding automation cost. Produce STRUCTURED research notes (not prose):
key facts + numbers, the trade-off matrix, service choices, failure modes, and the sources you used.
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md — deep study content:
   - Begins with a single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (these are the MCQ anchor targets — keep them stable).
   - IMPORTANT: heading text must NOT contain '/' or '&' (they break anchor slugs). Use commas / "and".
   - LAYERED depth: intuition -> how the AWS service(s)/pattern work -> real-world usage -> **TRADE-OFFS**.
     Trade-offs are the single most important thing in a system-design interview — for EVERY design
     choice (which isolation model, which layer, which service, which config) explicitly state what you
     gain, what you give up, and WHEN to pick it vs the alternative. Include a dedicated
     "## Trade-offs and when to use what" style section, and weave trade-off reasoning throughout.
   - Use Mermaid diagrams for architecture (NOT ASCII) where a diagram clarifies (fenced with \`\`\`mermaid).
     In any sequenceDiagram, end statements with semicolons to match repo render conventions.
   - Include: the AWS service limits/quotas that matter for the pattern; comparison tables (model A vs B
     vs C with columns for isolation strength / cost / ops burden / blast radius / when to use); concrete
     numbers; failure modes (cross-tenant leak, noisy neighbor, blast radius) and how the design degrades.
   - Use GitHub-alert callouts where useful: > [!TIP], > [!WARNING], > [!INTERVIEW], > [!KEY-TAKEAWAY].
   - Cross-reference (do not re-teach) sibling topics: the vendor-neutral core
     "multi-tenancy-and-saas-isolation", plus relevant aws-* deep dives (aws-security-iam-deep-dive,
     aws-dynamodb-deep-dive, aws-databases-rds-aurora, aws-networking-vpc-privatelink,
     aws-containers-ecs-eks, aws-security-kms-secrets-cognito-waf, aws-cost-optimization-scaling).
   - End with "## Common interview follow-up questions" and "## References" (list the actual AWS SaaS
     Lens / SaaS Factory whitepapers / re:Invent talks / Nagarro article you used).

2) questions.yaml — the MCQ bank. Top-level keys:
     topic: "<Topic Name>"
     domain: system-design
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001    # unique, zero-padded 3-digit seq from 001, prefix = topic-slug
         difficulty: intermediate  # beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options:
           - "<option 0>"
           - "<option 1>"
           - "<option 2>"
           - "<option 3>"
         answer: 2                # 0-BASED index of the correct option
         explanation: |
           <why correct; and WHY the distractors are wrong / what trade-off or AWS fact they miss>
         ref: "concepts.md#<anchor>"   # resolves to a real "## " heading (GitHub slug rules)

   RULES:
   - Produce 60-80 questions. Cover EVERY subtopic with several questions each.
   - ALL FOUR difficulties present: roughly 20% beginner, 30% intermediate, 30% advanced, 20% expert.
   - MANY questions must be TRADE-OFF / scenario / judgment questions: "Given <constraints: tenant count,
     isolation/compliance requirement, budget, blast-radius tolerance, ops maturity>, which AWS isolation
     model is most appropriate and why?", "What is the PRIMARY trade-off of account-per-tenant vs a pooled
     shared-schema model?", "Which cross-tenant failure does this design NOT prevent?", "Which AWS limit
     will this per-tenant-VPC design hit first?". Use LONG, plausible, descriptive options (each a
     defensible-sounding AWS design) so the learner reasons about trade-offs, not keyword-matches. Exactly
     ONE best answer; distractors wrong for a specific reason.
   - Include some AWS-fact questions (limits, Cognito/JWT tenant context, RLS, cost tags) AND cost/estimation questions.
   - 3-5 options, exactly one correct, 'answer' 0-based, VARY the correct index across the file.
   - No "all/none of the above". Every 'ref' anchor resolves to a real "## " heading. id prefix = slug.

Use the Write tool to create both files. Return one line:
"<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions, all tiers)".
`

const TOPICS = [
  { slug: 'aws-saas-multitenancy-foundations', name: 'AWS SaaS and Multi-Tenancy Foundations',
    hints: 'what multi-tenancy means on AWS and why SaaS providers choose it (cost/operational leverage vs isolation risk); the isolation SPECTRUM from fully-siloed to fully-pooled and everything between (bridge); the silo/pool/bridge models mapped to AWS at EACH layer (compute, network, data, identity) — you rarely pick one model for the whole stack; the CONTROL PLANE vs APPLICATION PLANE split (shared control plane for onboarding/identity/metering/billing/admin; per-tenant or pooled application plane) and why it is the central SaaS architecture idea; the AWS Well-Architected SaaS Lens and its design themes; single-tenant vs multi-tenant vs "SaaS but siloed" trade-offs; B2B vs B2C tenant definition and how it drives everything; tenant lifecycle overview (onboard/provision/operate/offboard); the three-way isolation vs cost vs operational-complexity trade-off as the through-line.' },
  { slug: 'aws-saas-isolation-patterns', name: 'AWS Tenant Isolation Architecture Patterns',
    hints: 'the SIX isolation architecture patterns along the spectrum, each with deep AWS trade-offs, limits, blast radius, and when to use: (1) GOVERNANCE model — AWS Organizations, OUs, consolidated billing, SCPs, cross-account sharing (max isolation, OU/account soft limits, premium/regulated tenants, complex shared-service deps); (2) ACCOUNT-PER-TENANT silo — full separation, per-tenant billing & blast-radius, account-vending/Control Tower automation, loses volume discounts, mgmt overhead & account-limit ceiling; (3) VPC-PER-TENANT in one account — logical isolation, per-region VPC limit (default 5, raisable), reserved-instance utilization, peering/TGW to shared services; (4) SUBNET-LEVEL isolation in one VPC — own public/private subnets, no peering needed, tedious NACL/SG sprawl, shared DHCP/route/VPC settings affect all tenants; (5) CONTAINER-LAYER — ECS/EKS namespaces + RBAC/IAM + network policies + SELinux, extensible/cheap, but shared worker nodes widen attack surface, cross-namespace traffic a risk, node-level noisy neighbors; (6) DATA-LAYER — pooled compute with data separated (covered in depth in the data-partitioning topic, summarize + cross-ref). For EACH: isolation strength, cost, ops burden, blast radius, onboarding automation, and the deciding constraint (compliance, tenant count, tier). Include a master comparison matrix and a decision guide.' },
  { slug: 'aws-saas-tenant-identity-and-routing', name: 'AWS SaaS Tenant Identity, Context and Routing',
    hints: 'SaaS identity on AWS: Amazon Cognito user pools for tenant users, mapping users->tenant (pooled pool with a tenant claim/custom attribute vs pool-per-tenant vs federated), injecting a TENANT CONTEXT into the JWT (tenant id + tier + role claims) and validating it; propagating tenant context end-to-end (API Gateway authorizer -> Lambda/service -> data layer) so every request is tenant-scoped; deriving scoped IAM credentials per request (STS AssumeRole with session tags / dynamic policy) so the data tier can only touch that tenant\'s data — "SaaS Identity" & "tenant isolation via IAM"; tenant ROUTING — routing a request to the right silo stack vs a shared pool (Route 53 / host-or-path-based routing / API Gateway custom domains / header-based routing / a routing/tenant-mapping service backed by DynamoDB); tenant ONBOARDING & PROVISIONING automation (control-plane workflow: create tenant record, provision resources for siloed tenants via CloudFormation/CDK/Service Catalog, seed pooled config, wire identity, set tier) and OFFBOARDING; the tenant registry/metadata store; trade-offs: pooled vs siloed identity, per-request AssumeRole cost/latency, custom-domain limits, onboarding automation complexity.' },
  { slug: 'aws-saas-data-partitioning', name: 'AWS SaaS Data Partitioning and Isolation',
    hints: 'the data-layer isolation sub-models in depth and how to enforce them on AWS: (a) full INSTANCE isolation (db-per-tenant on its own RDS/Aurora instance or dedicated DynamoDB tables) — strongest, costliest, hard to scale to many tenants; (b) single instance + SEPARATE DATABASES/tables per tenant addressed via a tenant->resource MAP in a metadata store (DynamoDB) ; (c) single database + separate SCHEMAS/tables per tenant; (d) single database + SHARED SCHEMA with a tenant_id partition/discriminator column (pool — best economies of scale, biggest leak risk). DynamoDB pooled partitioning (tenant id as partition-key prefix, per-tenant item-collection limits, leading-key design, avoiding hot tenants); RDS/Aurora pooled with POSTGRES ROW-LEVEL SECURITY as an enforcement backstop and connection pooling via RDS Proxy; S3 tenant data (prefix-per-tenant + IAM/session policy scoping vs bucket-per-tenant); ENFORCING isolation with scoped IAM/session policies & the dynamic policy pattern; the #1 catastrophic failure — CROSS-TENANT DATA LEAK (forgot tenant filter / wrong cache key / GSI without tenant scope) and defense in depth to prevent it; per-tenant encryption (KMS key-per-tenant vs shared); backup/restore/export per tenant; noisy-neighbor at the data tier (hot partitions, shared connection pool); trade-off matrix of the sub-models (isolation, cost, ops, migration/rollback, "tenant-aware app" refactor cost).' },
  { slug: 'aws-saas-metering-tiering-throttling', name: 'AWS SaaS Metering, Tiering, Throttling and Cost-per-Tenant',
    hints: 'operating a multi-tenant system fairly and profitably on AWS: the NOISY-NEIGHBOR problem in pooled models and mitigations (per-tenant quotas, throttling, bulkheads, tier-based capacity); TIERING (basic/standard/premium/enterprise) and how tiers map to isolation & capacity (e.g. premium -> siloed stack, basic -> pooled), tier as a JWT claim driving runtime behavior; tier-based THROTTLING & rate limiting (API Gateway usage plans & API keys per tenant/tier, token-bucket per tenant, WAF rate rules, application-level quotas backed by DynamoDB/ElastiCache); tenant METERING — capturing per-tenant usage/consumption events for billing and insight (fine-grained usage events -> Kinesis/Firehose -> S3/analytics; aggregation), metering for usage-based billing; per-tenant COST ATTRIBUTION — the hard problem of "what does each tenant cost me" in a pooled model (cost allocation tags & AWS Cost & Usage Report for siloed resources; proxy metrics / consumption-based apportionment for shared/pooled resources; tenant-aware CloudWatch metrics & dashboards); tenant health/operations dashboards; guardrails to protect the pool (circuit breakers, load shedding by tier); trade-offs: metering granularity vs cost/overhead, strict quotas vs elasticity, pooled cost-attribution accuracy vs effort.' },
]

phase('Research')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a principal AWS SaaS solutions architect researching authoritative, CURRENT material for the ` +
    `interview-prep topic "${t.name}" (slug: ${t.slug}) in the AWS System Design domain.\n\n` +
    `${SEED}\n\n${RESEARCH}\n\n` +
    `FOCUS / subtopics this research must cover:\n${t.hints}\n\n` +
    `Return DETAILED structured research notes (facts, numbers, trade-off matrices, service choices, ` +
    `failure modes, decision guides, and a "Sources" list) that a downstream author will turn into deep ` +
    `study content. Do NOT write the final files — just the research notes.`,
    { label: `research:${t.slug}`, phase: 'Research', effort: 'high' }
  ),
  (research, t) => agent(
    `You are a principal AWS SaaS solutions architect and system-design interview coach authoring deep, ` +
    `trade-off-focused study material for "${t.name}" (slug: ${t.slug}) in a learner's interview-prep ` +
    `library. This is the AWS System Design sub-domain (folder under topics/system-design/, domain slug ` +
    `"system-design"; these topics render inside the "AWS System Design" group via the aws- prefix).\n\n` +
    `${SEED}\n\n` +
    `Use these RESEARCH NOTES as your primary source (supplement with your own knowledge; the facts here ` +
    `were gathered against current AWS docs):\n\n<<RESEARCH>>\n${research}\n<</RESEARCH>>\n\n` +
    `FOCUS / subtopics to cover:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . Go deep, prioritize AWS-specific TRADE-OFFS and ` +
    `isolation-model selection, get service limits/facts right, aim high on MCQ count (60-80).`,
    { label: `author:${t.slug}`, phase: 'Author', effort: 'high' }
  ),
  (authorSummary, t) => agent(
    `You are a staff AWS SaaS solutions architect verifying AWS system-design interview content for ` +
    `"${t.name}" (slug: ${t.slug}).\n\n` +
    `Read BOTH ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and FIX IN PLACE:\n` +
    `1) FACTUAL/AWS-ACCURACY errors in concepts or MCQ answers/explanations — web-research anything ` +
    `uncertain. Verify service limits/quotas, isolation-model semantics, Cognito/JWT tenant-context claims, ` +
    `Postgres RLS behavior, IAM session-policy/AssumeRole scoping, cost-allocation-tag facts, and feature ` +
    `availability are CURRENT. A wrong 'answer' index or a trade-off/limit stated backwards is the worst ` +
    `defect — fix it.\n` +
    `2) TRADE-OFF COVERAGE: confirm concepts.md has explicit isolation-model / layer / service-selection ` +
    `trade-off treatment and that a healthy share of questions are scenario/trade-off/judgment style. If ` +
    `thin, ADD such questions.\n` +
    `3) SCHEMA: valid YAML; top-level topic/domain(system-design)/topic_slug(${t.slug})/version/questions; ` +
    `ids prefixed '${t.slug}-', unique, contiguous 3-digit from 001; difficulty in {beginner,intermediate,` +
    `advanced,expert} with all four represented; 3-5 options; 0-based in-range 'answer'; correct index ` +
    `VARIED; every 'ref' anchor resolves to a real '## ' heading (no '/' or '&' in headings — rename with ` +
    `comma/"and" + fix refs). Ensure 'ref' values are QUOTED strings. Verify Mermaid blocks are valid ` +
    `(sequenceDiagram lines end with semicolons).\n` +
    `4) COVERAGE: 60-80 questions, every subtopic represented. If thin, ADD questions. Dedupe semantic ` +
    `repeats by rewriting.\n\n` +
    `Return one line: "${t.slug}: <total> questions (<nBeg>/<nInt>/<nAdv>/<nExp>), <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
