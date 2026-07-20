# Docker Compose & Multi-Container Apps

This page covers **Docker Compose** — the tool for defining and running a
multi-container application *declaratively* on a **single host**. You describe your
services, networks, and volumes in a `compose.yaml` file and Compose reconciles the
running state to match. It is the standard way to spin up an app-plus-its-backing-
services (web + db + cache + queue) for local development, integration tests, CI, and
small single-node deployments.

> [!KEY-TAKEAWAY]
> Four ideas unlock this whole topic. **(1) Compose orchestrates, the Dockerfile
> builds** — the Dockerfile turns source into *one* image; Compose wires *many*
> containers together at runtime. **(2) Services find each other by service name**
> over a shared Compose network via built-in DNS — no hardcoded IPs. **(3)
> `depends_on` controls *start order*, not *readiness*** — a dependency being
> "started" is not the same as "ready to accept connections," so you need
> healthchecks (`condition: service_healthy`) or app-level retries. **(4) Compose is
> single-host** — for multi-node orchestration you move to Kubernetes (a separate
> domain).

---

## What Docker Compose is

**Docker Compose** is a tool that reads a YAML file (default `compose.yaml`, also
`docker-compose.yml`) describing a set of containers and their relationships, then
creates and manages them together as a single **project**. Instead of running many
`docker run` commands by hand — each with its own flags for networks, volumes, ports,
and environment — you declare the desired end state once and run `docker compose up`.

Why it matters:

- **Reproducibility** — the whole app topology (web + db + cache) is version-
  controlled in one file; any teammate runs `docker compose up` and gets the same
  stack.
- **Declarative reconciliation** — you describe *what* you want, Compose figures out
  *how* to get there (create networks, pull/build images, start containers in order,
  recreate only what changed).
- **Lifecycle as a unit** — `up`, `down`, `logs`, `ps`, `stop` operate on the whole
  project, so you tear the entire environment down cleanly (including its network).

Compose is now **Compose V2**, a Go plugin invoked as `docker compose` (subcommand,
space) rather than the legacy Python `docker-compose` (hyphen) binary. V2 implements
the open **Compose Specification**, which merged the old `version: "2"` and
`version: "3"` schemas into one.

> [!INTERVIEW]
> If asked "what problem does Compose solve," don't say "it runs containers" — Docker
> already does that. Say: "it lets me define a **multi-container app declaratively**
> and manage it as one unit — networking, dependency order, volumes, and config in a
> single version-controlled file, reproducible across machines."

---

## Compose vs Dockerfile

These are complementary, not alternatives, and confusing them is a classic interview
tell.

| | **Dockerfile** | **compose.yaml** |
|---|---|---|
| Purpose | **Builds one image** from source | **Runs/orchestrates many containers** |
| Verb | `docker build` | `docker compose up` |
| Scope | A single image's filesystem + metadata | The whole app: services, networks, volumes |
| Answers | "How is this image assembled?" | "How do these containers run together?" |
| Runtime concepts | none (build time only) | ports, env, depends_on, networks, scaling |

A `compose.yaml` service can *point to* a Dockerfile via a `build:` section, or *use*
a prebuilt `image:`. Build is one input to Compose; Compose does the wiring.

```yaml
services:
  web:
    build: ./web          # <- uses a Dockerfile to build the web image
  db:
    image: postgres:16    # <- uses a prebuilt image from a registry
```

> [!WARNING]
> A Dockerfile cannot express "start the DB, then the API, on a shared network with
> these env vars." That is orchestration, and it lives in Compose. Conversely,
> Compose does not replace the Dockerfile — you still need one to build custom
> images.

---

## compose.yaml structure

A Compose file is a map of **top-level elements**. The four you use constantly are
`services`, `networks`, `volumes`, and (for sensitive data) `secrets`/`configs`.

```yaml
services:            # the containers that make up the app (required)
  api:
    build: .
    ports: ["8080:8080"]
    environment:
      DB_HOST: db
    depends_on:
      db:
        condition: service_healthy
    networks: [backend]
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks: [backend]

networks:            # user-defined networks (optional; a default is auto-created)
  backend:

volumes:             # named volumes managed by Docker (optional)
  pgdata:
```

- **`services`** — the heart of the file; each key is a service name and its value
  configures one container (or many replicas). Nearly all `docker run` flags have an
  equivalent here.
- **`networks`** — declares custom networks. If you omit this, Compose creates a
  single **default network** and attaches every service to it.
- **`volumes`** — declares **named volumes** whose lifecycle Compose manages, so data
  survives container recreation.
- **`configs` / `secrets`** — inject non-secret and secret files into containers
  without baking them into images.

> [!WARNING]
> The top-level **`version:` field is obsolete**. Modern Compose ignores it and will
> warn. Do not add `version: "3.8"` to new files — the Compose Specification is
> versionless; you just write `services:` at the top.

---

## Defining a multi-container app declaratively

"Declaratively" means you describe the **desired end state**, not a sequence of
imperative commands. Compose diffs desired vs actual and makes the minimum changes.

Example: an API, a Postgres database, and a Redis cache.

```yaml
services:
  api:
    build: ./api
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/app
      REDIS_URL: redis://cache:6379
    depends_on:
      db:  { condition: service_healthy }
      cache: { condition: service_started }
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: app
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      timeout: 3s
      retries: 5
    volumes: [pgdata:/var/lib/postgresql/data]
  cache:
    image: redis:7

volumes:
  pgdata:
```

`docker compose up -d` creates a network, the `pgdata` volume, pulls/builds images,
and starts containers in dependency order. Re-running after editing only the `api`
build recreates *just* the `api` container — the DB and its data are untouched. That
minimal-change reconciliation is the payoff of the declarative model.

---

## Service discovery and the default network

When Compose starts a project it creates a **default bridge network** and attaches
every service to it. Docker runs an **embedded DNS server** (at `127.0.0.11` inside
each container) that resolves **service names to the container's IP**. So services
talk to each other by **service name**, never by IP.

```yaml
services:
  api:
    image: myapp
    environment:
      DB_HOST: db          # <- just the service name; DNS resolves it
  db:
    image: postgres:16
```

Inside the `api` container, `ping db` or connecting to `db:5432` works because Docker
DNS maps `db` to the database container's current IP. This is robust across restarts
(IPs change, names don't).

Key details:

- Resolution is **scoped to the shared network**. If two services are on *different*
  custom networks with no common network, they cannot resolve each other.
- The old `links:` directive is legacy — you don't need it; DNS on the default network
  handles discovery.
- You can add extra DNS names with `aliases` under a network, and reach the host from
  a container via `host.docker.internal` (Docker Desktop; add
  `extra_hosts: ["host.docker.internal:host-gateway"]` on Linux).

> [!TIP]
> A very common bug: an app config points at `localhost:5432` for the DB. Inside a
> container `localhost` is the container *itself*, not the DB. The fix is to use the
> **service name** (`db:5432`), because that's what Compose DNS resolves.

---

## Networks per service

By default all services share one network, so everything can reach everything. For
isolation you define **multiple named networks** and attach services selectively —
e.g., keep the database off the network that faces the outside proxy.

```yaml
services:
  proxy:
    image: nginx
    networks: [frontend]
  api:
    build: ./api
    networks: [frontend, backend]   # bridges both tiers
  db:
    image: postgres:16
    networks: [backend]             # NOT reachable from proxy

networks:
  frontend:
  backend:
```

Here `proxy` can reach `api` (shared `frontend`), `api` can reach `db` (shared
`backend`), but `proxy` cannot reach `db` — there is no common network. This is a
simple, effective way to reduce blast radius.

Network options you'll see: `driver: bridge` (default single-host), `internal: true`
(no external/outbound access — a locked-down backend), and `driver: host`/`none`.
`external: true` attaches to a pre-existing network Compose did not create.

> [!INTERVIEW]
> "How would you stop the web tier from talking directly to the database?" — Answer
> with **network segmentation**: put the DB only on a `backend` network that the edge
> proxy is not attached to. It shows you understand Compose networking beyond "it just
> works."

---

## depends_on: ordering, not readiness

`depends_on` controls **the order in which Compose starts and stops containers**. If
`api` depends on `db`, Compose starts `db` first. **But by default it only waits for
the dependency's container to be *started* (running), not *ready* to serve traffic.**

```yaml
services:
  api:
    depends_on:
      - db        # short form == condition: service_started
```

The trap: Postgres's container can be "running" while the database engine is still
initializing and refusing connections. `api` starts, tries to connect, and crashes.
`depends_on` did its job (order) but not what people assume (readiness).

The long form adds **conditions**:

| Condition | Waits until the dependency… |
|---|---|
| `service_started` | container has started (default; the weak guarantee) |
| `service_healthy` | passes its **healthcheck** (true readiness) |
| `service_completed_successfully` | ran to completion with exit code 0 (e.g. a migration/seed job) |

```yaml
services:
  api:
    depends_on:
      db:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
```

> [!WARNING]
> Writing `depends_on: [db]` and expecting the DB to be *query-ready* is one of the
> most common Compose mistakes. Either use `condition: service_healthy` (needs a
> healthcheck on `db`), or make your app **retry the connection with backoff** — the
> latter is the more portable, production-grade habit.

---

## Healthchecks and waiting for readiness

A **healthcheck** is a command Compose (via the Docker engine) runs periodically
inside a container to decide if it is `healthy` or `unhealthy`. It's the mechanism
that makes `depends_on: condition: service_healthy` meaningful.

```yaml
services:
  db:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s        # time between checks
      timeout: 3s         # a check taking longer than this = fail
      retries: 5          # consecutive fails before status flips to unhealthy
      start_period: 30s   # grace window: failures here don't count toward retries
```

Fields and states:

- `test` — a list starting with `CMD` (exec form, no shell) or `CMD-SHELL` (run via
  the shell, so you can use pipes/`$`), or `NONE`/`disable: true` to turn off an
  image-baked healthcheck.
- **States:** `starting` → `healthy` or `unhealthy`. During `start_period` the
  container is `starting` and failures are not counted, so slow-booting services
  aren't marked unhealthy prematurely.
- `start_interval` lets you probe more frequently during the start period.

A container being `unhealthy` does **not** by itself restart it in plain Compose — you
pair it with a restart policy or an orchestrator. Kubernetes consumes the same idea as
**liveness/readiness probes** (covered in the kubernetes domain); mention that
lineage if asked.

> [!TIP]
> Use the *dependency's own* tooling for the check (`pg_isready`, `redis-cli ping`, a
> `GET /healthz`), not just "is the port open." Port-open ≠ app-ready.

---

## build vs image

Every service must resolve to an **image**. There are two ways to get one:

- **`image:`** — use a prebuilt image (pull from a registry / use local cache).
- **`build:`** — build an image from a Dockerfile in the given context.

```yaml
services:
  api:
    build:
      context: ./api
      dockerfile: Dockerfile
      args:
        NODE_ENV: production
    image: myorg/api:dev     # optional: name/tag the built image
  db:
    image: postgres:16       # no build; pulled from Docker Hub
```

Behavior when both `build:` and `image:` are present: Compose **builds** the image and
**tags it** with the `image:` name (it does not pull). With only `build:`, Compose
names the image after the project/service. `pull_policy` controls pulling
(`missing` default; `build` when a build section exists; `always`; `never`).

- `docker compose build` builds without starting.
- `docker compose up --build` rebuilds images before starting.
- `docker compose up` alone will build a service the *first* time (if its image is
  absent) but will **not** rebuild on later runs just because source changed — you
  must pass `--build`.

> [!WARNING]
> Editing source and running `docker compose up` (without `--build`) and wondering why
> your change isn't there is a classic gotcha. Compose reuses the existing image. Use
> `--build`, or mount your source as a volume in dev so you don't rebuild at all.

---

## Ports and expose

Two different things, often confused:

- **`ports:`** publishes a container port to the **host** — makes it reachable from
  outside Docker (your laptop, the internet). This is a port *mapping*.
- **`expose:`** documents/opens a port for **other containers on the same network**
  only; it is **not** published to the host.

```yaml
services:
  api:
    ports:
      - "8080:80"          # HOST:CONTAINER  -> host 8080 -> container 80
      - "127.0.0.1:9090:9090"  # bind to loopback only (not all interfaces)
    expose:
      - "9000"             # visible to peers on the network, not to the host
```

Short syntax is `HOST:CONTAINER`. If you write a single number like `"80"` it means
container port 80 published to a **random** host port. Long syntax spells it out and
is clearer for scaling/protocols:

```yaml
    ports:
      - target: 80         # container port
        published: 8080    # host port
        protocol: tcp
        mode: host
```

> [!TIP]
> Inter-service traffic does **not** require `ports:`. Services reach each other over
> the Compose network on the container's own port regardless of publishing. You only
> publish ports that a human/external client must hit. Publishing needlessly widens
> your attack surface. Bind to `127.0.0.1:` when you only need local access.

> [!WARNING]
> When you **scale** a service (`--scale api=3`), you cannot give every replica the
> same fixed host port (`8080:80`) — the host port collides. Use a range
> (`ports: ["8080-8082:80"]`), let Docker assign random host ports (`- "80"`), or
> front the replicas with a proxy/load balancer.

---

## Volumes and data persistence

Containers are ephemeral: delete one and its writable layer is gone. To persist data
(a database) or share code (dev), Compose services use **volumes** and **bind
mounts**.

```yaml
services:
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data   # named volume (managed by Docker)
  web:
    build: .
    volumes:
      - ./src:/app/src                     # bind mount (host path -> container)
      - /app/node_modules                  # anonymous volume to shield deps

volumes:
  pgdata:                                   # declare the named volume
```

- **Named volumes** (`pgdata:`) are managed by Docker, declared under top-level
  `volumes:`, and **survive `docker compose down`** — you must run
  `docker compose down -v` to delete them. Use these for databases.
- **Bind mounts** (`./src:/app/src`) map a host directory in; edits on the host appear
  instantly in the container. Ideal for **development** hot-reload; discouraged in prod
  (couples the container to host layout).
- Deep dive on drivers, CoW, and `:ro`/`tmpfs` lives in the `volumes-and-storage`
  topic; here the point is *how services declare them*.

> [!WARNING]
> `docker compose down` removes containers and the default network but **keeps named
> volumes** by design (so you don't nuke your database). Losing data usually means
> someone ran `down -v` or was writing to the container's writable layer instead of a
> volume.

---

## environment, env_file, and .env substitution

There are **three distinct** mechanisms, and interviewers love to check you don't
conflate them.

**1. `environment:` — variables set *inside the container*:**

```yaml
services:
  api:
    environment:
      LOG_LEVEL: debug
      DB_HOST: db
```

**2. `env_file:` — load container env vars from a file:**

```yaml
services:
  api:
    env_file:
      - ./api.env         # KEY=VALUE lines injected into the container
```

**3. Variable substitution in the compose file itself, from a `.env` file:**

Compose automatically reads a file named **`.env`** in the project directory and uses
it to **interpolate `${VAR}` references *in the YAML*** before parsing.

```yaml
# .env  ->  TAG=1.4.2   POSTGRES_PASSWORD=secret
services:
  api:
    image: myorg/api:${TAG}                 # becomes myorg/api:1.4.2
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
```

Substitution supports defaults and required checks: `${VAR:-default}` (use default if
unset/empty), `${VAR:?error message}` (fail if unset).

> [!WARNING]
> The auto-loaded **`.env` is for interpolating the compose file**, and it is *not*
> the same as `env_file:`, which injects vars *into a container*. A `.env` value only
> reaches the container if you explicitly pass it (e.g.
> `environment: { X: ${X} }`) or reference the file with `env_file:`. Precedence
> (highest → lowest): `docker compose run --env` on the CLI > a value interpolated
> into `environment:`/`env_file:` from your shell/`.env` > a **static** value in
> `environment:` > `env_file:` > the image's `ENV`. A common misconception is that the
> host shell always wins: it does **not**. A static `environment: FOO=bar` beats a
> shell `FOO`; the shell value only reaches the container when the file passes it
> through (a bare `environment: [FOO]` or `${FOO}` interpolation).

---

## Scaling services

Compose can run **multiple replica containers of one service** on the single host.

```bash
docker compose up -d --scale worker=4
```

or declaratively via `deploy.replicas` (and the equivalent `scale:` key):

```yaml
services:
  worker:
    image: myorg/worker
    deploy:
      replicas: 4
```

All replicas share the service name in DNS; Docker's embedded DNS **round-robins**
across the replica IPs, giving basic client-side load spreading. Constraints:

- You **cannot** publish a **fixed** host port on a scaled service (port collision) —
  use a port range or random ports and put a proxy in front.
- Scaling is **single-host** — every replica runs on the same machine, so it doesn't
  give you HA across nodes. Horizontal scaling across machines is Kubernetes/Swarm
  territory.

> [!INTERVIEW]
> "Can Compose scale?" — Yes, replicas on one host, DNS round-robin. But be precise:
> it's **not** multi-node autoscaling. If they push on production HA, pivot to "that's
> where an orchestrator like Kubernetes comes in."

---

## Profiles

**Profiles** let you keep optional services in the same file but only start them when
a profile is activated. Great for tools (a DB admin UI, a seed job, a debugger) you
don't want running by default.

```yaml
services:
  api:
    image: myorg/api            # no profile -> always starts
  db:
    image: postgres:16          # always starts
  pgadmin:
    image: dpage/pgadmin4
    profiles: [tools]           # only starts when 'tools' profile is on
  seed:
    image: myorg/seed
    profiles: [debug, tools]
```

- Services with **no** `profiles` always start.
- Services *with* profiles start only when activated: `docker compose --profile tools
  up`, or `COMPOSE_PROFILES=tools,debug docker compose up`.
- Naming a service explicitly (`docker compose up pgadmin`) also pulls it in along with
  its profile.

This keeps one file for the whole team without forcing everyone to run heavyweight
optional services.

---

## Override files and merging

Compose can **merge multiple files**, layering configuration. This is how you keep one
base topology and adjust it per environment without duplicating the whole file.

- By default Compose auto-loads **`compose.yaml`** *and*, if present,
  **`compose.override.yaml`**, merging the override on top.
- You can specify files explicitly and **in order** with `-f`; later files win:

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d
```

Merge semantics: for **scalars** (like `image`, a single port), the later value
**replaces** the earlier. For **sequences** (like `ports`, `volumes`), values are
**appended/combined**, not replaced. Mappings (like `environment`) are merged key by
key.

```yaml
# compose.yaml (base)
services:
  api:
    build: .
    environment: { LOG_LEVEL: info }
# compose.prod.yaml (override)
services:
  api:
    image: myorg/api:1.4.2      # replaces build behavior for prod
    environment: { LOG_LEVEL: warn }   # LOG_LEVEL overridden; other keys merged
```

> [!TIP]
> The idiom: `compose.yaml` holds the shared topology, `compose.override.yaml` holds
> **dev** conveniences (bind-mount source, expose debug ports) and is auto-applied
> locally, while `compose.prod.yaml` is applied explicitly in deployment. Same base,
> different tops.

---

## Dev vs prod compose

Compose is used across the lifecycle, but the *config* differs sharply between local
development and a deployed environment.

| Concern | Dev compose | Prod compose |
|---|---|---|
| Image | `build:` from local source | `image:` a pinned, pre-built tag |
| Source | **bind-mount** `./src` for hot reload | baked into the image, no mount |
| Ports | publish freely for debugging | publish only what's needed, bind loopback/proxy |
| Env/secrets | `.env` files, plaintext ok | secrets manager / Docker secrets, not in git |
| Restart | rarely | `restart: unless-stopped`/`always` |
| Extras | pgAdmin, mailhog via `profiles` | omitted |

You express this split with **override files** (base + `override` for dev + `prod`
file) and/or **profiles**, so the topology stays DRY.

> [!WARNING]
> Bind-mounting source (`./:/app`) is a *dev* pattern. Shipping it to prod means the
> running code depends on files on the host, defeating the immutable-image guarantee.
> Prod should run the **built image** with no source mount.

---

## Compose is single-host

Compose provisions and manages containers on **one Docker host** (the machine running
the engine). It has **no scheduler, no multi-node networking, no self-healing across
machines, and no autoscaling**. That is by design — it's a development/CI and small-
deployment tool.

When requirements grow to:

- running across **many nodes** with a scheduler placing containers,
- **self-healing** (reschedule on node failure), rolling updates, autoscaling,
- cluster-wide service networking and load balancing,

…you graduate to an **orchestrator — Kubernetes** (its own domain in this library) or
Docker Swarm. Notably, the same **healthcheck** concept you wrote for Compose maps to
Kubernetes **liveness/readiness probes**, and Compose `services` map conceptually to
K8s Deployments/Services — but the orchestration model is fundamentally multi-host.

> [!INTERVIEW]
> A crisp senior answer: "Compose is the right tool for local dev, integration tests,
> CI, and single-node deployments. The moment I need multi-node scheduling, rolling
> updates, and self-healing, that's a signal to move to Kubernetes — Compose
> deliberately stops at one host."

---

## Common follow-up questions

- **"Why did my app crash on `up` even though `depends_on` lists the DB?"** —
  `depends_on` only waits for the container to *start*, not to be *ready*. Use
  `condition: service_healthy` with a healthcheck, or add connection retries in the
  app.
- **"How do two services talk to each other?"** — By **service name** over the shared
  Compose network via Docker's embedded DNS (`127.0.0.11`); no IPs, no `links`.
- **"My code change didn't show up after `docker compose up`."** — Compose reused the
  existing image; run `docker compose up --build`, or bind-mount source in dev.
- **"Difference between `ports` and `expose`?"** — `ports` publishes to the host;
  `expose` only advertises to other containers on the network.
- **"What's the difference between the `.env` file and `env_file:`?"** — `.env`
  interpolates `${VAR}` in the compose file itself; `env_file:` injects variables into
  a container.
- **"Does `docker compose down` delete my database?"** — No, named volumes survive;
  `down -v` deletes them.
- **"Can Compose scale / do HA?"** — Replicas on one host with DNS round-robin, yes;
  multi-node HA/autoscaling, no — that's Kubernetes.
- **"Is `version: '3.8'` required?"** — No, it's obsolete in the Compose
  Specification; omit it.
- **"How do I keep dev and prod config in one place?"** — Override files (base +
  override/prod) and profiles.

## References

- Docker docs — Compose overview & the Compose Specification:
  <https://docs.docker.com/compose/> and
  <https://docs.docker.com/reference/compose-file/>
- Compose file `services` reference (depends_on, healthcheck, build, ports, profiles):
  <https://docs.docker.com/reference/compose-file/services/>
- Networking in Compose (default network, service DNS, custom networks):
  <https://docs.docker.com/compose/how-tos/networking/>
- Control startup and shutdown order (depends_on conditions):
  <https://docs.docker.com/compose/how-tos/startup-order/>
- Environment variables & interpolation (`.env`, `env_file`, precedence):
  <https://docs.docker.com/compose/how-tos/environment-variables/>
- Multiple Compose files / merge & override:
  <https://docs.docker.com/compose/how-tos/multiple-compose-files/>
- Using profiles:
  <https://docs.docker.com/compose/how-tos/profiles/>
- Kubernetes probes (readiness/liveness — the orchestrator equivalent of
  healthchecks): see the `kubernetes` domain in this library.
