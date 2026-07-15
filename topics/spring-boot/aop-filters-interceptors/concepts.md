# AOP, Filters & Interceptors

Cross-cutting concerns — logging, security, transactions, caching, metrics — don't
belong scattered across every method. Spring gives you **three** layered mechanisms
to factor them out, each sitting at a different point in the request/execution chain:

1. **Servlet Filters** — operate at the servlet-container level, around the whole
   `DispatcherServlet`, on the raw `ServletRequest`/`ServletResponse`.
2. **Spring MVC `HandlerInterceptor`s** — operate inside `DispatcherServlet`, around
   handler (controller) invocation, with access to the resolved handler and
   `ModelAndView`.
3. **Spring AOP (`@Aspect`)** — operates at the *Spring bean method-call* level via
   proxies, around any Spring-managed bean method (not just controllers).

Interviewers love this topic because it mixes conceptual vocabulary (aspect, advice,
join point, pointcut, weaving) with famous proxy gotchas (JDK vs CGLIB, self-invocation)
and the "which of the three do I pick?" design question.

---

## AOP core concepts and terminology

**Aspect-Oriented Programming (AOP)** modularizes cross-cutting concerns into reusable
units called *aspects*, keeping them out of the core business logic. Learn this
vocabulary — interviewers quiz it directly:

| Term | Meaning |
|---|---|
| **Aspect** | A module encapsulating a cross-cutting concern (e.g. a `LoggingAspect`). In Spring, a class annotated `@Aspect`. |
| **Join point** | A point during program execution where an aspect *can* be applied. **In Spring AOP a join point is always a method execution** (AspectJ supports more: field access, constructor calls, etc.). |
| **Advice** | The action taken by an aspect at a join point — the actual code that runs (`@Before`, `@Around`, ...). |
| **Pointcut** | A predicate/expression that *selects* which join points an advice applies to (e.g. `execution(* com.app.service.*.*(..))`). |
| **Target object** | The object being advised — the real bean whose method is intercepted. |
| **Proxy** | The object Spring creates to wrap the target and apply advice. Callers talk to the proxy, not the target. |
| **Weaving** | Linking aspects with target objects to create the advised object. Spring AOP weaves **at runtime** (proxy creation); AspectJ can weave at compile-time or load-time. |
| **Introduction** | Declaring additional methods/fields (or making a bean implement a new interface) via an aspect. |

**Mental model:** *advice* = "what to do", *pointcut* = "where to do it",
*join point* = "a specific place where it happened", *aspect* = advice + pointcut
bundled together.

**Why it matters:** without AOP you copy-paste `try/finally` logging or security
checks into hundreds of methods. AOP centralizes that, so `@Transactional` and
`@Cacheable` "just work" — they are themselves implemented as AOP advice.

---

## Advice types

Spring AOP (via AspectJ annotations) supports five advice types:

| Annotation | When it runs | Can prevent target call? | Can modify return? |
|---|---|---|---|
| `@Before` | Before the join point | No (only by throwing) | No |
| `@After` | After the join point, **finally** (success *or* exception) | No | No |
| `@AfterReturning` | After the join point returns **normally** | No | Can read/inspect return value (bind via `returning=`) |
| `@AfterThrowing` | After the join point throws an exception | No | Can inspect the exception (bind via `throwing=`) |
| `@Around` | Surrounds the join point | **Yes** — it controls whether/when to call `proceed()` | Yes — can replace/transform return value or swallow exceptions |

```java
@Aspect
@Component
public class LoggingAspect {

    @Before("execution(* com.app.service.*.*(..))")
    public void logBefore(JoinPoint jp) {
        log.info("Entering {}", jp.getSignature());
    }

    @AfterReturning(pointcut = "execution(* com.app.service.*.*(..))",
                    returning = "result")
    public void logReturn(JoinPoint jp, Object result) {
        log.info("{} returned {}", jp.getSignature(), result);
    }

    @AfterThrowing(pointcut = "execution(* com.app.service.*.*(..))",
                   throwing = "ex")
    public void logError(JoinPoint jp, Throwable ex) {
        log.error("{} threw {}", jp.getSignature(), ex.getMessage());
    }

    @Around("execution(* com.app.service.*.*(..))")
    public Object timeIt(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.nanoTime();
        try {
            return pjp.proceed();          // <-- explicitly invoke target
        } finally {
            log.info("{} took {} ns", pjp.getSignature(),
                     System.nanoTime() - start);
        }
    }
}
```

**Key gotchas / advanced:**
- Only `@Around` receives a `ProceedingJoinPoint`; the others receive a plain
  `JoinPoint` (if they declare one). `ProceedingJoinPoint extends JoinPoint`, and it
  is only valid to declare it in an `@Around` method — declaring it elsewhere throws
  `IllegalArgumentException` at proxy time.
- `pjp.proceed()` vs `pjp.proceed(Object[])`: the no-arg form re-uses the original
  arguments; the array form lets an `@Around` **rewrite** the arguments passed to the
  target. The array's length/types must line up with the method signature or you get
  an `IllegalArgumentException` from the reflective invocation. This is how "argument
  massaging" aspects (trimming strings, decrypting fields) work.
- `proceed()` may be called **zero, one, or many times**. Calling it more than once
  (e.g. a retry aspect) re-executes the *rest of the interceptor chain and the target*,
  which is a correctness hazard if other advice in the chain has side effects.
- `@Around` **must** return a value (usually the result of `pjp.proceed()`) — forget
  it and the caller gets `null` even though the target ran.
- `@Around` **must** re-throw or `throws Throwable`; swallowing the exception silently
  changes behavior.
- **Execution order for a single aspect around one method that returns normally**
  (Spring 5.2.7+, AspectJ semantics): `@Around` (before proceed) → `@Before` →
  *target* → `@AfterReturning` → `@After` → `@Around` (after proceed). `@Around` is
  the **highest-precedence (outermost)** advice, so everything else runs *inside* its
  `proceed()` and its post-proceed code runs **last**. `@After` follows AspectJ
  "after finally" semantics, so it effectively runs **after** `@AfterReturning` /
  `@AfterThrowing`. Note that pre-5.2.7 Spring had a different (buggy) ordering in
  which `@Around`'s after-proceed code ran before `@After`; modern Spring follows
  AspectJ's precedence.
- `@After` is a *finally* block — it runs whether the method returns or throws.

---

## @Aspect and enabling AOP

`@Aspect` marks a class as an aspect, but that alone does **not** register it — it must
also be a Spring bean (e.g. `@Component`) *and* AspectJ auto-proxying must be enabled.

- **Spring Boot:** `spring-boot-starter-aop` is on the classpath →
  `AopAutoConfiguration` enables `@EnableAspectJAutoProxy` automatically. You just add
  `@Aspect @Component`.
- **Plain Spring:** add `@EnableAspectJAutoProxy` to a `@Configuration` class (or
  `<aop:aspectj-autoproxy/>` in XML).

Under the hood, `@EnableAspectJAutoProxy` registers an
`AnnotationAwareAspectJAutoProxyCreator` — a `BeanPostProcessor` that, during bean
creation, inspects beans, matches them against aspect pointcuts, and wraps matching
beans in a proxy.

**`proxyTargetClass` flag:** `@EnableAspectJAutoProxy(proxyTargetClass = true)` forces
CGLIB (class-based) proxies even when interfaces exist. **Spring Boot sets
`proxyTargetClass=true` by default** (since 2.0), so CGLIB is the Boot default.

> Note: Spring AOP uses AspectJ's *annotations and pointcut language* for convenience,
> but it is **not** using the AspectJ weaver at runtime — it's still proxy-based. This
> is a classic trap.

---

## Pointcut expressions

A pointcut expression selects join points. Spring AOP supports a subset of AspectJ's
pointcut designators. The most common is `execution`:

```
execution(modifiers? return-type declaring-type?.method-name(params) throws?)
```

```java
// any public method
execution(public * *(..))

// any method in the service package (not sub-packages)
execution(* com.app.service.*.*(..))

// any method in service package and ALL sub-packages
execution(* com.app.service..*.*(..))

// findById returning a User, any args
execution(User com.app.repo.*.findById(..))
```

Other designators:

| Designator | Matches |
|---|---|
| `execution(...)` | Method execution matching a signature (most used). |
| `within(com.app.service..*)` | Any join point within given types/packages. |
| `this(Type)` | Where the **proxy** is an instance of `Type`. |
| `target(Type)` | Where the **target object** is an instance of `Type`. |
| `args(String, ..)` | Where arguments match given types (and can bind them). |
| `@annotation(com.app.Audited)` | Methods **annotated** with the given annotation. |
| `@within(...)` / `@target(...)` | Types annotated with a given annotation. |
| `bean(orderService)` | Spring-specific: matches beans by name (supports `*`). |

**Named pointcuts** (`@Pointcut`) let you reuse and compose expressions with
`&&`, `||`, `!`:

```java
@Pointcut("execution(* com.app.service.*.*(..))")
public void serviceLayer() {}

@Pointcut("@annotation(com.app.Audited)")
public void audited() {}

@Around("serviceLayer() && audited()")
public Object advise(ProceedingJoinPoint pjp) throws Throwable { ... }
```

**Gotchas:**
- Spring AOP only supports **method-execution** join points, so `execution` and
  `within` are the workhorses; `call()`, field, and constructor pointcuts are
  AspectJ-only.
- `execution(* *(..))` matches by *method signature*; `within` matches by *type*.
- Because Spring proxies only apply to **public** (and, for CGLIB, protected) methods
  invoked *through the proxy*, a pointcut can match a private method but the advice
  will never fire for it via Spring AOP.

---

## JDK dynamic proxy vs CGLIB

Spring AOP creates the proxy in one of two ways:

| | **JDK dynamic proxy** | **CGLIB proxy** |
|---|---|---|
| Mechanism | `java.lang.reflect.Proxy` — implements interfaces | Subclasses the target class at runtime (bytecode gen via ASM) |
| Requires | Target implements ≥1 interface | No interface needed |
| Proxy type | Implements the same interfaces; **not** assignable to the concrete class | A **subclass** of the target |
| `final` limitation | N/A (interface methods) | **Cannot proxy `final` classes or `final` methods** (can't override) |
| `private` methods | Not on interface anyway | Cannot be advised (can't override) |
| Default in Spring | Historically: JDK if interfaces present | Used when no interface / `proxyTargetClass=true` |

**Selection rule (classic Spring):** if the target implements at least one interface,
Spring uses a **JDK dynamic proxy**; otherwise it uses **CGLIB**. Setting
`proxyTargetClass=true` forces CGLIB regardless.

**Spring Boot default:** CGLIB — Boot sets `proxyTargetClass=true`, which avoids the
common "I injected the concrete class but got a `ClassCastException` / no such bean"
problem that JDK proxies cause (a JDK proxy is not an instance of the concrete class,
only of its interfaces).

**CGLIB constraints (advanced):**
- Class must not be `final`; the method to advise must not be `final`, `private`, or
  `static` (CGLIB works by subclassing and overriding). Package-private methods in a
  parent class from a different package are effectively private and cannot be advised
  either.
- **Constructor invocation:** Spring instantiates the CGLIB proxy subclass via
  **Objenesis**, which bypasses the constructor, so your target's constructor is *not*
  called a second time on the proxy instance. The Spring reference is explicit: "The
  constructor of your proxied object will not be called twice, since the CGLIB proxy
  instance is created through Objenesis. However, if your JVM does not allow for
  constructor bypassing, you might see double invocations and corresponding debug log
  entries from Spring's AOP support." This is why you must **never put business logic /
  side effects in a proxied bean's constructor** — and why field initializers on the
  proxy subclass run against a bypassed-constructor instance (a subtle source of "my
  field is null in the proxy" bugs when logic depends on subclass field init).
- CGLIB is repackaged **into `spring-core`** (`org.springframework.cglib.*`), so you
  don't add a separate CGLIB dependency; Objenesis is likewise bundled/repackaged.
- CGLIB `final`/`private` methods silently run **un-advised** rather than erroring —
  the proxy simply can't override them, so calls resolve to the inherited target
  implementation with no advice. There is no startup failure, which makes this a
  quiet correctness trap.
- **Two instances exist:** for a CGLIB-proxied `@Configuration`/service bean there is
  the raw target instance *and* the proxy subclass instance. Spring publishes the proxy
  as the bean; the raw instance is only reachable inside the target's own `this`.

**Why interviewers care:** injecting a bean by its concrete class when a JDK proxy is
in play fails because the proxy only implements the interface. This drove the shift to
CGLIB-by-default in Boot.

---

## Self-invocation limitation

**The single most famous AOP trap.** Spring AOP advice is applied by the **proxy**.
When a method inside a bean calls **another method of the same bean via `this`**, the
call goes directly to the target object and **bypasses the proxy** — so no advice runs.

```java
@Service
public class OrderService {

    @Transactional                       // proxy-based advice
    public void outer() {
        inner();                         // self-invocation via `this` -> NO new tx / advice
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void inner() { ... }          // REQUIRES_NEW is IGNORED when called from outer()
}
```

This affects **any** proxy-based advice: `@Transactional`, `@Cacheable`, `@Async`,
`@Retryable`, custom aspects. Symptoms: "my `@Transactional` / `@Cacheable` /
`@Async` on the inner method does nothing."

**Fixes:**
1. **Refactor** the self-called method into a *separate bean* so the call crosses a
   proxy boundary (cleanest).
2. **Self-injection**: inject the bean into itself and call through the injected
   reference (`self.inner()`).
3. `AopContext.currentProxy()` + `((OrderService) AopContext.currentProxy()).inner()`
   — requires `@EnableAspectJAutoProxy(exposeProxy = true)`. Works but couples code to
   Spring AOP; considered a smell.
4. Switch to **AspectJ compile/load-time weaving**, which weaves the bytecode directly
   and therefore *does* intercept self-invocations (no proxy involved).

**Related traps:** advice also won't apply to `private`/`final`/`static` methods, and
`@Transactional` on a method called before the proxy is ready won't work either.

---

## Spring AOP vs AspectJ

| | **Spring AOP** | **AspectJ** |
|---|---|---|
| Weaving | Runtime, **proxy-based** | Compile-time (CTW), post-compile, or load-time (LTW) — real bytecode weaving |
| Join points | **Method execution only** | Method call/execution, constructors, field get/set, static init, etc. |
| Scope | Only **Spring-managed beans** | **Any object**, including non-Spring, `new`-ed objects |
| Self-invocation | Not intercepted (bypasses proxy) | **Intercepted** (bytecode woven directly) |
| `final`/`private`/`static` | Cannot advise (proxy limits) | Can advise |
| Setup | Trivial (just on the classpath) | Needs the ajc compiler or a load-time weaving agent |
| Performance | Slight per-call proxy overhead | Woven code, essentially native speed |
| Power | Simpler, covers ~80% of needs | Full-featured, more complex |

**Key point:** Spring AOP *uses AspectJ's annotation style and pointcut expression
language* but implements interception with proxies at runtime; it does **not** use the
AspectJ weaver unless you explicitly configure AspectJ load-time weaving
(`@EnableLoadTimeWeaving` / `-javaagent:aspectjweaver.jar`).

**When to reach for full AspectJ:** you need to advise non-method join points, non-Spring
objects, `final`/`private`/`static` methods, or you must intercept self-invocations.
Otherwise, prefer Spring AOP for simplicity.

---

## Aspect ordering

When multiple aspects advise the **same** join point, ordering matters (e.g. security
before transaction before logging). Control it with:

- Implement `org.springframework.core.Ordered`, or
- Annotate the aspect with `@Order(n)`.

**Lower order value = higher precedence = runs first on the "way in".** On the way out,
the order reverses (like nested `try/finally`): the highest-precedence aspect's
"before" runs first and its "after" runs last.

```java
@Aspect @Order(1) class SecurityAspect {}   // outermost
@Aspect @Order(2) class TxAspect {}          // middle
@Aspect @Order(3) class LoggingAspect {}     // innermost
```

**Gotchas:**
- Ordering across **different aspects** is defined by `@Order`. Ordering of **multiple
  advices within the same aspect** on the same join point is *not* controllable by
  `@Order` (before 5.2.7 it was undefined; since 5.2.7 Spring uses declaration order /
  advice-type precedence). If you need strict ordering, split into separate aspects.
- `@Transactional`'s advice order is `Ordered.LOWEST_PRECEDENCE` by default; you can
  change it via `@EnableTransactionManagement(order = ...)`.

---

## AOP use cases

Classic cross-cutting concerns implemented with AOP (many are built into Spring as
AOP-based features):

| Use case | Built-in Spring feature |
|---|---|
| Transactions | `@Transactional` (proxy AOP) |
| Caching | `@Cacheable` / `@CacheEvict` (`@EnableCaching`) |
| Async execution | `@Async` (`@EnableAsync`) |
| Retry | `@Retryable` (Spring Retry) |
| Security / method authorization | `@PreAuthorize` / `@Secured` (Spring Security) |
| Logging / tracing / auditing | Custom `@Aspect` |
| Metrics / timing | `@Timed` (Micrometer) or custom `@Around` |
| Validation | `@Validated` on beans |

**Rule of thumb:** if the concern applies to **many Spring bean methods** and is
orthogonal to business logic, it's an AOP candidate. Remember all of these are
proxy-based and thus share the self-invocation limitation.

---

## Servlet Filter

A **`jakarta.servlet.Filter`** (was `javax.servlet.Filter` before Spring Boot 3 /
Jakarta EE 9+ namespace change) intercepts requests at the **servlet container** level,
*before* they reach the `DispatcherServlet`, and wraps the entire request lifecycle.

```java
@Component
public class RequestLoggingFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        // pre-processing
        chain.doFilter(req, res);   // pass down the chain; omit to short-circuit
        // post-processing
    }
}
```

**Characteristics:**
- Part of the Servlet spec, **not** Spring MVC-specific — works for any servlet request,
  including static resources and other servlets.
- Sees the **raw** `ServletRequest`/`ServletResponse`; does **not** know about the
  matched controller/handler or `@RequestMapping`.
- Can wrap request/response (e.g. `ContentCachingRequestWrapper`), fully short-circuit
  by not calling `chain.doFilter`, and modify the body/stream.
- Registered via `@Component` (Boot auto-registers `Filter` beans), a
  `FilterRegistrationBean` (to control URL patterns and **order**), or `@WebFilter` +
  `@ServletComponentScan`.
- Ordering via `FilterRegistrationBean.setOrder(...)` or `@Order`.

**Use it for:** concerns that must apply to *all* requests regardless of Spring MVC —
CORS, compression (GZIP), authentication (Spring Security is implemented as a filter
chain!), request/response logging, correlation-ID (MDC) setup, encoding.

`OncePerRequestFilter` (Spring) is a convenience base class guaranteeing a single
execution per request (avoids double-filtering on forwards/async dispatches).

---

## HandlerInterceptor

A Spring MVC **`HandlerInterceptor`** intercepts requests **inside** the
`DispatcherServlet`, around handler (controller) execution. It has three hooks:

```java
public class AuthInterceptor implements HandlerInterceptor {
    // before controller; return false to STOP (handler not invoked)
    boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler);

    // after controller, before view render; can tweak ModelAndView
    void postHandle(HttpServletRequest req, HttpServletResponse res,
                    Object handler, ModelAndView mav);

    // after complete request (after view render) — always, even on exception
    void afterCompletion(HttpServletRequest req, HttpServletResponse res,
                         Object handler, Exception ex);
}
```

Register it:

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new AuthInterceptor())
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/public/**");
    }
}
```

**Characteristics:**
- Spring MVC-specific — knows the resolved **handler** (`HandlerMethod`), so it can read
  controller-method annotations, and can access the `ModelAndView`.
- `preHandle` returning `false` short-circuits — the controller is not called.
- URL-pattern include/exclude support out of the box.
- `postHandle` is **not** called if the handler threw an exception (but
  `afterCompletion` still is). `postHandle` is also skipped/limited for async requests.

**Use it for:** MVC-scoped concerns that need the handler context — auth checks per
route, adding common model attributes, timing controller execution, locale/theme
handling.

---

## Filter vs HandlerInterceptor vs @Aspect

The core "which do I choose?" design question. They sit at **different layers of the
chain**:

```
Client
  │
  ▼
Servlet Filter chain            ← container level, raw request/response
  │  (doFilter)
  ▼
DispatcherServlet
  │
  ▼
HandlerInterceptor.preHandle    ← MVC level, knows the handler
  │
  ▼
Controller (@Aspect can advise here and in any bean below)  ← bean/method level
  │
  ▼
Service / Repository (@Aspect, @Transactional advise here)
  │
  ▼
HandlerInterceptor.postHandle → view render → afterCompletion
  │
  ▼
Servlet Filter (post) → Client
```

| | **Servlet Filter** | **HandlerInterceptor** | **@Aspect (Spring AOP)** |
|---|---|---|---|
| Layer | Servlet container | Spring MVC (`DispatcherServlet`) | Any Spring bean method |
| Spec | Servlet (Jakarta) | Spring MVC | Spring AOP / AspectJ |
| Sees | Raw request/response | Handler + `ModelAndView` | Method args, return, target |
| Scope | All requests (incl. static, other servlets) | Only requests routed by DispatcherServlet | Only Spring beans (methods) |
| Can modify body/stream | Yes (wrap request/response) | Limited | Return value only |
| Not tied to web | — | — | **Works for non-web beans too** (services, batch) |
| Order control | `FilterRegistrationBean`/`@Order` | registration order | `@Order`/`Ordered` |

**Decision guide:**
- Applies to **all HTTP traffic**, need raw request/response, or non-MVC servlets →
  **Filter** (CORS, security, compression, logging, encoding).
- Web/MVC concern needing the **handler** or model, per-route → **HandlerInterceptor**
  (auth per controller, adding model attributes).
- Concern on **arbitrary bean methods** (service/repo), or reusable regardless of web →
  **@Aspect** (transactions, caching, business-level logging/auditing, metrics).

**Execution order for one request:** Filter (pre) → Interceptor `preHandle` → Aspect
around controller → Controller → Aspect (after) → Interceptor `postHandle` →
Interceptor `afterCompletion` → Filter (post).

---

## Proxy creation internals and failure modes

Understanding *when* and *how* the proxy is built explains most "why didn't my advice
fire?" incidents.

- **When proxies are created.** `AnnotationAwareAspectJAutoProxyCreator` is a
  `SmartInstantiationAwareBeanPostProcessor`. It wraps a bean in
  `postProcessAfterInitialization` (i.e. *after* the raw bean is fully constructed and
  initialized). This ordering has two consequences:
  1. Any code that runs **during** bean construction / `@PostConstruct` sees the *raw*
     target (`this`), never the proxy — advice on methods called from a constructor or
     `@PostConstruct` does **not** fire.
  2. If a bean is needed *before* the auto-proxy creator itself is instantiated (a common
     hazard when a `BeanPostProcessor` or its dependencies are advised), you get the
     famous log: *"Bean X is not eligible for getting processed by all
     BeanPostProcessors (for example: not eligible for auto-proxying)."* — the bean is
     created too early and ends up **un-proxied**, so `@Transactional`/aspects silently
     no-op. Fix: avoid making infrastructure beans (or their dependencies) depend on
     advised beans; use `@Lazy`.
- **Circular references + proxies.** When two singletons reference each other and one is
  advised, Spring's early-reference mechanism exposes an early proxy via
  `getEarlyBeanReference`. If a later `BeanPostProcessor` would have wrapped it
  differently, Spring raises `BeanCurrentlyInCreationException`. Spring Boot 2.6+ sets
  `spring.main.allow-circular-references=false` by default, so such graphs now fail fast
  at startup rather than limping along with a possibly-unproxied bean.
- **`@Lazy` and scoped-proxy interplay.** A `@Lazy` injection point or a scoped bean
  (`@Scope(proxyMode = ...)`) already introduces *its own* proxy. Stacking AOP on top
  produces a proxy-of-a-proxy; `AopProxyUtils.ultimateTargetClass` / `AopUtils.isAopProxy`
  are the introspection helpers interviewers expect you to know.
- **`@Async` return-type rule.** An `@Async` method must return `void`, `Future`,
  `CompletableFuture`, or a reactive type; returning a plain value means the caller gets
  a value produced on a *different* thread that the proxy cannot hand back synchronously,
  so Spring only supports the async-friendly return types. Exceptions from a `void`
  `@Async` method are swallowed unless you register an `AsyncUncaughtExceptionHandler`.

---

## Argument, return, and annotation binding in pointcuts

Beyond selecting *where* advice runs, pointcut designators can **bind** context into
advice parameters, which is both powerful and a common source of "advice didn't match"
confusion.

- `args()`, `@annotation()`, `@within()`, `target()`, `this()` can each **bind** a value
  when given a *parameter name* instead of a type literal, e.g.
  `@Before("execution(* *(..)) && args(id,..)")` binds the first argument to the advice
  parameter `id`. The parameter's declared type acts as an implicit runtime `instanceof`
  filter, so `args(String)` only matches when the runtime argument is a `String`.
- **Runtime vs static matching.** `execution`, `within`, `@within`, `@annotation` are
  matched statically at proxy-creation time. `args`, `this`, `target` (when they bind or
  test a subtype) may require **per-invocation** runtime checks, adding a small cost and
  meaning the same join point can match on one call and not another.
- **Parameter name resolution.** Binding relies on parameter names being available. With
  older bytecode or aggressive optimization, names may be lost; you then need the
  `argNames` attribute (`@Before(value="...", argNames="id")`) or compilation with
  `-parameters`. This is a real "works on my machine" trap.
- **`@annotation` binding gives you the annotation instance:**
  `@Around("@annotation(audited)") ... Object advise(ProceedingJoinPoint pjp, Audited
  audited)` hands you the annotation so you can read its attributes — the standard way to
  build configurable custom aspects.
- **CGLIB and generics:** a pointcut on a bridge method / generic signature can behave
  surprisingly; Spring matches against the *most specific* method, but interviewers
  sometimes probe whether advice fires on synthetic bridge methods (it generally does
  not on the bridge itself).

---

## Filters: registration, ordering, and concurrency

- **Auto-registration double-firing.** If you annotate a `Filter` with `@Component`
  *and* also register it in a `FilterRegistrationBean`, Spring Boot registers it
  **twice** (once by bean auto-detection, once explicitly). The fix is to either not use
  `@Component`, or set `registration.setEnabled(false)` on the auto-detected one — or
  keep the filter a plain bean referenced only by the `FilterRegistrationBean`.
- **Ordering scope.** `FilterRegistrationBean.setOrder()` and `@Order` order filters
  **relative to each other**, but Spring Security's chain is registered at
  `SecurityProperties.DEFAULT_FILTER_ORDER` (`-100`). To run a custom filter before or
  after security you must pick an order relative to `-100`, not just relative to your own
  filters.
- **`Ordered.HIGHEST_PRECEDENCE` = `Integer.MIN_VALUE` runs first**; higher numbers run
  later — the same convention as aspects, and the opposite of what "highest number wins"
  intuition suggests.
- **Thread-safety.** A `Filter` bean is a **singleton shared across all request
  threads**; storing per-request state in an instance field is a data-race bug. Use
  method-local variables, request attributes, or `ThreadLocal`/MDC that you **clear in a
  `finally`** — a `ThreadLocal` left un-cleared leaks across pooled request threads and
  causes cross-request data bleed (a classic correlation-ID / security-context leak).
- **Response already committed.** Once `chain.doFilter` has flushed/committed the
  response, post-chain code in the filter can no longer change status or headers
  (`response.isCommitted()` returns true). Buffering wrappers
  (`ContentCachingResponseWrapper`) exist precisely so you can inspect/modify the body
  before it is committed — but you must call `copyBodyToResponse()` or nothing is
  written to the client.
- **Async/error dispatch.** By default a filter is invoked for `REQUEST` dispatches
  only. To also run on `ASYNC`, `ERROR`, `FORWARD`, or `INCLUDE` dispatches you must set
  `setDispatcherTypes(...)`. `OncePerRequestFilter` additionally guards against running
  twice within the same dispatch cycle.

---

## Interceptors: async, ordering, and the postHandle trap

- **`@ResponseBody`/`ResponseEntity` bodies are already committed before `postHandle`.**
  Per the Spring reference, for these handlers the response is written and committed
  inside the `HandlerAdapter` *before* `postHandle` runs — so you **cannot** add headers
  or alter the body from `postHandle`. Use `ResponseBodyAdvice` (a `@ControllerAdvice`)
  or a servlet `Filter` instead. `postHandle`'s `ModelAndView` argument is also `null`
  for `@ResponseBody`/REST handlers (there is no view/model).
- **Async requests use `AsyncHandlerInterceptor`.** When a controller returns a
  `Callable`/`DeferredResult`/reactive type, the container releases the request thread
  and Spring calls `afterConcurrentHandlingStarted(...)` **instead of**
  `postHandle`/`afterCompletion` on the initial dispatch. When the async result is ready
  the request is *re-dispatched* and `preHandle` → `postHandle` → `afterCompletion` run
  again on the second dispatch. Interceptors doing timing/cleanup must account for this
  two-phase lifecycle or they under/over-count.
- **`afterCompletion` ordering is reversed.** Interceptors run `preHandle` in
  registration order; `postHandle` and `afterCompletion` run in **reverse** registration
  order (LIFO, like nested try/finally). And `afterCompletion` is only invoked for
  interceptors whose `preHandle` **already returned true** — if interceptor #2's
  `preHandle` returns `false`, only interceptors #1..#2's already-completed preHandles
  are unwound.
- **Interceptors are singletons too** — same thread-safety caveats as filters; never
  hold per-request state in fields.
- **Not a security boundary.** The Spring reference explicitly warns that interceptors
  are not ideal as a security layer because their path matching can mismatch annotated
  controller path matching; use Spring Security (filter-based) for authz.

---

## Transaction, AOP interaction edge cases

Because `@Transactional`, `@Cacheable`, `@Async`, `@Retryable` are *all* just AOP advice,
their subtle behaviors reduce to proxy mechanics:

- **Advice ordering matters for correctness.** If a caching aspect wraps *outside* the
  transaction aspect, a cache hit skips the transaction entirely (often desirable); if
  it wraps *inside*, you open a transaction even for cache hits. `@Transactional`'s order
  is `LOWEST_PRECEDENCE` by default, so most custom aspects run outside it unless you set
  their order lower.
- **`@Transactional` visibility.** On a CGLIB proxy, `@Transactional` on a
  `protected`/package-private/private method is **ignored** (proxy can't override /
  the call isn't public). Spring will not error; the method just runs non-transactionally.
- **Checked-exception rollback.** Proxy tx advice only rolls back on `RuntimeException`
  and `Error` by default; a checked exception commits unless you specify
  `rollbackFor`. This is advice behavior, not a database rule.
- **Self-invocation applies uniformly.** A `@Cacheable` method calling another
  `@Cacheable` method on the same bean via `this` gets **no second cache lookup** — the
  same proxy-bypass rule as transactions.

---

## Common follow-up questions

- *What is a join point in Spring AOP, and how does it differ from AspectJ?* — In Spring
  AOP it's always a method execution; AspectJ adds field access, constructors, etc.
- *Why doesn't my `@Transactional`/`@Cacheable` work when called from within the same
  class?* — Self-invocation bypasses the proxy. Refactor or self-inject.
- *When does Spring use CGLIB vs JDK proxy? What's the Boot default?* — JDK if the target
  has an interface, else CGLIB; Boot forces CGLIB via `proxyTargetClass=true`.
- *Can Spring AOP advise a `final` or `private` method?* — No; CGLIB can't override
  `final`/`private`, JDK proxies only cover interface methods.
- *What's the execution order of the five advice types around one method (normal
  return)?* — `@Around` (pre) → `@Before` → target → `@AfterReturning` → `@After` →
  `@Around` (post). `@Around` is outermost, so its post-proceed code runs last, and
  `@After` (finally) runs after `@AfterReturning`/`@AfterThrowing`.
- *`@Around` returns null unexpectedly — why?* — It didn't return `proceed()`'s result.
- *Filter vs Interceptor — which runs first and why?* — Filter (container) runs outside
  the interceptor (DispatcherServlet), so Filter wraps everything.
- *How do you order multiple aspects?* — `@Order`/`Ordered`; lower value = higher
  precedence = runs first inbound.
- *Is Spring Security a filter or interceptor?* — A **servlet filter chain**
  (`FilterChainProxy`).
- *javax vs jakarta?* — Spring Boot 3 / Spring 6 moved to `jakarta.servlet.*`; Boot 2 /
  Spring 5 use `javax.servlet.*`.

---

## References

- Spring Framework Reference — Aspect Oriented Programming with Spring:
  https://docs.spring.io/spring-framework/reference/core/aop.html
- Spring Framework Reference — Proxying mechanisms (JDK vs CGLIB):
  https://docs.spring.io/spring-framework/reference/core/aop/proxying.html
- Spring Framework Reference — Declaring advice / pointcuts:
  https://docs.spring.io/spring-framework/reference/core/aop/ataspectj.html
- Spring Framework Reference — HandlerInterceptor / MVC:
  https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet/handlermapping-interceptor.html
- Jakarta Servlet Filter API:
  https://jakarta.ee/specifications/servlet/
- Baeldung — Spring AOP: https://www.baeldung.com/spring-aop
- Baeldung — Spring AOP vs AspectJ: https://www.baeldung.com/spring-aop-vs-aspectj
- Baeldung — Filters vs Interceptors: https://www.baeldung.com/spring-mvc-handlerinterceptor-vs-filter
- Baeldung — CGLIB vs JDK proxies / self-invocation:
  https://www.baeldung.com/spring-aop-vs-aspectj
