export const meta = {
  name: 'cloud-computing-patterns-authoring',
  description: 'Author the Cloud Computing Patterns group (ccp-*) in system-design: 8 topics covering all 74 vendor-neutral patterns from Fehling/Leymann/Retter "Cloud Computing Patterns" (cloudcomputingpatterns.org). Research -> author -> verify with a completeness gate.',
  phases: [
    { title: 'Author', detail: 'one agent per topic: research the patterns + write concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'completeness gate (all patterns present) + fact-check + cross-ref check + schema, fix in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`

const SCOPE = `
SOURCE — "Cloud Computing Patterns" by Christoph Fehling, Frank Leymann, Ralph Retter, Walter
Schupeck, Peter Arbitter (Springer, 2014), catalogued at https://www.cloudcomputingpatterns.org/ .
This is a VENDOR-NEUTRAL, technology-independent pattern language (74 patterns / 5 categories) — the
abstract solutions that underpin cloud-native design regardless of AWS/Azure/GCP. We are adding it as
a new "Cloud Computing Patterns" group (ccp- prefix) in the system-design domain, alongside the
existing Design Patterns (dp-) and Architectural Patterns (arch-) groups.

FRAMING (important):
- Teach each pattern the way the book does: the INTENT (usually a "How can ...?" question), the
  CONTEXT/problem, the SOLUTION (abstract mechanism), and the RELATED patterns. Then add a short,
  MODERN "how this shows up today" note — concrete managed-service or framework examples across
  clouds (e.g. Elastic Load Balancer -> ALB/NLB, Azure LB, GCP LB; Message-oriented Middleware ->
  SQS/SNS, Kafka, Azure Service Bus, Pub/Sub) — WITHOUT turning it into an AWS-only lesson.
- These are ABSTRACT patterns, not product tutorials. Keep the vendor-neutral altitude; mention
  products only as illustrations.

BOUNDARY RULES (STRICT — this library already has deep coverage; CROSS-REFERENCE, do NOT re-teach):
- system-design core already owns: capacity-modeling-and-tail-latency (workload/capacity), cap-theorem-
  and-consistency (strict vs eventual consistency), scalability-and-load-balancing (elasticity, LB),
  message-queues-and-async + event-driven-cqrs-saga-cdc (messaging middleware, delivery), caching-and-cdn
  (CDN, cache), databases-sql-nosql-sharding-replication (relational/key-value/replication/sharding),
  resilience-tradeoffs-deep-dive + failure-theory-advanced (watchdog/resiliency), multi-tenancy-and-saas-
  isolation (tenant isolation), microservices-* (distributed application/loose coupling).
- The AWS group (aws-*) owns provider-specific depth (aws-load-balancing-elb-autoscaling,
  aws-storage-*, aws-messaging-sqs-sns-eventbridge, aws-migration-modernization for hybrid, etc.).
- reliability-ops owns operational resilience/elasticity PROCESS depth. messaging-databases owns
  DB/broker mechanism internals.
For any pattern that overlaps, give the PATTERN-LEVEL treatment (intent/solution/trade-off + the
pattern vocabulary) and add "Deep dive: see <domain>/<topic>" — do NOT duplicate the deep-dive content.

Ground every pattern's intent/solution in the cloudcomputingpatterns.org page for that pattern and
the book; verify the modern-equivalent examples are accurate.
`

const SCHEMA = `
CONTENT CONTRACT (follow exactly). Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1 + a short intro naming the source (Fehling et al., cloudcomputingpatterns.org)
     and the cross-reference boundary note.
   - "## <Pattern Name>" H2 PER PATTERN in this topic's assigned list (these are the MCQ anchor targets —
     use the exact pattern name as the heading). For EACH pattern: the INTENT (the "How can...?" question or
     one-line intent), the PROBLEM/CONTEXT, the SOLUTION (abstract mechanism), a "Modern equivalent" line
     (cross-cloud product/framework illustrations), TRADE-OFFS / when-to-use, and "Related patterns" +
     any "Deep dive: see <domain>/<topic>" cross-ref for overlaps.
   - You MAY group very closely related patterns under one H2 with sub-bullets IF it reads better, but
     every assigned pattern MUST be covered by name and findable. Prefer one H2 per pattern.
   - Where a diagram clarifies (a workload curve, a loose-coupling broker, a tiered/hybrid architecture,
     an elasticity control loop), use a \`\`\`mermaid fenced block (flowchart/graph). NO ASCII-art.
     CRITICAL: no semicolons in sequenceDiagram message text (use commas); QUOTE any flowchart node
     label containing "(" ")" or "?" e.g. A["Elastic Queue (SQS/Service Bus)"].
   - End with "## Common Interview Follow-ups" and "## References" (cite the book + cloudcomputingpatterns.org).

2) questions.yaml — top-level keys:
     topic: "<Topic Name>"
     domain: system-design
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
           <why correct; teach the pattern>
         ref: "concepts.md#<anchor>"  # resolves to a real "## " heading (GitHub slug rules)

   RULES: aim for 40-60 MCQs per topic. Focus on: PATTERN INTENT ("which pattern solves X?"),
   PATTERN SELECTION scenarios ("given this requirement, which pattern fits?"), TRADE-OFFS &
   distinctions between sibling patterns (e.g. Strict vs Eventual Consistency; At-least-once vs
   Exactly-once vs Timeout-based delivery; Stateful vs Stateless Component; Public/Private/Community/
   Hybrid Cloud; Node- vs Environment-based Availability), and the modern-equivalent mapping. 3-5 options,
   exactly one correct, 0-based answer; VARY the correct index (no single index >40%, no guessable cycle);
   mixed difficulty; scenario items preferred; distractors are plausible sibling patterns (a great
   distractor is a real but wrong-for-this-scenario pattern); no all/none-of-the-above; every 'ref'
   resolves to a real "## " heading; id prefix == slug. Quote any YAML option with a colon+space or leading brace.

Do your own web research on cloudcomputingpatterns.org for each assigned pattern to get its intent/
solution right. Use the Write tool. Return:
"<slug>: concepts.md (<n> patterns) + questions.yaml (<m> questions), patterns covered: <comma list>".
`

// 8 topics; each lists the EXACT patterns it must cover (completeness gate checks these).
const TOPICS = [
  {
    slug: 'ccp-fundamentals-workloads-models',
    name: 'Cloud Computing Fundamentals: Workloads & Service/Deployment Models',
    patterns: ['Static Workload', 'Periodic Workload', 'Once-in-a-lifetime Workload', 'Unpredictable Workload', 'Continuously Changing Workload', 'Infrastructure as a Service (IaaS)', 'Platform as a Service (PaaS)', 'Software as a Service (SaaS)', 'Public Cloud', 'Private Cloud', 'Community Cloud', 'Hybrid Cloud'],
    hints: "The 5 WORKLOAD patterns (utilization-over-time shapes that justify cloud elasticity: Static=flat; Periodic=predictable spikes e.g. payroll; Once-in-a-lifetime=one-off spike e.g. a launch; Unpredictable=random/viral; Continuously Changing=trend growth/shrink) — a workload curve diagram is ideal; cross-ref capacity-modeling-and-tail-latency for the capacity math. The 3 SERVICE MODELS (IaaS/PaaS/SaaS — what the provider vs you manage, the classic responsibility-split). The 4 DEPLOYMENT MODELS (Public/Private/Community/Hybrid — NIST-aligned, tenancy/control/cost trade-offs). Teach the intent + when each fits + modern examples per cloud." },
  {
    slug: 'ccp-offerings-compute-elasticity',
    name: 'Cloud Offerings: Compute, Elasticity & Processing',
    patterns: ['Elastic Infrastructure', 'Elastic Platform', 'Node-based Availability', 'Environment-based Availability', 'Hypervisor', 'Execution Environment', 'Map Reduce'],
    hints: "The compute/elasticity offering patterns: Elastic Infrastructure (IaaS with programmatic provisioning + monitoring, the substrate for autoscaling) vs Elastic Platform (PaaS-managed elastic runtime); Node-based Availability (SLA on the individual VM/node) vs Environment-based Availability (SLA on the whole platform/environment, not individual nodes — a key distinction); Hypervisor (virtualization of physical hardware into VMs) vs Execution Environment (the managed runtime hosting components); Map Reduce (data-local parallel processing over large datasets — cross-ref realtime-streaming-systems / aws analytics for the modern deep dive). Modern equivalents (EC2/ASG, Fargate/App Service, EMR/Dataproc). Cross-ref scalability-and-load-balancing." },
  {
    slug: 'ccp-offerings-storage-data-communication',
    name: 'Cloud Offerings: Storage, Data & Communication',
    patterns: ['Block Storage', 'Blob Storage', 'Relational Database', 'Key-Value Storage', 'Strict Consistency', 'Eventual Consistency', 'Virtual Networking', 'Message-oriented Middleware', 'Exactly-once Delivery', 'At-least-once Delivery', 'Transaction-based Delivery', 'Timeout-based Delivery'],
    hints: "Storage patterns: Block Storage (network-attached disk, EBS/Azure Disk) vs Blob Storage (object store, S3/Blob/GCS) vs Relational Database vs Key-Value Storage (the data-model trade-offs — cross-ref databases-sql-nosql-sharding-replication). CONSISTENCY: Strict vs Eventual Consistency (the CAP trade-off at the offering level — cross-ref cap-theorem-and-consistency, DO NOT re-derive CAP). Virtual Networking (software-defined networks/VPC). Message-oriented Middleware (async broker — cross-ref message-queues-and-async). The 4 DELIVERY patterns are the meaty distinction: Exactly-once (hard, dedup) vs At-least-once (retries + idempotency) vs Transaction-based (transactional read/consume) vs Timeout-based (visibility-timeout redelivery, e.g. SQS) — teach when each is achievable + the idempotency implication. Modern examples per cloud." },
  {
    slug: 'ccp-architecture-components-coupling',
    name: 'Cloud Application Architectures: Components & Coupling',
    patterns: ['Loose Coupling', 'Distributed Application', 'Stateless Component', 'User Interface Component', 'Processing Component', 'Batch Processing Component', 'Data Access Component', 'Data Abstractor', 'Idempotent Processor', 'Transaction-based Processor', 'Timeout-based Message Processor'],
    hints: "How to decompose a cloud app into scalable components. Loose Coupling (broker/intermediary between components — cross-ref message-queues, microservices) + Distributed Application (composed of independent components). The COMPONENT TYPES: Stateless Component (no session state -> horizontally scalable — the key enabler; cross-ref scalability), User Interface Component, Processing Component, Batch Processing Component (async bulk), Data Access Component, Data Abstractor (hides/abstracts eventually-consistent or sharded data). The PROCESSOR patterns for reliable message handling: Idempotent Processor (dedup / at-least-once safety), Transaction-based Processor (transactional consume), Timeout-based Message Processor (process-within-visibility-timeout). Emphasize statelessness + idempotency as cloud-native cornerstones. Modern examples." },
  {
    slug: 'ccp-architecture-state-tenancy-integration',
    name: 'Cloud Application Architectures: State, Multi-Tenancy & Integration',
    patterns: ['Stateful Component', 'Multi-Component Image', 'Shared Component', 'Tenant-isolated Component', 'Dedicated Component', 'Restricted Data Access Component', 'Message Mover', 'Application Component Proxy', 'Compliant Data Replication', 'Integration Provider'],
    hints: "State + multi-tenancy + integration patterns. Stateful Component (where state must live — externalize to storage, the counterpoint to Stateless). Multi-Component Image (packaging multiple components in one image — trade-off vs single-purpose). MULTI-TENANCY spectrum: Shared Component (all tenants share, cheapest, weakest isolation) vs Tenant-isolated Component (logical isolation per tenant) vs Dedicated Component (physical isolation, strongest, priciest) — cross-ref multi-tenancy-and-saas-isolation for the deep dive; give the pattern-level isolation/cost trade-off. Restricted Data Access Component (enforce per-tenant/per-user data filters). INTEGRATION: Message Mover (relay messages across queues/environments), Application Component Proxy (expose an internal component safely), Compliant Data Replication (replicate data while respecting legal/compliance constraints — cross-ref data residency), Integration Provider (a middleman offering integration as a service). Modern examples." },
  {
    slug: 'ccp-management-elasticity-resiliency',
    name: 'Cloud Application Management: Elasticity & Resiliency Processes',
    patterns: ['Provider Adapter', 'Managed Configuration', 'Elasticity Manager', 'Elastic Load Balancer', 'Elastic Queue', 'Watchdog', 'Elasticity Management Process', 'Feature Flag Management Process', 'Update Transition Process', 'Standby Pooling Process', 'Resiliency Management Process'],
    hints: "The management/runtime-control patterns. Provider Adapter (abstract provider APIs for portability — anti-lock-in). Managed Configuration (externalized, remotely-updatable config — cross-ref feature flags). The ELASTICITY components: Elasticity Manager (scale on utilization metrics), Elastic Load Balancer (distribute + scale behind an LB — cross-ref scalability + aws-load-balancing), Elastic Queue (scale workers on queue depth — the queue-based load-leveling pattern). Watchdog (health-monitor + auto-recover — cross-ref reliability-ops/redundancy + resilience). The management PROCESSES: Elasticity Management Process, Feature Flag Management Process (progressive rollout/toggles), Update Transition Process (rolling/blue-green update flow — cross-ref devops deployment-strategies), Standby Pooling Process (warm pools to cut scale-up latency — cross-ref reliability-ops capacity), Resiliency Management Process (detect+recover loop — cross-ref reliability-ops). Give a control-loop diagram. Modern examples." },
  {
    slug: 'ccp-composite-tiers-cdn',
    name: 'Composite Cloud Applications: Tiers & CDN',
    patterns: ['Two-Tier Cloud Application', 'Three-Tier Cloud Application', 'Content Distribution Network'],
    hints: "How the atomic patterns compose into whole application topologies. Two-Tier Cloud Application (presentation+logic in one tier over a data tier — simple, when it fits) vs Three-Tier Cloud Application (presentation / business-logic / data tiers separated and independently scaled — the classic scalable web architecture; each tier maps to the component patterns from the architecture topics). Content Distribution Network (edge-cache static/streaming content near users — cross-ref caching-and-cdn + aws-dns-cdn for the deep dive; give the pattern intent + when a CDN is the right composition). This is a smaller topic (3 patterns) so go DEEPER on each: full tier diagrams, scaling each tier independently, where state lives, and how the offering/architecture patterns plug in. Modern examples (CloudFront/Akamai/Fastly/Cloudflare). Aim for the lower end 40 MCQs given fewer patterns, heavy on composition scenarios." },
  {
    slug: 'ccp-composite-hybrid',
    name: 'Composite Cloud Applications: Hybrid Cloud Architectures',
    patterns: ['Hybrid User Interface', 'Hybrid Processing', 'Hybrid Data', 'Hybrid Backup', 'Hybrid Backend', 'Hybrid Application Functions', 'Hybrid Multimedia Web Application', 'Hybrid Development Environment'],
    hints: "The HYBRID CLOUD composition patterns — split an application across private+public (or on-prem+cloud) for cost/compliance/burst reasons. Hybrid User Interface (UI tier in one environment), Hybrid Processing (burst compute to public cloud — cloud bursting), Hybrid Data (keep sensitive data private, rest public — data residency/compliance driver), Hybrid Backup (back up on-prem to cloud — cross-ref reliability-ops DR), Hybrid Backend (backend split), Hybrid Application Functions (function-level split), Hybrid Multimedia Web Application (media served hybrid), Hybrid Development Environment (dev/test in cloud, prod on-prem or vice versa). Each is 'which PART lives where, and why' — teach the driver (compliance/cost/latency/burst) that picks each split. Cross-ref aws-migration-modernization + Hybrid Cloud (from the fundamentals topic). A hybrid split diagram is ideal. Modern examples (Outposts/Anthos/Arc, VPN/DirectConnect)." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a cloud architect and pattern-language expert authoring a topic in the "Cloud Computing Patterns" group of a system-design interview library.\n\n` +
    `${SCOPE}\n\n` +
    `THIS TOPIC: "${t.name}" (slug: ${t.slug}).\n` +
    `PATTERNS YOU MUST COVER (every one, by name, as a "## " heading — this is a completeness requirement):\n${t.patterns.map((p) => `  - ${p}`).join('\n')}\n\n` +
    `TOPIC GUIDANCE:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Research each pattern on cloudcomputingpatterns.org, then write the two files into ${DIR}/${t.slug}/ . Cover ALL listed patterns; cross-reference (don't duplicate) existing deep-dives; keep the vendor-neutral pattern altitude with modern cross-cloud examples; 40-60 MCQs weighted to pattern-intent + pattern-selection scenarios + sibling-pattern distinctions.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer (cloud architect + interviewer) verifying a "Cloud Computing Patterns" topic "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE}\n\n` +
    `Files: ${DIR}/${t.slug}/concepts.md and questions.yaml . Read BOTH. Check and FIX IN PLACE:\n` +
    `1) COMPLETENESS GATE (critical): EVERY one of these patterns MUST be covered by name as a "## " heading (or clearly as a named sub-section): ${t.patterns.join(', ')}. If any is missing, ADD it (intent/context/solution/modern-equivalent/trade-off/related). Confirm each is present.\n` +
    `2) FACTUAL accuracy vs the book/cloudcomputingpatterns.org: each pattern's intent + solution correct; the modern-equivalent examples accurate (right service for the pattern, right cloud); sibling distinctions correct (Strict vs Eventual Consistency; the 4 delivery patterns; Stateful vs Stateless; Shared/Tenant-isolated/Dedicated; Node- vs Environment-based Availability; the workload shapes). Fix errors.\n` +
    `3) BOUNDARY/SCOPE: overlapping patterns give the PATTERN-level treatment + a "Deep dive: see <domain>/<topic>" cross-ref, and do NOT duplicate the deep-dive content (CAP theory, DB internals, AWS product depth, multi-tenancy deep dive). Fix drift.\n` +
    `4) SCHEMA: valid YAML; keys topic/domain(system-design)/topic_slug(${t.slug})/version/questions; 40-60 questions; ids (prefix '${t.slug}-', unique, 3-digit seq); difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based 'answer' in range; explanation; correct-option VARIED (rebalance if any index >40% or a guessable cycle — shuffle options, keep 'answer' correct). Quote any YAML option with a colon+space or leading brace.\n` +
    `5) Every 'ref' resolves to a real '## ' heading; Mermaid valid (no semicolons in sequenceDiagram messages; QUOTE flowchart labels with ( ) or ?).\n` +
    `6) COVERAGE: MCQs span the patterns and are weighted to intent/selection/trade-off, not trivia.\n\n` +
    `After fixing, return: "<slug>: <questionCount> questions, <patternCount> patterns, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
