# System Design

27 core + 8 advanced/expert deep-dive + 7 design-patterns + 6 architectural-patterns +
8 cloud-computing-patterns + 31 AWS System Design + 7 AWS Cloud Design Patterns topics
(94 total).
Study content and MCQs live in per-topic subfolders. See the master taxonomy in
`../../TOPICS.md`.

| Topic | Slug | Freq | Difficulty | Status |
|---|---|---|---|---|
| System Design Fundamentals & Interview Framework | `fundamentals-and-framework` | very-high | beginner | ✅ (115 MCQs · 71 adv/expert) |
| Scalability & Load Balancing | `scalability-and-load-balancing` | very-high | beginner | ✅ (75 MCQs · 32 adv/expert) |
| Caching & CDN | `caching-and-cdn` | very-high | intermediate | ✅ (80 MCQs · 39 adv/expert) |
| Databases: SQL vs NoSQL, Indexing, Sharding & Replication | `databases-sql-nosql-sharding-replication` | very-high | intermediate | ✅ (110 MCQs · 70 adv/expert) |
| CAP Theorem & Consistency Models | `cap-theorem-and-consistency` | high | advanced | ✅ (111 MCQs · 69 adv/expert) |
| Message Queues, Streaming & Asynchronous Processing | `message-queues-and-async` | high | intermediate | ✅ (110 MCQs · 69 adv/expert) |
| Microservices, Monolith & API Design | `microservices-monolith-api-design` | high | intermediate | ✅ (109 MCQs · 67 adv/expert) |
| Rate Limiting & Consistent Hashing | `rate-limiting-and-consistent-hashing` | high | intermediate | ✅ (80 MCQs · 37 adv/expert) |
| Networking & Communication Protocols | `networking-and-protocols` | high | intermediate | ✅ (75 MCQs · 34 adv/expert) |
| Observability, Monitoring & Site Reliability | `observability-monitoring-reliability` | high | intermediate | ✅ (75 MCQs · 33 adv/expert) |
| Security, Authentication & Data Protection | `security-authentication-data-protection` | high | intermediate | ✅ (75 MCQs · 32 adv/expert) |
| Design Search, Autocomplete & Typeahead Systems | `design-search-autocomplete-typeahead` | high | advanced | ✅ (76 MCQs · 33 adv/expert) |
| Design a Web Crawler & Large-Scale Data Processing | `design-web-crawler-data-processing` | medium | advanced | ✅ (76 MCQs · 34 adv/expert) |
| Distributed Coordination, Locking & Collaborative Editing | `design-coordination-locking-collaboration` | medium | advanced | ✅ (76 MCQs · 32 adv/expert) |
| Design a Distributed Job Scheduler, Task Queue & Cron | `design-job-scheduler-task-queue` | medium | intermediate | ✅ (78 MCQs · 37 adv/expert) |
| Design a URL Shortener / Pastebin / Key-Value Store | `design-url-shortener` | very-high | beginner | ✅ (70 MCQs · 31 adv/expert) |
| Design Social Feed / Twitter / Chat / Notification System | `design-feed-chat-notification` | very-high | advanced | ✅ (70 MCQs · 32 adv/expert) |
| Design Video/Media Platform (YouTube, Netflix) & Distributed Cache | `design-video-platform-distributed-cache` | high | advanced | ✅ (72 MCQs · 33 adv/expert) |
| Design Location & Transactional Systems (Uber, Payments, Ticketmaster) | `design-location-and-payment-systems` | high | advanced | ✅ (80 MCQs · 40 adv/expert) |
| Event-Driven Architecture: CQRS, Event Sourcing, Saga & CDC | `event-driven-cqrs-saga-cdc` | high | advanced | ✅ (72 MCQs · 33 adv/expert) |
| GenAI & LLM System Design: RAG, Vector DBs & Inference at Scale | `genai-llm-system-design` | high | advanced | ✅ (72 MCQs · 36 adv/expert) |
| Real-Time & Streaming Systems: Analytics, Leaderboards & Live Data | `realtime-streaming-systems` | high | advanced | ✅ (75 MCQs · 35 adv/expert) |
| Resilience, Fault Tolerance & Design Trade-offs Deep-Dive | `resilience-tradeoffs-deep-dive` | very-high | advanced | ✅ (116 MCQs · 73 adv/expert) |
| Domain-Driven Design: Tactical Patterns | `ddd-tactical-patterns` | high | advanced | ✅ (48 MCQs) |
| DDD Strategic Design & Context Mapping | `ddd-strategic-context-mapping` | high | advanced | ✅ (52 MCQs) |
| Strangler Fig & Monolith-to-Microservices Migration | `strangler-fig-and-monolith-migration` | high | advanced | ✅ (50 MCQs) |
| Multi-Tenancy & SaaS Isolation | `multi-tenancy-and-saas-isolation` | high | advanced | ✅ (45 MCQs) |

Status: ☐ not started · ◐ concepts done · ● concepts+MCQs · ✅ validated

All 23 core topics: deep trade-off-focused concepts.md + validated MCQs across all four
tiers. Includes modern topics (event-driven/CQRS/saga/CDC, GenAI/RAG/vector DBs,
real-time streaming, resilience trade-offs deep-dive). Six high-frequency topics
(fundamentals, CAP/consistency, databases, microservices, message-queues, resilience)
were deepened with senior/staff-level concept sections + advanced/expert MCQs.

## Advanced & Expert Deep-Dives (8 topics)

Senior/staff-level theory that separates strong candidates: the interview *method*
itself, distributed-systems theory, capacity/failure modeling, storage internals, and
DDD. Skewed hard (~76% advanced/expert). **588 MCQs**, math- and trade-off-heavy.

| Topic | Slug | Freq | Difficulty | Status |
|---|---|---|---|---|
| System Design Interview Method and Scenario Playbooks | `interview-method-scenario-playbooks` | very-high | advanced | ✅ (74 MCQs · 61 adv/expert) |
| Consensus, Logical Clocks and Time in Distributed Systems | `consensus-clocks-and-time` | high | expert | ✅ (75 MCQs · 56 adv/expert) |
| Distributed Transactions Beyond Saga: 2PC, 3PC and Deterministic | `distributed-transactions-advanced` | high | expert | ✅ (65 MCQs · 52 adv/expert) |
| Capacity Modeling, Queueing and Tail Latency at Scale | `capacity-modeling-and-tail-latency` | high | expert | ✅ (75 MCQs · 55 adv/expert) |
| Failure Theory: Metastable Failures, Retry Storms and Load Shedding | `failure-theory-advanced` | high | expert | ✅ (75 MCQs · 56 adv/expert) |
| Data Store Internals: Storage Engines, MVCC and Schema Evolution | `data-internals-storage-engines` | high | expert | ✅ (75 MCQs · 56 adv/expert) |
| Probabilistic Data Structures for Scale | `probabilistic-data-structures` | medium | advanced | ✅ (75 MCQs · 60 adv/expert) |
| Microservices Depth: DDD, Service Boundaries and Anti-Patterns | `microservices-ddd-and-boundaries` | high | advanced | ✅ (74 MCQs · 62 adv/expert) |

## Design Patterns (7 topics)

Interview-grade catalog of software design patterns, `dp-` slug prefix. Covers ALL 23
Gang-of-Four patterns plus enterprise (Fowler PoEAA), concurrency (POSA), and distributed/
cloud patterns. Each pattern has a "problem it solves" statement, a Mermaid diagram, a
concrete example, and trade-offs. **427 MCQs**, mixed difficulty. Distributed-pattern topics
cross-reference the existing deep-dive topics rather than duplicate them.

| Topic | Slug | Freq | Difficulty | Status |
|---|---|---|---|---|
| Design Patterns: Fundamentals & Principles (SOLID, GoF taxonomy, anti-patterns) | `dp-fundamentals-and-principles` | very-high | intermediate | ✅ (56 MCQs) |
| Creational Design Patterns (all 5 GoF + DI/IoC, Object Pool) | `dp-creational` | very-high | intermediate | ✅ (55 MCQs) |
| Structural Design Patterns (all 7 GoF) | `dp-structural` | very-high | intermediate | ✅ (48 MCQs) |
| Behavioral Design Patterns (all 11 GoF) | `dp-behavioral` | very-high | intermediate | ✅ (56 MCQs) |
| Enterprise & Application Architecture Patterns (Fowler PoEAA, MVC/MVP/MVVM) | `dp-enterprise-application` | high | advanced | ✅ (67 MCQs) |
| Concurrency & Reactive Design Patterns (POSA) | `dp-concurrency` | high | advanced | ✅ (75 MCQs) |
| Distributed & Cloud Design Patterns (Circuit Breaker, Saga, CQRS, Sidecar, ...) | `dp-distributed-cloud` | high | advanced | ✅ (70 MCQs) |

## Architectural Patterns (6 topics)

System-level architectural STYLES (a different altitude from the object-level Design
Patterns group), `arch-` slug prefix. Covers distributed/infrastructure, code-organization,
data-flow/event, UI/presentation, and specialized styles. Each style has a "problem it
solves" statement, a Mermaid diagram, and trade-offs/-ilities; styles with a deep-dive
elsewhere cross-reference it rather than duplicate. **325 MCQs**, mixed difficulty.

| Topic | Slug | Freq | Difficulty | Status |
|---|---|---|---|---|
| Architectural Patterns: Fundamentals & Style Selection (-ilities, ADRs, Conway) | `arch-fundamentals-and-styles` | very-high | intermediate | ✅ (55 MCQs) |
| Distributed & Infrastructure (Client-Server, P2P, Microservices, SOA, Serverless, Space-Based) | `arch-distributed-infrastructure` | very-high | advanced | ✅ (55 MCQs) |
| Code-Organization (Layered, Hexagonal, Clean, Onion, Microkernel) | `arch-code-organization` | high | intermediate | ✅ (65 MCQs) |
| Data-Flow & Event-Driven (Event-Driven, Pipe-and-Filter, CQRS, Event Sourcing, Batch) | `arch-dataflow-event` | high | advanced | ✅ (52 MCQs) |
| UI / Presentation (MVC, MVP, MVVM) | `arch-ui-presentation` | high | intermediate | ✅ (50 MCQs) |
| Specialized (Blackboard, Primary-Replica, Broker) | `arch-specialized` | medium | advanced | ✅ (48 MCQs) |

## Cloud Computing Patterns (8 topics)

Vendor-neutral cloud pattern language from Fehling, Leymann, Retter et al.,
*Cloud Computing Patterns* (Springer, 2014) — https://www.cloudcomputingpatterns.org/.
The classic abstract solutions (workload types, IaaS/PaaS/SaaS, elasticity, loosely
coupled distributed components, hybrid architectures) that underpin how cloud-native
systems are designed regardless of provider. Overlaps with existing core/AWS topics are
CROSS-REFERENCED (workload types → capacity-modeling; consistency → cap-theorem; messaging
→ message-queues; elasticity → scalability; hybrid → aws-migration), not re-taught.

| Topic | Slug | Freq | Difficulty | Status |
|---|---|---|---|---|
| Cloud Computing Fundamentals: Workloads & Service/Deployment Models | `ccp-fundamentals-workloads-models` | high | beginner | ☐ |
| Cloud Offerings: Compute, Elasticity & Processing | `ccp-offerings-compute-elasticity` | high | intermediate | ☐ |
| Cloud Offerings: Storage, Data & Communication | `ccp-offerings-storage-data-communication` | high | intermediate | ☐ |
| Application Architectures: Components & Coupling | `ccp-architecture-components-coupling` | high | intermediate | ☐ |
| Application Architectures: State, Multi-Tenancy & Integration | `ccp-architecture-state-tenancy-integration` | high | advanced | ☐ |
| Cloud Application Management: Elasticity & Resiliency Processes | `ccp-management-elasticity-resiliency` | medium | advanced | ☐ |
| Composite Cloud Applications: Tiers & CDN | `ccp-composite-tiers-cdn` | medium | intermediate | ☐ |
| Composite Cloud Applications: Hybrid Cloud Architectures | `ccp-composite-hybrid` | high | advanced | ☐ |

Status: ☐ not started · ◐ concepts done · ● concepts+MCQs · ✅ validated

## AWS System Design (31 topics)

Designing microservices and large-scale systems with AWS primitives (SQS, DynamoDB,
ECS/EKS, EC2, Lambda, S3, and more), plus a SaaS multi-tenancy architecture cluster.
Same depth/trade-off bar as the core topics; `aws-` slug prefix. **2,368 MCQs**, all
four tiers, service-limit- and trade-off-heavy.

| Topic | Slug | Freq | Difficulty | Status |
|---|---|---|---|---|
| AWS Fundamentals and the Well-Architected Framework | `aws-fundamentals-well-architected` | very-high | beginner | ✅ (80 MCQs · 38 adv/expert) |
| AWS Compute: EC2, Containers, Fargate and Lambda Trade-offs | `aws-compute-ec2-fargate-lambda` | very-high | intermediate | ✅ (70 MCQs · 30 adv/expert) |
| Containers on AWS: ECS vs EKS, Fargate and Orchestration | `aws-containers-ecs-eks` | high | advanced | ✅ (75 MCQs · 35 adv/expert) |
| Serverless Architecture: Lambda, Step Functions and Event-Driven Design | `aws-serverless-lambda-stepfunctions` | very-high | intermediate | ✅ (72 MCQs · 34 adv/expert) |
| API Layer on AWS: API Gateway, AppSync and GraphQL | `aws-api-layer-apigateway-appsync` | high | intermediate | ✅ (70 MCQs · 37 adv/expert) |
| Amazon S3 Deep Dive: Object Storage at Scale | `aws-storage-s3-deep-dive` | very-high | intermediate | ✅ (75 MCQs · 37 adv/expert) |
| Block and File Storage: EBS, EFS and FSx Trade-offs | `aws-storage-ebs-efs-fsx` | high | intermediate | ✅ (75 MCQs · 37 adv/expert) |
| Amazon DynamoDB Deep Dive: Data Modeling and Scale | `aws-dynamodb-deep-dive` | very-high | advanced | ✅ (78 MCQs · 38 adv/expert) |
| Relational Databases on AWS: RDS and Aurora | `aws-databases-rds-aurora` | high | intermediate | ✅ (76 MCQs · 36 adv/expert) |
| Caching on AWS: ElastiCache, DAX and CloudFront Patterns | `aws-caching-elasticache-dax` | high | intermediate | ✅ (75 MCQs · 37 adv/expert) |
| AWS Messaging: SQS, SNS and EventBridge | `aws-messaging-sqs-sns-eventbridge` | very-high | intermediate | ✅ (70 MCQs · 35 adv/expert) |
| Streaming and Real-Time Data: Kinesis and MSK | `aws-streaming-kinesis-msk` | high | advanced | ✅ (80 MCQs · 39 adv/expert) |
| AWS Networking: VPC, Subnets, PrivateLink and Transit Gateway | `aws-networking-vpc-privatelink` | high | advanced | ✅ (70 MCQs · 30 adv/expert) |
| Edge, DNS and CDN: Route 53, CloudFront and Global Accelerator | `aws-dns-cdn-route53-cloudfront` | high | intermediate | ✅ (74 MCQs · 33 adv/expert) |
| Load Balancing and Auto Scaling: ALB, NLB, GWLB and ASG | `aws-load-balancing-elb-autoscaling` | high | intermediate | ✅ (80 MCQs · 36 adv/expert) |
| AWS IAM Deep Dive: Identities, Policies and Access Control | `aws-security-iam-deep-dive` | high | advanced | ✅ (80 MCQs · 39 adv/expert) |
| Data Protection and App Security: KMS, Secrets, Cognito and WAF | `aws-security-kms-secrets-cognito-waf` | high | intermediate | ✅ (78 MCQs · 43 adv/expert) |
| Observability on AWS: CloudWatch, X-Ray and CloudTrail | `aws-observability-cloudwatch-xray` | high | intermediate | ✅ (75 MCQs · 37 adv/expert) |
| Resilience and Disaster Recovery: Multi-AZ, Multi-Region and DR Strategies | `aws-resilience-multiregion-dr` | very-high | advanced | ✅ (80 MCQs · 42 adv/expert) |
| Analytics and Big Data on AWS: Data Lakes, Redshift, EMR and Athena | `aws-analytics-datalake-redshift-emr` | medium | advanced | ✅ (80 MCQs · 41 adv/expert) |
| Microservices Patterns on AWS: Decomposition, Saga, Outbox and Communication | `aws-microservices-patterns` | very-high | advanced | ✅ (76 MCQs · 35 adv/expert) |
| ML and GenAI System Design on AWS: SageMaker, Bedrock and RAG | `aws-ml-genai-sagemaker-bedrock` | high | advanced | ✅ (78 MCQs · 41 adv/expert) |
| IoT and Edge Computing on AWS: IoT Core, Greengrass and Edge | `aws-iot-edge-computing` | medium | advanced | ✅ (80 MCQs · 38 adv/expert) |
| Migration and Modernization Strategies on AWS | `aws-migration-modernization` | medium | intermediate | ✅ (78 MCQs · 36 adv/expert) |
| Cost Optimization and Scaling Trade-offs on AWS | `aws-cost-optimization-scaling` | high | advanced | ✅ (74 MCQs · 30 adv/expert) |
| End-to-End AWS Reference Architectures: Designing Real Systems | `aws-reference-architectures` | very-high | advanced | ✅ (80 MCQs · 34 adv/expert) |

### SaaS and Multi-Tenancy on AWS (5 topics)

AWS-specific companion to the vendor-neutral core `multi-tenancy-and-saas-isolation`
topic: the tenant-isolation architecture patterns (Organizations/OU governance →
account → VPC → subnet → container → data-layer), control-plane vs application-plane,
SaaS identity/routing, data partitioning, and metering/tiering/throttling. Anchored on
the AWS Well-Architected SaaS Lens + SaaS Factory guidance and the Nagarro six-pattern
article. **389 MCQs.**

| Topic | Slug | Freq | Difficulty | Status |
|---|---|---|---|---|
| AWS SaaS and Multi-Tenancy Foundations | `aws-saas-multitenancy-foundations` | high | beginner | ✅ (81 MCQs · 38 adv/expert) |
| AWS Tenant Isolation Architecture Patterns | `aws-saas-isolation-patterns` | high | advanced | ✅ (76 MCQs · 36 adv/expert) |
| AWS SaaS Tenant Identity, Context and Routing | `aws-saas-tenant-identity-and-routing` | high | advanced | ✅ (66 MCQs · 30 adv/expert) |
| AWS SaaS Data Partitioning and Isolation | `aws-saas-data-partitioning` | high | advanced | ✅ (96 MCQs · 51 adv/expert) |
| AWS SaaS Metering, Tiering, Throttling and Cost-per-Tenant | `aws-saas-metering-tiering-throttling` | high | advanced | ✅ (76 MCQs · 36 adv/expert) |

All 31 AWS topics: deep trade-off + service-selection concepts.md with service limits,
comparison tables, cost reasoning, Mermaid/ASCII diagrams, and end-to-end reference
designs; validated MCQs across all four tiers (heavy scenario/judgment + AWS-fact style).

## AWS Cloud Design Patterns (7 topics)

The classic AWS Cloud Design Patterns catalog (46 patterns, from clouddesignpattern.org),
taught **"classic intent → modern AWS equivalent"** — each ~2012-2015 EC2-era pattern is
framed by the problem it solves, the classic mechanism, and how you'd actually build it on
AWS today (many are now managed-service features). Overlaps with the AWS deep-dives are
cross-referenced, not re-taught. `aws-cdp-` slug prefix. **347 MCQs** (incl. 73 select-all
multi-select), all four tiers.

| Topic | Slug | Freq | Difficulty | Status |
|---|---|---|---|---|
| Basics and High Availability | `aws-cdp-basic-and-ha` | medium | intermediate | ✅ (49 MCQs · 10 multi) |
| Dynamic Content and Scaling | `aws-cdp-dynamic-content` | medium | intermediate | ✅ (50 MCQs · 10 multi) |
| Static Content Delivery and Data Upload | `aws-cdp-static-content-and-upload` | medium | intermediate | ✅ (55 MCQs · 11 multi) |
| Relational Databases and Data Stores | `aws-cdp-rdbms-and-data` | medium | advanced | ✅ (48 MCQs · 10 multi) |
| Batch Processing and Asynchronous Workflows | `aws-cdp-batch-and-async` | medium | advanced | ✅ (46 MCQs · 10 multi) |
| Operation and Maintenance | `aws-cdp-operation-and-maintenance` | medium | intermediate | ✅ (48 MCQs · 12 multi) |
| Networking and Security | `aws-cdp-network` | medium | advanced | ✅ (51 MCQs · 10 multi) |

