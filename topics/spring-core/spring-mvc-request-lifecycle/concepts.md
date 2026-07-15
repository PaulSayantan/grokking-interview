# Spring MVC and the Request Lifecycle

Spring MVC (also called Spring Web MVC) is the servlet-based web framework that ships inside the Spring Framework's `spring-webmvc` module. It implements the classic **Front Controller** pattern: a single servlet receives every request and dispatches it to the right handler. Understanding the request lifecycle — from the servlet container handing off a request all the way to the rendered response — is one of the most commonly tested Spring topics.

> Terminology note: This document is about the **Spring Framework** itself, not Spring Boot. Spring Boot merely auto-configures the same MVC machinery. In Spring Framework 6.x the web stack targets **Jakarta EE 9+**, so the servlet types live under `jakarta.servlet.*` (e.g. `jakarta.servlet.http.HttpServletRequest`). In Spring Framework 5.x and earlier they lived under `javax.servlet.*`. The `DispatcherServlet` is still a servlet either way.

---

## DispatcherServlet as Front Controller

The `DispatcherServlet` is the heart of Spring MVC. It is an ordinary `jakarta.servlet.http.HttpServlet` (via Spring's `HttpServletBean` → `FrameworkServlet` → `DispatcherServlet` hierarchy) that the servlet container maps to some URL pattern (commonly `/`). It acts as the **front controller**: instead of the container routing each URL to a different servlet, *all* matching requests funnel through this one servlet, which then delegates to the appropriate application components.

### What "front controller" buys you

- A single point for cross-cutting concerns (locale resolution, exception handling, multipart parsing, interceptors).
- Handlers (`@Controller` beans) are plain Spring beans, not servlets — they don't deal with the container directly.
- Consistent, configurable request processing shared across the whole application.

### The WebApplicationContext hierarchy

`DispatcherServlet` owns its own **`WebApplicationContext`** (a specialization of `ApplicationContext` for web apps). Classically there are two contexts:

- The **root** `WebApplicationContext`, bootstrapped by `ContextLoaderListener`, holds shared infrastructure beans (services, repositories, data sources).
- Each `DispatcherServlet` has a **child** context holding web-layer beans (controllers, view resolvers, handler mappings). The child can see beans in the root/parent, but not vice versa.

You can run with only a servlet context if you want; the parent/child split is a convention, not a requirement.

### Registration styles

Classic XML (`web.xml`):

```xml
<servlet>
  <servlet-name>app</servlet-name>
  <servlet-class>org.springframework.web.servlet.DispatcherServlet</servlet-class>
  <init-param>
    <param-name>contextConfigLocation</param-name>
    <param-value>/WEB-INF/app-context.xml</param-value>
  </init-param>
  <load-on-startup>1</load-on-startup>
</servlet>
<servlet-mapping>
  <servlet-name>app</servlet-name>
  <url-pattern>/</url-pattern>
</servlet-mapping>
```

Programmatic (Servlet 3.0+), by implementing `WebApplicationInitializer` — Spring detects it via `SpringServletContainerInitializer`. A convenient base class is `AbstractAnnotationConfigDispatcherServletInitializer`:

```java
public class MyWebInitializer
        extends AbstractAnnotationConfigDispatcherServletInitializer {
    @Override protected Class<?>[] getRootConfigClasses()    { return new Class[]{ RootConfig.class }; }
    @Override protected Class<?>[] getServletConfigClasses()  { return new Class[]{ WebConfig.class }; }
    @Override protected String[]   getServletMappings()      { return new String[]{ "/" }; }
}
```

### Special beans DispatcherServlet detects

On init, `DispatcherServlet` looks up specific bean types from its context (falling back to defaults in `DispatcherServlet.properties` if none are declared). The most important are:

| Strategy bean | Responsibility |
|---|---|
| `HandlerMapping` | Map a request to a handler (+ interceptors) |
| `HandlerAdapter` | Invoke the selected handler in a uniform way |
| `HandlerExceptionResolver` | Turn handler exceptions into a response/view |
| `ViewResolver` | Resolve a logical view name to a `View` |
| `LocaleResolver` | Determine the request's `Locale` |
| `ThemeResolver` | Resolve the theme (legacy) |
| `MultipartResolver` | Parse `multipart/form-data` (file uploads) |
| `FlashMapManager` | Store/retrieve flash attributes across a redirect |
| `RequestToViewNameTranslator` | Derive a view name when the handler returns none |

`@EnableWebMvc` (or `<mvc:annotation-driven/>`) installs a sensible, well-configured set of these — notably `RequestMappingHandlerMapping` and `RequestMappingHandlerAdapter`.

---

## Request Processing Flow

The end-to-end flow through `DispatcherServlet.doDispatch(...)` is the single most-asked diagram in Spring interviews. In order:

1. The servlet container receives the HTTP request and routes it to the `DispatcherServlet` (because of the servlet mapping).
2. `DispatcherServlet` asks each configured **`HandlerMapping`** to find the handler for the request. The result is a **`HandlerExecutionChain`** (the handler plus any matching `HandlerInterceptor`s).
3. `DispatcherServlet` selects a **`HandlerAdapter`** that supports that handler type.
4. Interceptors' `preHandle(...)` methods run (in registration order). If any returns `false`, processing stops.
5. The `HandlerAdapter` invokes the actual **handler** (your `@Controller` method), resolving its method arguments (path variables, params, body, etc.).
6. The handler returns one of: a `ModelAndView` / logical view name (+ model), a `@ResponseBody` object / `ResponseEntity` (body written directly), or `null`/void when it wrote the response itself.
7. Interceptors' `postHandle(...)` methods run (in *reverse* order), able to tweak the `ModelAndView` — but only for view-rendering handlers (not run before body is written via message converters in the same way).
8. If a view is involved, `DispatcherServlet` uses a **`ViewResolver`** to turn the logical view name into a `View`, then calls `view.render(model, request, response)`.
9. Interceptors' `afterCompletion(...)` run (reverse order), even if an exception occurred.
10. If a handler/render threw, a **`HandlerExceptionResolver`** gets a chance to produce an error response instead.

```
Client → [Servlet Container] → DispatcherServlet
   → HandlerMapping        (which handler? + interceptors)
   → HandlerAdapter        (how to invoke it)
   → Controller method     (business logic)
   → returns Model+View  OR  @ResponseBody / ResponseEntity
   → (view path) ViewResolver → View.render()
   → (body path) HttpMessageConverter writes body directly
   → Response → Client
```

Key distinction: a controller that returns a **view name** goes through the `ViewResolver`/`View` render path; a controller that returns a **response body** (`@ResponseBody`, `@RestController`, or `ResponseEntity`) bypasses view resolution entirely and uses an `HttpMessageConverter` to serialize the return value.

### Gotcha: postHandle timing for body-writing handlers

Interviewers love this one. For a **view-rendering** handler, `postHandle` runs *after* the handler returns but *before* `view.render(...)`, so it can still meaningfully mutate the `ModelAndView`. For a **`@ResponseBody`/`ResponseEntity`** handler, the return-value handler (`RequestResponseBodyMethodProcessor`) invokes the `HttpMessageConverter` and **writes the body to the response output stream during `HandlerAdapter.handle(...)`, before `postHandle` is called**. By the time `postHandle` runs, the `ModelAndView` is `null` and the response may already be **committed** — so trying to add headers or change the status there is silently ineffective. If you must alter a serialized response, use a `ResponseBodyAdvice`, a `Filter`, or `@ControllerAdvice`, not `postHandle`.

### Gotcha: what actually happens on an exception

If the handler (or a `preHandle`, or view rendering) throws, `postHandle` is **skipped**. `DispatcherServlet` catches the exception, walks its `HandlerExceptionResolver` chain to produce an (error) `ModelAndView`, renders it, and then calls `afterCompletion` with the exception. Interceptors whose `preHandle` already returned `true` still get `afterCompletion` (in reverse order); an interceptor whose `preHandle` returned `false` or was never reached does **not**. `DispatcherServlet` tracks the index of the last successfully-executed `preHandle` to know exactly which `afterCompletion` callbacks to fire.

---

## HandlerMapping and HandlerAdapter

These two strategy interfaces are the routing and invocation halves of the dispatch.

### HandlerMapping

A `HandlerMapping` answers "for this request, which handler should run?" It returns a `HandlerExecutionChain` = handler object + ordered interceptors. `DispatcherServlet` iterates its `HandlerMapping`s in order and uses the first that returns a match. Common implementations:

- **`RequestMappingHandlerMapping`** — maps requests to `@RequestMapping` annotated `@Controller` methods. This is the default modern mapping.
- **`BeanNameUrlHandlerMapping`** — maps URLs to beans whose name looks like a path (`/foo`).
- **`SimpleUrlHandlerMapping`** — explicit URL-to-handler map.
- **`RouterFunctionMapping`** — for functional endpoints (WebMvc.fn).

### HandlerAdapter

Because a "handler" can be many things (an annotated method, an `HttpRequestHandler`, a `Controller` interface, a `RouterFunction`), `DispatcherServlet` doesn't call it directly. It finds a `HandlerAdapter` whose `supports(handler)` returns `true` and delegates through `adapter.handle(request, response, handler)`. This decoupling is what lets Spring MVC support several handler programming models simultaneously. Common implementations:

- **`RequestMappingHandlerAdapter`** — invokes `@RequestMapping` methods; owns argument resolvers (`HandlerMethodArgumentResolver`) and return-value handlers (`HandlerMethodReturnValueHandler`), plus the `HttpMessageConverter`s.
- **`HttpRequestHandlerAdapter`** — for `HttpRequestHandler` (e.g. static resource handling).
- **`SimpleControllerHandlerAdapter`** — for the older `Controller` interface.
- **`HandlerFunctionAdapter`** — for functional endpoints.

### Why two interfaces instead of one?

Separation of concerns: `HandlerMapping` handles *routing* (URL, method, headers, params, content negotiation), `HandlerAdapter` handles *invocation* (argument binding, calling the method, handling the return value). Each can vary independently, which is the essence of the Strategy pattern here.

---

## Controller vs RestController

Both mark a Spring bean as a web handler; the difference is the default treatment of return values.

### @Controller

`@Controller` is a stereotype (a specialization of `@Component`, so it is component-scanned). By default, a method's return value (typically a `String`) is treated as a **logical view name** to be resolved and rendered. To return data as the response body from a `@Controller` method, you must annotate that method (or a return value) with `@ResponseBody`.

```java
@Controller
public class PageController {
    @GetMapping("/home")
    public String home(Model model) {
        model.addAttribute("user", currentUser());
        return "home";           // logical view name → ViewResolver → e.g. /WEB-INF/home.jsp
    }

    @GetMapping("/api/ping")
    @ResponseBody
    public String ping() {
        return "pong";           // written directly to the body (not a view name)
    }
}
```

### @RestController

`@RestController` is a **composed annotation**: it is meta-annotated with `@Controller` **and** `@ResponseBody`. So every handler method's return value is written to the response body via an `HttpMessageConverter` (e.g. Jackson serializes a POJO to JSON). It is the standard choice for REST/JSON APIs.

```java
@RestController
@RequestMapping("/api/users")
public class UserApi {
    @GetMapping("/{id}")
    public UserDto get(@PathVariable Long id) {
        return service.find(id);  // serialized to JSON in the response body
    }
}
```

| Aspect | `@Controller` | `@RestController` |
|---|---|---|
| Meta-annotations | `@Component` | `@Controller` + `@ResponseBody` |
| Default return handling | logical **view name** | **response body** (serialized) |
| Typical use | server-rendered pages (JSP/Thymeleaf), form flows | REST/JSON (and XML) APIs |
| Need `@ResponseBody`? | yes, per method returning data | no (implied) |
| Can still render a view? | yes | not by return value; would need e.g. `ModelAndView` explicitly |

---

## RequestMapping and HTTP Method Shortcuts

`@RequestMapping` declares the mapping between requests and handler methods (or a base path at the class level). It can constrain by URL path, HTTP method, headers, request/response media types, and query params.

```java
@RequestMapping(
    path     = "/orders",
    method   = RequestMethod.POST,
    consumes = "application/json",     // matches Content-Type of request
    produces = "application/json",     // matches Accept of client; sets response type
    params   = "type=express",         // only if ?type=express present
    headers  = "X-API-Version=2")
public Order create(@RequestBody OrderForm form) { ... }
```

### Composed shortcut annotations

Since Spring 4.3, method-level shortcuts pin the HTTP method so you don't repeat `method = ...`:

| Annotation | Equivalent | HTTP method |
|---|---|---|
| `@GetMapping` | `@RequestMapping(method = GET)` | GET |
| `@PostMapping` | `@RequestMapping(method = POST)` | POST |
| `@PutMapping` | `@RequestMapping(method = PUT)` | PUT |
| `@DeleteMapping` | `@RequestMapping(method = DELETE)` | DELETE |
| `@PatchMapping` | `@RequestMapping(method = PATCH)` | PATCH |

Class-level `@RequestMapping` sets a base path that is combined with method-level mappings. Path patterns support `{var}` templates, Ant-style wildcards (`*`, `**`), and (Spring 5.3+) the newer `PathPattern` parser.

```java
@RestController
@RequestMapping("/api/v1/books")
class BookController {
    @GetMapping                 List<Book> list()            { ... }  // GET /api/v1/books
    @GetMapping("/{id}")        Book one(@PathVariable id)    { ... }  // GET /api/v1/books/42
    @PostMapping                Book create(@RequestBody ...) { ... }  // POST /api/v1/books
}
```

If no `HandlerMapping` finds a match, `DispatcherServlet` responds `404`. A method match with the wrong HTTP verb yields `405 Method Not Allowed`; a content-type mismatch on `consumes` yields `415 Unsupported Media Type`; an `Accept`/`produces` mismatch yields `406 Not Acceptable`.

---

## Method Argument Annotations

The `RequestMappingHandlerAdapter` resolves each controller-method parameter using a chain of `HandlerMethodArgumentResolver`s. The four you must know:

### @PathVariable

Binds a **URI template variable** from the path. The variable name defaults to the parameter name (requires `-parameters` compilation or an explicit `@PathVariable("id")`).

```java
@GetMapping("/users/{id}/orders/{orderId}")
public Order get(@PathVariable Long id, @PathVariable("orderId") Long oid) { ... }
```

### @RequestParam

Binds a **query parameter** (or form field, or multipart part). Supports `required` (default `true`) and `defaultValue` (which implies `required=false`).

```java
@GetMapping("/search")
public List<Item> search(
        @RequestParam String q,                          // ?q=... required
        @RequestParam(defaultValue = "0") int page,      // optional, default 0
        @RequestParam(name = "sort", required = false) String sort) { ... }
```

If a required `@RequestParam` is missing, Spring throws `MissingServletRequestParameterException` → `400 Bad Request`.

### @RequestBody

Binds the **entire request body**, deserialized by an `HttpMessageConverter` (e.g. Jackson for JSON) into the parameter type. Combine with `@Valid` to trigger bean validation.

```java
@PostMapping("/users")
public User create(@Valid @RequestBody CreateUserRequest req) { ... }
```

The converter is chosen based on the request's `Content-Type`. No matching converter → `415 Unsupported Media Type`.

### @ModelAttribute

Binds request parameters onto the **fields of an object** (form binding) — Spring instantiates the target, then sets fields from matching request params. Also used at the method level to pre-populate the model for every handler in the controller. Unlike `@RequestBody`, it reads from query/form params (not a JSON body) and uses the `WebDataBinder`, so it participates in field-level type conversion and `BindingResult` errors.

```java
@PostMapping("/register")
public String register(@ModelAttribute("form") UserForm form, BindingResult result) { ... }

@ModelAttribute("countries")   // method-level: runs before each handler, adds to model
public List<String> countries() { return List.of("US", "IN", "UK"); }
```

| Annotation | Source of data | Typical binding | Missing/invalid → |
|---|---|---|---|
| `@PathVariable` | URI template segment | single value | 400 (or 500 if not optional) |
| `@RequestParam` | query string / form field | single value | 400 if required and absent |
| `@RequestBody` | HTTP body (via converter) | whole object from JSON/XML | 400 (unreadable) / 415 (type) |
| `@ModelAttribute` | query/form params | object fields (data binding) | binding errors in `BindingResult` |

Note: parameters like `Model`, `Map`, `HttpServletRequest`, `Principal`, `@RequestHeader`, `@CookieValue`, `HttpEntity`, and `Errors`/`BindingResult` are also resolved automatically without a value annotation.

---

## ViewResolver and View Rendering

When a handler returns a **logical view name** (a `String`, or a `ModelAndView`, or nothing and the name is inferred), `DispatcherServlet` must turn that name into something that can render. That is the job of `ViewResolver` and `View`.

- **`ViewResolver`** maps a logical name (e.g. `"home"`) plus the current `Locale` to a `View` instance.
- **`View`** does the actual rendering: `render(Map<String,?> model, request, response)` writes the response (HTML, PDF, etc.).

The most common resolver for JSP is `InternalResourceViewResolver`, which adds a prefix/suffix:

```java
@Bean
InternalResourceViewResolver viewResolver() {
    InternalResourceViewResolver r = new InternalResourceViewResolver();
    r.setPrefix("/WEB-INF/views/");
    r.setSuffix(".jsp");
    return r;                  // "home"  →  /WEB-INF/views/home.jsp
}
```

Other resolvers: `ThymeleafViewResolver`, `FreeMarkerViewResolver`, `BeanNameViewResolver`, `ContentNegotiatingViewResolver` (picks a view based on requested media type), `UrlBasedViewResolver`.

### Special view-name prefixes

- `redirect:/path` → issues an HTTP redirect (302) via `RedirectView`; model attributes become query params unless carried by `RedirectAttributes`/flash attributes.
- `forward:/path` → server-side forward within the container (no round trip).

### When no view is used

If the handler is `@ResponseBody`/`@RestController`/returns `ResponseEntity` or `HttpEntity`, or writes to the response itself, the `ViewResolver` chain is **skipped** — the return value is serialized by an `HttpMessageConverter`. This is the fundamental "view path vs body path" fork of Spring MVC.

---

## HandlerInterceptor vs Servlet Filter

Both let you run logic around request handling, but they operate at different layers.

### Servlet Filter

A `jakarta.servlet.Filter` is a **Servlet-spec** component managed by the servlet container. It wraps the entire `doFilter` chain and sits *outside* Spring MVC — it runs before the request even reaches `DispatcherServlet` and after the response leaves it. It sees the raw `ServletRequest`/`ServletResponse`, can wrap them, and can short-circuit the chain. It has **no knowledge** of which Spring handler will run or what the `ModelAndView` is. (Spring can register beans as filters via `DelegatingFilterProxy`.)

### HandlerInterceptor

A Spring `HandlerInterceptor` is a **Spring MVC** component invoked by `DispatcherServlet` around handler execution. It has three callbacks:

- `preHandle(request, response, handler)` → return `false` to stop; runs before the handler.
- `postHandle(request, response, handler, modelAndView)` → after the handler, before view render; can modify the model/view.
- `afterCompletion(request, response, handler, ex)` → after rendering (or on exception); for cleanup.

Because it runs inside `DispatcherServlet`, it *knows the chosen handler* and can access the `ModelAndView`.

```java
public class TimingInterceptor implements HandlerInterceptor {
    @Override public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object h) {
        req.setAttribute("start", System.nanoTime());
        return true;   // continue
    }
    @Override public void afterCompletion(HttpServletRequest req, HttpServletResponse res, Object h, Exception ex) {
        long start = (long) req.getAttribute("start");
        log.info("took {} ms", (System.nanoTime() - start) / 1_000_000);
    }
}
```

Register via `WebMvcConfigurer`:

```java
@Configuration @EnableWebMvc
public class WebConfig implements WebMvcConfigurer {
    @Override public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new TimingInterceptor()).addPathPatterns("/api/**");
    }
}
```

| Aspect | Servlet Filter | HandlerInterceptor |
|---|---|---|
| Defined by | Servlet spec (`jakarta.servlet.Filter`) | Spring MVC (`HandlerInterceptor`) |
| Managed by | Servlet container | `DispatcherServlet` |
| Position | Around `DispatcherServlet` (outermost) | Inside `DispatcherServlet`, around handler |
| Knows the handler? | No | Yes (`handler` arg) |
| Access to `ModelAndView`? | No | Yes (in `postHandle`) |
| Can wrap request/response? | Yes | No (works with existing objects) |
| Path matching | URL pattern in config | `addPathPatterns`/`excludePathPatterns` |
| Good for | encoding, CORS, compression, security (Spring Security is filter-based), request wrapping | app-level auth checks, timing, adding model attributes, logging tied to handlers |

Rule of thumb: use a **Filter** for concerns that must apply to *all* requests regardless of MVC (or that need to wrap the request/response); use a **HandlerInterceptor** for MVC-aware concerns tied to controller handling.

---

## ResponseEntity

`ResponseEntity<T>` represents the **entire HTTP response**: status code, headers, and body. Returning it from a handler gives you full, programmatic control that `@ResponseBody` alone (body only, default 200) does not.

```java
@GetMapping("/users/{id}")
public ResponseEntity<UserDto> get(@PathVariable Long id) {
    return service.findOptional(id)
        .map(ResponseEntity::ok)                                   // 200 + body
        .orElseGet(() -> ResponseEntity.notFound().build());       // 404, no body
}

@PostMapping("/users")
public ResponseEntity<UserDto> create(@RequestBody CreateUserRequest req) {
    UserDto saved = service.create(req);
    URI location = URI.create("/users/" + saved.getId());
    return ResponseEntity.created(location).body(saved);           // 201 + Location header
}
```

- It works in both `@Controller` and `@RestController` — because it *is* the response, it always goes down the body path and skips view resolution.
- The fluent builder (`ResponseEntity.status(...)`, `.ok()`, `.created(uri)`, `.notFound()`, `.badRequest()`, `.noContent()`, then `.header(...)`, `.body(...)`, `.build()`) makes status/header setting declarative.
- `ResponseEntity` is a subclass of `HttpEntity` (which has headers + body but no status). Its request-side counterpart is `RequestEntity`.
- Compared to setting `@ResponseStatus` on a method (a fixed status) or throwing `ResponseStatusException`, `ResponseEntity` lets you decide status/headers **dynamically per invocation**.

| Return type | Controls status? | Controls headers? | Controls body? | Goes through view resolver? |
|---|---|---|---|---|
| `String` (in `@Controller`) | no | no | no (it's a view name) | yes |
| `@ResponseBody` object | fixed 200 (or `@ResponseStatus`) | limited | yes | no |
| `ResponseEntity<T>` | yes (dynamic) | yes | yes | no |

---

## Exception Resolution Internals

When a handler or view render throws, `DispatcherServlet.processHandlerException(...)` iterates its ordered list of `HandlerExceptionResolver`s and uses the **first** that returns a non-null `ModelAndView` (an empty `ModelAndView` means "handled, nothing to render"). `@EnableWebMvc` registers three, in this precedence order:

1. **`ExceptionHandlerExceptionResolver`** — dispatches to `@ExceptionHandler` methods (local to the controller, then to `@ControllerAdvice` beans). This runs first, so a matching `@ExceptionHandler` wins over `@ResponseStatus` or the default resolver.
2. **`ResponseStatusExceptionResolver`** — handles exceptions annotated with `@ResponseStatus` and `ResponseStatusException`.
3. **`DefaultHandlerExceptionResolver`** — translates standard Spring MVC exceptions (`HttpRequestMethodNotSupportedException` → 405, `HttpMediaTypeNotSupportedException` → 415, `MissingServletRequestParameterException` → 400, etc.) into status codes.

Key subtleties senior candidates should know:

- **`@ExceptionHandler` method matching** picks the handler whose declared exception type is the *closest supertype* of the thrown exception (nearest match in the class hierarchy wins, not declaration order). If two `@ExceptionHandler`s are equally specific, an `IllegalStateException` (ambiguous) is raised.
- **Controller-local `@ExceptionHandler` beats `@ControllerAdvice`.** A local handler is always preferred over a global one for the same controller.
- **`@ControllerAdvice` ordering** among multiple advices honors `@Order`/`Ordered`; the first advice with a matching handler wins.
- **Exceptions inside `@ExceptionHandler` methods, `afterCompletion`, or during body serialization after the response is committed** cannot be re-resolved cleanly — the container's default error page (or the servlet error dispatch) takes over.
- `HandlerExceptionResolver`s only handle exceptions thrown **from the handler or during rendering inside `doDispatch`** — not exceptions thrown in a `Filter` (those are outside `DispatcherServlet`) or after the response is committed.
- Since Spring 6, `ResponseEntityExceptionHandler` (an `@ControllerAdvice` base class) and the `ProblemDetail` / `ErrorResponse` model (originally per RFC 7807, now RFC 9457, which obsoletes it) provide a standardized body for framework exceptions.

---

## HandlerMapping Ordering and Path Matching

`DispatcherServlet` sorts all detected `HandlerMapping` beans by `Ordered`/`@Order` and consults them **in order**, using the first that returns a non-null chain. By default `RequestMappingHandlerMapping` has order 0, `BeanNameUrlHandlerMapping` order 2, and the resource/`SimpleUrlHandlerMapping` handlers are ordered near `Integer.MAX_VALUE - n` so annotated controllers win over static-resource fallbacks.

### Best-match selection within RequestMappingHandlerMapping

When several `@RequestMapping`s match one request, Spring does **not** pick by declaration order. It builds all matching `RequestMappingInfo`s and sorts them with a `RequestMappingInfo` comparator that ranks by specificity: an exact path beats a `{var}` template, which beats a single `*`, which beats `**`; then method, params, headers, `consumes`, and `produces` conditions break ties. The best and second-best are compared — if they are *equally* specific, a `IllegalStateException: Ambiguous handler methods` is thrown at request time (not startup).

### PathPattern vs AntPathMatcher

Spring 5.3+ introduced `PathPattern` (parsed path matching) as the default for Spring MVC via `PathPatternParser`, replacing string-based `AntPathMatcher` for most cases. Differences that trip people up:

- `PathPattern` only allows `**` at the **end** of a pattern; `/a/**/b` is illegal with `PathPatternParser` but was allowed by `AntPathMatcher`.
- `PathPattern` uses a pre-parsed `RequestPath` and is faster and allocation-light on the hot path.
- The historical **suffix pattern matching** (`/foo` also matching `/foo.*`) and trailing-slash matching (`/foo` matching `/foo/`) are **deprecated and disabled by default** in Spring 6. `setUseTrailingSlashMatch(true)` is removed; you must map both explicitly or add a redirect. This is a common migration break: `/users` no longer matches `/users/`.

---

## Async Request Processing

A handler may return `DeferredResult<T>`, `Callable<T>`, `WebAsyncTask<T>`, `CompletableFuture<T>`/`CompletionStage`, or a reactive type (with the reactive adapter). This starts **Servlet 3.0 async processing**: the container thread that `DispatcherServlet` ran on is released back to the pool *before* the response is produced, and the result is produced later on another thread.

Mechanics and gotchas:

- On an async return, `DispatcherServlet` calls `request.startAsync()`, the request enters async mode, and `doDispatch` returns without rendering. `postHandle`/`afterCompletion` of `HandlerInterceptor` are **not** the async-aware hooks — use `AsyncHandlerInterceptor.afterConcurrentHandlingStarted(...)` to observe the point where the container thread is released.
- When the async result is set, the container **re-dispatches** the request to `DispatcherServlet` (a `DispatcherType.ASYNC` dispatch). The mapping/handler is not re-run; instead the produced value flows through return-value handling and rendering. Interceptors and filters mapped for `ASYNC` dispatch run again on this second dispatch.
- **`Callable`** is executed on a Spring-managed `AsyncTaskExecutor` (by default a `SimpleAsyncTaskExecutor` — which does **not** pool threads; configure a real executor via `WebMvcConfigurer.configureAsyncSupport`). **`DeferredResult`** is completed by *your* code from any thread (e.g. a message listener), decoupled from any Spring thread.
- **`ThreadLocal`-bound context is lost across the thread hop** unless propagated: request-scoped beans, `SecurityContextHolder` (default `MODE_THREADLOCAL`), and `RequestContextHolder` are thread-bound. Spring re-establishes request attributes on the async dispatch thread, but arbitrary `ThreadLocal`s and the security context need explicit propagation (e.g. `DelegatingSecurityContextRunnable`, `TaskDecorator`).
- Timeouts: an unfulfilled `DeferredResult`/`Callable` triggers `AsyncRequestTimeoutException` (default 503) after the configured timeout; you can supply `onTimeout`/`onError` callbacks.

---

## Data Binding, Type Conversion, and Validation Internals

`@RequestParam`, `@PathVariable`, and `@ModelAttribute` values are converted through Spring's `WebDataBinder`, which uses the shared `ConversionService` (plus legacy `PropertyEditor`s). Points that separate seniors:

- **`@InitBinder`** methods let a controller customize the `WebDataBinder` per request — register custom `PropertyEditor`s/`Formatter`s, set allowed/disallowed fields (`setAllowedFields`, `setDisallowedFields`) to prevent mass-assignment, and set required fields. `@InitBinder` methods run **before** argument resolution for each handler invocation.
- **`@ModelAttribute` binding never fails the request by itself** — binding/type-conversion errors are recorded in the `BindingResult`. But the `BindingResult` parameter **must immediately follow** the `@ModelAttribute` parameter in the method signature; otherwise Spring throws `BindException` (400) instead of giving you the errors to inspect. Order matters.
- **`@Valid`/`@Validated` on `@ModelAttribute`** → violations go into `BindingResult` (if present) so you can render the form again. **`@Valid` on `@RequestBody`** → violations throw `MethodArgumentNotValidException` (400) unless a following `Errors`/`BindingResult` is declared.
- **`@Validated` (Spring) vs `@Valid` (Jakarta):** only Spring's `@Validated` supports **validation groups**; `@Valid` does not. `@Validated` at the *class* level activates method-level validation via `MethodValidationPostProcessor` (violations → `ConstraintViolationException`, a different path than `MethodArgumentNotValidException`).
- **`@RequestParam Map<String,String>`** binds *all* parameters; a `@RequestParam` with no name and a `Map` type behaves differently from a named one — subtle but testable.
- Conversion failure for a typed `@RequestParam`/`@PathVariable` (e.g. `?age=abc` into an `int`) throws `MethodArgumentTypeMismatchException` → 400, distinct from a *missing* parameter (`MissingServletRequestParameterException`).

---

## Content Negotiation Internals

For response serialization, `ContentNegotiationManager` determines the requested media types via a strategy list, in this default priority: (1) **`Accept` header** (`HeaderContentNegotiationStrategy`), unless overridden. In Spring 6 the legacy **path-extension** strategy (`.json`) is disabled by default (security and ambiguity concerns); **query-parameter** strategy (`?format=json`) is off unless enabled via `configureContentNegotiation`. `RequestMappingHandlerAdapter` then intersects the requested types with the `produces` condition and the media types each `HttpMessageConverter` can write, picking the most specific match.

Gotchas:

- **`produces` on the mapping affects both routing and the chosen content type.** A request whose `Accept` cannot be satisfied by any `produces`/converter combination yields **406 Not Acceptable**.
- **Converter order matters**: converters are consulted in registration order; the first that `canWrite(type, mediaType)` wins. Adding a custom converter via `extendMessageConverters` vs `configureMessageConverters` differs: the latter **replaces** the entire default list (you lose Jackson, `String`, `ByteArray`, etc.), the former appends/tweaks. This is a frequent "why did my JSON stop working" trap.
- The `MappingJackson2HttpMessageConverter` supports `application/json` and, historically, `application/*+json`; ordering it before a more generic converter matters for `text/plain` String returns.

---

## FrameworkServlet, Initialization, and Thread-Safety

`DispatcherServlet` is a singleton servlet instance; the container may serve **many concurrent requests through the same instance**, so all its strategy beans (`HandlerMapping`, `HandlerAdapter`, converters) must be thread-safe — and they are designed to be effectively immutable after `refresh()`. Notes:

- `FrameworkServlet.initWebApplicationContext()` builds/attaches the `WebApplicationContext`; `DispatcherServlet.onRefresh()` → `initStrategies()` populates the strategy fields. This happens **once** at servlet init (or on context refresh), not per request.
- **`@Controller` singletons must be stateless.** Mutable instance fields shared across requests are a classic concurrency bug. Per-request state belongs in method parameters, request/session-scoped beans (injected as scoped proxies), or `ThreadLocal`-backed holders like `RequestContextHolder`.
- `RequestContextHolder` exposes the current request via a `ThreadLocal`; it is populated by `FrameworkServlet` (or `RequestContextFilter`/`RequestContextListener`) and is why you can retrieve request-scoped beans deep in the service layer — but it breaks across async/other-thread hops unless propagated.
- Multiple `DispatcherServlet`s can coexist (e.g. one for `/api/*`, one for `/admin/*`), each with its own child context but sharing the one root context.

---

## Filter Ordering and DelegatingFilterProxy

Filters run outside `DispatcherServlet`, wrapping it. Their **order is determined by the servlet container's filter chain**, not by Spring's `Ordered` (in plain Spring MVC with `web.xml`/programmatic registration, order follows `<filter-mapping>` declaration order or the registration order in `WebApplicationInitializer`). Key facts:

- **`DelegatingFilterProxy`** is a container-managed `Filter` that delegates to a Spring bean of type `Filter` found by name in the (root) `WebApplicationContext`. This is how Spring Security's `springSecurityFilterChain` is wired: the container manages a thin proxy, the real filter is a Spring bean with full DI.
- **`OncePerRequestFilter`** guards against running twice on the same request — important because a single request can pass through the filter chain multiple times across `FORWARD`/`INCLUDE`/`ASYNC` dispatches. It keys off a request attribute so `doFilterInternal` runs once per request, not per dispatch.
- Because filters sit outside MVC, an exception thrown in a filter **cannot** be handled by `@ExceptionHandler`/`HandlerExceptionResolver`; it propagates to the container error handling. Security/auth done as a filter therefore produces responses before MVC ever sees the request.
- Filters can **wrap** the request/response (e.g. `ContentCachingRequestWrapper`, `HttpServletRequestWrapper`) to cache/modify the body — something interceptors cannot do.

---

## Common follow-up questions

- **What is the difference between the root and servlet `WebApplicationContext`?** The root context (via `ContextLoaderListener`) holds shared services/repositories; each `DispatcherServlet` has a child web context (controllers, resolvers) that can see the parent but not vice versa.
- **What does `@EnableWebMvc` actually do?** It imports `DelegatingWebMvcConfiguration`, which registers the well-configured MVC infrastructure beans (`RequestMappingHandlerMapping`, `RequestMappingHandlerAdapter`, message converters, etc.) and lets you customize them via `WebMvcConfigurer`.
- **How does Spring pick which `HttpMessageConverter` to use?** By matching the request `Content-Type` (for `@RequestBody`) or the `Accept` header (for the response, i.e. content negotiation) against each converter's supported media types and the parameter/return type.
- **What happens if two handlers match the same request?** The mapping raises `IllegalStateException`/ambiguous-mapping errors at request time; more specific patterns win over less specific ones.
- **Is `DispatcherServlet` thread-safe / how are controllers scoped?** `@Controller` beans are singletons by default and must be stateless; the container serves requests concurrently on separate threads, and per-request data lives in method arguments/request scope, not controller fields.
- **What's the difference between `redirect:` and `forward:`?** `redirect:` sends a 3xx to the client causing a new request (URL changes); `forward:` is a server-internal dispatch (URL unchanged, same request).
- **How do exceptions get turned into responses?** Via `HandlerExceptionResolver`s — e.g. `@ExceptionHandler` methods (through `ExceptionHandlerExceptionResolver`), `@ResponseStatus` on exceptions (`ResponseStatusExceptionResolver`), and `DefaultHandlerExceptionResolver` for standard Spring MVC exceptions.
- **Filter vs interceptor for authentication?** Spring Security is implemented as servlet filters (runs before MVC); use a `HandlerInterceptor` for lighter, MVC-aware checks that need the resolved handler.

## References

- Spring Framework Reference — Web on Servlet Stack (Spring MVC): https://docs.spring.io/spring-framework/reference/web/webmvc.html
- DispatcherServlet: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet.html
- Annotated Controllers (`@RequestMapping`, argument resolvers): https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller.html
- Handler interceptors: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet/handlermapping-interceptor.html
- Javadoc: `org.springframework.web.servlet.DispatcherServlet`, `ResponseEntity`, `HandlerInterceptor`
- Jakarta Servlet migration (Spring Framework 6.x): https://docs.spring.io/spring-framework/reference/
