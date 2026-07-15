export const meta = {
  name: 'spring-core-authoring',
  description: 'Author interview-grade concepts.md + beginner/intermediate MCQ questions.yaml for all 19 Spring Core topics, then verify each for factual accuracy and schema compliance',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + beginner/intermediate questions.yaml' },
    { title: 'Verify', detail: 'fact-check + schema-check each topic, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/spring-core`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md — the study/answer content:
   - Begins with a single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (these are the MCQ anchor targets — keep them stable).
   - IMPORTANT: heading text must NOT contain '/' or '&' (they break anchor slugs). Use commas or "and".
   - Write FULL interview-grade content, LAYERED beginner → intermediate → advanced internals.
     (Author the deep material even though this pass's MCQs are only beginner/intermediate —
     advanced/expert questions will be added in a later pass and must not require rewriting notes.)
   - Include code snippets and comparison tables where they clarify.
   - End with a "## Common follow-up questions" section and a "## References" section.
   - Factual accuracy is critical. This is the SPRING FRAMEWORK (core), not Spring Boot — focus on
     the framework itself (javax vs jakarta note where relevant; Spring Framework 6.x on Jakarta).
     Do NOT assume Spring Boot features (no auto-configuration, starters, @SpringBootApplication) except
     where a topic explicitly contrasts Spring vs Spring Boot.

2) questions.yaml — the MCQ bank. Top-level keys:
     topic: "<Topic Name>"        # matches the concepts.md H1
     domain: spring-core
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001     # globally unique within the file, zero-padded 3-digit seq starting 001
         difficulty: beginner      # THIS PASS: only 'beginner' or 'intermediate'
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
         ref: "concepts.md#<anchor>"   # deep-link to a concepts.md "## " heading (GitHub slug: lowercase, spaces->-, punctuation stripped)

   RULES FOR THIS PASS:
   - Produce 35-45 questions. Cover EVERY subtopic with several questions each.
   - DIFFICULTY: ONLY 'beginner' and 'intermediate' this pass (roughly 45% beginner, 55% intermediate).
     Do NOT write advanced/expert questions now — those come in a later deepening pass.
   - 3-5 options per question, EXACTLY ONE correct. 'answer' is 0-based. Vary the correct index.
   - Mix short factual questions with some descriptive/scenario-style ones (plausible longer options),
     but keep them at beginner/intermediate cognitive level (definitions, comparisons, "what does this do",
     basic "which is correct" — not deep internals or tricky edge-case traps).
   - No "all of the above" / "none of the above".
   - Every 'ref' anchor MUST resolve to an actual "## " heading in concepts.md.
   - id prefix MUST equal the topic-slug.

Use the Write tool to create both files. Do your own web research to ensure correctness.
Return one line: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions, beginner+intermediate)".
`

const TOPICS = [
  { slug: 'ioc-container-applicationcontext-vs-beanfactory', name: 'IoC Container: ApplicationContext vs BeanFactory',
    hints: 'IoC principle & why; the container\'s job; BeanFactory (lazy, basic DI) vs ApplicationContext (eager singletons, i18n, events, AOP, resource loading, BeanPostProcessor auto-registration); common ApplicationContext implementations (ClassPathXmlApplicationContext, AnnotationConfigApplicationContext, GenericApplicationContext); container startup / refresh() at a high level; when a plain BeanFactory would ever be used.' },
  { slug: 'dependency-injection-types', name: 'Dependency Injection Types',
    hints: 'DI vs IoC; constructor vs setter vs field injection; pros/cons of each; why constructor injection is preferred (immutability, mandatory deps, testability, no partially-constructed beans); setter for optional/reconfigurable deps; why field injection is discouraged; method injection basics; injecting collections/maps.' },
  { slug: 'bean-definition-stereotype-annotations', name: 'Bean Definition and Stereotype Annotations',
    hints: '@Component/@Service/@Repository/@Controller and what distinguishes them (semantics, @Repository exception translation); @Bean vs @Component (who instantiates, factory methods, third-party classes); @Configuration classes; component scanning basics (@ComponentScan, basePackages, include/exclude filters); meta-annotations; XML vs annotation vs Java config.' },
  { slug: 'bean-scopes', name: 'Bean Scopes',
    hints: 'singleton (default, one per container — not JVM-wide) vs prototype (new each request); web scopes request/session/application/websocket; singleton thread-safety responsibility; when to use prototype; injecting a prototype into a singleton (the problem + ObjectProvider/@Lookup/scoped proxy solutions at intro level); custom scopes exist.' },
  { slug: 'bean-lifecycle-callbacks', name: 'Bean Lifecycle and Lifecycle Callbacks',
    hints: 'lifecycle phases: instantiation → dependency population → aware interfaces → BeanPostProcessor before-init → init callbacks → ready → destroy callbacks; the three init/destroy mechanisms (@PostConstruct/@PreDestroy, InitializingBean/DisposableBean, @Bean initMethod/destroyMethod) and their ORDER; BeanPostProcessor vs BeanFactoryPostProcessor (what/when each acts); prototype destruction not called by container.' },
  { slug: 'autowired-qualifier-autowiring-resolution', name: '@Autowired, @Qualifier, and Autowiring Resolution',
    hints: 'how @Autowired resolves (by type, then by qualifier/name); NoUniqueBeanDefinitionException on ambiguity; @Qualifier vs @Primary; required=false and Optional / ObjectProvider; @Resource (by name) vs @Inject vs @Autowired; injecting List/Map/array of beans; @Autowired on constructor (optional since 4.3 for single ctor).' },
  { slug: 'circular-dependencies', name: 'Circular Dependencies',
    hints: 'what a circular dependency is; why constructor-injection cycles cannot be resolved (BeanCurrentlyInCreationException); how setter/field cycles ARE resolved via the singleton caches (intro to the three-level cache / early references); Spring Boot 2.6+ prohibits circular refs by default & spring.main.allow-circular-references; fixes (@Lazy, redesign, setter injection, ObjectProvider).' },
  { slug: 'spring-aop-and-proxies', name: 'Spring AOP and Proxies',
    hints: 'cross-cutting concerns; core terms aspect/advice/join point/pointcut/weaving/target/proxy; advice types (@Before/@After/@AfterReturning/@AfterThrowing/@Around); @Aspect & @EnableAspectJAutoProxy; JDK dynamic proxy (interfaces) vs CGLIB (subclass) and when each is chosen; self-invocation limitation (proxy bypass) at intro level; Spring AOP vs full AspectJ.' },
  { slug: 'configuration-profiles-properties', name: 'Configuration, Profiles, and Externalized Properties',
    hints: '@Configuration + @Bean; @PropertySource; Environment abstraction; @Value with property placeholders and defaults; @Profile (activating via spring.profiles.active); default profile; PropertySourcesPlaceholderConfigurer; property vs YAML is a Boot concern — here focus on core Environment/PropertySource model.' },
  { slug: 'spring-vs-spring-boot', name: 'Spring vs Spring Boot',
    hints: 'Spring Framework = the core DI/AOP/MVC/tx libraries; Spring Boot = opinionated layer on top (auto-configuration, starters, embedded server, @SpringBootApplication, actuator, sensible defaults); Boot does NOT replace Spring — it builds on it; what problems Boot solves (boilerplate config, dependency management, deployment); when you might use plain Spring.' },
  { slug: 'transaction-management-events', name: 'Transaction Management and Events',
    hints: 'declarative vs programmatic tx; @Transactional & PlatformTransactionManager; @EnableTransactionManagement; propagation (REQUIRED, REQUIRES_NEW, NESTED — intro) & isolation levels (names + what they prevent); rollback rules (default only unchecked exceptions); readOnly; the proxy-based self-invocation/private-method limitation (intro); application events: ApplicationEvent, ApplicationEventPublisher, @EventListener, synchronous-by-default, @TransactionalEventListener.' },
  { slug: 'spring-mvc-request-lifecycle', name: 'Spring MVC and the Request Lifecycle',
    hints: 'DispatcherServlet as front controller; request flow: DispatcherServlet → HandlerMapping → HandlerAdapter → controller → returns Model/View or body → ViewResolver → render; @Controller vs @RestController; @RequestMapping / @GetMapping etc.; @PathVariable/@RequestParam/@RequestBody/@ModelAttribute; HandlerInterceptor vs Servlet Filter (intro); ResponseEntity.' },
  { slug: 'web-exception-handling', name: 'Exception Handling in the Web Layer',
    hints: '@ExceptionHandler (controller-local); @ControllerAdvice / @RestControllerAdvice (global); ResponseEntityExceptionHandler; mapping exceptions to HTTP status (@ResponseStatus); building consistent error responses; ProblemDetail (RFC 7807) in Spring 6 (intro); HandlerExceptionResolver concept.' },
  { slug: 'spring-data-persistence', name: 'Spring Data and Persistence Integration',
    hints: 'Spring Data vs JPA vs Hibernate distinction; repository abstraction (Repository, CrudRepository, PagingAndSortingRepository, JpaRepository); derived query methods; @Query (JPQL vs native); Pageable/Sort; JdbcTemplate basics; DataAccessException hierarchy & the @Repository exception translation; the N+1 problem at intro level; EntityManager vs Session (brief).' },
  { slug: 'testing-spring-applications', name: 'Testing Spring Applications',
    hints: 'spring-test module; @ContextConfiguration / @SpringJUnitConfig; loading and CACHING the application context across tests; @MockBean / @Mock (and how they differ); MockMvc for web-layer tests; @Transactional test rollback; profiles in tests (@ActiveProfiles); unit test (no context) vs integration test (with context); note @SpringBootTest is a Boot slice, contrast briefly.' },
  { slug: 'advanced-bean-wiring', name: 'Advanced Bean Wiring: FactoryBean, @Lazy, and Custom Registration',
    hints: 'FactoryBean<T> (getObject returns the bean; & prefix to get the factory itself) vs a @Bean factory method; @Lazy (defer creation; and as a way to break cycles); ObjectProvider / ObjectFactory for on-demand & optional lookup; @Lookup method injection; programmatic registration (BeanDefinitionRegistry, @Import, ImportBeanDefinitionRegistrar/ImportSelector at intro level); conditional registration idea.' },
  { slug: 'spel-and-value', name: 'Spring Expression Language (SpEL) and @Value',
    hints: 'what SpEL is; #{...} expression vs ${...} property placeholder (key difference!); @Value with literals, property placeholders, defaults, and SpEL; referencing beans (@bean.method()), properties, collections, operators, ternary/Elvis; T() for static access; common use cases and where SpEL is evaluated.' },
  { slug: 'actuator-observability', name: 'Actuator, Observability, and Production Concerns',
    hints: 'purpose of Actuator (production monitoring endpoints — a Boot module); key endpoints /health /info /metrics /env /beans /loggers; exposing & securing endpoints; custom health indicator; Micrometer as the metrics facade; liveness/readiness (intro); logging/observability basics. Note Actuator is a Spring Boot feature; frame accordingly.' },
  { slug: 'async-scheduling-caching', name: 'Asynchronous, Scheduled, and Caching Support',
    hints: '@EnableAsync + @Async (return void/Future/CompletableFuture; runs on a TaskExecutor; proxy self-invocation caveat); @EnableScheduling + @Scheduled (fixedRate vs fixedDelay vs cron); @EnableCaching + @Cacheable/@CacheEvict/@CachePut; CacheManager abstraction; all three are proxy/AOP-based (so self-invocation & same-class calls bypass them) — intro level.' },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior Spring Framework engineer and interview coach authoring study material for the SPRING FRAMEWORK CORE topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `FOCUS / frequently-asked subtopics to cover:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . This pass: full-depth concepts, but ONLY beginner+intermediate MCQs (35-45).`,
    { label: `author:${t.slug}`, phase: 'Author', effort: 'high' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous technical reviewer verifying Spring Framework CORE interview content for topic "${t.name}" (slug: ${t.slug}).\n\n` +
    `Read BOTH ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and FIX IN PLACE:\n` +
    `1) FACTUAL errors in concepts or MCQ answers/explanations — web-research anything uncertain (Spring Framework 6.x / Jakarta). A wrong 'answer' index is the worst defect. Ensure content is about the FRAMEWORK, not Spring-Boot-specific behavior (except the explicit Spring-vs-Boot topic and the Actuator topic, which is a Boot feature).\n` +
    `2) SCHEMA: valid YAML; top-level topic/domain(spring-core)/topic_slug(${t.slug})/version/questions; each question has id (prefix '${t.slug}-', unique, contiguous 3-digit seq from 001), difficulty in {beginner,intermediate} ONLY (re-tag or remove any advanced/expert — those are for a later pass), question, 3-5 options, 0-based in-range 'answer', explanation; correct-option index VARIED.\n` +
    `3) Every 'ref: concepts.md#anchor' resolves to a real '## ' heading (GitHub slug rules; note headings must not contain '/' or '&' — if any do, rename the heading with a comma/"and" and update refs).\n` +
    `4) COVERAGE: 35-45 questions, every subtopic represented, beginner+intermediate mix. If thin, ADD questions (beginner/intermediate only).\n\n` +
    `Return one line: "${t.slug}: <total> questions (<nBeginner>/<nIntermediate>), <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
