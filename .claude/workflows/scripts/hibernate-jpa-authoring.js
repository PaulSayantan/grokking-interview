export const meta = {
  name: 'hibernate-jpa-authoring',
  description: 'Author Hibernate & JPA study content for all 18 topics: ORM fundamentals, persistence context, entity lifecycle, mappings/associations, fetching & N+1, caching, JPQL/Criteria, locking, Spring Data JPA, modern Hibernate 6/7 + Jakarta migration. Author -> verify.',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact/version-precision check + boundary-scope check + schema check, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/hibernate-jpa`

const SCOPE_NOTE = `
DOMAIN SCOPE — "Hibernate & JPA" for BACKEND + SENIOR Java developer interviews. The ORM layer:
how JPA (the spec) and Hibernate (the reference implementation) map objects to relational tables,
manage the persistence context, and generate SQL — with the deep mechanism understanding that
separates a senior candidate (who understands the persistence context, dirty checking, flush order,
the N+1 problem, lazy proxies, and caching) from a junior who just calls save().

Ground everything in the CURRENT standards: Jakarta Persistence 3.1/3.2 (the jakarta.persistence.*
namespace — NOT the legacy javax.persistence.*), Hibernate ORM 6.x/7.x, and Spring Data JPA. Be
precise about versions: the javax -> jakarta namespace migration (Jakarta EE 9+), Hibernate 6's move
to jakarta + SQM (Semantic Query Model) + the new Hibernate 6/7 API, and where behavior differs
across versions. Show real annotations and real generated SQL.

BOUNDARY RULES (STRICT — cross-reference, do NOT duplicate other domains):
- messaging-databases OWNS SQL itself, B-tree/LSM internals, ACID isolation levels & anomalies,
  indexing, and transactions AT THE DATABASE LEVEL. HERE, teach how Hibernate/JPA USES the DB
  (dirty checking, flush, the persistence context, optimistic/pessimistic locking via JPA) and
  reference messaging-databases for the underlying DB mechanics.
- spring-boot / spring-core OWN the Spring container, @Transactional propagation/proxying, and
  auto-configuration. HERE, 'spring-data-jpa-repositories' teaches the JPA repository abstraction
  (derived queries, @Query, pagination, projections) and references spring-* for the container/tx
  proxy mechanics.
- system-design owns high-level data architecture. HERE stay at the ORM mechanism altitude.
When a topic overlaps, explicitly say "see <domain>/<topic>" and cover the Hibernate/JPA-specific angle.

Ground every claim (annotation names, generation strategies, fetch defaults — e.g. @ManyToOne/
@OneToOne default EAGER while @OneToMany/@ManyToMany default LAZY; cascade types; lock modes;
cache regions) in the Jakarta Persistence spec + Hibernate User Guide and verify anything uncertain.
`

const SCHEMA = `
CONTENT CONTRACT (follow exactly). Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1.
   - "## <Subtopic>" H2 per subtopic (MCQ anchor targets — keep stable).
   - Interview-grade depth: define the concept, explain the MECHANISM (what Hibernate actually does
     and WHY), show real annotations/entity code and the GENERATED SQL where it clarifies (e.g. the
     N+1 problem's SQL, a JOIN FETCH, an insert/update on flush), and always cover the TRADE-OFFS and
     GOTCHAS (this domain is full of them: LazyInitializationException, N+1, cascade surprises,
     equals/hashCode on entities, the first-level cache, flush order).
   - Use comparison tables where useful (lazy vs eager, cascade types, id-generation strategies,
     inheritance strategies SINGLE_TABLE/JOINED/TABLE_PER_CLASS, first vs second level cache,
     optimistic vs pessimistic locking).
   - Where a diagram clarifies (entity lifecycle state machine, persistence-context/flush flow,
     N+1 fan-out, cache lookup path), use a \`\`\`mermaid fenced block (stateDiagram-v2 / flowchart).
     NO ASCII-art. CRITICAL: no semicolons in sequenceDiagram message text (use commas).
   - End with "## Common Interview Follow-ups" and "## References".

2) questions.yaml — top-level keys:
     topic: "<Topic Name>"
     domain: hibernate-jpa
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
           <why correct; teach the concept>
         ref: "concepts.md#<anchor>"  # resolves to a real "## " heading (GitHub slug rules)

   RULES: aim for 40-60 MCQs per topic. Focus on: MECHANISM ("what does Hibernate do on flush?",
   "why does this throw LazyInitializationException?"), the N+1 problem + fixes, annotation/behavior
   precision ("what is the default fetch type of @OneToMany?"), and JUDGMENT/SCENARIO ("given this
   entity graph, which query avoids N+1?"). 3-5 options, exactly one correct, 0-based answer; VARY the
   correct index (no single index >40%, no guessable cycle); mixed difficulty; scenario items preferred;
   distractors plausible but wrong for a real reason (a common misconception makes a great distractor);
   no all/none-of-the-above; every 'ref' resolves to a real "## " heading; id prefix == slug. Quote any
   YAML option containing a colon+space or leading brace. Never let a WRONG-in-practice option (e.g.
   "entities should be mutable with no equals/hashCode", "EAGER everything") be the correct key.

Use the Write tool. Research to ensure annotation/version facts are correct. Return:
"<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'orm-fundamentals-jpa-vs-hibernate', name: 'ORM Fundamentals & JPA vs Hibernate', hints: "What ORM is + the object-relational impedance mismatch (granularity, inheritance, identity object==/equals vs DB PK, associations/directionality, data navigation/N+1); JPA = the SPEC (Jakarta Persistence, interfaces + annotations, jakarta.persistence.*) vs Hibernate = an IMPLEMENTATION (the reference/most-used JPA provider, plus Hibernate-native features beyond the spec); other providers (EclipseLink=reference impl of the spec, OpenJPA); the JPA architecture (EntityManagerFactory/EntityManager/persistence unit vs Hibernate SessionFactory/Session — Session extends/implements EntityManager in HB6); when to use an ORM vs plain JDBC/jOOQ/MyBatis (and when NOT to — bulk/reporting); Jakarta vs Java EE naming history (javax->jakarta). Cross-ref messaging-databases (SQL/JDBC)." },
  { slug: 'session-entitymanager-persistence-context', name: 'Session, EntityManager & Persistence Context', hints: "THE central concept: the PERSISTENCE CONTEXT = a first-level cache + a unit of work tracking managed entities; EntityManager (JPA) / Session (Hibernate) is the interface to it; guaranteed identity scope (repeatable read within a context — same PK returns the same object instance); how managed entities are tracked for DIRTY CHECKING; persistence-context scope: transaction-scoped (default, JTA/Spring) vs extended (@PersistenceContext(type=EXTENDED)); EntityManagerFactory/SessionFactory = expensive, thread-safe, one per app/persistence-unit vs EntityManager/Session = cheap, NOT thread-safe, one per request/tx; the operations (persist/find/merge/remove/detach/flush/clear/getReference); the L1 cache is mandatory & per-context (not shared); contains()/detach()/clear(). Cross-ref transactions-dirty-checking-flushing." },
  { slug: 'entity-lifecycle-states', name: 'Entity Lifecycle States', hints: "The FOUR states + transitions (a classic interview question): TRANSIENT/NEW (just newed, no PK, not associated with a context), MANAGED/PERSISTENT (associated with a persistence context, tracked, dirty-checked, PK assigned), DETACHED (was managed, context closed or evict/detach/clear — has PK but not tracked), REMOVED (scheduled for delete on flush). The transition operations: persist (transient->managed), find/load (->managed), merge (detached->returns a managed copy — merge does NOT make the passed instance managed!), remove (managed->removed), detach/clear/close (managed->detached), refresh. persist vs merge vs save/saveOrUpdate (Hibernate-native) vs Spring Data save(); what happens to a transient vs detached passed to each; re-attaching. A stateDiagram-v2 of the lifecycle is ideal. Common gotcha: modifying a detached entity does nothing until merge." },
  { slug: 'primary-keys-and-id-generation', name: 'Primary Keys & ID Generation Strategies', hints: "@Id + @GeneratedValue strategies and their MECHANICS: IDENTITY (DB auto-increment/identity column — disables JDBC batch inserts because the ID is only known after insert!), SEQUENCE (DB sequence, the DEFAULT & preferred for most DBs, supports pooled/hi-lo allocation via allocationSize to reduce round-trips), TABLE (a table emulating a sequence — portable but slow/contended, avoid), AUTO (provider picks — HB6 picks SEQUENCE or a sequence-table, changed from GenerationType by dialect). @SequenceGenerator/@TableGenerator config; the allocationSize/pooled optimizer (hi-lo, pooled, pooled-lo) trade-offs; natural vs surrogate keys; composite keys preview (see inheritance topic); UUID generation (@GeneratedValue for UUID in JPA 3.1, UUIDv7 ordered vs v4 random & index locality — cross-ref messaging-databases key design); why IDENTITY hurts batch performance. Equals/hashCode with generated ids (the assigned-after-persist problem)." },
  { slug: 'entity-mappings-associations', name: 'Entity Mappings & Associations', hints: "@Entity/@Table/@Column basics + the association mappings that dominate interviews: @OneToOne, @OneToMany, @ManyToOne, @ManyToMany; OWNING vs INVERSE side (the owning side has the FK / no mappedBy; the inverse side uses mappedBy and is read-only for the FK — updating only the inverse side does NOT persist the relationship, a top gotcha); unidirectional vs bidirectional; @JoinColumn (FK) vs @JoinTable (join table, default for ManyToMany); why @ManyToMany is often better modeled as two @OneToMany to an explicit join entity (extra columns, control); keeping both sides in sync with helper methods (addChild); List vs Set for collections (and the delete-all-then-reinsert behavior of bidirectional @OneToMany List with @JoinColumn); default fetch types (ToOne=EAGER, ToMany=LAZY). Cross-ref fetching topic for N+1." },
  { slug: 'inheritance-embeddables-composite-keys', name: 'Inheritance, Embeddables & Composite Keys', hints: "INHERITANCE strategies: SINGLE_TABLE (one table + discriminator column — fastest, no joins, but nullable columns for subclass fields & no NOT NULL constraints), JOINED (a table per class, joined by PK — normalized, no null waste, but joins on every query), TABLE_PER_CLASS (a table per concrete class, UNION for polymorphic queries — problematic, avoid); @MappedSuperclass (shares mapping but not an entity, no polymorphic query) vs @Inheritance; @DiscriminatorColumn/@DiscriminatorValue. EMBEDDABLES: @Embeddable/@Embedded value objects (composition, no identity, e.g. Address) + @AttributeOverride; @ElementCollection for collections of embeddables/basics. COMPOSITE KEYS: @IdClass vs @EmbeddedId (when to use each), @MapsId for shared-PK associations, why composite keys complicate equals/hashCode. Trade-off table across the 3 inheritance strategies." },
  { slug: 'fetching-lazy-eager-n-plus-one', name: 'Fetching Strategies: Lazy vs Eager & the N+1 Problem', hints: "THE most-asked Hibernate interview topic. LAZY vs EAGER: default fetch types (@ManyToOne/@OneToOne EAGER, @OneToMany/@ManyToMany LAZY) & why you should make ToOne LAZY too (EAGER is a code smell — can't be overridden per-query easily, causes surprise joins & N+1); how LAZY works — bytecode PROXIES / bytecode enhancement; LazyInitializationException (accessing a lazy association after the session/context is closed — the classic error, and the WRONG 'fixes' OSIV/EAGER vs the RIGHT fix: fetch what you need in the query). THE N+1 PROBLEM: 1 query for the parents + N queries for each child collection — show the generated SQL; detection; the FIXES: JOIN FETCH (JPQL), @EntityGraph (named/ad-hoc, JPA), batch fetching (@BatchSize / hibernate.default_batch_fetch_size -> IN clauses), subselect fetching (@Fetch(SUBSELECT)); the multiple-bag/MultipleBagFetchException & cartesian-product problem when JOIN FETCHing two collections; DTO projections to avoid loading entities. Mermaid of N+1 fan-out." },
  { slug: 'cascade-types-orphan-removal', name: 'Cascade Types & Orphan Removal', hints: "CASCADE propagates operations from parent to associated entities: the JPA CascadeType values (PERSIST, MERGE, REMOVE, REFRESH, DETACH, ALL) + Hibernate-native (SAVE_UPDATE, REPLICATE, LOCK); cascade is set on the association (@OneToMany(cascade=...)); when to cascade (composition/parent-owns-children like Order->OrderLines) vs when NOT to (shared references — cascading REMOVE could delete shared data); orphanRemoval=true vs CascadeType.REMOVE (the KEY distinction: orphanRemoval deletes a child when it's REMOVED FROM THE COLLECTION / dereferenced, not just when the parent is deleted — 'private ownership'; CascadeType.REMOVE only cascades an explicit parent remove); the combination and gotchas (orphanRemoval + reassigning collection); why cascade ALL + orphanRemoval models a true parent-child aggregate. Cross-ref DDD aggregates (system-design)." },
  { slug: 'transactions-dirty-checking-flushing', name: 'Transactions, Dirty Checking & Flushing', hints: "How Hibernate syncs the persistence context to the DB. DIRTY CHECKING: Hibernate snapshots managed entities at load and, on flush, compares current state to the snapshot to auto-generate UPDATE SQL for changed entities — you DON'T call save() on a managed entity, just mutate it (a senior 'aha'); how it detects changes (state snapshot, or bytecode enhancement for dirty tracking). FLUSH: writing pending SQL to the DB (not a commit); FlushModeType AUTO (default — flush before a matching query + at commit) vs COMMIT (only at commit) vs Hibernate MANUAL/ALWAYS; the flush ORDER (inserts, updates, deletes in a Hibernate-defined order — can cause constraint issues; ordering, insert ordering batch); flush != commit; transaction boundaries (@Transactional, JTA vs resource-local); write-behind (SQL deferred to flush to batch & enable dirty checking); read-only tx optimization; when explicit flush() is needed. Cross-ref messaging-databases (isolation), spring-* (@Transactional proxy)." },
  { slug: 'caching-first-second-level', name: 'Caching: First & Second Level Cache', hints: "FIRST-LEVEL (L1) cache = the persistence context itself: mandatory, per-EntityManager/Session, not shared, gives identity scope + avoids duplicate SELECTs within a tx; cleared on clear()/close(). SECOND-LEVEL (L2) cache = optional, shared across sessions at the SessionFactory level: caches entity data (by ID), needs a provider (Ehcache, Infinispan, Caffeine, Hazelcast) + @Cacheable + shared-cache-mode + @Cache(usage=...) concurrency strategies (READ_ONLY, NONSTRICT_READ_WRITE, READ_WRITE, TRANSACTIONAL) and when each is safe; what L2 does NOT cache by default (associations/collections need @Cache on the collection; query results need the QUERY CACHE which is separate & has its own gotchas — needs the L2 for entities too or it re-fetches). L2 gotchas: staleness, invalidation, why query cache is often a net-negative, only cache read-mostly reference data. L2 stores dehydrated state not objects. Cross-ref messaging-databases (Redis/caching patterns)." },
  { slug: 'querying-jpql-hql-criteria-native', name: 'Querying: JPQL, HQL, Criteria API & Native SQL', hints: "The query options: JPQL (Jakarta Persistence Query Language — object-oriented, queries ENTITIES/fields not tables/columns, portable) vs HQL (Hibernate's superset with extra features); the Criteria API (type-safe, programmatic query building — good for dynamic queries, verbose; the JPA metamodel _Entity classes); native SQL (@Query nativeQuery / createNativeQuery + result mapping @SqlResultSetMapping); named queries (@NamedQuery, precompiled/validated at startup); parameter binding (named :param vs positional ?1 — ALWAYS bind, never concatenate -> JPQL/SQL injection); pagination (setFirstResult/setMaxResults) & the pagination-with-JOIN-FETCH-collection problem (in-memory paging warning HHH000104); projections (constructor expressions SELECT new DTO(...), tuple, interface projections); scalar vs entity results; bulk update/delete (executeUpdate bypasses the persistence context & L1 -> must clear); fetching in queries (JOIN FETCH). Cross-ref messaging-databases (raw SQL), injection (security)." },
  { slug: 'concurrency-optimistic-pessimistic-locking', name: 'Concurrency Control: Optimistic vs Pessimistic Locking', hints: "The lost-update problem & how JPA solves it. OPTIMISTIC locking: @Version field (int/long/timestamp) — Hibernate adds WHERE version=? to updates & increments it; if 0 rows updated -> OptimisticLockException (someone else changed it); no DB locks held, great for low-contention/high-read; LockModeType.OPTIMISTIC vs OPTIMISTIC_FORCE_INCREMENT (bump version even on read, for aggregate consistency). PESSIMISTIC locking: DB-level locks via LockModeType.PESSIMISTIC_READ (shared) / PESSIMISTIC_WRITE (exclusive, SELECT ... FOR UPDATE) / PESSIMISTIC_FORCE_INCREMENT; lock timeouts & deadlock risk; when to use pessimistic (high contention, can't retry, financial) vs optimistic (default, retry on conflict). em.lock()/find with lock mode/@Lock in Spring Data. Isolation-level interplay (cross-ref messaging-databases ACID/isolation). Retry strategy for optimistic failures. First-commit-wins." },
  { slug: 'value-mapping-converters-enums-types', name: 'Value Mapping: Converters, Enums, Temporal & Custom Types', hints: "Mapping non-trivial column values. @Enumerated: EnumType.STRING (safe, readable, reorder-proof) vs EnumType.ORDINAL (fragile — stores position, breaks if you reorder/insert enum constants; a classic bug); @Convert + AttributeConverter<X,Y> (the standard JPA way to map custom types <-> DB columns, e.g. Boolean->'Y'/'N', a JSON string, money, encrypted fields, autoApply); @Temporal for legacy java.util.Date/Calendar vs modern java.time (LocalDate/LocalDateTime/Instant — natively supported in JPA 2.2+/Jakarta, no @Temporal needed, preferred); @Lob for CLOB/BLOB; Hibernate 6's revamped type system (JavaType/JdbcType, @JdbcTypeCode, replacing the legacy UserType/@Type — a HB6 change); mapping JSON (@JdbcTypeCode(SqlTypes.JSON)); @Basic(optional), @Column precision/scale for BigDecimal money. Cross-ref messaging-databases (money, JSONB)." },
  { slug: 'lifecycle-callbacks-auditing-interceptors', name: 'Entity Lifecycle Callbacks, Auditing & Interceptors', hints: "Hooking into entity events. JPA lifecycle CALLBACKS: @PrePersist, @PostPersist, @PreUpdate, @PostUpdate, @PreRemove, @PostRemove, @PostLoad — on the entity or an @EntityListeners class; rules & gotchas (no EntityManager access / no other-entity mutation inside callbacks — undefined behavior). AUDITING: Spring Data JPA @CreatedDate/@LastModifiedDate/@CreatedBy/@LastModifiedBy + @EntityListeners(AuditingEntityListener) + @EnableJpaAuditing; Hibernate Envers for full REVISION history (@Audited — audit tables, query historical state) vs simple auditing. Hibernate INTERCEPTORS (org.hibernate.Interceptor) & EVENT LISTENERS (the SPI, e.g. onSave/onFlushDirty) for cross-cutting concerns (multi-tenancy, soft-delete via @SQLDelete/@Where, encryption); @SQLDelete + @Where for soft deletes. When callbacks vs listeners vs Envers. Cross-ref soft-deletes (messaging-databases)." },
  { slug: 'spring-data-jpa-repositories', name: 'Spring Data JPA & Repository Abstraction', hints: "The repository layer most Java apps use. The repository hierarchy: Repository -> CrudRepository -> PagingAndSortingRepository -> JpaRepository (+ JpaSpecificationExecutor); DERIVED query methods (findByLastNameAndAgeGreaterThan — parsed from the method name into a query) & their limits; @Query (JPQL or nativeQuery=true) + named params @Param + SpEL; Modifying queries (@Modifying + @Transactional for bulk update/delete, clearAutomatically); pagination & sorting (Pageable/Page vs Slice — Page runs a COUNT query, Slice doesn't); PROJECTIONS (interface-based closed/open projections, class DTO, dynamic); Specifications (Criteria wrapper for dynamic queries) & QueryDSL; @EntityGraph on repo methods to fix N+1; the anemic save() (calls persist for new / merge for detached — how it detects 'new': @Version/id null/Persistable); custom repository impls; the OSIV (Open Session In View) default in Spring Boot — why it's ON by default, what it hides (LazyInit works in the view), and why many argue to disable it. Cross-ref spring-boot (autoconfig/tx)." },
  { slug: 'configuration-bootstrapping-schema-generation', name: 'Configuration, Bootstrapping & Schema Generation', hints: "Wiring it up. persistence.xml (JPA standard, the persistence-unit) vs Spring Boot auto-config (spring.jpa.* / a DataSource + JpaVendorAdapter, no persistence.xml needed); bootstrapping the EntityManagerFactory/SessionFactory (the Metadata/ServiceRegistry in HB6); the DIALECT (auto-detected in HB6+, tells Hibernate the DB's SQL flavor); connection pool (HikariCP default in Boot); hibernate.hbm2ddl.auto / jakarta.persistence.schema-generation (none/validate/update/create/create-drop) & why 'update' and 'create' are DANGEROUS in prod (use validate + a real migration tool Flyway/Liquibase — cross-ref devops/messaging-databases zero-downtime-migrations); SQL logging (show_sql vs the org.hibernate.SQL + BasicBinder logger vs a proper tool like p6spy/datasource-proxy); important properties (batch_size, order_inserts/updates, default_batch_fetch_size, jdbc.time_zone); naming strategies (physical/implicit)." },
  { slug: 'performance-tuning-pitfalls', name: 'Performance Tuning & Common Pitfalls', hints: "The senior 'make it fast / what goes wrong' topic — synthesize the domain's gotchas. N+1 (the #1 issue — detection & the fix menu: JOIN FETCH/@EntityGraph/@BatchSize); JDBC BATCHING (hibernate.jdbc.batch_size + order_inserts/order_updates; why IDENTITY id-gen disables insert batching); the equals()/hashCode() on entities problem (never use the generated @Id in hashCode for entities in a Set before persist — use a business key or a UUID assigned in the constructor; the detached-entity-in-a-HashSet bug); LazyInitializationException & OSIV trade-offs; over-fetching (EAGER, SELECT * of huge entities — use projections/DTOs); the open-session-in-view debate; Cartesian product from multiple JOIN FETCH collections (MultipleBagFetchException); pagination + collection fetch in-memory (HHH000104); flushing too often / large persistence context (clear() in batch loops); the second-level/query cache misuse; mutable @Version misuse; using an ORM for bulk/reporting (use native SQL/jOOQ); statement/StatelessSession for bulk. A checklist of anti-patterns." },
  { slug: 'hibernate-6-7-and-jakarta-migration', name: 'Modern Hibernate: 6/7 Changes & Jakarta Migration', hints: "What changed recently (senior/currency signal). The JAKARTA migration: javax.persistence.* -> jakarta.persistence.* namespace (Jakarta EE 9, a breaking package rename not just a version bump), why it happened (Oracle/Eclipse Foundation trademark), Hibernate 5.x (javax, or 5.6 bridge) -> Hibernate 6+ (jakarta only), Spring Boot 3 requires it. HIBERNATE 6 major changes: the new SQM (Semantic Query Model) query engine + full rewrite of the query translator, the revamped TYPE SYSTEM (JavaType/JdbcType/@JdbcTypeCode replacing legacy UserType/@Type/@TypeDef), better JPA 3.1 compliance, jakarta.persistence 3.1 (UUID generation, EXTRACT, math functions), improved SQL generation & read-by-position, @TenantId. HIBERNATE 6.2+/7: Jakarta Persistence 3.2, HQL enhancements, the new StatelessSession/Mutiny reactive (Hibernate Reactive), Jakarta Data preview & repositories, Java baseline bumps. Migration gotchas (namespace, dialect auto, removed legacy APIs, boolean/UUID/enum mapping changes). Cross-ref jakarta migration (apache-tomcat)." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a staff-level Java/Hibernate engineer and interview coach authoring study material for the topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / subtopics for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . Remember: interview-grade MECHANISM depth (what Hibernate actually does + generated SQL), the N+1 and LazyInitializationException classics where relevant, current Jakarta Persistence 3.1/3.2 + Hibernate 6/7 (jakarta.* namespace), cross-reference (don't duplicate) messaging-databases/spring-*/system-design, and 40-60 MCQs weighted to mechanism + annotation-precision + judgment/scenario.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer (staff Java/Hibernate engineer + interviewer) verifying Hibernate & JPA content for "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `Files: ${DIR}/${t.slug}/concepts.md and questions.yaml . Read BOTH. Check and FIX IN PLACE:\n` +
    `1) FACTUAL/VERSION PRECISION (most important): annotations, defaults, and version facts MUST be correct — default fetch types (@ManyToOne/@OneToOne EAGER, @OneToMany/@ManyToMany LAZY), id-generation semantics (IDENTITY disables insert batching; SEQUENCE + allocationSize), cascade vs orphanRemoval distinction, @Enumerated ORDINAL fragility, optimistic @Version mechanics, inheritance-strategy table semantics, JPA vs Hibernate spec-vs-impl, the jakarta.* (NOT javax.*) namespace for HB6+/Boot3, Hibernate 6 SQM + type-system (@JdbcTypeCode) changes, flush != commit, L1 mandatory vs L2 optional. Web-research anything uncertain and FIX it. A wrong default or version claim is the WORST defect.\n` +
    `2) NO WRONG-IN-PRACTICE KEYS: ensure no correct answer endorses a bad practice (EAGER-everything, mutable entities with @Id in hashCode, hbm2ddl=update in prod, string-concatenated JPQL, EnumType.ORDINAL as 'safe'). A plausible-but-wrong option must be a DISTRACTOR, never the key.\n` +
    `3) BOUNDARY/SCOPE: confirm the topic teaches the Hibernate/JPA angle and CROSS-REFERENCES (does not duplicate) messaging-databases (SQL/ACID/indexing), spring-* (container/@Transactional proxy), system-design. Fix scope drift.\n` +
    `4) SCHEMA: valid YAML; keys topic/domain(hibernate-jpa)/topic_slug(${t.slug})/version/questions; 40-60 questions; ids (prefix '${t.slug}-', unique, 3-digit seq); difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based 'answer' in range; explanation; correct-option VARIED (rebalance if any index >40% or a guessable cycle — shuffle options, keep 'answer' correct). Quote any YAML option with a colon+space or leading brace.\n` +
    `5) Every 'ref' resolves to a real '## ' heading; Mermaid valid (no semicolons in sequenceDiagram messages; valid stateDiagram-v2/flowchart).\n` +
    `6) COVERAGE: every subtopic represented; MCQs weighted to mechanism/annotation-precision/judgment, and the N+1 / lifecycle / lazy classics where relevant.\n\n` +
    `After fixing, return: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
