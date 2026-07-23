export const meta = {
  name: 'aws-saas-multitenancy-repair',
  description: 'Repair the 3 topics left incomplete after transient API errors: author+verify questions.yaml for 2 topics that already have concepts.md (foundations, metering-tiering-throttling), and full research+author+verify for the 1 fully-missing topic (tenant identity and routing)',
  phases: [
    { title: 'Research', detail: 'research the one fully-missing topic' },
    { title: 'Author', detail: 'write missing questions.yaml / full topic from concepts.md + research' },
    { title: 'Verify', detail: 'fact-check + schema-check + trade-off coverage, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`

const SEED = `
This content is the AWS-SPECIFIC companion to the existing vendor-neutral core topic
"multi-tenancy-and-saas-isolation" (silo/pool/bridge, RLS, noisy neighbors) — do NOT duplicate that;
here everything is expressed in concrete AWS primitives and architectural patterns. It sits in the
"AWS System Design" group (aws- prefix) alongside sibling new topics aws-saas-isolation-patterns and
aws-saas-data-partitioning.

USER-PROVIDED ANCHOR ARTICLE (Nagarro, "Architectural Design Patterns for AWS multi-tenancy"):
six tenant-isolation architecture patterns along an isolation spectrum:
 1) Governance via AWS Organizations / OUs + consolidated billing; 2) Account-per-tenant silo;
 3) VPC-per-tenant in one account; 4) Subnet-level isolation in one VPC; 5) Container-layer (ECS/EKS
 namespaces + RBAC/IAM); 6) Data-layer isolation with four sub-models (instance / db-per-tenant via a
 tenant-map store / schema-per-tenant / shared-schema + tenant-id column).

Draw on the canonical AWS SaaS body of knowledge: Well-Architected SaaS Lens; AWS SaaS Factory
reference architectures & whitepapers; the control-plane vs application-plane model; SaaS Identity
(Cognito + JWT tenant claims); tenant routing & context propagation; onboarding/provisioning
automation; tier-based throttling & metering; per-tenant cost attribution; re:Invent SaaS talks.
`

const RESEARCH = `
RESEARCH FIRST (accuracy is critical — AWS features/limits change): use web search to gather CURRENT
material. Prioritize AWS Well-Architected SaaS Lens; AWS SaaS Factory whitepapers (SaaS identity,
tenant isolation strategies, tenant routing, control/application plane); AWS Prescriptive Guidance &
Architecture Center SaaS references; re:Invent SaaS deep-dive talks; and the Nagarro anchor article.
Cross-check concrete AWS facts (Cognito user-pool limits & JWT custom-claim mechanics; STS AssumeRole /
session-tags / session-policy scoping (2,048-char session policy); API Gateway custom domains & usage
plans; Route 53 / host- and path-based routing; DynamoDB as a tenant registry). Name the REAL
trade-offs an interviewer probes: pooled vs siloed identity, per-request AssumeRole cost/latency,
custom-domain limits, onboarding automation complexity. Produce STRUCTURED research notes (facts +
numbers, trade-off matrix, service choices, failure modes, decision guide, sources).
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write into ${DIR}/<topic-slug>/ the required file(s).

concepts.md (only if it does not already exist) — deep study content:
   - Begins with a single "# <Topic Name>" H1; one "## <Subtopic>" H2 per subtopic (MCQ anchor targets).
   - Heading text must NOT contain '/' or '&' (they break anchor slugs). Use commas / "and".
   - LAYERED depth: intuition -> how the AWS service(s)/pattern work -> real usage -> **TRADE-OFFS**.
     Dedicated "## Trade-offs and when to use what" section + trade-off reasoning throughout; state what
     you gain, give up, and WHEN to pick each option vs alternatives.
   - Mermaid diagrams (NOT ASCII) where they clarify; sequenceDiagram lines end with semicolons.
   - Service limits/quotas that matter; comparison tables (isolation / cost / ops / blast-radius / when);
     concrete numbers; failure modes (cross-tenant leak, noisy neighbor) and how the design degrades.
   - GitHub-alert callouts where useful: > [!TIP] > [!WARNING] > [!INTERVIEW] > [!KEY-TAKEAWAY].
   - Cross-reference (do not re-teach) siblings: core "multi-tenancy-and-saas-isolation", and aws-*
     deep dives (aws-security-iam-deep-dive, aws-security-kms-secrets-cognito-waf, aws-dynamodb-deep-dive,
     aws-networking-vpc-privatelink, aws-dns-cdn-route53-cloudfront, aws-cost-optimization-scaling).
   - End with "## Common interview follow-up questions" and "## References".

questions.yaml — the MCQ bank. Top-level keys:
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
         ref: "concepts.md#<anchor>"   # resolves to a real "## " heading in THIS topic's concepts.md

   RULES:
   - Produce 60-80 questions. Cover EVERY subtopic (every "## " heading of concepts.md) with several each.
   - ALL FOUR difficulties present: ~20% beginner, 30% intermediate, 30% advanced, 20% expert.
   - MANY questions must be TRADE-OFF / scenario / judgment style with LONG plausible options; exactly ONE
     best answer; distractors wrong for a specific reason. Include AWS-fact and cost/estimation questions.
   - 3-5 options, exactly one correct, 'answer' 0-based, VARY the correct index across the file (do NOT
     cluster answers at one index).
   - No "all/none of the above". Every 'ref' anchor resolves to a real "## " heading. id prefix = slug.
   - IMPORTANT: read the EXISTING concepts.md in the topic folder first and align anchors/content to it.

Use the Write tool. Return one line:
"<slug>: questions.yaml (<m> questions, all tiers)" (and "+ concepts.md (<n> subtopics)" if you wrote it).
`

// Two topics already have a complete concepts.md — only questions.yaml is missing.
const QUESTIONS_ONLY = [
  { slug: 'aws-saas-multitenancy-foundations', name: 'AWS SaaS and Multi-Tenancy Foundations' },
  { slug: 'aws-saas-metering-tiering-throttling', name: 'AWS SaaS Metering, Tiering, Throttling and Cost-per-Tenant' },
]

// One topic is fully missing — needs research -> concepts.md + questions.yaml.
const FULL = {
  slug: 'aws-saas-tenant-identity-and-routing', name: 'AWS SaaS Tenant Identity, Context and Routing',
  hints: 'SaaS identity on AWS: Amazon Cognito user pools for tenant users, mapping users->tenant (pooled pool with a tenant claim/custom attribute vs pool-per-tenant vs federated), injecting a TENANT CONTEXT into the JWT (tenant id + tier + role claims) and validating it; propagating tenant context end-to-end (API Gateway authorizer -> Lambda/service -> data layer) so every request is tenant-scoped; deriving scoped IAM credentials per request (STS AssumeRole with session tags / dynamic policy) so the data tier can only touch that tenant\'s data — "SaaS Identity" & "tenant isolation via IAM"; tenant ROUTING — routing a request to the right silo stack vs a shared pool (Route 53 / host-or-path-based routing / API Gateway custom domains / header-based routing / a routing/tenant-mapping service backed by DynamoDB); tenant ONBOARDING & PROVISIONING automation (control-plane workflow: create tenant record, provision resources for siloed tenants via CloudFormation/CDK/Service Catalog, seed pooled config, wire identity, set tier) and OFFBOARDING; the tenant registry/metadata store; trade-offs: pooled vs siloed identity, per-request AssumeRole cost/latency, custom-domain limits, onboarding automation complexity.',
}

function verifyPrompt(slug, name) {
  return (
    `You are a staff AWS SaaS solutions architect verifying AWS system-design interview content for ` +
    `"${name}" (slug: ${slug}).\n\n` +
    `Read BOTH ${DIR}/${slug}/concepts.md and ${DIR}/${slug}/questions.yaml and FIX IN PLACE:\n` +
    `1) FACTUAL/AWS-ACCURACY errors in concepts or MCQ answers/explanations — web-research anything ` +
    `uncertain. Verify service limits/quotas, Cognito/JWT tenant-context claims, STS AssumeRole / ` +
    `session-policy scoping, API Gateway usage-plan/custom-domain facts, cost-allocation-tag facts, and ` +
    `feature availability are CURRENT. A wrong 'answer' index or a trade-off/limit stated backwards is ` +
    `the worst defect — fix it.\n` +
    `2) TRADE-OFF COVERAGE: confirm a healthy share of questions are scenario/trade-off/judgment style. ` +
    `If thin, ADD such questions.\n` +
    `3) SCHEMA: valid YAML; top-level topic/domain(system-design)/topic_slug(${slug})/version/questions; ` +
    `ids prefixed '${slug}-', unique, contiguous 3-digit from 001; difficulty in {beginner,intermediate,` +
    `advanced,expert} with all four represented; 3-5 options; 0-based in-range 'answer'; correct index ` +
    `VARIED (not clustered at one index — redistribute by shuffling option text+index together if skewed); ` +
    `every 'ref' anchor resolves to a real '## ' heading (no '/' or '&' in headings). 'ref' values QUOTED. ` +
    `Mermaid sequenceDiagram lines end with semicolons.\n` +
    `4) COVERAGE: 60-80 questions, every subtopic represented. If thin, ADD questions. Dedupe repeats.\n` +
    `5) Run \`python ${REPO}/scripts/validate_content.py\` mentally against this file's rules; the id ` +
    `sequence must be contiguous with NO gaps and NO suffixed ids like '029b'.\n\n` +
    `Return one line: "${slug}: <total> questions (<nBeg>/<nInt>/<nAdv>/<nExp>), <fixed|clean>, notes: ...".`
  )
}

// --- Full topic: research -> author -> verify (runs concurrently with the questions-only repairs) ---
phase('Research')
const fullChain = (async () => {
  const research = await agent(
    `You are a principal AWS SaaS solutions architect researching authoritative, CURRENT material for ` +
    `"${FULL.name}" (slug: ${FULL.slug}) in the AWS System Design domain.\n\n${SEED}\n\n${RESEARCH}\n\n` +
    `FOCUS / subtopics this research must cover:\n${FULL.hints}\n\n` +
    `Return DETAILED structured research notes (facts, numbers, trade-off matrices, service choices, ` +
    `failure modes, decision guides, Sources). Do NOT write the final files.`,
    { label: `research:${FULL.slug}`, phase: 'Research', effort: 'high' }
  )
  await agent(
    `You are a principal AWS SaaS solutions architect and interview coach authoring deep, trade-off-` +
    `focused study material for "${FULL.name}" (slug: ${FULL.slug}) in a learner's interview-prep library ` +
    `(folder under topics/system-design/, domain slug "system-design"; renders in the "AWS System Design" ` +
    `group via the aws- prefix).\n\n${SEED}\n\n` +
    `Use these RESEARCH NOTES as your primary source (supplement with your own knowledge):\n\n` +
    `<<RESEARCH>>\n${research}\n<</RESEARCH>>\n\n` +
    `FOCUS / subtopics to cover:\n${FULL.hints}\n\n${SCHEMA}\n\n` +
    `Write BOTH concepts.md and questions.yaml now into ${DIR}/${FULL.slug}/ . Go deep, prioritize ` +
    `AWS-specific TRADE-OFFS and pooled-vs-siloed identity/routing selection, get facts right, 60-80 MCQs.`,
    { label: `author:${FULL.slug}`, phase: 'Author', effort: 'high' }
  )
  return agent(verifyPrompt(FULL.slug, FULL.name), { label: `verify:${FULL.slug}`, phase: 'Verify', effort: 'high' })
})()

// --- Questions-only repairs: author (from existing concepts.md) -> verify ---
const qChains = QUESTIONS_ONLY.map((t) => (async () => {
  await agent(
    `You are a principal AWS SaaS solutions architect and interview coach. The topic "${t.name}" ` +
    `(slug: ${t.slug}) in ${DIR}/${t.slug}/ ALREADY HAS a complete concepts.md but its questions.yaml is ` +
    `MISSING. FIRST read ${DIR}/${t.slug}/concepts.md carefully — note every "## " heading (these are your ` +
    `anchor targets and the subtopics to cover). Then author ONLY questions.yaml, aligned to that ` +
    `concepts.md.\n\n${SEED}\n\n${SCHEMA}\n\n` +
    `Write questions.yaml now into ${DIR}/${t.slug}/ (do NOT modify concepts.md). 60-80 MCQs, all tiers, ` +
    `heavy trade-off/scenario coverage, answer index VARIED, every ref anchor resolving to a real heading.`,
    { label: `author:${t.slug}`, phase: 'Author', effort: 'high' }
  )
  return agent(verifyPrompt(t.slug, t.name), { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' })
})())

const results = await parallel([() => fullChain, ...qChains.map((c) => () => c)])
return results.filter(Boolean)
