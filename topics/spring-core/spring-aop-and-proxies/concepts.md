# Spring AOP and Proxies

Aspect-Oriented Programming (AOP) complements Object-Oriented Programming by giving you another way to structure a program. Where OOP's unit of modularity is the class, AOP's unit of modularity is the *aspect*: a module that encapsulates a concern (like logging, security, or transactions) that would otherwise be scattered across many classes. Spring AOP is the framework's own, proxy-based implementation of these ideas, and it is the machinery behind declarative transactions (`@Transactional`), method-level security, caching (`@Cacheable`), and `@Async`.

This note covers the vocabulary, the annotations, the two proxying strategies (JDK dynamic proxies vs CGLIB), the famous self-invocation limitation, and how Spring AOP differs from full AspectJ.

---

## Cross-cutting concerns

A **cross-cutting concern** is a piece of behaviour that is needed in many places across an application but is not part of any one component's core business responsibility. Classic examples:

- Logging / tracing of method entry, exit, and arguments
- Transaction management (begin, commit, rollback)
- Security / authorization checks
- Performance monitoring and metrics
- Caching
- Retry and error handling

If you implement these directly inside business methods, the same boilerplate gets copied everywhere. This causes two problems that AOP is designed to solve:

- **Code tangling** — a single method mixes business logic with unrelated concerns (a `transferMoney` method that also opens transactions, logs, checks permissions).
- **Code scattering** — the same concern is duplicated across dozens of methods and classes; changing it means editing all of them.

AOP lets you write the concern **once**, in an aspect, and declaratively apply it to all the places (join points) that match a pointcut. The business code stays clean and focused; the cross-cutting logic lives in one modular unit.

```java
// Without AOP: the concern is tangled into every method
public void placeOrder(Order o) {
    long start = System.currentTimeMillis();      // metrics concern
    log.info("placeOrder start");                 // logging concern
    // ... actual business logic ...
    log.info("placeOrder done in {}ms", System.currentTimeMillis() - start);
}
```

With AOP that timing/logging code is extracted into an aspect and the method contains only business logic.

---

## Core AOP terminology

These terms are shared vocabulary across AOP frameworks (AspectJ defined most of them; Spring reuses them). Interviewers frequently ask you to define and distinguish them.

| Term | Definition |
|------|------------|
| **Aspect** | A module that encapsulates a cross-cutting concern. In Spring, a class annotated with `@Aspect` containing advice and pointcuts. |
| **Join point** | A point during program execution where an aspect can be applied. **In Spring AOP a join point is always a method execution** — nothing else. |
| **Advice** | The action taken by an aspect at a join point (the actual code that runs): `@Before`, `@After`, `@Around`, etc. |
| **Pointcut** | A predicate/expression that matches join points. Advice is associated with a pointcut and runs at any join point the pointcut matches. Spring uses the AspectJ pointcut expression language. |
| **Target object** | The original object being advised (the real bean with the business logic). Also called the "advised" object. |
| **Proxy** | The object created by the framework that wraps the target to apply advice. Callers get the proxy, not the raw target. |
| **Weaving** | Linking aspects with target objects to create the advised object. Can happen at compile time, load time, or runtime. **Spring AOP weaves at runtime** (via proxies). |
| **Introduction** | Declaring additional methods or fields on behalf of a type (making a bean implement a new interface). Called inter-type declaration in AspectJ. |
| **AOP proxy** | The specific proxy object Spring creates: a JDK dynamic proxy or a CGLIB proxy. |

A useful mental model: the **pointcut** selects *where*, the **advice** defines *what* and *when*, the **aspect** bundles them, and **weaving** wires the aspect into the target through a **proxy**.

---

## Advice types

Advice is the code that runs at a matched join point. Spring supports five advice annotations (from `org.aspectj.lang.annotation`):

| Annotation | When it runs | Can prevent method call | Can modify return | Notes |
|------------|--------------|-------------------------|-------------------|-------|
| `@Before` | Before the join point | No (unless it throws) | No | Runs before the method; can't stop it except by throwing. |
| `@AfterReturning` | After the method returns normally | No | No (can read the returned value via `returning`) | Not called if the method throws. |
| `@AfterThrowing` | After the method throws an exception | No | Can access the exception via `throwing` | Not called on normal return. |
| `@After` | After the method, regardless of outcome | No | No | "Finally" semantics — runs on both normal return and exception. |
| `@Around` | Surrounds the join point | **Yes** | **Yes** | Most powerful; receives `ProceedingJoinPoint`, must call `proceed()`. |

```java
@Aspect
@Component
public class LoggingAspect {

    @Before("execution(* com.example.service.*.*(..))")
    public void logBefore(JoinPoint jp) {
        System.out.println("Calling " + jp.getSignature().getName());
    }

    @AfterReturning(pointcut = "execution(* com.example.service.*.*(..))",
                    returning = "result")
    public void logReturn(JoinPoint jp, Object result) {
        System.out.println("Returned: " + result);
    }

    @AfterThrowing(pointcut = "execution(* com.example.service.*.*(..))",
                   throwing = "ex")
    public void logError(JoinPoint jp, Throwable ex) {
        System.out.println("Threw: " + ex.getMessage());
    }

    @After("execution(* com.example.service.*.*(..))")
    public void logAfterFinally(JoinPoint jp) {
        System.out.println("Finished (finally)");
    }

    @Around("execution(* com.example.service.*.*(..))")
    public Object timeIt(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.currentTimeMillis();
        try {
            Object result = pjp.proceed();          // invoke the target method
            return result;                           // may wrap/replace the result
        } finally {
            long ms = System.currentTimeMillis() - start;
            System.out.println(pjp.getSignature() + " took " + ms + "ms");
        }
    }
}
```

Key details interviewers probe:

- **`@Around` must declare `ProceedingJoinPoint` and call `proceed()`.** If you forget `proceed()`, the target method never runs. `@Around` can also skip `proceed()` deliberately (e.g., return a cached value), call it multiple times (retry), or transform its return value / swallow exceptions.
- **Other advice types use `JoinPoint`** (not `ProceedingJoinPoint`) as an optional first parameter to introspect args, signature, and target.
- **Advice ordering.** Around the same join point, on entry the order is `@Around` (before `proceed`) → `@Before`; on exit it is `@AfterReturning`/`@AfterThrowing` → `@After` → `@Around` (after `proceed`). Note: in Spring Framework 5.2.7+ the ordering for multiple advice methods *within the same aspect* was made deterministic based on advice type (`@Around`, then `@Before`, then `@After`, then `@AfterReturning`, then `@AfterThrowing` on the "after" side). Ordering between *different* aspects is controlled by `@Order` / `Ordered`.

**Worked example — trace the five advice types firing.** Take the `LoggingAspect` above (all five advice methods, all matching the same pointcut) applied to one call: `orderService.placeOrder(o)`, where `placeOrder` prints `"...running placeOrder..."` and returns the string `"OK"`. Follow the proxy step by step.

*Normal return.* `proceed()` runs the target, which returns `"OK"`; `@AfterReturning` sees that value. Console output, top to bottom:

```
Calling placeOrder            ← @Around before proceed()  →  @Before
...running placeOrder...      ← target body runs inside proceed()
Returned: OK                  ← @AfterReturning (normal return only)
Finished (finally)            ← @After (runs on any outcome)
placeOrder took 3ms           ← @Around resumes after proceed() (its finally block)
```

The onion closes in reverse of how it opened: `@Around` is the outermost layer, so it is first in and last out; `@AfterReturning` fires before `@After` because "returning" is more specific than the finally-style `@After`.

*Exception path.* Now `placeOrder` throws `IllegalStateException("bad order")`. `proceed()` throws, so `@AfterThrowing` fires instead of `@AfterReturning`, and the code *after* `proceed()` that is **not** in a `finally` is skipped — but `timeIt`'s `finally` still runs:

```
Calling placeOrder            ← @Around before proceed()  →  @Before
...running placeOrder...      ← target body, then throws
Threw: bad order              ← @AfterThrowing (throw path only)
Finished (finally)            ← @After
placeOrder took 3ms           ← @Around's finally block still runs
(exception then propagates to the caller)
```

Note what did **not** print: `Returned: OK` (no normal return) and any `@Around` line placed *after* `proceed()` but outside the `finally`. The exception rethrows out of `proceed()` and, since `timeIt` doesn't catch it, propagates to the original caller after the `finally` completes.

Deeper details a senior interviewer probes about `@Around`:

- **Declare the return type as `Object`, not `void`.** If an `@Around` method is declared `void`, Spring always returns `null` to the caller and the value produced by `proceed()` is discarded — even if the target returned something. This silently corrupts non-void target methods. Always declare `Object` (or the exact matching type) and `return` the value from `proceed()`.
- **`proceed()` vs `proceed(Object[])`.** Calling `proceed()` with no arguments forwards the *original* call arguments to the target. The overload `proceed(Object[] args)` lets `@Around` **substitute** arguments before the target runs — the canonical way to sanitize, decorate, or normalize inputs. In Spring's proxy model the array positions map to the join-point arguments; this is one behavioral difference from aspects compiled with the native AspectJ (`ajc`) weaver, where the `proceed` argument count must match the *advice's* bound parameters instead.
- **Argument binding.** Instead of positional `args()` indexing, you can name pointcut bindings (`args(pattern)`, `@annotation(audited)`, `this(svc)`, `target(t)`, `@args(...)`) and declare matching typed parameters on the advice method. Binding also acts as a *matching filter*: `args(String)` only matches when the runtime argument is a `String`. Likewise `@AfterReturning(returning = "r")` where `r` is typed `List` only fires when the actual return value is assignable to `List` — a subtle way advice can be skipped even though the pointcut's `execution(...)` part matched.
- **Least-powerful-advice principle.** Prefer `@Before`/`@AfterReturning` over `@Around` when you do not need to control invocation or mutate the result — `@Around` is easy to misuse (forgotten `proceed()`, wrong return type, swallowed exceptions).

---

## Aspect declaration and EnableAspectJAutoProxy

Spring uses **@AspectJ annotation style** — you write plain classes annotated with AspectJ annotations, but they are processed by Spring's proxy-based runtime (this is not AspectJ's compiler/weaver).

Two things are required:

1. **Mark the class as an aspect and register it as a bean.**

```java
@Aspect                 // marks this as an aspect (from AspectJ)
@Component              // makes Spring pick it up as a bean (needed for Spring to manage it)
public class LoggingAspect { ... }
```

`@Aspect` alone does **not** register the class as a Spring bean — Spring explicitly ignores `@Aspect`-only classes for autodetection. You still need `@Component` (or an `@Bean` method / XML definition) so the aspect becomes a managed bean.

2. **Enable auto-proxying** so Spring scans beans for aspects and creates proxies.

```java
@Configuration
@EnableAspectJAutoProxy      // turns on @AspectJ support in a Java-config context
@ComponentScan("com.example")
public class AppConfig { }
```

`@EnableAspectJAutoProxy` registers an `AnnotationAwareAspectJAutoProxyCreator` (a `BeanPostProcessor`) that, at bean creation time, checks whether any aspect's pointcut matches the bean and, if so, wraps it in an AOP proxy. The XML equivalent is `<aop:aspectj-autoproxy/>`.

Reusable **named pointcuts** keep expressions DRY:

```java
@Aspect @Component
public class Pointcuts {
    @Pointcut("execution(* com.example.service.*.*(..))")
    public void serviceLayer() {}    // the method body is empty; name = pointcut

    @Pointcut("@annotation(com.example.Audited)")
    public void audited() {}
}
// referenced elsewhere: @Before("com.example.Pointcuts.serviceLayer() && audited()")
```

Common pointcut designators: `execution(...)` (most used — matches method execution), `within(...)` (types), `@annotation(...)` (methods carrying an annotation), `bean(name)` (by bean name), `args(...)`, `this(...)`, `target(...)`.

**Worked example — decompose `execution(* com.example.service.*.*(..))` token by token.** An `execution` pointcut has the shape `execution([modifiers] return-type declaring-type.method-name(param-pattern) [throws])` — the modifiers and throws clause are optional. Splitting the expression used ~8 times above:

| Token | Part | Matches |
|-------|------|---------|
| `*` (first) | return type | **any** return type (void, `String`, `int`, …) |
| `com.example.service` | package of declaring type | that exact package (not sub-packages) |
| `.*` | declaring type | **any** class in that package |
| `.*` | method name | **any** method name |
| `(..)` | parameter pattern | **any** number and type of args (including zero) |

So it reads: "any method, any name, on any class directly in `com.example.service`, any return type, any arguments." Contrast that with narrower variants to see each token do work:

```
execution(public String com.example.service.OrderService.find(..))
  └ only public methods named "find" on OrderService that return String

execution(* com.example..*.*(..))
  └ ".." in the package position = com.example AND all sub-packages (recursive)

execution(* com.example.service.*.get*(..))
  └ only methods whose name starts with "get"

execution(* *..*Service.*(..))
  └ any class whose name ends in "Service", in any package

execution(* com.example.service.*.*(String, ..))
  └ only methods whose FIRST arg is a String (any further args)

execution(* com.example.service.*.*())
  └ "()" (not "(..)") = methods that take EXACTLY zero arguments
```

The two traps students miss: `.*` matches one package level while `..` matches that level *and* all nested packages; and `(..)` means "any args" whereas `()` means "no args."

> Note on packages: In **Spring Framework 6.x** the aspect annotations still come from `org.aspectj.lang.annotation` (AspectJ), unchanged. The jakarta/javax split affects things like `@Transactional`'s underlying APIs and servlet/JPA, not the AOP annotations themselves.

---

## JDK dynamic proxy vs CGLIB

Spring AOP is **proxy-based**: it does not modify your class bytecode. Instead it creates a proxy object that intercepts calls and applies advice before delegating to the target. There are two proxy mechanisms.

**JDK dynamic proxy**
- Built into the JDK (`java.lang.reflect.Proxy`).
- **Proxies interfaces**: the generated proxy implements the same interface(s) as the target and holds a reference to the target.
- Only methods declared on the proxied interfaces can be advised. The proxy is *not* an instance of the concrete class, only of its interfaces.

**CGLIB proxy**
- Uses a bytecode library (CGLIB, now repackaged inside `spring-core`) to generate a **runtime subclass** of the target class and override its methods.
- **Proxies classes** — no interface required.
- Limitations that follow from subclassing: it **cannot proxy `final` classes** or override **`final` methods**, and `private` methods are never advised. The target needs an instantiable constructor. Since Spring 4.0, CGLIB uses Objenesis, so a default no-arg constructor is not strictly required.

**How Spring chooses:**

| Situation | Proxy used |
|-----------|------------|
| Target implements one or more interfaces AND `proxyTargetClass=false` (default in plain Spring Framework) | **JDK dynamic proxy** |
| Target implements no interface | **CGLIB** (forced — nothing else is possible) |
| `proxyTargetClass=true` set on `@EnableAspectJAutoProxy(proxyTargetClass=true)` or `<aop:aspectj-autoproxy proxy-target-class="true"/>` | **CGLIB** always |

```java
@EnableAspectJAutoProxy(proxyTargetClass = true)  // force CGLIB for all proxies
```

Important nuances:

- **Default differs in Spring Boot.** Plain Spring Framework defaults to interface-based JDK proxies when interfaces exist. Spring Boot flips the default to CGLIB (`proxyTargetClass=true`) for its AOP auto-configuration, so injecting by concrete class type works out of the box. (This note is about the framework; the Boot default is a common gotcha.)
- **Inject by interface, not by concrete class, when using JDK proxies.** A JDK proxy is not an instance of the target class, so `@Autowired MyServiceImpl impl` fails to inject a JDK proxy — autowire the interface (`MyService`) instead.
- Regardless of mechanism, the proxy delegates to a single target instance; both approaches produce a runtime (weaving) proxy.

**Deeper internals:**

- **Fields are never proxied — only methods are intercepted.** Both proxy types dispatch on *method invocation*. A JDK proxy holds a separate target instance and forwards; a CGLIB proxy is a subclass whose own fields are typically **never populated** (Objenesis instantiates it without running the constructor, and Spring wires the *target*, not the proxy shell). Consequences: (1) reading a field directly on the proxy sees `null`/defaults, which is why advised methods must access state via getters that route to the target; (2) with CGLIB the target's `final` fields and constructor-initialized state live on the target, not the proxy subclass.
- **Objenesis and constructors.** Since Spring 4.0, CGLIB proxies are instantiated via Objenesis, bypassing the constructor, so the constructor is **not** invoked twice and a no-arg constructor is not required. If the JVM cannot bypass constructor invocation, Spring falls back to normal instantiation and the constructor may run twice — visible in debug logs.
- **`equals`/`hashCode`/`toString`.** `Object` methods are generally **not advised**. JDK proxies handle `equals`/`hashCode` specially (identity-ish semantics on the proxy). This matters when proxies are placed in `HashSet`/`HashMap` keys.
- **`AopUtils` / `AopProxyUtils`.** To reason about a proxied bean at runtime, use `AopUtils.isAopProxy()`, `isJdkDynamicProxy()`, `isCglibProxy()`, and `AopProxyUtils.ultimateTargetClass(bean)` to recover the real class behind the proxy. `bean.getClass()` on a CGLIB proxy returns a generated name like `MyService$$SpringCGLIB$$0` (or the older `$$EnhancerBySpringCGLIB$$` form).
- **`getBean(MyServiceImpl.class)` and `@Qualifier`.** Under JDK proxying, requesting the bean by its concrete class throws `NoSuchBeanDefinitionException`/`NoUniqueBeanDefinitionException`-style failures because the exposed type is the interface. This is the runtime face of the "inject by interface" rule.

---

## Self-invocation limitation

Because Spring AOP works through a proxy, **advice is only applied when the call comes through the proxy.** When a method inside the target object calls another method on the *same* object using `this`, the call goes directly to the target and bypasses the proxy entirely — so no advice runs. This is the **self-invocation** (a.k.a. internal method call) limitation.

```java
@Service
public class OrderService {

    @Transactional
    public void outer() {
        inner();           // self-invocation: 'this.inner()' — bypasses the proxy!
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void inner() {  // its @Transactional is IGNORED when called from outer()
        ...
    }
}
```

Here calling `orderService.outer()` triggers the proxy for `outer()`, but the internal `inner()` call does not go through the proxy, so `inner()`'s transactional advice (and any other advice) is silently skipped. The same applies to `@Cacheable`, `@Async`, custom aspects, etc.

Ways to deal with it (intro level — know that the limitation exists and the common fixes):

1. **Restructure** — move `inner()` into a separate bean and inject it, so the call crosses a proxy boundary.
2. **Self-injection** — inject the bean into itself and call through the injected reference (`self.inner()`).
3. **`AopContext.currentProxy()`** — call `((OrderService) AopContext.currentProxy()).inner()`. Requires `exposeProxy = true` and couples code to Spring AOP.
4. **Use full AspectJ (compile/load-time weaving)** — it weaves the actual bytecode, so self-invocation is advised too, since there is no proxy involved.

This limitation is a direct consequence of the proxy model and is one of the most commonly asked "gotcha" questions about Spring AOP.

**Subtle extensions of the same rule:**

- **Constructor-time calls are never advised.** If a target invokes an advised method from its own constructor, the proxy does not yet exist (the proxy wraps the fully constructed bean via a `BeanPostProcessor` *after* initialization), so no advice runs — regardless of whether the call is "external".
- **Lifecycle-callback calls.** Calls made from `@PostConstruct` or an `InitializingBean.afterPropertiesSet()` run on the raw target too, before/around proxy creation, so their internal advised calls are not intercepted.
- **`@Async` self-invocation returns synchronously.** A self-invoked `@Async` method not only skips the async advice — it runs on the caller's thread and returns immediately, which is a common source of "why isn't this running in the background" confusion.
- **`AopContext.currentProxy()` needs `exposeProxy=true`.** Without `@EnableAspectJAutoProxy(exposeProxy = true)`, `AopContext.currentProxy()` throws `IllegalStateException: Cannot find current proxy` because the proxy is not bound to the thread-local. `exposeProxy` has a small per-call cost since it stores/clears a `ThreadLocal` around every proxied invocation.
- **Self-injection ordering.** Injecting a bean into itself (`@Autowired private OrderService self;`) works but creates a self-reference that must be resolvable; with strict constructor injection this is a circular dependency, so self-injection is usually done via field/setter injection or `@Lazy`.

---

## Spring AOP vs AspectJ

Both use the same annotations and pointcut language, but they are fundamentally different implementations. AspectJ is a complete AOP language/framework; Spring AOP is a lighter, proxy-based subset integrated with the Spring container.

| Aspect | Spring AOP | AspectJ |
|--------|-----------|---------|
| **Weaving** | Runtime, via dynamic proxies | Compile-time, post-compile, or load-time weaving (LTW) — modifies bytecode |
| **Join points supported** | **Method execution only** | Method call/execution, constructor, field get/set, static init, exception handler, etc. |
| **Scope of what it can advise** | Only Spring-managed beans | Any object, including non-Spring objects and those created with `new` |
| **Self-invocation advised?** | No (proxy bypass) | Yes (bytecode is woven) |
| **Extra build/setup** | None — pure Java, part of Spring | Needs AspectJ compiler (ajc) or a load-time weaving agent |
| **Performance** | Slight per-call proxy overhead | Faster at runtime (woven directly), no proxy indirection |
| **Complexity** | Simpler, sufficient for most needs | More powerful but heavier to set up |

**Key takeaway:** Spring AOP intentionally covers the "80% case" (method-level cross-cutting on beans) with zero build changes. Reach for full AspectJ only when you need capabilities Spring AOP cannot provide: advising constructors or field access, advising non-Spring/`new`-created objects, or making self-invocations trigger advice. Spring can also *drive* AspectJ load-time weaving via `@EnableLoadTimeWeaving` / `<context:load-time-weaver/>` when you need it — the two are not mutually exclusive.

---

## Proxy creation internals and bean post-processing

Spring AOP proxies are created by an `AbstractAutoProxyCreator` — a `SmartInstantiationAwareBeanPostProcessor`. `@EnableAspectJAutoProxy` registers the `AnnotationAwareAspectJAutoProxyCreator` subclass, which understands both `@AspectJ` aspects and Spring's low-level `Advisor` beans.

Key timing and ordering facts:

- **Proxies are created in `postProcessAfterInitialization`.** For a normally created bean, wrapping happens *after* the target is fully instantiated, populated, and initialized (`@PostConstruct`/`afterPropertiesSet` have run on the raw target). This is why constructor/init-time internal calls are unadvised.
- **Early proxy references for circular dependencies.** When beans form a cycle, the auto-proxy creator can expose an *early* proxy via `getEarlyBeanReference` (the "early singleton reference" mechanism) so the injected reference is already the proxy. If a bean that needs proxying is injected into another bean mid-cycle and cannot be proxied early consistently, Spring throws `BeanCurrentlyInCreationException` or a "wrapped version" warning.
- **Multiple `BeanPostProcessor`s and `@Order`.** If several post-processors both want to wrap a bean (e.g., an AOP proxy creator and a custom BPP), the *order of the post-processors* determines nesting. `AbstractAutoProxyCreator` itself is ordered, and a bean already proxied is not re-proxied — matching advisors are merged into the single existing proxy where possible.
- **`@Transactional`, `@Cacheable`, `@Async`, and custom `@Aspect`s share one proxy.** They are all realized as `Advisor`s in a single interceptor chain around the bean, ordered by their advisor precedence (`@Order`, `Ordered`, or framework-assigned values such as `Ordered.LOWEST_PRECEDENCE` for the transaction advisor by default). Getting `@Transactional` and a custom aspect to interleave correctly is purely an ordering problem.
- **`@Configuration` classes are themselves CGLIB-proxied**, but by a *different* mechanism (the `ConfigurationClassEnhancer`, to enforce inter-`@Bean` singleton semantics), not by the AOP auto-proxy creator. Do not conflate the two.

## Advisor chain, MethodInterceptor, and matching

Under the hood every piece of advice becomes an `Advisor` = `Pointcut` + `Advice`, and each advice type is adapted into an `org.aopalliance.intercept.MethodInterceptor`. At invocation time a `ReflectiveMethodInvocation` (JDK) or CGLIB equivalent walks the interceptor chain, each interceptor calling `invocation.proceed()` to reach the next link, ending at the target method. `@Around` maps most directly to a `MethodInterceptor`; `@Before`, `@AfterReturning`, etc. are wrapped by adapter interceptors that call the target at the right point.

**Worked example — the nested `proceed()` onion for two advisors.** Say `OrderService.placeOrder()` is advised by both the transaction advisor (`@Transactional`, framework precedence `LOWEST_PRECEDENCE`) and a custom `@Around` audit aspect annotated `@Order(0)` (higher precedence = runs first on the way in). Spring builds one chain on the single proxy. `proceed()` is a *cursor*: each call advances one link deeper, and each interceptor's code before its `proceed()` runs on the way in, after it on the way out.

```
caller.placeOrder()
  → proxy: start chain at index 0
    → AuditInterceptor   (@Order(0))   : "audit: begin"      // before proceed
        → TxInterceptor  (LOWEST_PREC) : open transaction    // before proceed
            → target.placeOrder()      : ...business logic, returns "OK"
        ← TxInterceptor                : commit transaction   // after proceed
    ← AuditInterceptor                 : "audit: end (OK)"    // after proceed
  ← proxy returns "OK" to caller
```

Trace the cursor: the proxy calls `proceed()` → audit interceptor logs "begin" then calls `proceed()` → tx interceptor opens the transaction then calls `proceed()` → the target runs and returns `"OK"`. Now the stack unwinds in reverse: tx commits, then audit logs "end", then `"OK"` reaches the caller. The chain is a stack of nested `proceed()` calls, so the **last** advisor in (transaction) is the **first** to finish — which is exactly why `@Order` controls interleaving: to make audit *wrap* the transaction (see rollbacks in the audit log), give audit the lower `@Order` value so it sits outside the tx interceptor, as shown. Swap the order and the transaction would already be committed by the time audit's "after" code runs.

- **`execution` matching is static (per method); `args`/`this`/`target`/`@annotation` with runtime binding can be dynamic (per invocation).** Purely static pointcuts are matched once and cached, so they are cheap. Pointcuts requiring runtime argument type checks are evaluated on every call and are more expensive — relevant for hot paths.
- **Pointcut evaluation cost.** Broad `execution(* com..*(..))` pointcuts force the auto-proxy creator to test many beans at startup and can proxy far more beans than intended, adding startup cost and per-call indirection. Narrow with `within(...)` or bean-name scoping.
- **`this()` vs `target()`.** `this(Foo)` matches when the *proxy* is an instance of `Foo`; `target(Foo)` matches when the *target* is. Under JDK proxying the proxy is not an instance of the concrete class, so `this(ConcreteClass)` may fail to match where `target(ConcreteClass)` succeeds — a genuine trap.

## Thread-safety and performance

- **Proxies and advisor chains are thread-safe and stateless per call.** A single proxy instance serves all threads; per-invocation state lives on the stack (`MethodInvocation`). Aspect *beans* are singletons by default, so any mutable field you add to an aspect is shared across threads — keep aspects stateless or use `ThreadLocal`/concurrent structures.
- **Overhead.** Each proxied call adds a small, bounded cost: interceptor-chain traversal plus reflective (JDK) or generated (CGLIB) dispatch. CGLIB dispatch via generated `FastClass`/index is generally faster than JDK reflective invocation. The cost is per-call and negligible versus I/O, but broad pointcuts on tight in-memory loops can show up in profiles.
- **`exposeProxy` and thread-locals** add a `ThreadLocal` set/reset around each call; enable it only when `AopContext.currentProxy()` is actually needed.

---

## Common follow-up questions

- Q: In Spring AOP, what is the only kind of join point? Method execution. Field access, constructor calls, etc. are not supported (that's AspectJ).
- Q: Difference between `@After` and `@AfterReturning`? `@After` runs regardless of outcome (finally semantics); `@AfterReturning` runs only on normal return and can capture the returned value.
- Q: Why did my `@Transactional` / `@Cacheable` not work on an internal call? Self-invocation — the internal call bypasses the proxy. Move the method to another bean or use `AopContext.currentProxy()`.
- Q: When does Spring use CGLIB instead of a JDK proxy? When the target has no interface, or when `proxyTargetClass=true` is set. (And by default in Spring Boot.)
- Q: Can Spring AOP advise `private` or `final` methods? No. `private` methods are never advised; CGLIB cannot override `final` methods or subclass `final` classes; JDK proxies only see interface methods.
- Q: Does `@Aspect` make a class a Spring bean? No — you also need `@Component`/`@Bean`. And you need `@EnableAspectJAutoProxy` to activate proxying.
- Q: What must an `@Around` advice do? Accept a `ProceedingJoinPoint` and call `proceed()` (unless it deliberately short-circuits); it can alter arguments, the return value, or handle exceptions.
- Q: How do you order multiple aspects? Implement `Ordered` or annotate with `@Order`; lower value = higher precedence (runs first on the way in).
- Q: Is Spring AOP the same as AspectJ? No. Spring AOP is proxy-based, runtime, method-execution-only; it uses AspectJ's annotations and pointcut syntax but not its weaver.

---

## References

- Spring Framework Reference — Aspect Oriented Programming with Spring: https://docs.spring.io/spring-framework/reference/core/aop.html
- Spring Framework Reference — @AspectJ support and `@EnableAspectJAutoProxy`: https://docs.spring.io/spring-framework/reference/core/aop/ataspectj.html
- Spring Framework Reference — Proxying mechanisms (JDK dynamic proxies vs CGLIB): https://docs.spring.io/spring-framework/reference/core/aop/proxying.html
- Spring Framework Reference — Advice types and ordering: https://docs.spring.io/spring-framework/reference/core/aop/ataspectj/advice.html
- Spring Framework Reference — Choosing between Spring AOP and full AspectJ: https://docs.spring.io/spring-framework/reference/core/aop/choosing.html
- Spring Boot Reference — AOP (Boot defaults to CGLIB proxies; `spring.aop.proxy-target-class`): https://docs.spring.io/spring-boot/reference/features/aop.html
- AspectJ Programming Guide (terminology and full weaving model): https://eclipse.dev/aspectj/doc/latest/progguide/
