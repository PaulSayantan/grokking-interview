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
