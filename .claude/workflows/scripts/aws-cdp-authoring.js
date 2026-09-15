export const meta = {
  name: 'aws-cdp-authoring',
  description: 'Author the AWS Cloud Design Patterns group (aws-cdp-*) in system-design: 7 topics covering all 46 patterns from clouddesignpattern.org, framed "classic intent -> modern AWS equivalent". Research -> author -> verify with a completeness gate. Includes select-all-that-apply (multi) MCQs.',
  phases: [
    { title: 'Author', detail: 'one agent per topic: research the patterns + write concepts.md + questions.yaml (incl. multi)' },
    { title: 'Verify', detail: 'completeness gate (all patterns present) + fact-check + cross-ref + schema (single & multi), fix in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`

const SCOPE = `
SOURCE — the "AWS Cloud Design Patterns" (CDP) catalog at https://en.clouddesignpattern.org/ (and its
mirror content), a classic (~2012-2015) collection of 46 AWS design patterns across 9 categories. We are
adding it as a NEW "AWS Cloud Design Patterns" group (aws-cdp- prefix) in the system-design domain,
alongside the existing AWS System Design (aws-), Cloud Computing Patterns (ccp-), Design Patterns (dp-),
and Architectural Patterns (arch-) groups.

CRITICAL FRAMING — "classic intent -> modern AWS equivalent" (do NOT teach these at face value):
- The CDP catalog is CLASSIC BUT DATED. Many patterns are EC2-era manual workarounds that modern managed
  services have since absorbed. Teach each pattern as: (1) the PROBLEM it solves (timeless), (2) the
  CLASSIC mechanism as the catalog described it, (3) the MODERN AWS equivalent / "how you'd actually do
  this on AWS today", and (4) "when (if ever) the classic approach is still relevant". Examples of the
  classic->modern mapping to apply:
  * Floating IP -> Elastic IP / NLB;  Scale Up/Out, Scheduled Scale Out -> Auto Scaling Groups + target
    tracking / scheduled scaling;  Clone Server / Stamp / Bootstrap / Stack Deployment -> golden AMIs +
    CloudFormation/CDK + user-data/cloud-init;  NFS Sharing / NFS Replica -> EFS;  Snapshot -> EBS
    snapshots / AWS Backup;  Monitoring Integration -> CloudWatch;  OnDemand NAT -> managed NAT Gateway;
    Web Storage / Direct Hosting / Cache Distribution -> S3 + CloudFront + OAC;  Read Replica / DB
    Replication -> RDS/Aurora read replicas & Multi-AZ;  Inmemory DB Cache -> ElastiCache / DAX;
    Queuing Chain / Priority Queue / Job Observer -> SQS (+ FIFO) + Lambda/ECS workers;  Server Swapping
    -> detach/attach EBS or immutable replace;  Weighted Transition -> Route 53 weighted routing /
    canary;  WAF Proxy -> AWS WAF;  CloudHub -> Site-to-Site VPN / Transit Gateway.

BOUNDARY RULES (STRICT — this library already has 31 deep aws-* topics; CROSS-REFERENCE, do NOT re-teach):
- ~40% of CDP patterns overlap existing aws-* deep dives. For an overlapping pattern, give the
  PATTERN-LEVEL treatment (problem + classic intent + the modern-AWS one-liner + when-still-relevant) and
  add "Deep dive: see system-design/aws-<topic>" — do NOT duplicate the deep-dive content. Overlap map:
  autoscaling -> aws-load-balancing-elb-autoscaling; storage -> aws-storage-ebs-efs-fsx &
  aws-storage-s3-deep-dive; messaging -> aws-messaging-sqs-sns-eventbridge; caching ->
  aws-caching-elasticache-dax; edge/CDN -> aws-dns-cdn-route53-cloudfront; NoSQL -> aws-dynamodb-deep-dive;
  RDBMS -> aws-databases-rds-aurora; networking -> aws-networking-vpc-privatelink; DR/HA ->
  aws-resilience-multiregion-dr; cost -> aws-cost-optimization-scaling.
- Keep the PATTERN altitude: teach the pattern vocabulary + the modern mapping, not a product tutorial.

Ground every pattern's problem/classic-solution in the clouddesignpattern.org catalog, and VERIFY the
modern-AWS equivalent is accurate and current (services/limits change).
`

const SCHEMA = `
CONTENT CONTRACT (follow exactly). Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1 + a short intro naming the source (clouddesignpattern.org) and the
     "classic intent -> modern AWS equivalent" framing + the cross-reference boundary note.
   - "## <Pattern Name>" H2 PER PATTERN in this topic's assigned list (these are the MCQ anchor targets —
     use the pattern's catalog name as the heading, e.g. "## Snapshot Pattern"). Heading text must NOT
     contain '/' or '&' (they break anchor slugs) — use commas or "and". For EACH pattern cover:
     PROBLEM it solves; CLASSIC mechanism (as the catalog framed it); "Modern AWS equivalent" (the
     managed-service way today, named concretely); TRADE-OFFS / when-to-use; "Still relevant when ..."
     (or "Superseded — use X instead"); and any "Deep dive: see system-design/aws-<topic>" cross-ref.
   - Where a diagram clarifies (an autoscaling loop, a queuing chain, an S3+CloudFront edge topology, a
     read-replica fan-out, a hybrid VPN hub), use a \`\`\`mermaid fenced block (flowchart/graph). NO
     ASCII-art. CRITICAL: no semicolons in sequenceDiagram message text (use commas); QUOTE any flowchart
     node label containing "(" ")" or "?" e.g. A["NAT Gateway (managed)"].
   - End with "## Common interview follow-ups" and "## References" (cite clouddesignpattern.org + the AWS
     docs you used to verify the modern mapping).

2) questions.yaml — top-level keys:
     topic: "<Topic Name>"
     domain: system-design
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001    # unique, zero-padded 3-digit seq from 001; prefix == slug
         difficulty: intermediate  # beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options: ["<0>","<1>","<2>","<3>"]
         answer: 2                # 0-BASED index (single-answer questions)
         explanation: |
           <why correct; teach the pattern + the modern mapping>
         ref: "concepts.md#<anchor>"  # resolves to a real "## " heading (GitHub slug rules)

   MULTI-SELECT (select-all-that-apply) questions are SUPPORTED and ENCOURAGED here (pattern catalogs are
   enumeration/trade-off heavy). For a multi question, use \`type: multi\` and \`answers: [i, j, ...]\`
   INSTEAD of \`answer\`:
       - id: <topic-slug>-0NN
         difficulty: advanced
         type: multi
         tags: [..]
         question: |
           Which of the following are TRUE of <pattern>? Select all that apply.
         options: ["<0>","<1>","<2>","<3>"]
         answers: [0, 2]        # 0-based indices of ALL correct options; NO 'answer' field
         explanation: |
           <why each correct option is true AND why each distractor is false>
         ref: "concepts.md#<anchor>"
     MULTI RULES (a validator enforces these): 4 options; at least one correct AND at least one distractor
     (NEVER mark all options correct); prefer 2-3 correct; each correct option independently true and each
     distractor independently a real misconception (all-or-nothing scoring). No 'answer' field on multi;
     no 'answers' field on single. No "all/none of the above" options.

   OVERALL RULES: aim for 40-60 MCQs per topic. Make ROUGHLY 20-30% of them \`type: multi\` (the rest
   single). Focus on: PATTERN INTENT ("which pattern solves X?"), the CLASSIC-vs-MODERN mapping ("the
   <classic> pattern is realized today on AWS by ...?"), PATTERN SELECTION scenarios, and TRADE-OFFS /
   when-still-relevant. Single questions: 3-5 options, exactly one correct, 0-based 'answer'; VARY the
   correct index (no single index >40%, no guessable cycle); mixed difficulty; distractors are plausible
   sibling patterns or plausible-but-wrong modern services. Every 'ref' resolves to a real "## " heading;
   id prefix == slug. Quote any YAML option containing a colon+space or a leading brace.

Do your own web research on clouddesignpattern.org for each assigned pattern (problem + classic solution)
and on AWS docs for the modern equivalent. Use the Write tool. Return:
"<slug>: concepts.md (<n> patterns) + questions.yaml (<m> Qs, <k> multi), patterns: <comma list>".
`

// 7 topics; each lists the EXACT patterns it must cover (completeness gate checks these).
const TOPICS = [
  {
    slug: 'aws-cdp-basic-and-ha',
    name: 'AWS Cloud Design Patterns: Basics and High Availability',
    patterns: ['Snapshot', 'Stamp', 'Scale Up', 'Scale Out', 'On-demand Disk', 'Multi-Server', 'Multi-Datacenter', 'Floating IP', 'Deep Health Check'],
    hints: "The foundational + HA patterns. BASIC: Snapshot (point-in-time backup of a volume -> EBS snapshots/AWS Backup), Stamp (a reusable server template/image -> golden AMI), Scale Up (vertical resize -> change instance type), Scale Out (horizontal add -> ASG), On-demand Disk (grow storage as needed -> EBS elastic volumes/gp3). HIGH AVAILABILITY: Multi-Server (redundant instances behind an LB), Multi-Datacenter (spread across AZs -> Multi-AZ), Floating IP (reassign a stable address on failover -> Elastic IP / NLB), Deep Health Check (check the whole dependency chain not just the port -> ELB/Route 53 health checks that hit a real endpoint). Emphasize classic->modern and when the manual pattern is now just a managed feature." },
  {
    slug: 'aws-cdp-dynamic-content',
    name: 'AWS Cloud Design Patterns: Dynamic Content and Scaling',
    patterns: ['Clone Server', 'NFS Sharing', 'NFS Replica', 'State Sharing', 'URL Rewriting', 'Rewrite Proxy', 'Cache Proxy', 'Scheduled Scale Out'],
    hints: "Serving dynamic content at scale. Clone Server (duplicate a running master web server for scale-out -> AMI + ASG). NFS Sharing (shared file storage across servers -> EFS) vs NFS Replica (read-replicated shared files for read scaling -> EFS + read patterns / read replicas). State Sharing (externalize session/state so servers stay stateless -> ElastiCache / DynamoDB session store; cross-ref multi-tenancy + scalability). URL Rewriting (rewrite URLs to offload static assets to S3/CDN). Rewrite Proxy vs Cache Proxy (reverse proxy that rewrites vs one that caches -> CloudFront / ElastiCache / managed proxies). Scheduled Scale Out (scale on a known schedule -> ASG scheduled scaling). Deep dive cross-refs: aws-caching-elasticache-dax, aws-load-balancing-elb-autoscaling, aws-storage-ebs-efs-fsx." },
  {
    slug: 'aws-cdp-static-content-and-upload',
    name: 'AWS Cloud Design Patterns: Static Content Delivery and Data Upload',
    patterns: ['Web Storage', 'Direct Hosting', 'Private Distribution', 'Cache Distribution', 'Rename Distribution', 'Write Proxy', 'Storage Index', 'Direct Object Upload'],
    hints: "STATIC CONTENT: Web Storage (store static assets in object storage -> S3), Direct Hosting (serve a static site straight from S3), Private Distribution (serve content only to authorized users -> CloudFront signed URLs/cookies + OAC), Cache Distribution (edge-cache near users -> CloudFront), Rename Distribution (cache-busting via renamed objects/paths -> versioned object keys / CloudFront invalidation trade-off). DATA UPLOAD: Write Proxy (accelerate/mediate uploads -> S3 Transfer Acceleration / a presign service), Storage Index (metadata index over object storage -> DynamoDB/RDS index pointing at S3 objects — the classic 'metadata in DB, blob in S3' split), Direct Object Upload (client uploads straight to S3 via presigned URL, bypassing the app server). Deep dive cross-refs: aws-storage-s3-deep-dive, aws-dns-cdn-route53-cloudfront." },
  {
    slug: 'aws-cdp-rdbms-and-data',
    name: 'AWS Cloud Design Patterns: Relational Databases and Data Stores',
    patterns: ['DB Replication', 'Read Replica', 'Inmemory DB Cache', 'Sharding Write'],
    hints: "Data-tier patterns (smaller topic — go DEEPER on each). DB Replication (replicate the DB across AZs/regions for DR/HA -> RDS Multi-AZ, cross-region read replicas, Aurora Global Database). Read Replica (offload reads to async replicas -> RDS/Aurora read replicas + a reader endpoint; teach replica lag + read-your-writes gotcha). Inmemory DB Cache (cache hot query results in memory -> ElastiCache / DAX; cache-aside vs write-through). Sharding Write (partition writes across multiple DBs to scale write throughput -> app-level sharding / Aurora limits / when to reach for DynamoDB instead). Heavy cross-ref: aws-databases-rds-aurora, aws-caching-elasticache-dax, aws-dynamodb-deep-dive, databases-sql-nosql-sharding-replication (do NOT re-derive replication/sharding theory — pattern level + modern mapping). Aim ~40 MCQs given only 4 patterns; go deep on trade-offs." },
  {
    slug: 'aws-cdp-batch-and-async',
    name: 'AWS Cloud Design Patterns: Batch Processing and Asynchronous Workflows',
    patterns: ['Queuing Chain', 'Priority Queue', 'Job Observer', 'Scheduled Autoscaling'],
    hints: "Async/batch patterns (smaller topic — go DEEPER). Queuing Chain (decouple pipeline stages with queues between workers -> SQS between Lambda/ECS stages; loose coupling + retry isolation). Priority Queue (process high-priority work first -> separate high/low SQS queues + weighted polling; why not one queue). Job Observer (scale worker fleet on queue depth -> CloudWatch queue-depth metric -> ASG/Lambda concurrency; the queue-based load-leveling pattern). Scheduled Autoscaling (pre-scale workers for known batch windows -> ASG scheduled actions / EventBridge Scheduler). Teach idempotency + visibility-timeout + DLQ gotchas. Cross-ref aws-messaging-sqs-sns-eventbridge, aws-serverless-lambda-stepfunctions, message-queues-and-async. Aim ~40 MCQs, scenario-heavy." },
  {
    slug: 'aws-cdp-operation-and-maintenance',
    name: 'AWS Cloud Design Patterns: Operation and Maintenance',
    patterns: ['Bootstrap', 'Cloud DI', 'Stack Deployment', 'Server Swapping', 'Monitoring Integration', 'Web Storage Archive', 'Weighted Transition', 'Hybrid Backup'],
    hints: "Ops/maintenance patterns. Bootstrap (configure an instance at first boot from a script -> EC2 user-data / cloud-init). Cloud DI (Cloud Dependency Injection: inject config/params at launch rather than baking in -> SSM Parameter Store / Secrets Manager / instance tags). Stack Deployment (deploy a whole environment reproducibly from a template -> CloudFormation/CDK). Server Swapping (swap the server behind a volume/identity to recover -> detach/attach EBS, or immutable replace). Monitoring Integration (build monitoring into the deploy -> CloudWatch agent/alarms). Web Storage Archive (tier cold data to cheap archival storage -> S3 lifecycle -> Glacier/Deep Archive). Weighted Transition (gradually shift traffic to a new version -> Route 53 weighted routing / canary / blue-green). Hybrid Backup (back up on-prem to cloud -> Storage Gateway / AWS Backup; cross-ref DR). Cross-ref aws-migration-modernization, aws-observability-cloudwatch-xray, aws-resilience-multiregion-dr." },
  {
    slug: 'aws-cdp-network',
    name: 'AWS Cloud Design Patterns: Networking and Security',
    patterns: ['OnDemand NAT', 'Backnet', 'Functional Firewall', 'Operational Firewall', 'Multi-Load Balancer', 'WAF Proxy', 'CloudHub'],
    hints: "Network/security patterns. OnDemand NAT (outbound internet for private instances -> managed NAT Gateway; classic self-managed NAT instance -> managed NAT trade-off, cost/HA). Backnet (a separate back-end/admin subnet isolated from the public path -> private subnets + bastion/SSM Session Manager). Functional Firewall (layer/tier-based filtering by function -> security groups per tier) vs Operational Firewall (filter by source/operator identity/CIDR -> NACLs / SG source rules) — teach the SG (stateful) vs NACL (stateless) distinction. Multi-Load Balancer (multiple LBs for different protocols/tiers -> ALB + NLB per need). WAF Proxy (a filtering proxy for web attacks -> AWS WAF on ALB/CloudFront). CloudHub (hub-and-spoke VPN connecting multiple sites -> Site-to-Site VPN / Transit Gateway). Cross-ref aws-networking-vpc-privatelink, aws-security-kms-secrets-cognito-waf. Heading text: use 'Multi-Load Balancer' (no slash)." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a principal AWS solutions architect and pattern-catalog expert authoring a topic in the new ` +
    `"AWS Cloud Design Patterns" group of a system-design interview library.\n\n${SCOPE}\n\n` +
    `THIS TOPIC: "${t.name}" (slug: ${t.slug}).\n` +
    `PATTERNS YOU MUST COVER (every one, by name, as a "## " heading — completeness requirement):\n` +
    `${t.patterns.map((p) => `  - ${p}`).join('\n')}\n\n` +
    `TOPIC GUIDANCE:\n${t.hints}\n\n${SCHEMA}\n\n` +
    `Research each pattern on clouddesignpattern.org (problem + classic solution) and AWS docs (modern ` +
    `equivalent), then write the two files into ${DIR}/${t.slug}/ . Cover ALL listed patterns; frame each ` +
    `classic-intent -> modern-AWS; cross-reference (don't duplicate) existing aws-* deep-dives; 40-60 MCQs ` +
    `with ~20-30% multi-select, weighted to pattern-intent + classic-vs-modern mapping + selection scenarios.`,
    { label: `author:${t.slug}`, phase: 'Author', effort: 'high' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer (principal AWS architect + interviewer) verifying an "AWS Cloud Design ` +
    `Patterns" topic "${t.name}" (slug: ${t.slug}).\n\n${SCOPE}\n\n` +
    `Files: ${DIR}/${t.slug}/concepts.md and questions.yaml . Read BOTH. Check and FIX IN PLACE:\n` +
    `1) COMPLETENESS GATE (critical): EVERY one of these patterns MUST be covered by name as a "## " ` +
    `heading: ${t.patterns.join(', ')}. If any is missing, ADD it (problem/classic/modern-AWS/trade-off/` +
    `still-relevant). Confirm each is present.\n` +
    `2) FACTUAL accuracy: each pattern's problem + classic solution correct per clouddesignpattern.org; and ` +
    `CRUCIALLY the "modern AWS equivalent" is accurate and current (right service, right mechanism, correct ` +
    `limits) — web-verify anything uncertain. Fix errors.\n` +
    `3) BOUNDARY/SCOPE: overlapping patterns give pattern-level treatment + "Deep dive: see ` +
    `system-design/aws-<topic>" and do NOT duplicate deep-dive content. Fix drift.\n` +
    `4) SCHEMA (single AND multi): valid YAML; keys topic/domain(system-design)/topic_slug(${t.slug})/` +
    `version/questions; 40-60 questions; ids (prefix '${t.slug}-', unique, contiguous 3-digit seq from 001); ` +
    `difficulty in {beginner,intermediate,advanced,expert}; 3-5 options. SINGLE questions have 'answer' ` +
    `(0-based, in range), NO 'answers'. MULTI questions have 'type: multi' + 'answers' (list, in range, ` +
    `unique, >=1 correct AND >=1 distractor — NEVER all-correct), NO 'answer'. ~20-30% should be multi. ` +
    `For single questions, correct-index VARIED (rebalance if any index >40% or a guessable cycle — shuffle ` +
    `options, keep answer correct). Quote any YAML option with a colon+space or leading brace.\n` +
    `5) Every 'ref' resolves to a real '## ' heading (no '/' or '&' in headings); Mermaid valid (no ` +
    `semicolons in sequenceDiagram messages; QUOTE flowchart labels with ( ) or ?).\n` +
    `6) COVERAGE: MCQs span the patterns and weight to intent / classic-vs-modern / selection / trade-off.\n` +
    `7) Run \`python3 ${REPO}/scripts/validate_content.py\` reasoning: ids contiguous, refs resolve, ` +
    `multi/single answer fields correct.\n\n` +
    `After fixing, return: "<slug>: <questionCount> questions (<multi> multi), <patternCount> patterns, ` +
    `<fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
