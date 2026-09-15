export const meta = {
  name: 'spring-boot-authoring',
  description: 'Author interview-grade concepts.md + a large MCQ questions.yaml for all 18 Spring Boot topics, then verify each for factual accuracy and schema compliance',
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
const DIR = `${REPO}/topics/spring-boot`

// Shared contract every agent must follow (mirrors docs/content-schema.md).
const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md — the study/answer content:
   - Begins with a single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (these are the MCQ anchor targets — keep them stable).
   - Interview-grade answers, LAYERED: beginner definition + why it matters → intermediate
     trade-offs/comparisons → advanced internals/gotchas (e.g. bean creation flow, proxy/CGLIB,
     3-level singleton cache, transaction proxy self-invocation, N+1, etc. where relevant).
   - Include code snippets and comparison tables where they clarify.
   - End with a "## Common follow-up questions" section and a "## References" section
     (link to official Spring / Baeldung / reference docs you used).
   - Factual accuracy is critical. Verify version-specific behavior; note Jakarta EE
     (jakarta.* vs javax.*) and Spring Boot 3.x specifics where relevant.

2) questions.yaml — the MCQ bank. Top-level keys:
     topic: "<Topic Name>"        # matches the concepts.md H1
     domain: spring-boot
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001     # globally unique within the file, zero-padded 3-digit seq
         difficulty: beginner      # one of: beginner | intermediate | advanced
         tags: [kebab, tokens]
         question: |
           <prompt>
         options:
           - "<option 0>"
           - "<option 1>"
           - "<option 2>"
           - "<option 3>"
         answer: 2                 # 0-BASED index of the correct option
         explanation: |
           <why the correct answer is right; teach the concept>
         ref: "concepts.md#<anchor>"   # deep-link to the concepts.md H2 (GitHub slug: lowercase, spaces->-, punctuation stripped)

   RULES:
   - Produce 50-60 questions (minimum 40). Cover EVERY subtopic with several questions each.
   - 3-5 options per question, EXACTLY ONE correct. 'answer' is 0-based.
   - VARY the correct option's position across the file (do not cluster on one index).
   - Mixed difficulty across beginner/intermediate/advanced.
   - INCLUDE long, descriptive, scenario-style questions with lengthy plausible options
     (not just one-word answers) to genuinely challenge the learner — e.g. "given this code
     snippet / this scenario, which statement is correct?". Distractors must be plausible
     but wrong for a real reason.
   - No "all of the above" / "none of the above".
   - Every 'ref' anchor MUST resolve to an actual "## " heading in concepts.md.
   - id prefix MUST equal the topic-slug.

Use the Write tool to create both files. Do your own web research to ensure correctness and
completeness. Return a one-line summary: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

// Merged reference syllabus from the two user-provided PDFs (ChatGPT 46-section + Gemini 14-section),
// so agents don't miss frequently-asked subtopics. Each topic below also has focused subtopic hints.
const SYLLABUS_NOTE = `
This taxonomy was cross-checked against two exhaustive interview syllabi. Ensure your topic
covers the frequently-asked angles listed in its focus hints. Where a concept has famous
"trap" questions (e.g. @Transactional self-invocation, field vs constructor injection,
@Bean vs @Component, PUT vs PATCH, N+1, JDK proxy vs CGLIB), include them.
`

const TOPICS = [
  { slug: 'fundamentals-autoconfiguration-starters', name: 'Spring Boot Fundamentals, Auto-Configuration & Starters',
    hints: 'Spring vs Spring Boot; @SpringBootApplication (=@Configuration+@EnableAutoConfiguration+@ComponentScan); SpringApplication.run() flow; convention over configuration; auto-configuration mechanism (@EnableAutoConfiguration, spring.factories vs AutoConfiguration.imports in Boot 2.7+/3.x); @ConditionalOnClass/OnBean/OnMissingBean/OnProperty; how to disable auto-config; writing custom auto-configuration; starter dependencies (what they are, custom starter, dependency/version management via BOM); embedded server; fat/executable JAR & layered JAR; SpringFactoriesLoader.' },
  { slug: 'ioc-dependency-injection', name: 'IoC Container & Dependency Injection',
    hints: 'IoC vs DI; loose coupling; BeanFactory vs ApplicationContext; context hierarchy; constructor vs setter vs field injection (why field injection is discouraged, immutability, testability); @Autowired resolution algorithm; @Qualifier vs @Primary; @Resource vs @Inject vs @Autowired; required=false / Optional injection; collections/map injection; circular dependencies & the three-level singleton cache; @Lazy injection; when beans are created.' },
  { slug: 'bean-scopes-lifecycle', name: 'Bean Scopes & Lifecycle',
    hints: 'Scopes: singleton (default), prototype, request, session, application, websocket, custom; singleton vs prototype; thread safety of singletons; full bean lifecycle (instantiation → populate → aware → BeanPostProcessor before-init → @PostConstruct/InitializingBean/init-method → post-init → use → @PreDestroy/DisposableBean/destroy-method); BeanPostProcessor vs BeanFactoryPostProcessor vs BeanDefinitionRegistryPostProcessor; SmartLifecycle; order of callbacks; prototype destruction caveat.' },
  { slug: 'core-annotations-stereotypes', name: 'Core Annotations & Stereotypes',
    hints: '@Component/@Service/@Repository/@Controller/@RestController differences; @Repository exception translation; meta-annotations; component scanning (how it works, include/exclude filters, basePackages); @Configuration (full vs lite mode, CGLIB proxying of @Bean methods) vs @Component; @Bean vs @Component; @Import; @Value and property injection; SpEL basics and use cases; @Primary vs @Qualifier.' },
  { slug: 'configuration-profiles-properties', name: 'Configuration, Profiles & Externalized Properties',
    hints: 'application.properties vs application.yml; @Value vs @ConfigurationProperties (type-safe, relaxed binding, validation); property source precedence order (command-line, env vars, profile-specific, etc.); externalized configuration; environment variables & command-line args; @Profile; default profile; multiple/active profiles; environment-specific configs; @PropertySource; Environment abstraction.' },
  { slug: 'spring-mvc-rest-apis', name: 'Spring MVC & REST APIs',
    hints: 'DispatcherServlet front-controller flow (HandlerMapping, HandlerAdapter, ViewResolver, Model/View); request lifecycle; @Controller vs @RestController; request mapping (@RequestMapping/@GetMapping/etc.); @PathVariable/@RequestParam/@RequestBody/@RequestHeader/@CookieValue; multipart upload; ResponseEntity; REST principles & Richardson maturity; HTTP methods & status codes; idempotency; PUT vs PATCH vs POST; DTO; content negotiation (XML vs JSON); pagination/sorting/filtering; API versioning; HATEOAS; filters vs interceptors; CORS.' },
  { slug: 'exception-handling-validation', name: 'Exception Handling & Validation',
    hints: '@ExceptionHandler; @ControllerAdvice / @RestControllerAdvice; ResponseEntityExceptionHandler; global exception handling & consistent error responses (ProblemDetail RFC 7807 in Boot 3); mapping exceptions to status codes; Bean Validation (Jakarta) & Hibernate Validator; @Valid vs @Validated (groups); @Valid + BindingResult; validating path/query params; custom constraint validators; cascading validation.' },
  { slug: 'spring-data-jpa-persistence', name: 'Spring Data JPA & Persistence',
    hints: 'Spring Data JPA vs Hibernate vs JPA; repository hierarchy (Repository, CrudRepository, PagingAndSortingRepository, JpaRepository); derived query methods; @Query JPQL vs native; @Modifying; Specifications & Criteria; projections; pagination & sorting (Pageable); save() vs saveAndFlush(); entity lifecycle states (transient/managed/detached/removed); persistence context; EntityManager vs Session; dirty checking; flush modes; fetch types (lazy vs eager); N+1 problem & fixes (fetch join, @EntityGraph, batch size); cascade types; orphanRemoval; first vs second level cache; optimistic vs pessimistic locking; @Version; auditing.' },
  { slug: 'transaction-management', name: 'Transaction Management',
    hints: 'ACID; declarative vs programmatic; @Transactional mechanics (AOP proxy); PlatformTransactionManager; propagation (REQUIRED, REQUIRES_NEW, NESTED, SUPPORTS, MANDATORY, NEVER, NOT_SUPPORTED); isolation levels (READ_UNCOMMITTED..SERIALIZABLE) & anomalies (dirty/non-repeatable/phantom); rollback rules (rollbackFor — default only unchecked/Error); readOnly; timeout; the classic trap: @Transactional does NOT work on private methods or self-invocation (proxy bypass) and why; REQUIRED vs REQUIRES_NEW.' },
  { slug: 'aop-filters-interceptors', name: 'AOP, Filters & Interceptors',
    hints: 'AOP concepts: aspect, advice, join point, pointcut, weaving, target, proxy; advice types (@Before, @After, @AfterReturning, @AfterThrowing, @Around); @Aspect; pointcut expressions; JDK dynamic proxy vs CGLIB (interface vs class, final methods, self-invocation limitation); Spring AOP vs AspectJ (proxy-based runtime vs compile/load-time weaving, capabilities); ordering; use cases (logging, security, tx, caching); Servlet Filter vs HandlerInterceptor vs @Aspect — where each sits in the chain and when to use which.' },
  { slug: 'spring-security-basics', name: 'Spring Security Basics',
    hints: 'Authentication vs authorization; security filter chain & how a request flows; SecurityFilterChain / lambda DSL (Boot 3, no WebSecurityConfigurerAdapter); SecurityContext & SecurityContextHolder; UserDetailsService & UserDetails; AuthenticationManager/Provider; PasswordEncoder & BCrypt; form login vs basic vs stateless; JWT stateless auth (structure header.payload.signature, access vs refresh token, expiry, blacklisting/revocation); CSRF (why disabled for stateless APIs); CORS; session management; method security (@PreAuthorize/@Secured/@RolesAllowed differences); RBAC vs ABAC; OAuth2 grant types & PKCE (brief).' },
  { slug: 'actuator-monitoring-embedded-servers', name: 'Actuator, Monitoring & Embedded Servers',
    hints: 'Actuator purpose; key endpoints (/health, /metrics, /info, /env, /beans, /mappings, /loggers, /threaddump); exposing/securing endpoints (management.endpoints); custom health indicators; liveness/readiness probes; Micrometer & meter registries; Prometheus/Grafana; custom metrics; embedded servers (Tomcat default, Jetty, Undertow) & switching; embedded Tomcat startup; graceful shutdown; distributed tracing (Micrometer Tracing / OpenTelemetry, Zipkin/Jaeger), MDC/correlation IDs, logging (SLF4J/Logback/Log4j2).' },
  { slug: 'testing-spring-boot-applications', name: 'Testing Spring Boot Applications',
    hints: 'Test pyramid in Boot; @SpringBootTest (webEnvironment options, full context) vs slice tests @WebMvcTest / @DataJpaTest / @JsonTest / @RestClientTest; @MockBean vs Mockito @Mock (and @SpyBean); MockMvc (testing controllers without a running server) vs TestRestTemplate/WebTestClient; @DataJpaTest defaults (in-memory DB, rollback); Testcontainers for real DB/integration; JUnit 5 + Mockito basics; @TestConfiguration; test slices & context caching; verifying transactions.' },
  { slug: 'async-scheduling-events', name: 'Asynchronous Processing, Scheduling & Application Events',
    hints: '@EnableScheduling & @Scheduled (fixedRate vs fixedDelay vs cron, initialDelay); ThreadPoolTaskScheduler; @EnableAsync & @Async (return void/Future/CompletableFuture, custom TaskExecutor, exception handling via AsyncUncaughtExceptionHandler, proxy self-invocation caveat); application events: ApplicationEvent/ApplicationEventPublisher/@EventListener; @TransactionalEventListener; async events (@Async on listener); synchronous-by-default event semantics.' },
  { slug: 'caching-abstraction', name: 'Caching Abstraction',
    hints: '@EnableCaching; @Cacheable/@CachePut/@CacheEvict/@Caching; key generation & SpEL keys; condition/unless; CacheManager abstraction; providers (Caffeine, Ehcache, Redis, Hazelcast, simple ConcurrentMap); cache eviction/TTL; cache stampede considerations; proxy self-invocation caveat (same as @Transactional/@Async); when caching helps vs hurts.' },
  { slug: 'reactive-webflux', name: 'Reactive Programming with Spring WebFlux',
    hints: 'Reactive programming & Reactive Streams; Mono vs Flux; publisher/subscriber/subscription/backpressure; Project Reactor operators (map/flatMap/zip); MVC (servlet, blocking, thread-per-request) vs WebFlux (event-loop, non-blocking, Netty); when to choose WebFlux; WebClient vs RestTemplate; functional endpoints (RouterFunction/HandlerFunction) vs annotated controllers; schedulers; common pitfalls (blocking in reactive chain).' },
  { slug: 'microservices-spring-cloud-resilience', name: 'Microservices, Spring Cloud & Resilience',
    hints: 'Monolith vs microservices trade-offs; API Gateway (Spring Cloud Gateway) role; service discovery (Eureka); distributed/centralized config (Spring Cloud Config, Bus); client load balancing (Spring Cloud LoadBalancer); declarative clients (OpenFeign); resilience patterns with Resilience4j (circuit breaker states, retry, rate limiter, bulkhead, time limiter); distributed tracing (Sleuth/Micrometer Tracing); saga, CQRS, event sourcing, idempotency, rate limiting; graceful degradation.' },
  { slug: 'messaging-event-driven-integration', name: 'Messaging & Event-Driven Integration',
    hints: 'Event-driven architecture; JMS; RabbitMQ (exchanges, queues, bindings, routing keys, ack); Apache Kafka with Spring (KafkaTemplate, @KafkaListener, topics/partitions/consumer groups/offsets, delivery semantics at-most/at-least/exactly-once, idempotent producer); ActiveMQ; message ordering, retries, dead-letter queues; idempotent consumers; sync request/response vs async messaging; comparing Kafka vs RabbitMQ.' },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior Spring/Spring Boot engineer and interview coach authoring study material for the topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SYLLABUS_NOTE}\n` +
    `FOCUS / frequently-asked subtopics to cover for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . Aim high on MCQ count (50-60).`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous technical reviewer verifying interview study content for the Spring Boot topic "${t.name}" (slug: ${t.slug}).\n\n` +
    `The files are at ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml . Read BOTH.\n\n` +
    `Check and FIX IN PLACE (using Edit/Write) any of:\n` +
    `1) FACTUAL ERRORS in concepts.md or in MCQ answers/explanations. Do web research to confirm anything uncertain, especially version-specific behavior (Spring Boot 3.x / Jakarta). A wrong 'answer' index or a misleading explanation is the worst defect — fix it.\n` +
    `2) SCHEMA violations in questions.yaml: valid YAML; top-level keys topic/domain(spring-boot)/topic_slug(${t.slug})/version/questions; each question has id (prefix '${t.slug}-', unique, 3-digit seq), difficulty in {beginner,intermediate,advanced}, question, 3-5 options, 0-based 'answer' in range, explanation; ids unique; correct-option position VARIED (not all same index) — if clustered, rewrite some.\n` +
    `3) Every 'ref: concepts.md#anchor' must resolve to an actual '## ' heading in concepts.md (GitHub slug rules). Fix mismatches.\n` +
    `4) COVERAGE: at least 40 (ideally 50+) questions, every subtopic represented, mixed difficulty, and some long/descriptive/scenario-style questions present. If the bank is thin or a subtopic is uncovered, ADD questions to reach the bar.\n\n` +
    `After fixing, return a JSON-free one-line verdict: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
