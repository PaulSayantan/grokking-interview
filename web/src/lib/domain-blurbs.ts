/**
 * One-to-two-line description per domain — the single source of truth for the
 * marketing/context blurb shown on the landing page and the /domain/<slug> hero.
 * Keep each blurb tight (roughly ≤ 160 chars): what the domain covers + why it
 * matters in an interview. Keyed by domain slug.
 */
export const DOMAIN_BLURBS: Record<string, string> = {
  "system-design": "Scaling, caching, consistency, messaging, and cloud architecture — the whiteboard round that decides senior and staff offers.",
  "spring-boot": "Auto-configuration, starters, actuator, testing slices, and production readiness — how real Spring services are built and shipped.",
  "spring-core": "IoC and the bean lifecycle, AOP, and declarative transactions — how the Spring container actually works under the hood.",
  "java-jvm": "Language depth, JVM internals, memory model, garbage collection, and concurrency — from Java 8 idioms to modern JDK 17/21 features.",
  "rest-api-design": "Resource modeling, versioning, idempotency, pagination, error contracts, and gateways — designing HTTP APIs that age well.",
  networking: "TCP, TLS, HTTP/1.1 through HTTP/3, DNS, and QUIC — the protocols beneath every distributed system, down to the packets.",
  security: "OWASP Top 10, authentication and OAuth2/OIDC, JWTs, session and crypto foundations — the appsec questions that filter senior engineers.",
  "messaging-databases": "SQL and NoSQL internals, indexing, transactions and isolation, replication and sharding, plus Kafka, Redis, and RabbitMQ.",
  testing: "The test pyramid, doubles, TDD/BDD, integration with Testcontainers, contract and mutation testing, and taming flaky suites.",
  observability: "Metrics, logs, and traces with OpenTelemetry, Prometheus, and Grafana — plus SLOs, error budgets, and actionable alerting.",
  "devops-cicd": "CI/CD pipelines, Infrastructure as Code with Terraform, deployment strategies, GitOps, and DevSecOps across the delivery lifecycle.",
  docker: "Container fundamentals and internals — images and layers, the build cache, namespaces and cgroups, networking, and the OCI runtime chain.",
  kubernetes: "The control plane, workloads and scheduling, services and ingress, config and RBAC, and operating clusters from pods to service mesh.",
  "interview-craft": "STAR stories, leadership principles, the seniority ladder, estimation, ADRs, and negotiation — the behavioral round, done deliberately.",
  "dsa-coding": "How the built-in data structures really work, complexity analysis, and the recurring problem-solving patterns that unlock most coding rounds.",
  "lld-and-ood": "Object-oriented design under time pressure — SOLID, UML, and the machine-coding round: parking lots, rate limiters, and more as clean, extensible code.",
  "reliability-ops": "SLOs and error budgets, resilience patterns (retries, circuit breakers, bulkheads), incident response, chaos engineering, and disaster recovery.",
  "hibernate-jpa": "The ORM layer in depth — persistence context, entity lifecycle, the N+1 problem, caching, and locking across JPA and Hibernate 6/7.",
  grpc: "High-performance RPC with Protocol Buffers over HTTP/2 — the four streaming modes, schema evolution, deadlines, and gRPC versus REST.",
};

/** Blurb for a domain, or a sensible generic fallback built from the count. */
export function domainBlurb(slug: string, subtopicCount?: number): string {
  return (
    DOMAIN_BLURBS[slug] ??
    (subtopicCount
      ? `Interview-grade study notes and practice across ${subtopicCount} subtopics.`
      : "Interview-grade study notes and practice questions.")
  );
}
