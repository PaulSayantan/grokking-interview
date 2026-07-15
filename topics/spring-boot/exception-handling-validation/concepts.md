# Exception Handling & Validation

Robust APIs need two things that interviewers probe hard on: **turning exceptions into clean, consistent HTTP responses** and **rejecting bad input before it reaches business logic**. This topic covers Spring MVC's exception-handling machinery (`@ExceptionHandler`, `@ControllerAdvice`, `ResponseEntityExceptionHandler`, `ProblemDetail`) and Jakarta Bean Validation (`@Valid`/`@Validated`, Hibernate Validator, custom constraints, groups, cascading).

> **Jakarta vs javax note (Spring Boot 3.x / Spring 6):** Everything moved from the `javax.*` namespace to `jakarta.*`. Bean Validation annotations are now `jakarta.validation.constraints.*` (e.g. `jakarta.validation.Valid`, `jakarta.validation.constraints.NotNull`). Spring Boot 2.x / Spring 5 used `javax.validation.*`. Mixing them is a common upgrade bug — a `javax.validation.@NotNull` is silently ignored by a `jakarta`-based validator.

---

## @ExceptionHandler

`@ExceptionHandler` marks a method that handles exceptions thrown from `@RequestMapping`/controller handler methods. It is the most local exception-handling mechanism in Spring MVC.

**Beginner:** Put a method annotated with `@ExceptionHandler(SomeException.class)` inside a `@Controller`/`@RestController` and any matching exception thrown by that controller's handler methods is routed to it instead of propagating to the servlet container (which would produce a generic 500 / error page).

```java
@RestController
public class OrderController {

    @GetMapping("/orders/{id}")
    public Order get(@PathVariable Long id) {
        return service.find(id); // may throw OrderNotFoundException
    }

    @ExceptionHandler(OrderNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorDto handleNotFound(OrderNotFoundException ex) {
        return new ErrorDto("ORDER_NOT_FOUND", ex.getMessage());
    }
}
```

**Method signature flexibility:** handler methods can accept the exception itself, the `HttpServletRequest`/`HttpServletResponse`, `WebRequest`, `HandlerMethod`, `Locale`, etc., and can return a `@ResponseBody` object, a `ResponseEntity`, a `ModelAndView`, a `String` view name, or `void`. One handler can cover multiple types: `@ExceptionHandler({FooException.class, BarException.class})`.

**Status code control:** Without `@ResponseStatus` or a `ResponseEntity`, an `@ExceptionHandler` returning a body defaults to **200 OK** — a classic gotcha. Use `@ResponseStatus(...)` on the method, or return `ResponseEntity.status(...).body(...)` to control the status.

**Intermediate — exception matching:** When multiple handlers could match, Spring picks the one whose declared type is the **closest supertype** (most specific) to the thrown exception, walking the exception's superclass hierarchy. Cause matching: if no handler matches the thrown exception directly, Spring also inspects the exception's **cause chain**.

**Advanced — resolution order:** Controller-local `@ExceptionHandler` methods take precedence over `@ControllerAdvice` ones. Internally these are resolved by the `ExceptionHandlerExceptionResolver` (one of the `HandlerExceptionResolver` implementations, alongside `ResponseStatusExceptionResolver` and `DefaultHandlerExceptionResolver`). An `@ExceptionHandler` cannot handle exceptions thrown *outside* the handler-method invocation (e.g. inside a `Filter`, or during request-body reading before the interceptor chain in some cases) — those are handled by the servlet container / error dispatch.

---

## @ControllerAdvice / @RestControllerAdvice

`@ControllerAdvice` is a specialization of `@Component` that lets you apply `@ExceptionHandler`, `@InitBinder`, and `@ModelAttribute` methods **globally** across many controllers, centralizing cross-cutting concerns.

**Beginner:** Instead of repeating the same `@ExceptionHandler` in every controller, put them once in a `@ControllerAdvice` class.

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(OrderNotFoundException.class)
    public ResponseEntity<ErrorDto> handle(OrderNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                             .body(new ErrorDto("ORDER_NOT_FOUND", ex.getMessage()));
    }
}
```

**`@RestControllerAdvice` = `@ControllerAdvice` + `@ResponseBody`.** With plain `@ControllerAdvice`, handler return values are treated like controller returns (a `String` is a view name); `@RestControllerAdvice` serializes returns directly to the body (JSON/XML) — the right choice for REST APIs.

**Scoping (intermediate):** By default advice applies to *all* controllers. You can narrow it:
- `@ControllerAdvice(basePackages = "com.acme.api")`
- `@ControllerAdvice(assignableTypes = {OrderController.class})`
- `@ControllerAdvice(annotations = RestController.class)`

**Ordering (advanced):** Multiple advice beans are ordered via `@Order`/`Ordered`; lower value = higher priority. Within a single advice, handler-method matching still uses the most-specific-exception rule. A common pattern is a low-priority "catch-all" `@ExceptionHandler(Exception.class)` in one advice plus specific handlers in higher-priority advices. **Note:** the most-specific-match rule applies *within one advice class*; across advices, order determines which advice is consulted first, so a broad `Exception` handler in a high-priority advice can shadow a specific handler in a lower-priority one — keep the catch-all advice last.

`@ControllerAdvice` beans are singletons discovered at startup by `@Component` scanning. They also support `@InitBinder` (register custom `PropertyEditor`/`Formatter`/validators per request) and `@ModelAttribute` (populate common model data) globally.

---

## ResponseEntityExceptionHandler

`ResponseEntityExceptionHandler` is a convenient **base class** for a `@ControllerAdvice` that provides `@ExceptionHandler` methods for the standard set of Spring MVC exceptions, all returning `ResponseEntity`.

**Why it matters:** Spring throws many built-in exceptions (`MethodArgumentNotValidException`, `HttpMessageNotReadableException`, `HttpRequestMethodNotSupportedException`, `MissingServletRequestParameterException`, `NoHandlerFoundException`, `HttpMediaTypeNotSupportedException`, etc.). By default these are handled by `DefaultHandlerExceptionResolver` and produce sensible status codes but a body you don't control. Extending `ResponseEntityExceptionHandler` lets you override the response body/format for all of them in one place.

```java
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    // Override to customize validation error responses
    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        var errors = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> fe.getField() + ": " + fe.getDefaultMessage()).toList();
        var body = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Validation failed");
        body.setProperty("errors", errors);
        return handleExceptionInternal(ex, body, headers, status, request);
    }
}
```

**Spring 6 / Boot 3 changes (advanced):**
- Method signatures now use `HttpStatusCode` (interface) instead of `HttpStatus` (enum) — an override that still declares `HttpStatus` won't override the parent and silently does nothing. Common upgrade trap.
- The servlet MVC variant lives in `org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler`, and Spring 6 also adds a separate reactive variant `org.springframework.web.reactive.result.method.annotation.ResponseEntityExceptionHandler` for WebFlux — pick the one matching your stack.
- In Spring 6 the base class produces **`ProblemDetail`** (RFC 7807) bodies by default via `handleExceptionInternal`, aligning with the new standard.
- `handleExceptionInternal` is the single choke point you override to attach a body / adjust status for all standard exceptions.

You do **not** need this base class for your *own* domain exceptions — just add `@ExceptionHandler` methods. Extend it when you want to reshape Spring's built-in exception responses.

---

## Global exception handling & consistent error responses (ProblemDetail / RFC 7807)

Consistent error responses mean every error, whatever its source, comes back in the same predictable shape so clients can parse it uniformly.

**RFC 7807 `application/problem+json`** defines a standard problem structure with fields: `type` (URI), `title`, `status`, `detail`, `instance`, plus arbitrary extension members. Spring Framework 6 / Boot 3 provide first-class support via `org.springframework.http.ProblemDetail`.

```java
ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "Order 42 not found");
pd.setType(URI.create("https://api.acme.com/errors/order-not-found"));
pd.setTitle("Order Not Found");
pd.setInstance(URI.create("/orders/42"));
pd.setProperty("orderId", 42);   // extension member
```

A handler can simply **return a `ProblemDetail`** (or throw an exception implementing `ErrorResponse`), and Spring serializes it with content type `application/problem+json`.

**`ErrorResponse` / `ErrorResponseException` (Spring 6):** The `ErrorResponse` interface models an exception that carries HTTP status + `ProblemDetail` + headers. `ErrorResponseException` is a ready-made throwable implementation. Spring's own exceptions implement `ErrorResponse` now, which is how `ResponseEntityExceptionHandler` emits `ProblemDetail` uniformly.

**Enabling default ProblemDetail behavior:** by default Spring will not convert every unhandled exception to ProblemDetail. Set `spring.mvc.problemdetails.enabled=true` (Boot 3) to make Spring MVC use `ProblemDetail` for its built-in exceptions automatically without you subclassing `ResponseEntityExceptionHandler`.

**Design guidance for interviews:**
- Never leak stack traces / internal messages to clients. Map internal exceptions to safe, generic messages; log the detail server-side with a correlation id and echo the id in the response.
- Use a broad `@ExceptionHandler(Exception.class)` fallback returning 500 with a generic body so nothing escapes unformatted.
- Keep status-code mapping in one place (the advice) so it stays consistent.

**Boot's default error handling contrast:** Even with no advice, Spring Boot has `BasicErrorController` (`/error`) and `DefaultErrorAttributes`, producing a default JSON error body (`timestamp`, `status`, `error`, `path`, and optionally `message`/`trace`). This is a fallback via error-dispatch, distinct from `@ExceptionHandler` resolution. `server.error.include-message`, `include-stacktrace`, `include-binding-errors` control what's exposed (defaults are conservative — `message` and `stacktrace` are `never`/off by default in Boot 2.3+).

---

## Mapping exceptions to status codes

Several mechanisms decide the HTTP status for an exception; know their precedence.

1. **`@ResponseStatus` on a custom exception class** — annotate your exception with `@ResponseStatus(HttpStatus.NOT_FOUND)` and Spring's `ResponseStatusExceptionResolver` maps it automatically, even with no handler.
   ```java
   @ResponseStatus(HttpStatus.NOT_FOUND)
   public class OrderNotFoundException extends RuntimeException { ... }
   ```
2. **`ResponseStatusException`** (Spring 5+) — throw it directly to set status without a dedicated class: `throw new ResponseStatusException(HttpStatus.NOT_FOUND, "not found");`. Good for one-offs; avoids proliferating exception classes.
3. **`@ExceptionHandler` + `@ResponseStatus`** or returning `ResponseEntity.status(...)` — explicit, most flexible; can shape the body too.
4. **Spring's built-in exception → status mapping** via `DefaultHandlerExceptionResolver` (e.g. `HttpRequestMethodNotSupportedException` → 405, `HttpMessageNotReadableException` → 400, `MethodArgumentNotValidException` → 400, `NoHandlerFoundException` → 404, `HttpMediaTypeNotSupportedException` → 415, `MissingServletRequestParameterException` → 400).

**Precedence gotcha (advanced):** If a handler method returns a `ResponseEntity` with one status but the *method* is also annotated `@ResponseStatus`, the `@ResponseStatus` on an `@ExceptionHandler` is ignored when the return value is a `ResponseEntity` (the ResponseEntity's status wins). Conversely, when the method's own `@ResponseStatus` is present and the return is a plain body, that status applies. Also, `@ResponseStatus` on the exception class is overridden if an `@ExceptionHandler` for it explicitly sets a different status.

**Common mappings interviewers expect:**

| Situation | Status |
|---|---|
| Bad/failed request-body validation (`@Valid` on `@RequestBody`) | 400 |
| Malformed JSON (`HttpMessageNotReadableException`) | 400 |
| Constraint violation on path/query param (`ConstraintViolationException`) | 400 (needs a handler; otherwise 500) |
| Missing required query param | 400 |
| Unknown resource / entity not found | 404 (you map it) |
| Method not allowed | 405 |
| Unsupported/incorrect `Content-Type` | 415 |
| Not acceptable `Accept` | 406 |
| Unhandled runtime exception | 500 |

> **Trap:** A `ConstraintViolationException` from method-level validation is **not** mapped to 400 by default — without a handler it surfaces as 500. This differs from `MethodArgumentNotValidException` (from `@Valid` on `@RequestBody`), which *is* 400 by default.

---

## Bean Validation (Jakarta) & Hibernate Validator

**Bean Validation** is a Java specification (JSR 380 / Jakarta Validation 3.x) for declaring constraints on beans via annotations. **Hibernate Validator** is the reference implementation Spring Boot ships (`spring-boot-starter-validation` brings it in — note it is *not* transitively included in the web starter since Boot 2.3).

**Common constraints** (`jakarta.validation.constraints.*`): `@NotNull`, `@NotEmpty` (not null + size>0, for collections/strings/arrays/maps), `@NotBlank` (string not null and trimmed length>0), `@Size(min,max)`, `@Min`/`@Max`, `@Positive`/`@Negative`/`@PositiveOrZero`, `@Email`, `@Pattern`, `@Past`/`@Future`, `@Digits`, `@DecimalMin`/`@DecimalMax`.

| Annotation | Applies to | Null is... | Checks |
|---|---|---|---|
| `@NotNull` | any | invalid | value is non-null |
| `@NotEmpty` | String, Collection, Map, array | invalid | non-null AND size/length > 0 |
| `@NotBlank` | String only | invalid | non-null AND trimmed length > 0 |
| `@Size` | String, Collection, Map, array | **valid** | length/size within [min,max] |
| `@Email` | CharSequence | **valid** | valid email format |

> **Trap:** Most constraints (`@Size`, `@Email`, `@Pattern`, `@Min`...) consider `null` **valid** — they only validate non-null values. Combine with `@NotNull` if the field is required.

**Where constraints go:** on fields, getters, method parameters, method return values, and type parameters (container element constraints like `List<@NotBlank String>`).

**Boot integration:** With `spring-boot-starter-validation` on the classpath, Boot auto-configures a `LocalValidatorFactoryBean` (a `Validator`) and a `MethodValidationPostProcessor`. Constraint violations on `@RequestBody` `@Valid` params become `MethodArgumentNotValidException`.

---

## @Valid vs @Validated (groups)

Two distinct annotations that interviewers love to contrast:

| | `@Valid` | `@Validated` |
|---|---|---|
| Package | `jakarta.validation.Valid` (spec) | `org.springframework.validation.annotation.Validated` (Spring) |
| Validation groups | **No** | **Yes** — `@Validated(OnCreate.class)` |
| Enables method-level validation on a bean | No | **Yes** (put on class for `@Validated` proxy) |
| Cascades into nested objects | **Yes** (the standard cascade marker) | No (not a cascade marker) |

**Groups** let one model define different rules for different operations:

```java
public interface OnCreate {}
public interface OnUpdate {}

public class UserDto {
    @Null(groups = OnCreate.class)          // must be null on create
    @NotNull(groups = OnUpdate.class)       // required on update
    private Long id;

    @NotBlank(groups = {OnCreate.class, OnUpdate.class})
    private String name;
}

@PostMapping("/users")
public User create(@Validated(OnCreate.class) @RequestBody UserDto dto) { ... }

@PutMapping("/users/{id}")
public User update(@Validated(OnUpdate.class) @RequestBody UserDto dto) { ... }
```

**Key facts:**
- `@Valid` cannot specify groups; it always validates the **default** group. So to use groups you need `@Validated`.
- Constraints without an explicit `group` belong to the `Default` group and only run when the `Default` group (or a group extending it) is validated.
- `@Validated` at **class level** on a bean (service/controller) enables Spring's **method-level validation** (via `MethodValidationPostProcessor`), so `@Min`, `@NotNull` etc. on method parameters are enforced — throwing `ConstraintViolationException`.
- `@Valid` on a **method parameter** (typically `@RequestBody`) triggers argument validation and yields `MethodArgumentNotValidException` on failure.

**Trap:** People try `@Valid(groups=...)` — that doesn't compile/exist. Use `@Validated(Group.class)`. Also, `@Validated` is *not* a cascade annotation, so nested-object validation still requires `@Valid` on the nested field.

---

## @Valid + BindingResult

When you want to handle validation errors **manually inside the controller** instead of letting Spring throw, declare a `BindingResult` (or `Errors`) parameter **immediately after** the validated object.

```java
@PostMapping("/users")
public ResponseEntity<?> create(@Valid @RequestBody UserDto dto, BindingResult result) {
    if (result.hasErrors()) {
        var errors = result.getFieldErrors().stream()
            .collect(toMap(FieldError::getField, FieldError::getDefaultMessage));
        return ResponseEntity.badRequest().body(errors);
    }
    // ... proceed
}
```

**Critical rules:**
- The `BindingResult` **must come directly after** the `@Valid` object it refers to. If they aren't adjacent, Spring associates them incorrectly. One `BindingResult` per validated model.
- **Presence of `BindingResult` suppresses the exception.** If you declare it, Spring does **not** throw `MethodArgumentNotValidException`; it's your responsibility to check `hasErrors()`. Forgetting the check means invalid data flows through — a real bug.
- Without a `BindingResult`, a failed `@Valid` on `@RequestBody` throws `MethodArgumentNotValidException` (→ 400), which you handle globally in advice. This is the **preferred** approach for REST APIs (centralized handling); `BindingResult` is more common with server-side form/`@ModelAttribute` flows where you re-render the form.

`BindingResult` exposes `getFieldErrors()`, `getGlobalErrors()`, `getAllErrors()`, `getFieldError(name)`, `getErrorCount()`, and `rejectValue(...)` for programmatically adding errors.

**Note on binding vs validation:** `BindingResult` also captures **type-mismatch/binding** errors (e.g. a non-numeric value bound to an `int`), not only constraint violations — this is why it exists for form binding.

---

## Validating path/query params

Constraints placed **directly on controller method parameters** (`@PathVariable`, `@RequestParam`) are *not* triggered by `@Valid` on a body. They require **method-level validation**, which needs `@Validated` on the controller class.

```java
@RestController
@Validated                       // REQUIRED to enforce param constraints
public class ProductController {

    @GetMapping("/products")
    public List<Product> list(
            @RequestParam @Min(1) int page,
            @RequestParam @Max(100) @Positive int size,
            @RequestParam @Pattern(regexp = "asc|desc") String order) { ... }

    @GetMapping("/products/{id}")
    public Product get(@PathVariable @Positive Long id) { ... }
}
```

**Key facts:**
- Without class-level `@Validated`, the `@Min`/`@Max`/`@Pattern` on params are **silently ignored**. Extremely common interview/real-world bug.
- Failures throw **`ConstraintViolationException`** (from `jakarta.validation`), *not* `MethodArgumentNotValidException`. By default this is **500**, so you must add an `@ExceptionHandler(ConstraintViolationException.class)` returning 400 to get correct semantics.
- The mechanism is `MethodValidationPostProcessor`, which creates an AOP proxy around `@Validated` beans. Because it's proxy-based, the usual proxy caveats apply (self-invocation of a validated method within the same bean bypasses validation).

**Spring Boot 3.2+ change (advanced):** Spring Framework 6.1 introduced improved method validation where controller method-parameter constraint violations can be adapted into `HandlerMethodValidationException` (which is an `ErrorResponse` → 400) instead of a raw `ConstraintViolationException`, giving field-error-like details and proper 400 status without a custom handler in many cases. Still, class-level `@Validated` remains the trigger.

---

## Custom constraint validators

When built-in constraints don't express your rule, define a custom constraint = an annotation + a `ConstraintValidator`.

```java
@Target({FIELD, PARAMETER})
@Retention(RUNTIME)
@Constraint(validatedBy = CountryCodeValidator.class)
public @interface ValidCountryCode {
    String message() default "invalid country code";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}

public class CountryCodeValidator
        implements ConstraintValidator<ValidCountryCode, String> {

    private Set<String> allowed;

    @Override
    public void initialize(ValidCountryCode ann) {
        allowed = Set.of(Locale.getISOCountries());
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext ctx) {
        if (value == null) return true;          // let @NotNull handle null
        return allowed.contains(value);
    }
}
```

**Required members (mandatory by spec):** every constraint annotation MUST declare `message()`, `groups()`, and `payload()`. Missing any of these makes it an invalid constraint.

**Key facts:**
- Convention: return `true` for `null` and pair with `@NotNull` — keeps constraints composable.
- **Validators are Spring beans:** Hibernate Validator integrated with Spring resolves `ConstraintValidator` instances via the `SpringConstraintValidatorFactory`, so you can `@Autowired` dependencies (e.g. a repository for uniqueness checks) into a validator. This is how "is-email-unique" validators query the DB.
- **Custom message with dynamic content:** disable the default and build your own via the context:
  ```java
  ctx.disableDefaultConstraintViolation();
  ctx.buildConstraintViolationWithTemplate("code " + value + " not allowed")
     .addConstraintViolation();
  ```
- **Class-level (cross-field) constraints:** target `TYPE` and validate the whole object (e.g. `password == confirmPassword`, or "endDate after startDate"). The validator's generic type is your class.
- **Composed constraints:** annotate a new annotation with existing constraints (`@NotNull @Size(min=8) @Pattern(...)`) plus `@ReportAsSingleViolation` to bundle them.

---

## Cascading validation

By default, validation does **not** recurse into nested objects. To validate a nested bean's constraints you must mark the reference with **`@Valid`** — this is "cascaded validation."

```java
public class OrderDto {
    @NotNull
    private String customer;

    @Valid                       // cascade into Address's own constraints
    @NotNull
    private Address shippingAddress;

    @Valid                       // cascade into each LineItem
    private List<@Valid LineItem> items;   // container-element + cascade
}

public class Address {
    @NotBlank private String street;
    @NotBlank private String zip;
}
```

**Key facts:**
- Without `@Valid` on `shippingAddress`, `Address`'s `@NotBlank` constraints are **not** evaluated even though the top-level object is validated. The `@NotNull` on the field itself still runs (it's a constraint on the container reference, not a cascade).
- For collections, `@Valid` on the collection field cascades to each element; you can also use container-element `@Valid`/constraints (`List<@Valid LineItem>`, `Map<String, @NotNull @Valid Value>`) in Bean Validation 2.0+.
- Cascading is recursive: `@Valid` on `OrderDto` param + `@Valid` on `shippingAddress` + `@Valid` on `items` validates the whole tree in one pass, aggregating all violations.
- **Groups + cascade:** the validated group propagates down the cascade. Use `@ConvertGroup(from = X.class, to = Y.class)` to translate groups across a cascade boundary.
- `@Valid` (cascade) is the spec annotation; `@Validated` does not cascade — remember the two roles of `@Valid`: (1) trigger validation of a controller parameter, (2) mark a nested reference for cascading.

---

## Common follow-up questions

- **What's the difference between `@Valid` and `@Validated`?** `@Valid` is the Jakarta spec annotation (no groups, but is the cascade marker); `@Validated` is Spring's, supports validation groups and enables method-level validation when placed on a class.
- **Why is my `@Min` on a `@RequestParam` ignored?** The controller class lacks `@Validated`; param constraints need method-level validation.
- **Why does a path-variable constraint violation return 500 instead of 400?** It throws `ConstraintViolationException`, which has no default 400 mapping (unlike `MethodArgumentNotValidException`); add a handler (or rely on Spring 6.1+ `HandlerMethodValidationException`).
- **`MethodArgumentNotValidException` vs `ConstraintViolationException` — when each?** The former from `@Valid` on `@RequestBody`/`@ModelAttribute`; the latter from method-level validation on `@Validated` beans (params, service methods).
- **Why did my `@ExceptionHandler` return 200 for an error?** No `@ResponseStatus` and you returned a plain body; set the status explicitly or return `ResponseEntity`.
- **`@ControllerAdvice` vs `@RestControllerAdvice`?** The latter adds `@ResponseBody` so returns are serialized to the response body.
- **How do you produce RFC 7807 responses?** Return/throw `ProblemDetail`/`ErrorResponseException`; enable `spring.mvc.problemdetails.enabled=true` for built-ins; content type is `application/problem+json`.
- **Why did adding `BindingResult` stop my 400s?** Its presence suppresses the thrown exception — you must check `hasErrors()` yourself.
- **How can a validator query the database (uniqueness)?** `ConstraintValidator`s are Spring beans; inject a repository via `@Autowired`.
- **Upgrade trap: my `ResponseEntityExceptionHandler` overrides do nothing after Boot 3.** The signatures changed from `HttpStatus` to `HttpStatusCode`; and `javax.validation` annotations must move to `jakarta.validation`.
- **Does `@ExceptionHandler` catch exceptions from filters?** No — filters run outside DispatcherServlet's handler invocation; use error-dispatch/`@ControllerAdvice` cannot see them.
- **Self-invocation and validation:** calling a `@Validated` method from within the same bean bypasses the validation proxy (same reason as `@Transactional` self-invocation).

## References

- Spring Framework Reference — Web MVC, Exceptions & Error Responses: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-exceptionhandler.html
- Spring Framework Reference — Error Responses / ProblemDetail (`ErrorResponse`): https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html
- Spring Framework Reference — Validation (Bean Validation, method validation): https://docs.spring.io/spring-framework/reference/core/validation/beanvalidation.html
- `ResponseEntityExceptionHandler` Javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/servlet/mvc/method/annotation/ResponseEntityExceptionHandler.html
- `ProblemDetail` Javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/ProblemDetail.html
- RFC 7807 — Problem Details for HTTP APIs: https://datatracker.ietf.org/doc/html/rfc7807
- Jakarta Bean Validation 3.0 specification: https://jakarta.ee/specifications/bean-validation/3.0/
- Hibernate Validator reference guide: https://docs.jboss.org/hibernate/validator/8.0/reference/en-US/html_single/
- Baeldung — Spring `@ControllerAdvice` / `@ExceptionHandler`: https://www.baeldung.com/exception-handling-for-rest-with-spring
- Baeldung — Spring `@Valid` vs `@Validated`: https://www.baeldung.com/spring-valid-vs-validated
- Baeldung — Spring `MethodArgumentNotValidException` / validation: https://www.baeldung.com/spring-boot-bean-validation
- Baeldung — Custom validation annotation: https://www.baeldung.com/spring-mvc-custom-validator
