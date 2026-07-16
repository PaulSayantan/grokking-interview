export const meta = {
  name: 'aws-system-design-authoring',
  description: 'Author deep, trade-off-focused concepts.md + a large all-tier MCQ questions.yaml for all 26 AWS System Design topics (compute, storage, DBs, messaging/streaming, networking, security, resilience, analytics, ML/GenAI, IoT, migration, cost, reference architectures), then verify',
  phases: [
    { title: 'Author', detail: 'one agent per topic researches + writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact-check + schema-check + trade-off coverage, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`

const RESEARCH = `
RESEARCH FIRST (accuracy is critical — AWS service limits/features change): use web search to gather
current, accurate material. Good sources: the AWS Well-Architected Framework, AWS service docs &
developer guides, the AWS Architecture Center & reference architectures, re:Invent talks (esp. the
"deep dive"/"advanced design patterns" and "300/400-level" sessions), the "AWS Builders' Library",
Werner Vogels / DynamoDB & S3 papers, the AWS Prescriptive Guidance, and reputable engineering blogs.
Cross-check current defaults and hard/soft limits (e.g. S3 strong read-after-write consistency since
Dec 2020; Lambda up to 15 min / 10 GB memory / 10 GB ephemeral; SQS standard vs FIFO throughput & the
300 TPS/3000-with-batching FIFO limit; DynamoDB 400 KB item, partition 3000 RCU/1000 WCU; Kinesis 1 MB/s
or 1000 rec/s per shard ingest, 2 MB/s egress; API Gateway 29 s integration timeout; ALB vs NLB layer;
etc.). Prefer CURRENT best practices and name the real service trade-offs interviewers probe.
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md — deep study content:
   - Begins with a single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (these are the MCQ anchor targets — keep them stable).
   - IMPORTANT: heading text must NOT contain '/' or '&' (they break anchor slugs). Use commas / "and".
   - LAYERED depth: intuition → how the AWS service(s) work → real-world usage → **TRADE-OFFS**.
     Trade-offs are the single most important thing in a system-design interview — for EVERY design
     choice (which service, which mode, which config) explicitly state what you gain, what you give up,
     and WHEN to pick it vs the alternative (incl. non-AWS or other-AWS alternatives). Include a dedicated
     "## Trade-offs and when to use what" style section, and weave trade-off reasoning throughout.
   - Include: service limits/quotas that matter for design; capacity/back-of-envelope estimation and
     cost reasoning where relevant; ASCII architecture diagrams; comparison tables (service A vs B vs C
     with columns for consistency/latency/durability/scaling/cost/ops-burden); concrete numbers
     (latency ballparks, throughput per shard/partition, size limits, pricing dimensions); failure modes
     and how the design degrades (AZ/region failure, throttling, hot partitions).
   - Cover the topic's focus hints and any MODERN patterns (serverless-first, event-driven, cell-based).
   - End with "## Common interview follow-up questions" and "## References" (list the actual AWS docs /
     re:Invent talks / Builders' Library articles you used).

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
   - MANY questions must be TRADE-OFF / scenario / judgment questions: "Given <constraints: scale,
     latency budget, consistency need, durability, budget, ops maturity>, which AWS design is most
     appropriate and why?", "What is the PRIMARY trade-off of choosing <service X> over <service Y>?",
     "Which failure does this architecture NOT tolerate?", "Which service limit will this design hit
     first?". Use LONG, plausible, descriptive options (each a defensible-sounding AWS design) so the
     learner must reason about trade-offs, not pattern-match keywords. Exactly ONE best answer;
     distractors wrong for a specific reason (wrong service for the constraint, hits a limit, wrong
     consistency/durability model, more cost/ops for no benefit, etc.).
   - Include some AWS-fact questions (limits, consistency models, defaults) AND estimation/cost questions.
   - 3-5 options, exactly one correct, 'answer' 0-based, VARY the correct index across the file.
   - No "all/none of the above". Every 'ref' anchor resolves to a real "## " heading. id prefix = slug.

Use the Write tool to create both files. Return one line:
"<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions, all tiers)".
`

const TOPICS = [
  { slug: 'aws-fundamentals-well-architected', name: 'AWS Fundamentals and the Well-Architected Framework',
    hints: 'global infrastructure (Regions, AZs, edge/local zones, PoPs); the shared responsibility model; the 6 Well-Architected pillars (operational excellence, security, reliability, performance efficiency, cost optimization, sustainability) and their design principles; how to choose a service (managed vs self-managed, serverless-first thinking); IAM/account structure & multi-account (Organizations, Control Tower, landing zone); resilience building blocks (Multi-AZ, multi-Region); how AWS maps to generic system-design primitives; trade-offs of managed services (velocity/ops vs lock-in/cost/control).' },
  { slug: 'aws-compute-ec2-fargate-lambda', name: 'AWS Compute: EC2, Containers, Fargate and Lambda Trade-offs',
    hints: 'the compute spectrum EC2 (VM) vs containers (ECS/EKS) vs Fargate (serverless containers) vs Lambda (functions); when to pick each; EC2 instance families & purchasing options (On-Demand, Reserved, Savings Plans, Spot) and their trade-offs; Auto Scaling groups & launch templates; Lambda execution model (cold starts, concurrency, provisioned concurrency, 15-min/10 GB limits, event vs request/response); Fargate vs EC2 launch type for containers; cost & operational-burden trade-offs; when serverless is wrong (long-running, steady high load, GPU, low-latency).' },
  { slug: 'aws-containers-ecs-eks', name: 'Containers on AWS: ECS vs EKS, Fargate and Orchestration',
    hints: 'ECS (task definitions, services, clusters) vs EKS (managed Kubernetes) vs self-managed — deep trade-offs (ops burden, ecosystem, portability, lock-in, cost); Fargate vs EC2 capacity for both; task networking (awsvpc mode, ENI limits), service discovery (Cloud Map), load balancer integration (ALB/NLB target groups); scaling (service auto scaling, cluster autoscaler/Karpenter for EKS); ECR image registry; App Mesh / service mesh trade-offs; when to choose ECS over EKS and vice versa; blast radius & multi-tenant clusters.' },
  { slug: 'aws-serverless-lambda-stepfunctions', name: 'Serverless Architecture: Lambda, Step Functions and Event-Driven Design',
    hints: 'serverless-first architecture; Lambda triggers/event sources (S3, DynamoDB Streams, Kinesis, SQS, SNS, EventBridge, API Gateway) and poll vs push models; concurrency & scaling, reserved vs provisioned concurrency, cold starts & mitigation; error handling, retries, DLQ, idempotency; Step Functions (standard vs express) for orchestration/sagas, state machine patterns; event-driven vs orchestrated; fan-out; serverless data (DynamoDB, Aurora Serverless v2); trade-offs: cost at scale, 15-min limit, statelessness, vendor lock-in, observability; when serverless wins vs loses.' },
  { slug: 'aws-api-layer-apigateway-appsync', name: 'API Layer on AWS: API Gateway, AppSync and GraphQL',
    hints: 'API Gateway REST vs HTTP API vs WebSocket API — feature/cost/latency trade-offs; the 29 s integration timeout; throttling, usage plans, API keys, caching, request/response mapping, authorizers (IAM, Cognito, Lambda authorizers); AppSync (managed GraphQL) — resolvers, subscriptions (real-time), when GraphQL beats REST; edge-optimized vs regional vs private endpoints; API Gateway + Lambda vs ALB + Fargate for APIs; rate limiting & WAF integration; versioning & stages; trade-offs of managed API layer vs self-hosted (NGINX/Kong).' },
  { slug: 'aws-storage-s3-deep-dive', name: 'Amazon S3 Deep Dive: Object Storage at Scale',
    hints: 'S3 object model, buckets, keys, prefixes; strong read-after-write consistency (since Dec 2020) and what it does/does not cover; storage classes (Standard, IA, One Zone-IA, Intelligent-Tiering, Glacier Instant/Flexible/Deep Archive) & lifecycle policies — cost vs retrieval-latency trade-offs; 11 nines durability & how (multi-AZ replication); request rate scaling (3500 PUT / 5500 GET per prefix) & key-prefix design for hot partitions; multipart upload, transfer acceleration, byte-range; versioning, MFA delete, Object Lock (WORM); encryption (SSE-S3, SSE-KMS, SSE-C) & bucket policies/Block Public Access; static hosting, presigned URLs, S3 event notifications, S3 Select; cross-region replication; when S3 vs EBS vs EFS; egress cost.' },
  { slug: 'aws-storage-ebs-efs-fsx', name: 'Block and File Storage: EBS, EFS and FSx Trade-offs',
    hints: 'block (EBS) vs file (EFS/FSx) vs object (S3) — pick-the-right-storage; EBS volume types (gp3, io2 Block Express, st1, sc1), IOPS/throughput provisioning, single-AZ attachment, Multi-Attach, snapshots (incremental, to S3), encryption; EFS (NFS, multi-AZ, elastic, throughput modes, performance modes, IA lifecycle) vs FSx (Windows/NetApp ONTAP/Lustre for HPC); durability & availability differences; latency & throughput ballparks; cost models; when a database needs EBS io2 vs instance store; data migration (DataSync, Storage Gateway); trade-offs.' },
  { slug: 'aws-dynamodb-deep-dive', name: 'Amazon DynamoDB Deep Dive: Data Modeling and Scale',
    hints: 'partition key/sort key & how partitioning works; single-table design & access-pattern-first modeling; GSI vs LSI (differences, projection, eventual vs strong consistency); capacity modes (provisioned + auto scaling vs on-demand) & cost trade-offs; RCU/WCU math, 400 KB item limit, ~3000 RCU/1000 WCU per partition, adaptive capacity, hot partitions/keys; strongly vs eventually consistent reads; transactions & conditional writes; DynamoDB Streams + Lambda (CDC/event-driven); TTL; global tables (multi-region, LWW conflict resolution); DAX caching; backup/PITR; when DynamoDB vs RDS/Aurora; overloading/GSI overloading; the single-table vs multi-table debate.' },
  { slug: 'aws-databases-rds-aurora', name: 'Relational Databases on AWS: RDS and Aurora',
    hints: 'RDS engines & managed-DB value; Multi-AZ (sync standby, failover) vs read replicas (async, read scaling) — different purposes; Aurora architecture (shared distributed storage, 6 copies across 3 AZs, log-structured, fast failover, up to 15 replicas, reader/writer endpoints); Aurora Serverless v2 (ACU scaling); Aurora Global Database (cross-region, <1s replication, DR); RDS Proxy (connection pooling for Lambda); parameter/option groups; backups, PITR, snapshots; when RDS vs Aurora vs DynamoDB vs self-managed on EC2; vertical scaling limits & read/write scaling trade-offs; failover behavior & RPO/RTO.' },
  { slug: 'aws-caching-elasticache-dax', name: 'Caching on AWS: ElastiCache, DAX and CloudFront Patterns',
    hints: 'ElastiCache Redis vs Memcached (persistence, replication, cluster mode, data structures, pub/sub, sorted sets vs simple multi-threaded cache) trade-offs; cache patterns (cache-aside, write-through, write-behind) on AWS; cluster mode enabled vs disabled, sharding & replication, Multi-AZ failover; DAX (DynamoDB in-memory cache, write-through, microsecond reads) vs ElastiCache in front of DynamoDB; caching at the edge (CloudFront); TTL & invalidation; hot-key & thundering-herd mitigation; when to cache vs not; cost vs latency; session store & leaderboard use cases.' },
  { slug: 'aws-messaging-sqs-sns-eventbridge', name: 'AWS Messaging: SQS, SNS and EventBridge',
    hints: 'SQS standard (at-least-once, best-effort order, near-unlimited throughput) vs FIFO (exactly-once processing, ordering, 300 TPS or 3000 with batching, message groups, dedup) — trade-offs; visibility timeout, long polling, DLQ, redrive, message retention, 256 KB limit + extended client for large payloads; SNS pub/sub fan-out (to SQS, Lambda, HTTP, SMS/email) & the SNS+SQS fan-out pattern; EventBridge (event bus, schema registry, rules/filtering, SaaS & scheduler, content-based routing) vs SNS — when each; message ordering, idempotency, poison messages; SQS vs Kinesis vs Kafka for the same problem; choosing the right decoupling primitive.' },
  { slug: 'aws-streaming-kinesis-msk', name: 'Streaming and Real-Time Data: Kinesis and MSK',
    hints: 'Kinesis Data Streams (shards: 1 MB/s or 1000 rec/s ingest, 2 MB/s egress; partition keys & hot shards; resharding; on-demand vs provisioned; retention 24h-365d; enhanced fan-out) vs SQS (no replay, no ordering across) vs MSK/Kafka (self vs managed, higher throughput, ecosystem, more ops) — deep trade-offs; Kinesis Data Firehose (managed load to S3/Redshift/OpenSearch, buffering) vs Data Streams; Kinesis vs Kafka decision; consumers (KCL, Lambda), ordering per partition/shard, exactly-once challenges; Kafka on MSK vs MSK Serverless; lambda/kappa on AWS; real-time analytics (Managed Service for Apache Flink); replay & backpressure; when streaming vs queue.' },
  { slug: 'aws-networking-vpc-privatelink', name: 'AWS Networking: VPC, Subnets, PrivateLink and Transit Gateway',
    hints: 'VPC, subnets (public vs private), route tables, IGW vs NAT gateway; security groups (stateful) vs NACLs (stateless) — trade-offs & when each; VPC endpoints (gateway for S3/DynamoDB vs interface/PrivateLink) to keep traffic off the internet; PrivateLink for exposing services privately; VPC peering vs Transit Gateway (hub-and-sphoke, transitive routing, scale); Direct Connect vs Site-to-Site VPN (hybrid connectivity, bandwidth/latency/cost); multi-VPC & multi-account network design; IP addressing/CIDR planning; egress cost & data-transfer trade-offs; DNS (Route 53 Resolver) in VPC; how network isolation supports zero-trust.' },
  { slug: 'aws-dns-cdn-route53-cloudfront', name: 'Edge, DNS and CDN: Route 53, CloudFront and Global Accelerator',
    hints: 'Route 53 (authoritative DNS, hosted zones, record types, health checks) and routing policies (simple, weighted, latency-based, geolocation, geoproximity, failover, multivalue) — when each; DNS-based failover & DR; CloudFront (CDN, edge caching, origins S3/ALB/custom, cache behaviors, TTL, invalidation, signed URLs/cookies, Lambda@Edge & CloudFront Functions, OAC for S3); Global Accelerator (anycast static IPs, network-layer, non-cacheable/TCP-UDP) vs CloudFront (cacheable HTTP) — key trade-off; edge for latency & DDoS (Shield); origin shield; caching static vs dynamic; how to design low-latency global delivery.' },
  { slug: 'aws-load-balancing-elb-autoscaling', name: 'Load Balancing and Auto Scaling: ALB, NLB, GWLB and ASG',
    hints: 'ELB family: ALB (L7, HTTP/HTTPS, path/host routing, WebSocket, target groups, sticky sessions) vs NLB (L4, TCP/UDP, ultra-low latency, static IP, millions of connections, preserves source IP) vs GWLB (L3 gateway for appliances) vs classic (legacy) — pick-the-right-LB; cross-zone load balancing; health checks & connection draining/deregistration delay; Auto Scaling groups (dynamic/target-tracking/step/scheduled/predictive scaling), cooldowns, lifecycle hooks, warm pools; scaling metrics & the right target; integration with ECS/EKS; multi-AZ distribution; trade-offs of L4 vs L7; when to combine CloudFront + ALB.' },
  { slug: 'aws-security-iam-deep-dive', name: 'AWS IAM Deep Dive: Identities, Policies and Access Control',
    hints: 'IAM users vs roles vs groups; roles & STS temporary credentials (AssumeRole, instance profiles, IRSA for EKS, Lambda execution roles) — why roles beat long-lived keys; policy types (identity-based, resource-based, SCPs, permission boundaries, session policies) & evaluation logic (explicit deny > allow, default deny); least privilege & policy conditions; cross-account access; federation (SAML, OIDC, IAM Identity Center); resource policies (S3 bucket policy, KMS key policy) & the confused-deputy problem; access analyzer; trade-offs of coarse vs fine-grained policies; how IAM enables zero-trust; common pitfalls (wildcards, PassRole).' },
  { slug: 'aws-security-kms-secrets-cognito-waf', name: 'Data Protection and App Security: KMS, Secrets, Cognito and WAF',
    hints: 'encryption at rest vs in transit; KMS (CMK/customer-managed vs AWS-managed vs owned keys, envelope encryption, data keys, key policies, rotation, multi-Region keys) & how services integrate; CloudHSM vs KMS; Secrets Manager (rotation, cross-service) vs SSM Parameter Store (cost/feature trade-off); Cognito user pools (authN, tokens, MFA, hosted UI, federation) vs identity pools (authZ to AWS resources) — the difference; WAF (managed rules, rate-based, bot control) & Shield (Standard vs Advanced) for DDoS; ACM for TLS certs; Macie/GuardDuty/Inspector at a high level; PII/compliance & tokenization; defense-in-depth trade-offs.' },
  { slug: 'aws-observability-cloudwatch-xray', name: 'Observability on AWS: CloudWatch, X-Ray and CloudTrail',
    hints: 'the three pillars mapped to AWS: metrics (CloudWatch metrics, custom & high-resolution, alarms, composite alarms, dimensions & cardinality cost), logs (CloudWatch Logs, log groups, Logs Insights, metric filters, subscription filters to Kinesis/OpenSearch), traces (X-Ray, service map, segments/subsegments, sampling, OpenTelemetry/ADOT); CloudTrail (API audit, management vs data events, org trail) vs CloudWatch (operational) vs Config (resource state/compliance) — what each is for; dashboards, EventBridge for events; alerting (symptom vs cause, alarm actions, SNS); cost of observability (log/metric/trace volume); SLI/SLO on AWS; distributed tracing across Lambda/microservices.' },
  { slug: 'aws-resilience-multiregion-dr', name: 'Resilience and Disaster Recovery: Multi-AZ, Multi-Region and DR Strategies',
    hints: 'availability building blocks (Multi-AZ within a Region for HA; multi-Region for DR/latency); the 4 DR strategies (backup & restore, pilot light, warm standby, multi-site active-active) and their RPO/RTO vs cost trade-offs; how to choose based on RTO/RPO targets; data replication (Aurora Global DB, DynamoDB global tables, S3 CRR) & the consistency/conflict trade-offs; Route 53 failover & health checks; cell-based architecture & blast-radius reduction; static stability & avoiding control-plane dependency in failover; chaos engineering (FIS); graceful degradation, throttling & load shedding; backups & immutable/WORM; trade-offs of active-active vs active-passive.' },
  { slug: 'aws-analytics-datalake-redshift-emr', name: 'Analytics and Big Data on AWS: Data Lakes, Redshift, EMR and Athena',
    hints: 'data lake on S3 (schema-on-read) vs data warehouse (Redshift, schema-on-write) vs lakehouse — trade-offs; Glue (catalog, ETL, crawlers) & Lake Formation (governance/permissions); Athena (serverless SQL on S3, pay-per-scan, Parquet/partitioning to cut cost) vs Redshift (MPP columnar, RA3, Spectrum, concurrency scaling, distribution/sort keys); EMR (managed Hadoop/Spark) vs serverless (EMR Serverless, Glue) — when each; ETL vs ELT; OpenSearch for search/log analytics; QuickSight (BI); batch vs streaming ingestion (Firehose); columnar formats & partitioning for cost/perf; when Athena vs Redshift vs EMR; cost models.' },
  { slug: 'aws-microservices-patterns', name: 'Microservices Patterns on AWS: Decomposition, Saga, Outbox and Service Communication',
    hints: 'decomposing on AWS (per-service data store, database-per-service); sync (API Gateway/ALB + gRPC/REST) vs async (SQS/SNS/EventBridge/Kinesis) communication trade-offs; service discovery (Cloud Map) & service mesh (App Mesh) trade-offs; saga pattern (orchestration via Step Functions vs choreography via EventBridge/SNS) for distributed transactions & compensation; transactional outbox with DynamoDB Streams / DB + CDC to avoid dual-write; idempotency (idempotency keys, DynamoDB conditional writes); API gateway & BFF; strangler-fig migration; event-driven vs request-response; when NOT to do microservices on AWS; cell-based & bounded contexts.' },
  { slug: 'aws-ml-genai-sagemaker-bedrock', name: 'ML and GenAI System Design on AWS: SageMaker, Bedrock and RAG',
    hints: 'MODERN & frequently asked. ML lifecycle on AWS: SageMaker (training, real-time vs batch vs async vs serverless inference endpoints, autoscaling, multi-model endpoints) trade-offs; feature store, pipelines; GenAI with Bedrock (managed foundation models, provisioned vs on-demand throughput); RAG on AWS (embeddings via Bedrock/SageMaker, vector store options — OpenSearch k-NN, Aurora/pgvector, Kendra, Bedrock Knowledge Bases; chunking, retrieval, re-ranking, grounding); serving inference at scale (GPU instances, batching, cost/latency dominate); prompt/semantic caching; guardrails & hallucination mitigation; fine-tuning vs RAG vs prompt-engineering trade-offs; agents (Bedrock Agents); cost & latency as the dominant trade-offs.' },
  { slug: 'aws-iot-edge-computing', name: 'IoT and Edge Computing on AWS: IoT Core, Greengrass and Edge',
    hints: 'IoT Core (MQTT/device gateway, device registry, device shadows, rules engine to route to other services, at scale to millions of devices); message protocols (MQTT vs HTTP vs WebSocket) trade-offs; Greengrass (edge runtime, local compute/ML/offline, sync); ingestion of high-volume telemetry (IoT Core -> Kinesis/Firehose -> S3/analytics); edge computing rationale (latency, bandwidth cost, intermittent connectivity, data sovereignty) vs cloud; Local Zones / Outposts / Wavelength for edge; device security (X.509 certs, IoT Device Defender); time-series storage (Timestream); when edge vs cloud processing; trade-offs of local autonomy vs central control.' },
  { slug: 'aws-migration-modernization', name: 'Migration and Modernization Strategies on AWS',
    hints: 'the 7 Rs (retire, retain, rehost/lift-and-shift, relocate, repurchase, replatform, refactor/re-architect) and when each; migration tooling (Application Migration Service/MGN, Database Migration Service DMS + Schema Conversion Tool, DataSync, Snowball/Snowmobile for bulk data, Transfer Family); the strangler-fig pattern to incrementally break a monolith; hybrid architectures (Direct Connect, Storage Gateway, Outposts); minimizing downtime (DMS ongoing replication/CDC, cutover); assessing & prioritizing (migration portfolio, TCO); refactoring monolith to microservices/serverless; data-gravity & network trade-offs; when to modernize vs just rehost; cost & risk trade-offs.' },
  { slug: 'aws-cost-optimization-scaling', name: 'Cost Optimization and Scaling Trade-offs on AWS',
    hints: 'cost-aware architecture; pricing dimensions per service (compute-hours, requests, GB stored, GB scanned, data transfer/egress — the hidden cost); purchasing (On-Demand vs Reserved vs Savings Plans vs Spot) & when each; serverless (pay-per-use, scale-to-zero) vs provisioned economics — the crossover point where always-on beats per-request; right-sizing & auto scaling to match demand; data-transfer & NAT gateway cost traps; S3 storage-class & lifecycle for cost; caching to cut cost (fewer DB/API calls); DynamoDB on-demand vs provisioned cost; Graviton (ARM) for price-performance; tagging & cost allocation; the cost vs performance vs availability vs operational-effort trade-off framework; FinOps basics.' },
  { slug: 'aws-reference-architectures', name: 'End-to-End AWS Reference Architectures: Designing Real Systems',
    hints: 'putting services together for classic interview prompts, AWS-native: (1) URL shortener (API Gateway + Lambda + DynamoDB + CloudFront); (2) image/video upload & processing (S3 + Lambda/MediaConvert + CloudFront + DynamoDB metadata); (3) video streaming like Netflix (S3 + MediaConvert + CloudFront + adaptive bitrate); (4) real-time chat/notifications (API Gateway WebSocket + Lambda + DynamoDB + SNS/Pinpoint); (5) e-commerce/order system (microservices on ECS/EKS, SQS, DynamoDB/Aurora, saga via Step Functions); (6) social feed (fan-out with SQS/Kinesis, DynamoDB, ElastiCache); (7) analytics pipeline (Kinesis + S3 + Athena/Redshift). For EACH: the components, the data flow, the scaling & failure story, and the KEY trade-offs / alternative choices. Emphasize how to reason from requirements to an AWS design in an interview.' },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a principal AWS solutions architect and system-design interview coach authoring deep, ` +
    `trade-off-focused study material for the topic "${t.name}" (slug: ${t.slug}) in a learner's ` +
    `interview-prep library. This is the AWS System Design sub-domain (folder lives under ` +
    `topics/system-design/, domain slug is "system-design").\n\n` +
    `${RESEARCH}\n\n` +
    `FOCUS / subtopics to cover (include modern patterns):\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . Go deep, prioritize AWS-specific TRADE-OFFS and ` +
    `service selection, get service limits/facts right, aim high on MCQ count (60-80).`,
    { label: `author:${t.slug}`, phase: 'Author', effort: 'high' }
  ),
  (authorSummary, t) => agent(
    `You are a staff AWS solutions architect verifying AWS system-design interview content for "${t.name}" ` +
    `(slug: ${t.slug}).\n\n` +
    `Read BOTH ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and FIX IN PLACE:\n` +
    `1) FACTUAL/AWS-ACCURACY errors in concepts or MCQ answers/explanations — web-research anything ` +
    `uncertain. Verify service limits/quotas, consistency models, defaults, and feature availability are ` +
    `CURRENT (e.g. S3 strong read-after-write since 2020; Lambda 15 min/10 GB; SQS FIFO 300 TPS / 3000 ` +
    `batched; DynamoDB 400 KB item & partition throughput; Kinesis shard 1 MB/s-1000 rec/s in, 2 MB/s out; ` +
    `API Gateway 29 s timeout; ALB=L7/NLB=L4; Aurora 6 copies/3 AZs). A wrong 'answer' index or a ` +
    `trade-off/limit stated backwards is the worst defect — fix it.\n` +
    `2) TRADE-OFF COVERAGE: confirm concepts.md has explicit trade-off + service-selection treatment and ` +
    `that a healthy share of questions are scenario/trade-off/judgment style (not just definitions). ` +
    `If thin, ADD such questions.\n` +
    `3) SCHEMA: valid YAML; top-level topic/domain(system-design)/topic_slug(${t.slug})/version/questions; ` +
    `ids prefixed '${t.slug}-', unique, contiguous 3-digit from 001; difficulty in {beginner,intermediate,advanced,expert} ` +
    `with all four represented; 3-5 options; 0-based in-range 'answer'; correct index VARIED; every 'ref' ` +
    `anchor resolves to a real '## ' heading (no '/' or '&' in headings — rename with comma/"and" + fix refs). ` +
    `Ensure 'ref' values are QUOTED strings.\n` +
    `4) COVERAGE: 60-80 questions, every subtopic represented. If thin, ADD questions. Dedupe semantic repeats by rewriting.\n\n` +
    `Return one line: "${t.slug}: <total> questions (<nBeg>/<nInt>/<nAdv>/<nExp>), <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
