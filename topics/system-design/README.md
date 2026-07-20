# System Design

23 core + 8 advanced/expert deep-dive topics + 26 AWS System Design topics (57 total).
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

## AWS System Design (26 topics)

Designing microservices and large-scale systems with AWS primitives (SQS, DynamoDB,
ECS/EKS, EC2, Lambda, S3, and more). Same depth/trade-off bar as the core topics;
`aws-` slug prefix. **1,979 MCQs**, all four tiers, service-limit- and trade-off-heavy.

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

All 26 AWS topics: deep trade-off + service-selection concepts.md with service limits,
comparison tables, cost reasoning, ASCII diagrams, and end-to-end reference designs;
validated MCQs across all four tiers (heavy scenario/judgment + AWS-fact style).

