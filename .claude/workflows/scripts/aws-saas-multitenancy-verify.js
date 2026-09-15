export const meta = {
  name: 'aws-saas-multitenancy-verify',
  description: 'Verify-only pass over the 5 already-authored AWS SaaS / multi-tenancy topics: fact-check against current AWS docs, fix schema, ensure trade-off coverage and answer-index balance — fix in place, do NOT regenerate from scratch',
  phases: [
    { title: 'Verify', detail: 'one agent per topic fact-checks + schema-checks + rebalances, fixes in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`

const TOPICS = [
  { slug: 'aws-saas-multitenancy-foundations', name: 'AWS SaaS and Multi-Tenancy Foundations' },
  { slug: 'aws-saas-isolation-patterns', name: 'AWS Tenant Isolation Architecture Patterns' },
  { slug: 'aws-saas-tenant-identity-and-routing', name: 'AWS SaaS Tenant Identity, Context and Routing' },
  { slug: 'aws-saas-data-partitioning', name: 'AWS SaaS Data Partitioning and Isolation' },
  { slug: 'aws-saas-metering-tiering-throttling', name: 'AWS SaaS Metering, Tiering, Throttling and Cost-per-Tenant' },
]

phase('Verify')
const results = await parallel(TOPICS.map((t) => () => agent(
  `You are a staff AWS SaaS solutions architect verifying ALREADY-AUTHORED AWS system-design interview ` +
  `content for "${t.name}" (slug: ${t.slug}). The files already exist and are good — your job is to ` +
  `verify and FIX IN PLACE, NOT to rewrite from scratch.\n\n` +
  `Read BOTH ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and fix:\n` +
  `1) FACTUAL/AWS-ACCURACY errors in concepts or MCQ answers/explanations — web-research anything ` +
  `uncertain. Verify service limits/quotas (AWS Organizations OU/account limits, VPCs-per-region=5 default, ` +
  `subnets-per-VPC=200, DynamoDB 400 KB item & ~3000 RCU/1000 WCU per partition, Cognito limits, RDS Proxy ` +
  `pooling, API Gateway usage-plan throttling), isolation-model semantics, Cognito/JWT tenant-context claims, ` +
  `Postgres RLS behavior, IAM session-policy/AssumeRole (session tags) scoping, cost-allocation-tag facts, ` +
  `and feature availability are CURRENT. A wrong 'answer' index or a trade-off/limit stated backwards is the ` +
  `worst defect — fix it.\n` +
  `2) TRADE-OFF COVERAGE: confirm concepts.md has explicit isolation-model / layer / service-selection ` +
  `trade-off treatment and that a healthy share of questions are scenario/trade-off/judgment style. If thin, ADD such questions.\n` +
  `3) SCHEMA: valid YAML; top-level topic/domain(system-design)/topic_slug(${t.slug})/version/questions; ` +
  `ids prefixed '${t.slug}-', unique, contiguous 3-digit from 001; difficulty in {beginner,intermediate,` +
  `advanced,expert} with all four represented; 3-5 options; 0-based in-range 'answer'; correct index NOT ` +
  `severely skewed (rebalance if one index dominates — e.g. spread across 0/1/2/3); every 'ref' anchor ` +
  `resolves to a real '## ' heading (no '/' or '&' in headings — rename with comma/"and" + fix refs). ` +
  `Ensure 'ref' values are QUOTED strings. Normalize list indentation to the repo's 2-space convention if ` +
  `it drifted. Verify any Mermaid blocks are valid (sequenceDiagram lines end with semicolons).\n` +
  `4) COVERAGE: 60-80 questions, every subtopic represented. If thin, ADD questions. Dedupe semantic repeats.\n\n` +
  `Return one line: "${t.slug}: <total> questions (<nBeg>/<nInt>/<nAdv>/<nExp>), <fixed|clean>, notes: ...".`,
  { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
)))

return results.filter(Boolean)
