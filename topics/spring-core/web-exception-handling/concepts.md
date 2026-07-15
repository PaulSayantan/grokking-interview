# Exception Handling in the Web Layer

Exception handling in Spring's web layer (Spring MVC / `spring-webmvc`, and analogously Spring WebFlux) is about turning exceptions thrown while processing an HTTP request into a well-formed HTTP response: the right status code, headers, and body. Spring provides a layered set of mechanisms — from a single method on a controller (`@ExceptionHandler`), to application-wide advice (`@ControllerAdvice`), to a low-level SPI (`HandlerExceptionResolver`) that underpins all of it.

This note focuses on the **Spring Framework** itself (Spring 6.x runs on Jakarta EE 9+, so the servlet API is `jakarta.servlet.*`, not `javax.servlet.*`). Spring Boot layers additional conveniences (e.g. the `BasicErrorController` / `/error` mapping, `ErrorAttributes`, auto-configured error responses); those are called out explicitly where relevant, but the mechanisms below are all part of the core framework.

---

## The exception resolution pipeline

Before diving into annotations, it helps to understand where exception handling sits in the request lifecycle.

`DispatcherServlet` invokes a `HandlerAdapter` to run your controller method. If the handler (or any interceptor, or the adapter) throws an exception, `DispatcherServlet` does **not** immediately propagate it to the servlet container. Instead it delegates to its ordered list of **`HandlerExceptionResolver`** beans, giving each one a chance to produce a `ModelAndView` (or, for `@ResponseBody`/`ResponseEntity` handlers, to write the response directly).

The default resolvers registered by `@EnableWebMvc` / `WebMvcConfigurationSupport`, in order, are:

1. **`ExceptionHandlerExceptionResolver`** — finds and invokes matching `@ExceptionHandler` methods (controller-local and `@ControllerAdvice`). This is the workhorse for annotation-based handling.
2. **`ResponseStatusExceptionResolver`** — handles `@ResponseStatus`-annotated exceptions and `ResponseStatusException`.
3. **`DefaultHandlerExceptionResolver`** — translates standard Spring MVC exceptions (e.g. `HttpRequestMethodNotSupportedException`, `HttpMessageNotReadableException`, `MissingServletRequestParameterException`) into the appropriate HTTP status codes.

If **no** resolver handles the exception, `DispatcherServlet` re-throws it and it propagates to the servlet container (which typically renders a generic error page or, under Spring Boot, forwards to `/error`).

Key mental model: `@ExceptionHandler`, `@ControllerAdvice`, `@ResponseStatus`, and `ResponseEntityExceptionHandler` are all **higher-level abstractions built on top of the `HandlerExceptionResolver` SPI.**

### What exactly is inside the try block

In `DispatcherServlet.doDispatch(...)`, the `try` block wraps `applyPreHandle` (interceptor `preHandle`), the `HandlerAdapter.handle(...)` call, and `applyPostHandle` (interceptor `postHandle`). Any exception thrown from **those** phases is caught and routed to `processHandlerException(...)`, which walks the resolver chain. Consequences a senior candidate should know:

- **Interceptor `preHandle`/`postHandle` exceptions ARE resolvable** by `@ExceptionHandler`/resolvers — they are inside the try block. But `HandlerInterceptor.afterCompletion(...)` runs *after* the try block (during rendering/cleanup), so an exception it throws is **not** routed through the resolvers; it propagates to the container.
- **View rendering exceptions** (thrown from `render(...)`) are largely outside the exception-resolver flow in the same dispatch; `DispatcherServlet` calls `triggerAfterCompletion` and rethrows. `@ExceptionHandler` is generally *not* a reliable place to catch failures that occur while rendering a view you already selected.
- The `handler` argument passed to a resolver may be `null` (e.g. `NoHandlerFoundException`, where no handler was ever matched). `ExceptionHandlerExceptionResolver` needs a `HandlerMethod` to locate controller-local handlers, so with a `null` handler only `@ControllerAdvice`-based handlers are eligible.
- If the response is **already committed** (bytes flushed, e.g. mid-stream), a resolver can no longer change the status line or headers; the best it can do is stop writing. This is a common cause of "my `@ExceptionHandler` ran but the client still saw 200."

---

## @ExceptionHandler (controller-local)

`@ExceptionHandler` marks a method within a `@Controller` (or `@RestController`) that handles exceptions thrown by `@RequestMapping`/`@GetMapping`/etc. handler methods **in that same controller**.

```java
@RestController
public class OrderController {

    @GetMapping("/orders/{id}")
    public Order get(@PathVariable String id) {
        return service.find(id); // may throw OrderNotFoundException
    }

    // Handles OrderNotFoundException thrown by any handler method in THIS controller
    @ExceptionHandler(OrderNotFoundException.class)
    public ResponseEntity<ApiError> handleNotFound(OrderNotFoundException ex) {
        ApiError body = new ApiError("ORDER_NOT_FOUND", ex.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body);
    }
}
```

### How the exception type is matched

- The exception types can be declared in the annotation (`@ExceptionHandler({FooException.class, BarException.class})`) **or** inferred from the method's parameter list (`public void handle(FooException ex)`). You cannot declare types in *both* places at once if they conflict.
- Matching walks the exception hierarchy: if `OrderNotFoundException extends ResourceException`, a handler for `ResourceException` will catch it when no more specific handler exists.
- When multiple handlers could match, Spring picks the one that is the **closest match in the exception hierarchy** (most specific super-type / smallest "depth" to the thrown type), not the first declared.
- Since Spring 5.3, handlers can also match against the **cause** of the thrown exception if no handler matches the top-level exception, by unwrapping nested causes. The top-level exception is always tried first against *all* candidate handlers; only if none match does the resolver unwrap `getCause()` and retry. This means a handler for the wrapper type shadows a handler for the cause, even if the cause handler is "more specific" to the real problem.

### The matching algorithm, precisely

`ExceptionHandlerExceptionResolver` delegates to `ExceptionHandlerMethodResolver`, which at controller-class init time builds a `Map<Class<? extends Throwable>, Method>` of every declared mapping. On resolution it calls `getMappedMethod(exceptionType)`:

1. It collects **all** mapping keys assignable from the thrown type into a list.
2. It sorts that list with `ExceptionDepthComparator`, which computes the "depth" = number of super-class hops from the thrown type up to each candidate. Depth 0 = exact class match.
3. The **smallest depth wins.** If two mappings tie at the same depth (only possible when they are unrelated types both matched via, say, an interface or a multi-value `@ExceptionHandler`), Spring throws `IllegalStateException("Ambiguous @ExceptionHandler method mapped for ...")` — an **eager, fail-fast** ambiguity error, not a silent pick.
4. Resolved matches are cached in a `ConcurrentHashMap` keyed by exception type, so the tree walk happens once per exception type per resolver.

A subtle trap: matching is by the **declared** exception type of the handler, considering both the annotation value(s) and the method parameter. If you declare `@ExceptionHandler({IOException.class, SQLException.class})` and the method parameter is `Exception ex`, the *mapping keys* are `IOException` and `SQLException` (from the annotation), NOT `Exception`. The parameter type is only used to derive mappings when the annotation value is empty.

### Cross-cutting: it is a HandlerMethod, so the same infrastructure applies

An `@ExceptionHandler` method is invoked via the same `InvocableHandlerMethod` machinery as a normal controller method. That means `@InitBinder` and `@ModelAttribute` methods are NOT applied to it (there is no request-body binding), but argument resolvers and return-value handlers ARE. A `@ResponseBody`/`ResponseEntity` return is written via `HttpMessageConverter`s exactly as for a normal handler — including content negotiation, which can itself fail (see the failure-modes section).

### Supported method arguments and return values

`@ExceptionHandler` methods are very flexible, similar to `@RequestMapping` methods. Common **arguments**:

- The exception instance (any supertype of the thrown exception).
- `HttpServletRequest` / `HttpServletResponse` (Jakarta types in Spring 6), `WebRequest`, `NativeWebRequest`.
- `HandlerMethod` (the handler that failed), `java.util.Locale`, `TimeZone`, `java.io.OutputStream`/`Writer`, `Model`, session, etc.
- **Not supported:** `@RequestBody`, `@RequestParam`, `@PathVariable` binding of the original request payload/params (there is no argument resolution of the *request* into the handler beyond request/response/session objects).

Common **return values**:

- `ResponseEntity<T>` — full control of status, headers, body.
- `@ResponseBody`-annotated object (or any object in a `@RestController`) — serialized via `HttpMessageConverter`s; status defaults to 200 unless combined with `@ResponseStatus`.
- `String` view name, `ModelAndView`, `View` — for view rendering.
- `ProblemDetail` (Spring 6) or `ErrorResponse` — serialized as RFC 7807.
- `void` — when the method writes to the response directly.

### Setting the status

A controller-local `@ExceptionHandler` returning a plain body defaults to HTTP 200. To set the status:

- Return a `ResponseEntity` with an explicit status, **or**
- Add `@ResponseStatus(HttpStatus.NOT_FOUND)` to the handler method.

```java
@ExceptionHandler(OrderNotFoundException.class)
@ResponseStatus(HttpStatus.NOT_FOUND)   // otherwise the body would be returned with 200
public ApiError handle(OrderNotFoundException ex) {
    return new ApiError("ORDER_NOT_FOUND", ex.getMessage());
}
```

**Scope:** a controller-local `@ExceptionHandler` only handles exceptions from its own controller. To share handling across controllers, use `@ControllerAdvice`.

---

## @ControllerAdvice and @RestControllerAdvice (global)

`@ControllerAdvice` is a specialization of `@Component` that makes a class a **global assistant** to controllers. It can hold three kinds of methods, shared across many controllers:

1. `@ExceptionHandler` methods — global exception handling.
2. `@InitBinder` methods — shared `WebDataBinder` configuration.
3. `@ModelAttribute` methods — shared model population.

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(OrderNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ApiError handleNotFound(OrderNotFoundException ex) {
        return new ApiError("ORDER_NOT_FOUND", ex.getMessage());
    }

    @ExceptionHandler(Exception.class)                       // catch-all fallback
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ApiError handleUnexpected(Exception ex) {
        return new ApiError("INTERNAL_ERROR", "Unexpected error");
    }
}
```

### @RestControllerAdvice vs @ControllerAdvice

`@RestControllerAdvice` = `@ControllerAdvice` + `@ResponseBody`. In a `@RestControllerAdvice`, handler return values are automatically written to the response body via message converters (JSON/XML), which is what you want for REST APIs. With plain `@ControllerAdvice`, a returned object is treated as a **model attribute / view name** unless the method (or class) is also annotated with `@ResponseBody`.

| Feature | `@ControllerAdvice` | `@RestControllerAdvice` |
|---|---|---|
| Meta-annotation | `@Component` | `@Component` + `@ControllerAdvice` + `@ResponseBody` |
| Default return handling | view / model | serialized response body |
| Typical use | server-side rendered apps (JSP/Thymeleaf) | REST APIs |

### Targeting a subset of controllers

By default a `@ControllerAdvice` applies to **all** controllers. You can narrow its scope:

```java
// Only controllers in these packages
@ControllerAdvice("com.example.api")
@ControllerAdvice(basePackages = "com.example.api")
@ControllerAdvice(basePackageClasses = ApiMarker.class)

// Only controllers annotated with a given annotation
@ControllerAdvice(annotations = RestController.class)

// Only specific controller types (or their subtypes)
@ControllerAdvice(assignableTypes = {OrderController.class, PaymentController.class})
```

### Ordering and precedence

- A **controller-local** `@ExceptionHandler` always takes precedence over one in a `@ControllerAdvice` for exceptions thrown by that controller.
- Multiple `@ControllerAdvice` beans are ordered via `@Order` / `Ordered` / `@Priority`. Within the applicable advices, the resolver still picks the **most specific exception match**; ordering matters mainly to break ties and to decide which advice is consulted first.
- A common pattern: a low-priority advice with `@ExceptionHandler(Exception.class)` as the final catch-all, and higher-priority advices for specific exceptions.

### The ordering gotcha most people get wrong

Ordering across advices does **not** mean "the most specific handler across all advices wins." The resolver first orders the applicable `ControllerAdviceBean`s by `@Order`, then iterates them **in order**, asking each advice's `ExceptionHandlerMethodResolver` whether it has *any* matching handler. **The first advice that has a match wins**, and matching then proceeds only within that advice. So a high-priority advice with a broad `@ExceptionHandler(Exception.class)` will **shadow** a lower-priority advice that has a perfectly specific `@ExceptionHandler(OrderNotFoundException.class)` — the specific handler is never even consulted. Within a single advice, specificity (`ExceptionDepthComparator`) decides; across advices, `@Order` decides. This is why the catch-all belongs in the **lowest-priority** advice.

Note `@ControllerAdvice` beans with no explicit order sort as `Ordered.LOWEST_PRECEDENCE` (they do not honor `@Order` unless present), and equal-order advices fall back to a stable but implementation-dependent order — never rely on it.

### How advice beans are discovered and cached

`ExceptionHandlerExceptionResolver.afterPropertiesSet()` scans the `ApplicationContext` **once** for `@ControllerAdvice` beans, wraps each in a `ControllerAdviceBean`, sorts them, and caches their `ExceptionHandlerMethodResolver`s in an ordered `Map`. Consequences: advices are resolved at startup, and a `@ControllerAdvice` registered in a **child context** (e.g. the `DispatcherServlet`'s own context) is only visible to that servlet's resolver — an advice in the root context is visible, but one defined only in another servlet's context is not. Also, because scanning is per-`DispatcherServlet`, two dispatcher servlets each build their own view of advices.

### Request-scoped and stateful advice: thread-safety

A `@ControllerAdvice` bean is a **singleton** by default and is invoked concurrently by many request threads. Storing per-request state in an instance field (e.g. `private Exception lastError;`) is a race-condition bug. Keep advice handlers stateless; if you need request data, take it as a method parameter (`WebRequest`, `HttpServletRequest`) or inject a request-scoped bean/`ObjectProvider`. `ProblemDetail` instances you create inside a handler are method-local and therefore safe.

---

## ResponseEntityExceptionHandler

`ResponseEntityExceptionHandler` is a convenient **base class** (in `org.springframework.web.servlet.mvc.method.annotation`) for a `@ControllerAdvice` that wants consistent, body-carrying responses for the **standard Spring MVC exceptions**.

It provides `@ExceptionHandler` methods for the framework's own exceptions — e.g. `HttpRequestMethodNotSupportedException`, `HttpMediaTypeNotSupportedException`, `HttpMediaTypeNotAcceptableException`, `MissingPathVariableException`, `MissingServletRequestParameterException`, `ServletRequestBindingException`, `HttpMessageNotReadableException`, `HttpMessageNotWritableException`, `MethodArgumentNotValidException`, `HandlerMethodValidationException`, `NoHandlerFoundException`, `NoResourceFoundException`, `AsyncRequestTimeoutException`, `ErrorResponseException`, `MaxUploadSizeExceededException`, `ConversionNotSupportedException`, `TypeMismatchException`, etc. (around 20 in Spring 6.1) — mapping each to an appropriate status.

```java
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    // Add your own domain handlers
    @ExceptionHandler(OrderNotFoundException.class)
    public ResponseEntity<Object> handleNotFound(OrderNotFoundException ex, WebRequest req) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        return handleExceptionInternal(ex, pd, new HttpHeaders(), HttpStatus.NOT_FOUND, req);
    }

    // Override to customize how a framework exception is rendered
    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        ProblemDetail pd = ex.getBody();               // Spring 6 populates a ProblemDetail
        pd.setDetail("Validation failed");
        pd.setProperty("errors", ex.getFieldErrors().stream()
                .map(fe -> Map.of("field", fe.getField(), "message", fe.getDefaultMessage()))
                .toList());
        return handleExceptionInternal(ex, pd, headers, status, request);
    }
}
```

Key points:

- **Spring 6 change:** since Spring Framework 6.0, `ResponseEntityExceptionHandler`'s handled exceptions implement `ErrorResponse`, and the default body is a **`ProblemDetail`** (RFC 7807). In Spring 5 the default body was empty (you had to fill it yourself).
- The central customization hooks are `handleExceptionInternal(...)` (last stop before building the `ResponseEntity` — override to add a body, log, etc.) and the individual `handleXxx` protected methods (override to change a specific exception's rendering).
- You must register your subclass as a Spring bean, typically by annotating it `@ControllerAdvice` / `@RestControllerAdvice`. The base class itself is **not** a `@ControllerAdvice`.
- WebFlux has an analogous base class: `org.springframework.web.reactive.result.method.annotation.ResponseEntityExceptionHandler`.

### Why your override might never be called

A frequent surprise: you extend `ResponseEntityExceptionHandler` **and** also declare your own advice (or a controller-local handler) for, say, `MethodArgumentNotValidException`. Only one wins, and which one depends on advice ordering / locality, not on the fact that you subclassed the base class. The base class's `@ExceptionHandler` methods are just ordinary annotated methods discovered like any other; there is nothing special elevating them. If a different advice with higher `@Order` also handles that framework exception, your override is dead code.

Conversely, if you extend the base class but a framework exception you care about is **not** among the ~20 it declares (for example, `ConstraintViolationException` raised by Jakarta Bean Validation on a `@Validated` service bean), the base class does nothing for it and it falls through to whatever generic handler you have (or to `DefaultHandlerExceptionResolver`). `ConstraintViolationException` in particular is a Jakarta Bean Validation type, not a Spring MVC exception, so `ResponseEntityExceptionHandler` does not handle it out of the box — you must add your own handler. (Note: since Spring 6.1, validation failures on controller *method parameters* surface as `HandlerMethodValidationException`, which the base class **does** handle; the classic `ConstraintViolationException` path is the one on `@Validated` beans outside the web layer.)

### handleExceptionInternal and the body-vs-null contract

`handleExceptionInternal(ex, body, headers, status, request)` has non-obvious behavior:

- If you pass a **null body**, Spring 6 substitutes the exception's `ProblemDetail` (via `ErrorResponse.updateAndGetBody(messageSource, locale)`) whenever the exception implements `ErrorResponse`. So "return null body" does not mean "empty response" in Spring 6 the way it did in Spring 5.
- For a `500` (`INTERNAL_SERVER_ERROR`) status it sets the `jakarta.servlet.error.exception` request attribute (constant `WebUtils.ERROR_EXCEPTION_ATTRIBUTE`) so downstream error infrastructure can see the original exception.
- It also handles the special case where the status is `INTERNAL_SERVER_ERROR` and the request is a `WebRequest` by setting scope attributes — details you override at your peril if you replace it wholesale rather than calling `super`.

### Ordering `ResponseEntityExceptionHandler` relative to your handlers

Because it is discovered as a normal advice, its effective precedence is its `@Order`. A common, robust pattern is to put the `ResponseEntityExceptionHandler` subclass at a middle/low precedence and let more specific domain advices sit above it — but never above your catch-all. If you both `extends ResponseEntityExceptionHandler` and add `@ExceptionHandler(Exception.class)` in the *same* class, the specific framework methods still win over your `Exception` catch-all **within that class** thanks to `ExceptionDepthComparator`.

---

## Mapping exceptions to HTTP status with @ResponseStatus

`@ResponseStatus` binds an exception (or a handler method) to a specific HTTP status code, without needing to write a `ResponseEntity`.

**On an exception class** — handled by `ResponseStatusExceptionResolver`:

```java
@ResponseStatus(value = HttpStatus.NOT_FOUND, reason = "Order not found")
public class OrderNotFoundException extends RuntimeException { }
```

When such an exception propagates unhandled, `ResponseStatusExceptionResolver` sets the status (404 here) by calling `HttpServletResponse.sendError(...)`. If `reason` is set, it calls `sendError(status, reason)`; if `reason` is **empty**, it calls the single-argument `sendError(status)`. Either way it goes through `sendError`, which **commits** the response and hands off to the container's error-page mechanism (and, under Spring Boot, a forward to `/error`). The `reason` only changes whether a message string is attached — it does **not** change the `sendError`-based mechanism.

**On an `@ExceptionHandler` / `@RequestMapping` method** — sets the response status for that method's result:

```java
@ExceptionHandler(OrderNotFoundException.class)
@ResponseStatus(HttpStatus.NOT_FOUND)
public ApiError handle(OrderNotFoundException ex) { ... }
```

### ResponseStatusException — the programmatic alternative

`@ResponseStatus` is static (baked into the exception type). When you need to decide the status at runtime, or don't want to create an exception class per status, throw a **`ResponseStatusException`** (Spring 5+):

```java
throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Order " + id + " not found");
```

`ResponseStatusException` (and its subclasses like `NotFoundException`) implement `ErrorResponse`, so in Spring 6 they carry a `ProblemDetail` body automatically. It is handled by `ResponseStatusExceptionResolver` as well.

| Approach | When to use | Status source |
|---|---|---|
| `@ResponseStatus` on exception class | one fixed status per exception type; simple | annotation (static) |
| `ResponseStatusException` | status decided at runtime; avoid many exception classes | constructor arg (dynamic) |
| `@ExceptionHandler` returning `ResponseEntity` | full control of headers/body | code |

**Note:** if you catch an exception in an `@ExceptionHandler`, the `@ResponseStatus` on the *exception class* is ignored — your handler is now in charge of the response.

### sendError and the error-page forward that bites people

A subtlety many people get wrong: `ResponseStatusExceptionResolver` uses `sendError` **regardless** of whether `reason` is present. Its `applyStatusAndReason(...)` method does:

```java
if (!StringUtils.hasLength(reason)) {
    response.sendError(statusCode);          // no reason
} else {
    response.sendError(statusCode, reason);  // with reason
}
```

So the `reason` attribute only changes whether a message string is attached; it does **not** switch mechanisms. `sendError` **commits** the response and asks the container to produce an error representation — the configured `<error-page>` (or, under Spring Boot, an internal `ERROR` dispatch to `/error`, which re-enters `DispatcherServlet` and can invoke `BasicErrorController`). Any body your code might have written is discarded.

This is why a bare `@ResponseStatus(code = HttpStatus.NOT_FOUND)` on an exception in a REST app can unexpectedly return an HTML error page instead of your JSON — the `sendError` forward bypasses your message converters. Note that `ResponseStatusException` is **also** resolved by `ResponseStatusExceptionResolver` through the same `applyStatusAndReason`/`sendError` path (its headers are copied onto the response first). If you want a real JSON/`ProblemDetail` body rendered by message converters, handle the exception with an `@ExceptionHandler`/`@ControllerAdvice` (e.g. via `ResponseEntityExceptionHandler`, which handles `ErrorResponseException`/the framework exceptions and writes a `ProblemDetail`), rather than relying on `ResponseStatusExceptionResolver`'s `sendError` behavior.

### ResponseStatusException and ErrorResponseException internals

`ResponseStatusException extends ErrorResponseException implements ErrorResponse`. It carries an `HttpStatusCode`, a lazily-built `ProblemDetail`, and optional `reason` (mapped to `ProblemDetail.detail`). Because it implements `ErrorResponse`, `ResponseEntityExceptionHandler` (which declares a handler for `ErrorResponseException`) can render it with a proper RFC 7807 `ProblemDetail` body via message converters. Note, however, that `ResponseStatusExceptionResolver` itself does **not** write a `ProblemDetail`: it copies the exception's headers onto the response and then calls `applyStatusAndReason(...)`, i.e. `sendError`. So the RFC 7807 body comes from the `@ExceptionHandler` path (`ResponseEntityExceptionHandler`), not from `ResponseStatusExceptionResolver`. Subclasses like `MethodNotAllowedException`, `NotAcceptableStatusException`, `UnsupportedMediaTypeStatusException`, and `ServerErrorException` also let you attach response headers (e.g. `Allow`, `Accept`) via the exception itself.

`@ResponseStatus` is discovered via `AnnotatedElementUtils.findMergedAnnotation`, so it is **inherited through meta-annotations and superclasses** — an exception subclass without its own `@ResponseStatus` still gets the parent's. But note: `@ResponseStatus` on an exception is only honored by `ResponseStatusExceptionResolver`; it has **no effect** if some `@ExceptionHandler` catches the exception first (the `ExceptionHandlerExceptionResolver` runs earlier in the chain).

---

## Building consistent error responses

Real APIs want a uniform error contract, e.g. every error returns the same JSON shape. Approaches:

### 1. A custom error DTO + global advice

```java
public record ApiError(String code, String message, Instant timestamp, List<FieldViolation> errors) {}

@RestControllerAdvice
public class GlobalErrors {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiError onValidation(MethodArgumentNotValidException ex) {
        var violations = ex.getFieldErrors().stream()
            .map(fe -> new FieldViolation(fe.getField(), fe.getDefaultMessage()))
            .toList();
        return new ApiError("VALIDATION_FAILED", "Request invalid", Instant.now(), violations);
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ApiError onUnexpected(Exception ex) {
        return new ApiError("INTERNAL_ERROR", "Unexpected error", Instant.now(), List.of());
    }
}
```

### 2. Extend ResponseEntityExceptionHandler

So framework exceptions get the same treatment as your domain exceptions (override `handleExceptionInternal` to attach a consistent body).

### 3. Use ProblemDetail (RFC 7807) — the Spring 6 standard shape

See the next section. This gives you an industry-standard media type (`application/problem+json`) so clients don't need bespoke parsing.

### Practical guidance

- **Don't leak internals.** Avoid returning stack traces or raw exception messages for 5xx errors; log them server-side with a correlation id and return a generic message.
- **Map the exception layer to HTTP semantics deliberately:** validation → 400, auth → 401, forbidden → 403, missing resource → 404, conflict/optimistic-lock → 409, unexpected → 500.
- **Keep the catch-all last.** A `@ExceptionHandler(Exception.class)` should be the final fallback (lowest precedence advice), not shadow more specific handlers.
- **Include a correlation/trace id** so a returned error can be tied to server logs.

---

## ProblemDetail (RFC 7807) in Spring 6

**RFC 7807** ("Problem Details for HTTP APIs") defines a standard JSON (and XML) format for error responses, using media type `application/problem+json`. Spring Framework 6.0 added first-class support via `org.springframework.http.ProblemDetail`.

Standard fields:

| Field | Meaning |
|---|---|
| `type` | URI identifying the problem type (default `about:blank`) |
| `title` | short human-readable summary (usually tied to the status) |
| `status` | HTTP status code (integer) |
| `detail` | human-readable explanation specific to this occurrence |
| `instance` | URI identifying this specific occurrence |

Plus arbitrary **extension** members via `setProperty(...)`.

```java
ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "Order 42 not found");
pd.setType(URI.create("https://api.example.com/problems/order-not-found"));
pd.setTitle("Order Not Found");
pd.setInstance(URI.create("/orders/42"));
pd.setProperty("orderId", 42);   // extension member
```

Produces:

```json
{
  "type": "https://api.example.com/problems/order-not-found",
  "title": "Order Not Found",
  "status": 404,
  "detail": "Order 42 not found",
  "instance": "/orders/42",
  "orderId": 42
}
```

Ways to use it:

- **Return a `ProblemDetail`** directly from a `@ExceptionHandler` (in a `@RestController`/`@RestControllerAdvice`); Spring serializes it with `content-type: application/problem+json`.
- **Implement `ErrorResponse`** (or extend `ErrorResponseException`) on your exception — a strategy interface that exposes an `HttpStatusCode`, `HttpHeaders`, and a `ProblemDetail` body. Built-in exceptions (`ResponseStatusException`, most `ResponseEntityExceptionHandler`-handled exceptions) already implement it.
- **`ResponseEntityExceptionHandler`** now returns `ProblemDetail` bodies for framework exceptions out of the box (Spring 6).

Notes / gotchas:

- This is a **Spring Framework 6** feature (baseline Java 17, Jakarta EE 9). It is available in plain Spring MVC / WebFlux — you do **not** need Spring Boot. (Spring Boot 3 exposes a property `spring.mvc.problemdetails.enabled` to auto-enable `ProblemDetail` responses for framework exceptions, but that switch is a Boot convenience, not the framework mechanism.)
- `ProblemDetail` uses a `LinkedHashMap` for its extension properties, so field ordering is predictable; the standard fields serialize with their RFC names.
- Localization: `ErrorResponse` supports resolving `title`/`detail` from a `MessageSource` using message codes, enabling i18n of problem messages. The default message code is `problemDetail.` + the fully-qualified exception class name for the detail, and `problemDetail.title.` + the class name for the title; arguments are supplied via `ErrorResponse.getDetailMessageArguments()`. `ResponseEntityExceptionHandler` exposes `setMessageSource(...)` and, when a `MessageSource` is present, `handleExceptionInternal` will localize the `ProblemDetail` before writing it.

### Content negotiation and problem+json

Returning a `ProblemDetail` does not unconditionally produce `application/problem+json`. It is still written by an `HttpMessageConverter`, subject to content negotiation. The Jackson converter is registered to also support the `application/problem+json` media type, and Spring's handling promotes that media type for `ProblemDetail` results. But if the client's `Accept` header excludes JSON entirely (e.g. `Accept: application/xml` with no XML converter for `ProblemDetail`), you can get an `HttpMediaTypeNotAcceptableException` **while trying to render the error** — a secondary failure (see failure modes). Also, a `ProblemDetail` returned from a plain `@Controller` method (not `@ResponseBody`/not a `@RestController`) is treated as a **model attribute**, not serialized — the same `@ResponseBody` requirement as any other return value.

### The instance field and null semantics

`ProblemDetail.instance` is not auto-populated by the framework by default in plain Spring MVC — you set it yourself. Fields left null are omitted from serialization (Jackson `NON_EMPTY`-style handling for the standard members), except `status`, which mirrors the response status. Extension properties are stored in a `Map` and serialized flattened at the top level, so an extension key that collides with a standard field name (`"title"`, `"status"`, ...) is a bug waiting to happen.

---

## HandlerExceptionResolver concept

`HandlerExceptionResolver` is the low-level **SPI** that all of the above build on. Its single method:

```java
public interface HandlerExceptionResolver {
    ModelAndView resolveException(HttpServletRequest request,
                                  HttpServletResponse response,
                                  Object handler,          // the handler that threw, may be null
                                  Exception ex);
}
```

Contract:

- Return a `ModelAndView` (possibly empty, i.e. `new ModelAndView()`) to indicate **"I handled it"** and stop the resolver chain. An empty `ModelAndView` means "response fully written, nothing more to render."
- Return `null` to indicate **"not my exception"**, letting the next resolver in the chain try.

`DispatcherServlet` maintains an **ordered** list of resolvers and calls them in order until one returns non-null.

### Built-in resolvers

| Resolver | Responsibility |
|---|---|
| `ExceptionHandlerExceptionResolver` | dispatch to matching `@ExceptionHandler` / `@ControllerAdvice` methods |
| `ResponseStatusExceptionResolver` | `@ResponseStatus` exceptions and `ResponseStatusException` |
| `DefaultHandlerExceptionResolver` | standard Spring MVC exceptions → status codes |
| `SimpleMappingExceptionResolver` | map exception class names → view names (classic MVC/JSP apps) |

`@EnableWebMvc` registers the first three by default (highest to lowest priority in that order). `SimpleMappingExceptionResolver` is opt-in and useful for server-rendered apps that want exception→error-page-view mappings without writing `@ExceptionHandler` methods.

### Writing a custom resolver

Implement `HandlerExceptionResolver` (or extend `AbstractHandlerExceptionResolver`) and register it as a bean, or via `WebMvcConfigurer`:

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void extendHandlerExceptionResolvers(List<HandlerExceptionResolver> resolvers) {
        resolvers.add(new MyCustomResolver()); // appended after the defaults
    }
    // configureHandlerExceptionResolvers(...) would REPLACE the defaults entirely
}
```

- `extendHandlerExceptionResolvers` **adds** to the default list.
- `configureHandlerExceptionResolvers` **replaces** the defaults (rarely what you want).

For most applications you should prefer `@ExceptionHandler`/`@ControllerAdvice` and never touch this SPI directly — it exists as the extension point and to explain how the annotations actually work.

### Ordering, HandlerExceptionResolverComposite, and the empty-ModelAndView contract

`DispatcherServlet` does not iterate resolver beans one-by-one from the context; `WebMvcConfigurationSupport` builds a fixed-order list — `ExceptionHandlerExceptionResolver`, then `ResponseStatusExceptionResolver`, then `DefaultHandlerExceptionResolver` — and wraps it in a single `HandlerExceptionResolverComposite` (itself registered at `LOWEST_PRECEDENCE`). The composite iterates that list in order and returns the first non-null result. A resolver you add via `extendHandlerExceptionResolvers` is appended to the end of that list and thus runs **after** the defaults — meaning it only sees exceptions the defaults declined. If you need to run *before* `ExceptionHandlerExceptionResolver`, you must register a resolver bean with a lower order and (often) replace the config, because appending cannot pre-empt.

The `ModelAndView` return contract has three distinct states, and confusing them causes bugs:

- **`null`** → "not handled," continue the chain.
- **empty `ModelAndView` (`new ModelAndView()`, `mav.isEmpty()` true)** → "handled; response already fully written, do NOT render a view." `@ResponseBody`/`ResponseEntity` handlers return this after the message converter writes the body.
- **non-empty `ModelAndView`** → "handled; render this view/model." A view-rendering step follows, which can itself throw (and that throw is largely not re-resolvable).

### AbstractHandlerExceptionResolver: mappedHandlers, order, and logging

Extending `AbstractHandlerExceptionResolver` gives you `setMappedHandlers`/`setMappedHandlerClasses` (restrict which handlers this resolver applies to — `shouldApplyTo` returns false otherwise, so it returns `null` and defers), `setOrder`, `setWarnLogCategory`, and the `preventResponseCaching` behavior (it sets `Cache-Control` headers on the error response by default). It also short-circuits when the response is **already committed** — returning `null` (Spring 4.3.9+ logs a warning). This is the actual place the "response committed → can't handle" rule lives for the built-in resolvers.

---

## Failure modes when handling an exception

Exception handling is itself code that runs during a failing request, so it can fail again. Senior engineers must reason about the **secondary** failure:

- **The `@ExceptionHandler` method itself throws.** `ExceptionHandlerExceptionResolver` does not recursively resolve the new exception with the same machinery; it logs the original and the handler-thrown exception (the original is logged at warn/error) and returns from resolution such that the *new* exception effectively propagates to the container. You do not get infinite recursion, but you also do not get a second chance from your advices. Keep handlers trivially safe.
- **Content negotiation fails while rendering the error body** (`HttpMediaTypeNotAcceptableException` because the client `Accept` doesn't match your error converter). This is a fresh exception during rendering; the client typically ends up with a `406` from the container rather than your intended error body.
- **`HttpMessageNotWritableException`** — the error DTO can't be serialized (e.g. a lazy Hibernate proxy, a `ProblemDetail` extension value with no Jackson serializer). Again a secondary failure surfaced during write.
- **Response already committed** — as above, status/headers are frozen. Streaming responses (`StreamingResponseBody`, SSE, large `ResponseEntity<Resource>`) are especially prone; once the first bytes flush, no resolver can turn a 200 into a 500.
- **Async and error dispatches** — for a `DeferredResult`/`Callable` that completes exceptionally, the exception is re-dispatched onto the container thread and *does* go through the resolver chain (that is what `AsyncRequestTimeoutException` handling relies on). But an exception thrown from the async worker thread **outside** the managed `Callable`/`DeferredResult` contract (e.g. a raw thread you spawned) is invisible to Spring MVC entirely.

---

## Ordering and precedence across mechanisms

Putting the whole picture together, when a controller throws, resolution proceeds strictly by resolver order, and within the annotation resolver by advice order then depth:

1. `ExceptionHandlerExceptionResolver`: controller-local `@ExceptionHandler` first (it is checked before advices because the local `ExceptionHandlerMethodResolver` for the failing `HandlerMethod`'s class is consulted first), then `@ControllerAdvice` beans in `@Order` sequence — **first advice with any match wins**, depth decides within it.
2. `ResponseStatusExceptionResolver`: `@ResponseStatus` on the exception, or `ResponseStatusException`/`ErrorResponse`.
3. `DefaultHandlerExceptionResolver`: the standard Spring MVC exceptions (~20).
4. Any resolver you appended (custom).
5. If all return `null`: propagate to the container.

Two consequences worth memorizing: (a) a matching `@ExceptionHandler` **anywhere** (even a broad one in a high-priority advice) pre-empts `@ResponseStatus`/`ResponseStatusException` handling, because the whole `ExceptionHandlerExceptionResolver` runs first; (b) a controller-local handler pre-empts every advice, full stop.

---

## Common follow-up questions

**Q: Where does exception handling happen relative to the servlet container?**
Inside `DispatcherServlet`, via `HandlerExceptionResolver`s, before the exception would reach the container. If no resolver handles it, it propagates to the container (and, in Boot, to `/error`).

**Q: A controller-local `@ExceptionHandler` and a `@ControllerAdvice` one both match — which wins?**
The controller-local one. Advice is only consulted for exceptions not handled locally.

**Q: My `@ExceptionHandler` returns a DTO but the response is 200 even though it's an error. Why?**
A returned body defaults to status 200. Add `@ResponseStatus(...)` to the handler or return a `ResponseEntity` with the desired status.

**Q: `@ControllerAdvice` vs `@RestControllerAdvice`?**
`@RestControllerAdvice` adds `@ResponseBody`, so return values are serialized as the response body (JSON/XML) instead of being interpreted as view names.

**Q: `@ResponseStatus` on the exception vs `ResponseStatusException`?**
`@ResponseStatus` is static per exception type; `ResponseStatusException` lets you choose the status at runtime and avoids proliferating exception classes.

**Q: What happens when two `@ExceptionHandler`s could match the thrown exception?**
Spring chooses the most specific match in the exception hierarchy, not the first declared.

**Q: How do I get RFC 7807 responses without Spring Boot?**
Return `ProblemDetail` / implement `ErrorResponse`, or extend `ResponseEntityExceptionHandler` — all part of Spring Framework 6.

**Q: Does `@ExceptionHandler` catch exceptions from filters or servlet-level code?**
No. It only catches exceptions arising from handler execution within `DispatcherServlet` (controller methods, HandlerAdapter, interceptors). Servlet filters run outside `DispatcherServlet` and need their own error handling.

**Q: javax vs jakarta?**
Spring Framework 6 (and Spring Boot 3) migrated to Jakarta EE 9+, so it's `jakarta.servlet.HttpServletRequest`. Spring Framework 5 / Boot 2 use `javax.servlet.*`.

---

## References

- Spring Framework Reference — Web MVC, "Exceptions" and "Controller Advice": https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-exceptionhandler.html
- Spring Framework Reference — "Error Responses" / ProblemDetail: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html
- Javadoc — `ResponseEntityExceptionHandler`, `ProblemDetail`, `ErrorResponse`, `ResponseStatusException`, `HandlerExceptionResolver`
- RFC 7807 — Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc7807
- Spring Blog — "RFC 7807 Problem Details support in Spring Framework 6"
