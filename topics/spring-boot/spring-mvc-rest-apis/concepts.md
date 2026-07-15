# Spring MVC & REST APIs

Spring MVC is the servlet-based web framework at the heart of `spring-webmvc`. It
implements the classic **Front Controller** pattern: a single `DispatcherServlet`
receives every HTTP request and delegates to specialized collaborators
(HandlerMapping, HandlerAdapter, ViewResolver, message converters, etc.). Spring
Boot auto-configures all of this on top of an embedded servlet container
(Tomcat by default). This topic covers the request lifecycle, the controller/REST
programming model, and REST API design concerns (status codes, idempotency,
versioning, HATEOAS, content negotiation, CORS).

> Spring Boot 3.x runs on **Spring Framework 6** and **Jakarta EE 9+**: the servlet
> API is `jakarta.servlet.*` (not `javax.servlet.*`), and validation is
> `jakarta.validation.*`. Minimum Java 17.

---

## DispatcherServlet front-controller flow

The `DispatcherServlet` is the **front controller** — one servlet mapped
(usually to `/`) that funnels all requests through a single entry point so that
cross-cutting concerns (locale, theme, multipart parsing, exception handling)
live in one place instead of being scattered across many servlets.

Core collaborators (each is a bean the DispatcherServlet looks up in its
`WebApplicationContext`):

| Component | Responsibility |
|---|---|
| `HandlerMapping` | Maps an incoming request to a handler (+ interceptor chain). `RequestMappingHandlerMapping` resolves `@RequestMapping` methods. |
| `HandlerAdapter` | Knows how to *invoke* a given handler type. `RequestMappingHandlerAdapter` invokes annotated controller methods, resolving arguments and handling return values. |
| `HandlerExceptionResolver` | Turns exceptions thrown during handling into a response/view. |
| `ViewResolver` | Resolves a logical view name (e.g. `"home"`) to an actual `View`. |
| `LocaleResolver` / `ThemeResolver` | Resolve locale/theme for i18n. |
| `MultipartResolver` | Parses `multipart/form-data` requests (`StandardServletMultipartResolver`). |
| `HandlerMethodArgumentResolver` | Resolves each controller-method parameter (`@PathVariable`, `@RequestBody`, etc.). |
| `HandlerMethodReturnValueHandler` | Processes the return value (e.g. write body via `HttpMessageConverter`). |

**Simplified `doDispatch` flow:**

1. `MultipartResolver` checks & wraps a multipart request.
2. Iterate `HandlerMapping`s → obtain a `HandlerExecutionChain` (handler + interceptors).
3. Find the `HandlerAdapter` that supports the handler.
4. Call `interceptor.preHandle()` for each interceptor (in order).
5. `HandlerAdapter.handle()` invokes the controller method → returns `ModelAndView` (null for `@ResponseBody`/REST).
6. Call `interceptor.postHandle()` (reverse order).
7. `processDispatchResult`: render the view via `ViewResolver` (or the body was already written by a message converter), then `interceptor.afterCompletion()`.
8. Any exception is routed through the `HandlerExceptionResolver`s.

For REST controllers there is **no view**: the return value handler
(`RequestResponseBodyMethodProcessor`) serializes the object with an
`HttpMessageConverter` and the ViewResolver step is skipped.

**Advanced gotchas:**
- The DispatcherServlet has its own child `WebApplicationContext` (the "web
  context"), whose parent is the root context. Web beans can see root beans but
  not vice-versa. Spring Boot uses a single context by default but the parent/child
  concept still matters in traditional setups.
- Default beans come from `DispatcherServlet.properties`. `@EnableWebMvc` (or Boot's
  auto-config) registers the annotation-driven `RequestMappingHandlerMapping`/`Adapter`.
- `DispatcherServlet` extends `FrameworkServlet` extends `HttpServletBean` extends
  `HttpServlet` — it *is* a servlet.

---

## Request lifecycle

End-to-end path of a request in a Spring Boot MVC app:

```
Client → Embedded Tomcat connector → Servlet Filter chain
       → DispatcherServlet → HandlerMapping (+ HandlerInterceptors)
       → HandlerAdapter → ArgumentResolvers → Controller method
       → ReturnValueHandler / HttpMessageConverter (or ViewResolver→View)
       → HandlerInterceptor.postHandle/afterCompletion → Filter chain → Client
```

Key ordering facts often tested:
- **Filters run outside the DispatcherServlet**; interceptors run inside it (they
  only see requests that reached the DispatcherServlet).
- `OncePerRequestFilter` guarantees a filter body runs once per request even with
  forwards/includes.
- `preHandle` returning `false` short-circuits: the handler is not invoked, and
  `afterCompletion` runs only for interceptors whose `preHandle` already returned true.
- `postHandle` is **not** called if the handler threw an exception; `afterCompletion`
  *is* always called for interceptors that passed `preHandle`.

---

## @Controller vs @RestController

- `@Controller` is a stereotype marking a web controller. Its methods typically
  return a **logical view name** (a `String`) that a `ViewResolver` renders. To
  return data directly you must add `@ResponseBody` per method.
- `@RestController` = `@Controller` + `@ResponseBody` at the class level (it is a
  meta-annotation composed of both). Every method's return value is written to the
  response body via an `HttpMessageConverter` — no view resolution.

```java
@Controller
public class PageController {
  @GetMapping("/home")
  public String home() { return "home"; }         // → resolves view "home"

  @GetMapping("/api/x") @ResponseBody
  public X x() { return new X(); }                 // → serialized to body
}

@RestController                                     // implies @ResponseBody
public class ApiController {
  @GetMapping("/api/y")
  public Y y() { return new Y(); }                  // → serialized to body
}
```

Trap: if you use `@RestController` but intended to render a template, you'll get the
literal view name string written to the body instead of an HTML page.

---

## Request mapping annotations

`@RequestMapping` is the general mapping annotation (class + method level). The
HTTP-method-specific composed annotations are shortcuts:

| Annotation | Equivalent |
|---|---|
| `@GetMapping` | `@RequestMapping(method = GET)` |
| `@PostMapping` | `@RequestMapping(method = POST)` |
| `@PutMapping` | `@RequestMapping(method = PUT)` |
| `@DeleteMapping` | `@RequestMapping(method = DELETE)` |
| `@PatchMapping` | `@RequestMapping(method = PATCH)` |

Narrowing attributes: `path`/`value`, `method`, `params`, `headers`, `consumes`
(match `Content-Type`), `produces` (match `Accept`).

```java
@RequestMapping(value = "/users", method = POST,
                consumes = "application/json", produces = "application/json")
```

- Path patterns use `PathPattern` (Spring 5.3+, default in Boot) — e.g. `/files/{*path}`
  captures the rest of the path. The older `AntPathMatcher` is still available.
- Ambiguous mappings (two methods equally specific for the same request) throw
  `IllegalStateException` at startup or produce a 500 at request time.
- Class-level `@RequestMapping("/api")` prefixes all method paths.

---

## @PathVariable, @RequestParam, @RequestBody, @RequestHeader, @CookieValue

| Annotation | Source | Example |
|---|---|---|
| `@PathVariable` | URI template segment | `/users/{id}` → `@PathVariable Long id` |
| `@RequestParam` | query string or form field | `?page=2` → `@RequestParam int page` |
| `@RequestBody` | full request body (deserialized) | JSON → `@RequestBody UserDto dto` |
| `@RequestHeader` | HTTP header | `@RequestHeader("User-Agent") String ua` |
| `@CookieValue` | cookie | `@CookieValue("JSESSIONID") String sid` |

Notes & traps:
- `@RequestParam` is **required by default**; use `required = false` and/or
  `defaultValue`. Supplying `defaultValue` implicitly makes it optional. Same for
  `@PathVariable`/`@RequestHeader`.
- If a param name can't be inferred (no `-parameters` compiler flag), you must name
  it explicitly: `@RequestParam("page")`. Spring Boot enables `-parameters` by default.
- `@RequestParam` can bind `MultiValueMap`/`Map` for all params, and a `List<>` for
  repeated params.
- `@RequestBody` uses `HttpMessageConverter` (Jackson for JSON). Only one `@RequestBody`
  per method. Combine with `@Valid` to trigger bean validation (→ `MethodArgumentNotValidException`).
- Form-encoded bodies (`application/x-www-form-urlencoded`) bind via `@RequestParam` or a
  model attribute, **not** `@RequestBody`.

---

## Multipart file upload

For `multipart/form-data` uploads:

```java
@PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
public ResponseEntity<String> upload(@RequestParam("file") MultipartFile file,
                                     @RequestParam("desc") String desc) {
  String name = file.getOriginalFilename();
  file.transferTo(Path.of("/tmp/" + name));
  return ResponseEntity.ok("stored " + name);
}
```

- `MultipartFile` is the Spring abstraction (`org.springframework.web.multipart`).
  Use `@RequestPart` when a part is itself JSON that needs a converter, e.g.
  `@RequestPart("meta") MetaDto meta, @RequestPart("file") MultipartFile file`.
- In Boot 3, the `MultipartResolver` is `StandardServletMultipartResolver` (servlet
  container handles parsing). Limits set via
  `spring.servlet.multipart.max-file-size` / `max-request-size`.
- Multiple files: `MultipartFile[]` or `List<MultipartFile>`.
- `@RequestParam` vs `@RequestPart`: `@RequestParam` treats the value as a simple
  string/`MultipartFile`; `@RequestPart` runs it through content-type-aware
  `HttpMessageConverter`s (so a JSON part is deserialized).

---

## ResponseEntity

`ResponseEntity<T>` represents the **entire** HTTP response: status code, headers,
and body. Use it when you need control beyond the body (custom status, `Location`
header, caching headers).

```java
@PostMapping("/users")
public ResponseEntity<UserDto> create(@RequestBody @Valid UserDto in) {
  UserDto saved = service.save(in);
  URI loc = ServletUriComponentsBuilder.fromCurrentRequest()
              .path("/{id}").buildAndExpand(saved.id()).toUri();
  return ResponseEntity.created(loc).body(saved);   // 201 + Location
}

return ResponseEntity.notFound().build();            // 404, no body
return ResponseEntity.status(HttpStatus.ACCEPTED).body(x);
```

- Alternatives: return the object directly (status defaults to 200, or use
  `@ResponseStatus` on the method/exception), or use `ProblemDetail`
  (RFC 7807/9457) in Spring 6 for error bodies.
- `ResponseEntity<Void>` for no body. `ResponseEntity<Resource>` for streaming files.
- `HttpEntity` is the superclass without status (request or response headers+body).

---

## REST principles & Richardson Maturity Model

REST (Representational State Transfer) constraints: **client-server, stateless,
cacheable, uniform interface, layered system,** and optional code-on-demand.
"Stateless" means each request carries all context — the server keeps no client
session state between requests (enables horizontal scaling).

**Richardson Maturity Model** grades how "RESTful" an API is:

| Level | Name | Characteristic |
|---|---|---|
| 0 | The Swamp of POX | Single URI, single verb (usually POST); RPC over HTTP (e.g. SOAP-style). |
| 1 | Resources | Many URIs (one per resource), still often one verb. |
| 2 | HTTP Verbs | Proper use of GET/POST/PUT/DELETE + status codes. Most "REST" APIs live here. |
| 3 | Hypermedia Controls (HATEOAS) | Responses include links telling the client what it can do next. |

Leonard Richardson devised it; Martin Fowler popularized it. Level 3 is the
"glory of REST" but rarely fully implemented in practice.

---

## HTTP methods & status codes

| Method | Safe | Idempotent | Typical use |
|---|---|---|---|
| GET | yes | yes | read a resource |
| HEAD | yes | yes | headers only |
| OPTIONS | yes | yes | capabilities / CORS preflight |
| POST | no | **no** | create / non-idempotent action |
| PUT | no | yes | full replace / create-at-known-URI |
| PATCH | no | **no** (not required) | partial update |
| DELETE | no | yes | remove resource |

**Status code families:** 1xx informational, 2xx success, 3xx redirection,
4xx client error, 5xx server error.

Commonly tested codes:
- `200 OK`, `201 Created` (+ `Location`), `202 Accepted` (async), `204 No Content`.
- `301` (permanent redirect) vs `302`/`307`/`308`; `304 Not Modified` (conditional GET/ETag).
- `400 Bad Request`, `401 Unauthorized` (not authenticated), `403 Forbidden`
  (authenticated but not allowed), `404 Not Found`, `405 Method Not Allowed`,
  `406 Not Acceptable` (content negotiation), `409 Conflict`, `415 Unsupported
  Media Type`, `422 Unprocessable Entity` (validation), `429 Too Many Requests`.
- `500 Internal Server Error`, `502 Bad Gateway`, `503 Service Unavailable`.

Trap: **401 vs 403** — 401 = who are you (missing/invalid credentials); 403 = I
know who you are but you may not.

---

## Idempotency

An operation is **idempotent** if making the same request N times has the same
effect on server state as making it once. It is **safe** if it does not modify
state at all.

- GET, HEAD, OPTIONS, PUT, DELETE are idempotent by the HTTP spec; POST is not.
- DELETE is idempotent in *effect* (resource ends up absent) even though the second
  call may return 404 — idempotency is about server state, not identical responses.
- PATCH is not *required* to be idempotent, though a PATCH can be written to be.
- **Idempotency keys**: for POST (e.g. payments) clients send an `Idempotency-Key`
  header; the server deduplicates retries. This is how you make an inherently
  non-idempotent operation safe to retry.
- Why it matters: network retries, at-least-once delivery, and load balancers can
  replay requests; idempotent endpoints tolerate that safely.

---

## PUT vs PATCH vs POST

| | POST | PUT | PATCH |
|---|---|---|---|
| Intent | create / process | full replace (or create at URI) | partial update |
| Target URI | collection (`/users`) | specific resource (`/users/42`) | specific resource |
| Idempotent | no | yes | not required |
| Body | new representation | **complete** representation | delta/patch document |
| Missing fields | n/a | treated as null/removed (full replace) | left unchanged |

- Use **POST** to create when the server assigns the ID (returns `201` + `Location`).
- Use **PUT** when the client knows the full URI and sends the entire resource;
  repeating it yields the same result. PUT can create if the resource doesn't exist.
- Use **PATCH** to change a subset of fields. Formats: JSON Merge Patch (RFC 7386)
  or JSON Patch (RFC 6902, an array of ops). `Content-Type: application/merge-patch+json`
  or `application/json-patch+json`.
- Trap: sending a partial body with PUT can wipe unspecified fields — that's PATCH semantics.

---

## DTO (Data Transfer Objects)

A DTO is a flat object shaped for the API boundary, decoupled from JPA
entities/domain models.

Why use DTOs:
- **Decoupling**: entity schema changes don't break the API contract, and API
  shape changes don't leak into persistence.
- **Security**: avoid over-exposing fields (passwords, internal flags) and prevent
  **mass-assignment** (binding client input straight onto an entity).
- **Serialization control / N+1 avoidance**: returning entities can trigger lazy
  loading during Jackson serialization (`LazyInitializationException` after the
  transaction closed, or accidental N+1 queries). DTOs let you project exactly what
  you need (JPQL constructor expressions / Spring Data projections).
- **Validation** at the boundary with `jakarta.validation` annotations.

Mapping: manual, MapStruct (compile-time), or ModelMapper. Java `record`s make
concise immutable DTOs. Trade-off: boilerplate/mapping cost vs. clean layering.

---

## Content negotiation (JSON vs XML)

Content negotiation selects the response representation. Spring uses
`ContentNegotiationManager` + `HttpMessageConverter`s.

Strategies (in default priority):
1. **`Accept` header** (default, preferred) — `Accept: application/xml`.
2. **URL path extension** — `.json`/`.xml` (disabled by default in Spring 5.3+/Boot for security).
3. **Query parameter** — `?format=json` (enable `favor-parameter`).

- The chosen converter must both support the type and match the client's `Accept`.
  No match → `406 Not Acceptable`. Request body type not supported → `415`.
- JSON works out of the box (Jackson on classpath). XML requires
  `jackson-dataformat-xml` (or JAXB) on the classpath; then the same controller can
  serve both based on `Accept`.
- `produces`/`consumes` on `@RequestMapping` further constrain negotiation.

```properties
spring.mvc.contentnegotiation.favor-parameter=true
spring.mvc.contentnegotiation.parameter-name=format
```

---

## Pagination, sorting & filtering

- Spring Data provides `Pageable`/`Sort`; a controller method taking `Pageable`
  auto-binds `?page=0&size=20&sort=name,asc&sort=age,desc`. Backed by
  `PageableHandlerMethodArgumentResolver`.
- `Page<T>` includes total count (extra `count` query); `Slice<T>` only knows if
  there's a next page (no count query — cheaper). `Window`/keyset (seek) pagination
  scales better than large `OFFSET`.
- Defaults configurable: `spring.data.web.pageable.default-page-size`,
  `max-page-size`, and `one-indexed-parameters`.
- **Offset pagination pitfall**: deep offsets are slow (DB scans and discards rows)
  and can skip/duplicate rows when data mutates between pages; keyset/cursor
  pagination (WHERE id > lastId) avoids this.
- Filtering: query params (`?status=ACTIVE&minAge=18`), or Spring Data
  `Specification`/QueryDSL/`Example` for dynamic predicates.
- Return metadata via `PagedModel` (Spring HATEOAS / Spring Data) to keep the
  serialized `Page` contract stable (the raw `PageImpl` JSON shape is not guaranteed).

---

## API versioning

Common strategies (trade-offs, no single "right" answer):

| Strategy | Example | Pros | Cons |
|---|---|---|---|
| URI path | `/api/v1/users` | simple, visible, cacheable | not "pure REST" (URI should be stable), route duplication |
| Query param | `/api/users?version=1` | easy default | clutters params, weaker caching |
| Custom header | `X-API-Version: 1` | clean URIs | invisible, harder to test in a browser |
| `Accept` header (media type) | `Accept: application/vnd.myapp.v1+json` | RESTful, content negotiation | verbose, hardest to use |

- Spring can route by header/param/media type via `@RequestMapping(headers=...)`,
  `params=...`, or `produces=...`.
- **Spring Framework 7 / Boot 4.0+** add first-class API versioning:
  `@RequestMapping(version = "1.2")` plus `spring.mvc.apiversion.*` config (resolve
  from header, param, path segment, or media type). (Boot 3.x, on Spring Framework 6,
  does not have this; you version via `headers=`/`params=`/`produces=` instead.)
- Best practice: version only on breaking changes; prefer additive, backward-
  compatible evolution (tolerant reader). URI versioning is the most common in
  practice for its simplicity.

---

## HATEOAS

HATEOAS (Hypermedia As The Engine Of Application State) = Richardson Level 3: the
server embeds **links** in responses so clients discover available transitions
dynamically instead of hardcoding URIs.

```java
EntityModel<UserDto> model = EntityModel.of(user,
    linkTo(methodOn(UserController.class).getUser(id)).withSelfRel(),
    linkTo(methodOn(UserController.class).getAllUsers()).withRel("users"));
```

- **Spring HATEOAS** provides `RepresentationModel`, `EntityModel`,
  `CollectionModel`, `PagedModel`, `Link`, and `WebMvcLinkBuilder` (`linkTo`,
  `methodOn`). Default media type is **HAL** (`application/hal+json`, `_links`/`_embedded`).
- Benefits: looser client coupling, self-documenting, evolvable server URIs.
- Costs: bigger payloads, more complexity, few clients truly follow links — which is
  why most APIs stop at Level 2.

---

## Filters vs Interceptors

| | Servlet Filter | HandlerInterceptor |
|---|---|---|
| Layer | Servlet container (before DispatcherServlet) | Spring MVC (inside DispatcherServlet) |
| API | `jakarta.servlet.Filter` | `org.springframework.web.servlet.HandlerInterceptor` |
| Awareness | request/response only; no handler info | knows the target handler method, `ModelAndView` |
| Hooks | one `doFilter` (wraps before+after) | `preHandle`, `postHandle`, `afterCompletion` |
| Use cases | logging, auth, compression, CORS, request wrapping, works for any servlet resource (static files too) | auth checks tied to handlers, timing, adding model attributes |
| Order | `@Order` / `FilterRegistrationBean` | `addInterceptors` registration order |

- Filters can modify the request/response stream and short-circuit the whole chain;
  interceptors only see requests routed to a handler.
- Spring Security is built on a **filter chain** (`FilterChainProxy`), so it runs
  before interceptors — an interceptor can't authenticate ahead of Security.
- `HandlerInterceptor` beans are registered via `WebMvcConfigurer#addInterceptors`.

---

## CORS

**CORS** (Cross-Origin Resource Sharing) relaxes the browser's **same-origin
policy**, letting a page from origin A call an API at origin B. It is enforced by
the **browser**, not the server (server just declares what's allowed via headers).

- **Preflight**: for "non-simple" requests the browser sends an `OPTIONS` request
  with `Access-Control-Request-Method`/`-Headers`; the server answers with
  `Access-Control-Allow-Origin/-Methods/-Headers`. Simple GET/POST (with simple
  headers) skip preflight.
- Spring options:
  - `@CrossOrigin` on a controller/method.
  - Global `WebMvcConfigurer#addCorsMappings(CorsRegistry)`.
  - `CorsConfigurationSource` bean (needed with Spring Security).
- **Traps:**
  - `allowCredentials(true)` **cannot** be combined with `allowedOrigins("*")` —
    use `allowedOriginPatterns` instead (Spring rejects the wildcard+credentials combo).
  - With Spring Security you must also enable CORS in the security filter chain
    (`http.cors(...)`), or the security filters block the preflight first.
  - CORS is a browser mechanism — server-to-server or curl calls are unaffected.

---

## Common follow-up questions

- **Walk me through what happens from the moment a request hits Tomcat until the
  JSON response is written.** (Filters → DispatcherServlet → HandlerMapping →
  interceptors → HandlerAdapter → argument resolvers → controller → message
  converter → interceptors → filters.)
- **Why is `@RestController` enough — where did `@ResponseBody` go?** (It's a
  meta-annotation combining `@Controller` + `@ResponseBody`.)
- **Is DELETE idempotent even though the second call returns 404?** (Yes —
  idempotency is about resulting server state, not the response.)
- **PUT vs PATCH for updating one field?** (PATCH; PUT would replace the whole
  resource and blank unspecified fields.)
- **How do you make a POST /payments safe to retry?** (Idempotency-Key header + server-side dedup.)
- **Filter vs interceptor — where does Spring Security sit?** (Filter layer, before
  interceptors.)
- **Why not return JPA entities directly?** (Coupling, mass-assignment,
  LazyInitializationException/N+1, over-exposure — use DTOs.)
- **Why does `allowCredentials(true)` + `allowedOrigins("*")` fail?** (Spec/Spring
  forbids it; use `allowedOriginPatterns`.)
- **Difference between 401 and 403? 400 vs 422? 302 vs 307 vs 308?**
- **How does content negotiation pick XML vs JSON, and what returns 406 vs 415?**

## References

- Spring Framework Reference — Web MVC:
  https://docs.spring.io/spring-framework/reference/web/webmvc.html
- DispatcherServlet:
  https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet.html
- Spring Boot Reference — Developing Web Applications:
  https://docs.spring.io/spring-boot/reference/web/servlet.html
- Spring HATEOAS Reference: https://docs.spring.io/spring-hateoas/docs/current/reference/html/
- CORS support: https://docs.spring.io/spring-framework/reference/web/webmvc-cors.html
- Martin Fowler — Richardson Maturity Model:
  https://martinfowler.com/articles/richardsonMaturityModel.html
- MDN — HTTP request methods & CORS:
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods ,
  https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- RFC 9110 (HTTP Semantics — methods, status, idempotency); RFC 9457 (Problem Details).
- Baeldung: PUT vs PATCH (https://www.baeldung.com/http-put-patch-difference-spring),
  ResponseEntity (https://www.baeldung.com/spring-response-entity),
  REST API versioning (https://www.baeldung.com/rest-versioning).
