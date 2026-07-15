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
- Since Spring 5.3, handlers can also match against the **cause** of the thrown exception if no handler matches the top-level exception, by unwrapping nested causes.

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

---

## ResponseEntityExceptionHandler

`ResponseEntityExceptionHandler` is a convenient **base class** (in `org.springframework.web.servlet.mvc.method.annotation`) for a `@ControllerAdvice` that wants consistent, body-carrying responses for the **standard Spring MVC exceptions**.

It provides `@ExceptionHandler` methods for the framework's own exceptions — e.g. `HttpRequestMethodNotSupportedException`, `HttpMediaTypeNotSupportedException`, `HttpMediaTypeNotAcceptableException`, `MissingPathVariableException`, `MissingServletRequestParameterException`, `ServletRequestBindingException`, `HttpMessageNotReadableException`, `HttpMessageNotWritableException`, `MethodArgumentNotValidException`, `NoHandlerFoundException`, `NoResourceFoundException`, `AsyncRequestTimeoutException`, etc. — mapping each to an appropriate status.

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

---

## Mapping exceptions to HTTP status with @ResponseStatus

`@ResponseStatus` binds an exception (or a handler method) to a specific HTTP status code, without needing to write a `ResponseEntity`.

**On an exception class** — handled by `ResponseStatusExceptionResolver`:

```java
@ResponseStatus(value = HttpStatus.NOT_FOUND, reason = "Order not found")
public class OrderNotFoundException extends RuntimeException { }
```

When such an exception propagates unhandled, `ResponseStatusExceptionResolver` sets the status (404 here). If `reason` is set, Spring calls `HttpServletResponse.sendError(status, reason)`, which typically produces the container's error page (and, under Spring Boot, a forward to `/error`). If `reason` is **empty**, only the status is set and the response is committed without an error-page forward.

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
- Localization: `ErrorResponse` supports resolving `title`/`detail` from a `MessageSource` using message codes, enabling i18n of problem messages.

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
