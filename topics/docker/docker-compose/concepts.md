# Docker Compose & Multi-Container Apps

Topic 7 left a container answering to its own name the instant Compose creates it — long before the process inside has bound its port. That gap between a name that already resolves and a service that is actually *ready* is where this topic bites, and [depends_on: ordering, not readiness](#depends_on-ordering-not-readiness) is where it settles.

You write one `compose.yaml`, run `docker compose up`, and a five-line file brings up an API, a Postgres database on `postgres:16`, and a Redis cache: one network, the right start order, data that survives a restart. Then on the very first boot the API dies with `connection refused` — Postgres is "up" but not yet taking queries. That one symptom holds the whole topic. This page answers how a single declarative file describes a multi-container app on one host, and where "described" quietly stops meaning "working."

> [!TIP]
> **Reading map.** About 20 minutes. The first six sections build the model: one file, one network, services that find each other by name. If you already run Compose daily, skip to [depends_on: ordering, not readiness](#depends_on-ordering-not-readiness) and [environment, env_file, and .env substitution](#environment-env_file-and-env-substitution) — those two are where careful engineers still get caught. Everything before them is the model those catches rest on.

---

## What Docker Compose is

Docker Compose reads one YAML file — `compose.yaml` by default, or the older `docker-compose.yml` — that describes a set of containers and how they relate. It then creates and runs them together as a single unit it calls a **project**: a named group of containers, networks and volumes with one shared lifecycle. Instead of typing a dozen `docker run` commands by hand, each with its own flags for networks, volumes, ports and environment, you declare the end state once and run `docker compose up`.

Three things follow from managing the stack as one project rather than as loose containers. The whole topology — API, database, cache — lives version-controlled in a single file, so any teammate who runs `docker compose up` gets the identical stack. You describe *what* you want and Compose works out *how*: it creates the network, pulls or builds images, starts containers in dependency order, and recreates only the containers that changed. And the lifecycle verbs — `up`, `down`, `logs`, `ps`, `stop` — act on the whole project at once, so you tear the environment down cleanly, network included. The honest answer to "what problem does Compose solve" is not "it runs containers" — Docker already does that — but "it defines a multi-container app declaratively and manages it as one reproducible unit."

The command itself has two spellings, and the difference is not cosmetic. Modern Compose is **Compose V2** — a Go plugin invoked as `docker compose`, a subcommand with a space. The legacy `docker-compose` (one word, a hyphen) was a separate Python binary, now end-of-life. V2 implements the open Compose Specification, which folded the old `version: "2"` and `version: "3"` schemas into one versionless format.

Compose builds or pulls an image for every service, and that one step is where it is most often confused with the Dockerfile.

---

## Compose vs Dockerfile

A Dockerfile and a `compose.yaml` answer two different questions, so they stack on top of each other rather than competing. `docker build` turns a source directory into *one* image — a filesystem plus metadata. `docker compose up` takes images, built or pulled, and runs *many* containers together: the network between them, the ports they publish, the environment they see, the order they start in. Build is one input; Compose does the wiring.

| | Dockerfile | compose.yaml |
|---|---|---|
| Purpose | Builds one image from source | Runs and orchestrates many containers |
| Verb | `docker build` | `docker compose up` |
| Scope | One image's filesystem + metadata | The whole app: services, networks, volumes |
| Answers | "How is this image assembled?" | "How do these containers run together?" |
| Runtime concepts | none (build time only) | ports, env, depends_on, networks, scaling |

A Dockerfile has no way to say "start the database, then the API, on a shared network, with these environment variables." That whole sentence is orchestration, and orchestration lives in Compose. The reverse holds just as firmly: Compose does not replace the Dockerfile, because something still has to turn your source into the image a service runs. A service in the file therefore either points at a Dockerfile through a `build:` section or names a prebuilt `image:`.

```yaml
services:
  web:
    build: ./web          # <- uses a Dockerfile to build the web image
  db:
    image: postgres:16    # <- uses a prebuilt image from a registry
```

Every service resolves to one image that way, and all those service definitions share a fixed file shape worth pinning down next.

---

## compose.yaml structure

A Compose file is a map of top-level keys, and exactly one of them is required: `services`. The rest — `networks`, `volumes`, and the pair `configs`/`secrets` for injected files — are optional, and Compose supplies a sensible default whenever you leave one out.

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

Read that file top to bottom. `services` is the heart of it: each key under it is a service name, its value configures one container or several replicas, and nearly every `docker run` flag has an equivalent here. `networks` declares custom networks; leave it out and Compose still creates one default network and attaches every service to it, so services can reach each other out of the box. `volumes` declares named volumes whose lifecycle Docker manages, so their data outlives any single container. `configs` and `secrets` hand non-secret and secret files to containers without baking them into the image.

One top-level key you should *not* write is `version:`. The field is obsolete: the Compose Specification is versionless, so a current Compose ignores a `version: "3.8"` line and prints a warning instead of acting on it. New files start straight at `services:`.

Compose supplies those defaults; the next question is what "declaring the end state" actually does the moment you run it.

---

## Defining a multi-container app declaratively

Declaring a stack means writing down the end state you want and letting Compose reach it, rather than scripting the steps yourself — and the real payoff appears the *second* time you run it. Here is an API, a Postgres database, and a Redis cache in one file:

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

`docker compose up -d` reads that and does the imperative work for you: it creates a network, creates the `pgdata` volume, pulls or builds each image, and starts the containers in dependency order. Nothing surprising yet — a shell script could do the same on a clean machine.

The difference shows on the *next* run. Edit only the `api` build and run `up` again: Compose compares the end state you declared against what is already running, and recreates just the `api` container, leaving the database and every byte in its volume untouched. Recreating only what changed — **minimal-change reconciliation** — is the whole reason the declarative model earns its keep; on a stack of ten services you never rebuild the nine you did not touch.

Tearing it down is symmetric. `docker compose down` stops and removes the project's containers and the network it created, but by design it *keeps* named volumes, so your database survives a `down`/`up` cycle. Deleting the data is a separate, explicit `down -v`, covered under volumes below.

Compose can reach that end state only if the containers can find each other, which is what the shared network and its DNS are for.

---

## Service discovery and the default network

Hardcode a fixed address like `172.18.0.5` into your API and the first container restart breaks it, because Docker hands out new IPs freely. Compose's answer is to let a container be reached by the name you gave it in the file: the key you wrote under `services:`, which Compose registers with the engine as a network alias. That key is the **service name**: the name Compose registers so peers can find the container. It resolves just like a container name would — point the API at `db:5432` and the connection lands, restart after restart.

```yaml
services:
  api:
    image: myapp
    environment:
      DB_HOST: db          # <- just the service name; DNS resolves it
  db:
    image: postgres:16
```

Why the name resolves at all comes from topic 7. When Compose starts the project it attaches every service to one shared network and runs an embedded DNS server inside it — the resolver lives at `127.0.0.11` in each container. Inside the `api` container, `ping db` or a connection to `db:5432` asks that resolver, which maps `db` to the database container's current IP. The IP churns across restarts; the service name does not, which is exactly why you never write an address down.

### Where it breaks: localhost, `links`, and reaching the host

The name resolves only for peers on a shared network, and three sharp edges follow from that.

First, `localhost` inside a container means the container *itself* — not the host, not a peer. A config that points the API at `localhost:5432` for its database is the most common Compose networking bug there is: the API dials its own empty port 5432 and gets connection refused. The fix is the service name, `db:5432`, because that is the name Compose DNS actually resolves.

Second, resolution is scoped to the shared network. Put two services on different custom networks with nothing in common and neither can resolve the other — the name is simply absent from the other network's DNS. The next section turns that limit into a security feature.

Third, the old `links:` directive is legacy. It once wired up name resolution by hand; on the default network DNS does that for you, so `links:` is dead weight. You can still register extra names for a service with `aliases` under a network.

Reaching *out* to the host machine is the mirror image of the `localhost` trap. From inside a container the host is not `localhost` either. Docker Desktop resolves the special name `host.docker.internal` to the host automatically, and on plain Linux you map that name to the gateway yourself with `extra_hosts: ["host.docker.internal:host-gateway"]`. It needs a special name for the same reason `localhost` failed: the container's own loopback is not the host's.

One shared network lets everything reach everything, which is convenient in development and a liability the moment you want the database sealed off.

---

## Networks per service

By default every service lands on the one default network, so everything can reach everything — fine for three friendly services, dangerous once one of them faces the public internet. Split the app across multiple named networks and attach each service only to the ones it needs, and you get to decide who can reach whom. The classic move keeps the database off the network that faces the outside proxy:

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

Trace the reachability. `proxy` and `api` share `frontend`, so the proxy can reach the API. `api` and `db` share `backend`, so the API can reach the database. But `proxy` and `db` share *nothing*, so the proxy cannot reach the database at all — there is no network on which its name even resolves. That is **network segmentation**: the edge of the app is given no route to the data. The point of it is to reduce blast radius — the damage one compromised component can do. An attacker who takes over the internet-facing proxy still cannot open a connection to the database, because the wire between them does not exist.

A few network keys shape this further. `driver: bridge` is the default single-host driver; `driver: host` puts a container on the host's own network stack directly, while `none` gives it no networking at all. `internal: true` marks a network with no route to the outside world, so a locked-down backend can talk internally yet make no outbound connections. `external: true` attaches services to a network that already exists — one Compose did not create and will not delete. Together they answer one question: which services can even see each other, before any of them says a word.

Segmentation decides *who* may connect; it says nothing about *when* a dependency is ready to accept the connection, which is the next control and the most misunderstood one in Compose.

---

## depends_on: ordering, not readiness

`depends_on` controls the order in which Compose starts and stops containers, and nothing more. Declare that `api` depends on `db` and Compose starts `db` first — but by default it waits only for the `db` container to be *running*, not for the database inside it to be ready to answer. This is the gap topic 7 pointed at. The name `db` resolves the instant its container is created, and `depends_on` clears the instant that container starts — both long before Postgres is actually taking queries.

```yaml
services:
  api:
    depends_on:
      - db        # short form == condition: service_started
```

So the failure is completely ordinary. The `db` container is "running" while the engine inside is still starting up — initializing its data directory on a first boot, or replaying its write-ahead log after a restart — and refusing connections; `api` starts on schedule, dials `db:5432`, gets connection refused, and crashes. `depends_on` did precisely its job, start order, and none of the job people assume it does — which is **readiness**: the property that a service is not merely running but able to serve. A resolvable name and a started container are both weaker than readiness.

The long form narrows the gap by letting you wait on a *condition* rather than mere start:

| Condition | Waits until the dependency… |
|---|---|
| `service_started` | its container has started — the default, and the weak guarantee |
| `service_healthy` | passes its health check, which is genuine readiness |
| `service_completed_successfully` | ran to completion with exit code 0, e.g. a migration or seed job |

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
> Writing `depends_on: [db]` and expecting the database to be *query-ready* is one of the most common Compose mistakes there is. Only two things fix it: wait on `condition: service_healthy`, which requires a health check on `db`, or make the application retry its own connection with backoff. Reach for the retry first; the next paragraph is why.

### Where it breaks: even a healthy dependency is not a contract

Even `condition: service_healthy` only tells you the dependency passed its check at the one moment `api` started. A database can pass its health check, take `api`'s first queries, then drop every connection an hour later during a failover, a restart, or a brief overload — and `depends_on` stopped watching the instant the gate opened. A passing check is a one-time gate at startup, never a standing promise.

For that reason an application that retries its own connections, with backoff, beats any `depends_on` condition. Retry survives the startup race *and* the mid-life blip; it needs no health check on the dependency at all; and it behaves identically whether you run under Compose, Kubernetes, or a bare `docker run`. Read `depends_on` as a convenience for ordering the first boot, and connection retry as the thing that actually keeps the API alive.

`condition: service_healthy` leans entirely on the dependency having a health check, so the next question is what a health check is and how to write one that genuinely means "ready."

---

## Healthchecks and waiting for readiness

A health check is the mechanism sitting behind `service_healthy`: a command the Docker engine runs periodically *inside* a container to decide whether it is `healthy` or `unhealthy`. You supply a command that succeeds only when the service can truly do its job, and Compose reports the container's health from that command's exit code. Leave it out and `condition: service_healthy` has nothing to test against.

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

The fields split into "how to test" and "how patient to be." `test` is the command, written one of three ways. `CMD` runs it directly, in exec form with no shell. `CMD-SHELL` runs it through a shell, so you can use pipes and `$` expansion. `NONE` or `disable: true` turns off a check baked into the image. Then `interval`, `timeout`, and `retries` set the rhythm: how often to probe, how long one probe may take before it counts as a failure, and how many failures in a row flip the status to `unhealthy`.

`start_period` is the field that catches people. A container's health begins at `starting` and then resolves to `healthy` or `unhealthy`. Inside the `start_period` window, failing checks do *not* count toward `retries`, so a database that takes thirty seconds to come up is not marked unhealthy for being slow to boot. `start_interval` lets you probe more often during that window, so a service that becomes ready early gets noticed early.

Two things about a health check surprise people by their absence. A container going `unhealthy` does not, on its own, restart it in plain Compose — you pair the check with a restart policy or hand the job to an orchestrator. And the check is only as honest as its command. Probe with the dependency's own tooling — `pg_isready`, `redis-cli ping`, a `GET /healthz` — not just "is the TCP port open." A port can be open while the app behind it still returns errors, so port-open is not app-ready. Kubernetes consumes this same idea as liveness and readiness probes, in its own domain in this library; the health check you write here is the concept those probes formalize.

A health check assumes there is already an image to run the command inside, so the next section is the two ways a service gets that image and the gotcha hiding in the choice.

---

## build vs image

Every service has to resolve to an image, and there are exactly two ways to get one — which is why a service with *neither* `build:` nor `image:` is invalid and Compose rejects it. `image:` names a prebuilt image to pull from a registry or take from the local cache. `build:` points at a Dockerfile and a build context and produces the image on the spot.

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

When both keys appear, Compose does one specific thing: it builds the image and tags it with the `image:` name, and it does not pull. With only `build:`, the built image is named after the project and the service. The `pull_policy` key decides when Compose reaches for the registry — `missing` (the default) pulls only if the image is absent, `build` forces a build when a build section exists, `always` pulls every time, and `never` fails rather than pull.

The commands divide along the same seam. `docker compose build` builds images without starting anything. `docker compose up --build` rebuilds before it starts. Plain `docker compose up` builds a service only the *first* time, when no image for it exists yet. After that it reuses the image it has and will not rebuild merely because your source changed.

> [!WARNING]
> Editing your source, running `docker compose up`, and wondering why the change is missing is the classic Compose gotcha: `up` reused the image it built last time. Force a fresh build with `docker compose up --build`, or bind-mount your source in development so there is no image to rebuild at all.

Once a service is running from its image, the next question is which of its ports the outside world can actually reach.

---

## Ports and expose

`ports:` and `expose:` look alike and do different jobs. `ports:` publishes a container port to the host, making it reachable from outside Docker entirely — your laptop, and anything that can route to your laptop. `expose:` only advertises a port to other containers on the same network and publishes nothing to the host. The first opens a door to the world; the second is a note to peers.

```yaml
services:
  api:
    ports:
      - "8080:80"          # HOST:CONTAINER  -> host 8080 -> container 80
      - "127.0.0.1:9090:9090"  # bind to loopback only (not all interfaces)
    expose:
      - "9000"             # visible to peers on the network, not to the host
```

The short port syntax reads `HOST:CONTAINER` — host port on the left, container port on the right — and reversing it silently publishes the wrong port, so it is worth getting right. A single bare number like `"80"` means "publish container port 80 to a *random* host port." The long syntax spells every field out and reads more clearly once you scale or need a specific protocol:

```yaml
    ports:
      - target: 80         # container port
        published: 8080    # host port
        protocol: tcp
        mode: host
```

### Where it breaks: publishing wider than you need

Two rules keep the published surface as small as it should be. First, services on the same Compose network reach each other on the container's own port whether or not it is published. Inter-service traffic never needs `ports:`, so you publish only the ports a human or an external client must hit. Every extra published port is attack surface for no gain. Writing `127.0.0.1:9090:9090` instead of `9090:9090` keeps a port reachable from the local machine while hiding it from every other interface.

The second rule bites when you scale. Give a service three replicas with `--scale api=3` and you cannot hand all three the same fixed host port like `8080:80`, because the host has exactly one port 8080 and the second replica collides on it. The fixes are to publish a range (`ports: ["8080-8082:80"]`), let Docker assign random host ports (`- "80"`), or, in practice, put a proxy in front and publish only the proxy.

Publishing decides what is reachable from outside; the next section is how a container keeps any data at all once it stops.

---

## Volumes and data persistence

A container's writable layer is disposable: delete the container and everything written inside it is gone with it. To keep data across that deletion — a database's files — or to share code into a running container during development, a Compose service mounts storage from outside the container, as either a named volume or a bind mount.

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

A named volume (`pgdata:`) is storage Docker creates and looks after, declared under the top-level `volumes:` key, and it survives `docker compose down` — exactly what a database needs. A bind mount (`./src:/app/src`) maps a directory on the host straight into the container, so an edit on the host appears inside instantly. Live host edits make it ideal for development hot-reload and a poor choice for production, where it chains the running container to the host's directory layout. The anonymous volume `/app/node_modules` in the example keeps the source bind mount from hiding the dependencies the image already installed. The full story on drivers, copy-on-write, and `:ro`/`tmpfs` mounts lives in the `volumes-and-storage` topic; here the point is only how a service declares them.

> [!WARNING]
> `docker compose down` removes the containers and the default network but deliberately keeps named volumes, so a routine `down` never nukes your database. Losing data almost always means someone ran `down -v`, which does delete them, or was writing to the container's disposable writable layer instead of into a volume.

Storage decides what survives a restart; configuration decides what the app reads on each start, which is where environment variables and their surprising precedence come in.

---

## environment, env_file, and .env substitution

Three different mechanisms decide what values a service sees, and they get muddled because two of them mention "env" and the third edits the compose file itself.

The first, `environment:`, sets variables *inside the container* directly:

```yaml
services:
  api:
    environment:
      LOG_LEVEL: debug
      DB_HOST: db
```

The second, `env_file:`, loads those same in-container variables from a file of `KEY=VALUE` lines instead of listing them inline:

```yaml
services:
  api:
    env_file:
      - ./api.env         # KEY=VALUE lines injected into the container
```

The third is different in kind. Compose automatically reads a file named `.env` in the project directory and uses it to interpolate `${VAR}` references *in the YAML itself*, before parsing. So `.env` changes what the compose file *says*, not what the container *sees*:

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

Interpolation supports a default and a required-check form: `${VAR:-default}` uses the default when `VAR` is unset or empty, and `${VAR:?error message}` makes Compose fail with that message when `VAR` is missing.

### The precedence ladder, highest to lowest

The same variable can be set in several of these places at once, and they do not all win equally. When more than one source sets `FOO`, Compose resolves it in this fixed order, highest first:

1. `docker compose run --env FOO=...` on the command line;
2. a value interpolated into `environment:` or `env_file:` from your shell or `.env`;
3. a *static* value written directly in `environment:`;
4. a value read from a file named in `env_file:`;
5. the image's own `ENV`, baked in by its Dockerfile.

The counter-intuitive rung is the third. Engineers assume the host shell always wins, and it does not: a static `environment: FOO=bar` in the compose file beats a `FOO` exported in your shell. The shell value reaches the container only when the file lets it through — a bare `environment: [FOO]`, or an explicit `${FOO}` interpolation. And the auto-loaded `.env` is not `env_file:`: `.env` feeds `${VAR}` interpolation into the YAML, whereas `env_file:` injects variables into the container. A value in `.env` reaches the container only if you pass it through on purpose, for instance `environment: { X: ${X} }`.

Environment settles what one container reads; the next section is how Compose runs several copies of the same service at once.

---

## Scaling services

Compose can run several replica containers of one service on the single host — four copies of a worker, say, to chew through a queue faster:

```bash
docker compose up -d --scale worker=4
```

You can also fix the count in the file with `deploy.replicas`, or the shorter `scale:` key:

```yaml
services:
  worker:
    image: myorg/worker
    deploy:
      replicas: 4
```

`deploy:` began life as the Docker Swarm block, which is why its appearance here looks out of place. `docker compose up` reads the parts of it that make sense on one machine — `replicas` among them — and ignores the parts that need a cluster to mean anything, such as placing containers across nodes. So `replicas: 4` runs four workers locally, while the swarm-only keys around it sit inert under plain Compose.

All four replicas answer to the one service name in DNS, and Docker's embedded DNS round-robins across their IPs, spreading client connections across the replicas with no load balancer in the picture. Two limits bound how far this goes. You still cannot publish a fixed host port on a scaled service — the same port collision the ports section described — so you use a range, random ports, or a proxy. And every replica runs on the same machine, so scaling here buys throughput, not high availability: if the host dies, all four die with it. Spreading replicas across machines is an orchestrator's job — Kubernetes or Swarm — not Compose's.

Scaling changes how many copies of a service run; profiles change which services start at all.

---

## Profiles

Profiles let optional services live in the same file yet stay dormant until you switch them on. The use case is tooling you want available but not running by default — a database admin UI, a one-off seed job, a debugger:

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

The rule is short. A service with no `profiles:` key always starts. A service that lists profiles starts only when one of them is active, switched on either with `docker compose --profile tools up` or by setting `COMPOSE_PROFILES=tools,debug` in the environment. Naming a profiled service directly on the command line, `docker compose up pgadmin`, also pulls it in along with its profile. The payoff is one file for the whole team, with nobody forced to run the heavyweight extras just because they are defined in it.

Profiles pick which services start; override files let two different files describe the same services differently.

---

## Override files and merging

Compose can merge several files into one effective configuration, layering later files on top of earlier ones. Merging is how you keep a single base topology and adjust it per environment without copying the whole file. Two things trigger a merge: by default Compose auto-loads `compose.yaml` and, if it is present, `compose.override.yaml` on top of it; or you name files explicitly and in order with `-f`, where later files win.

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d
```

The merge is not uniform across value types, and knowing which is which heads off surprises. A scalar — a single value like `image`, or one port — is *replaced* by the later file. A sequence like `ports` is *appended*, so the later file's entries join the earlier ones instead of overwriting them. Not every list is a plain append, though: `volumes` merge by their container mount path, so a later mount at the same target *replaces* the earlier one rather than adding a second. A mapping like `environment` is merged key by key, so one file can change `LOG_LEVEL` while leaving every other key the earlier file set.

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

The idiom that falls out of these rules is a three-file split. `compose.yaml` holds the shared topology; an auto-applied `compose.override.yaml` holds local dev conveniences like bind-mounting source and exposing debug ports; and a `compose.prod.yaml`, applied explicitly at deploy time, holds the production settings. Same base, different tops.

Merging is the machinery; the next section is the concrete split it exists to express — development configuration against production.

---

## Dev vs prod compose

Compose runs across the whole lifecycle, but the configuration differs sharply between local development and a deployed environment — one tool, tuned for opposite priorities. Development optimizes for fast feedback; production optimizes for reproducibility and safety.

| Concern | Dev compose | Prod compose |
|---|---|---|
| Image | `build:` from local source | `image:` a pinned, pre-built tag |
| Source | bind-mount `./src` for hot reload | baked into the image, no mount |
| Ports | publish freely for debugging | publish only what's needed, bind loopback/proxy |
| Env/secrets | `.env` files, plaintext ok | secrets manager / Docker secrets, not in git |
| Restart | rarely | `restart: unless-stopped`/`always` |
| Extras | pgAdmin, mailhog via `profiles` | omitted |

You express the split with the override files and profiles from the last two sections — a base file, a dev override, and a prod file — so the topology stays written once. The row that matters most is the source. Bind-mounting your source into the container (`./:/app`) is a *dev* pattern, because it makes the running code depend on files sitting on the host. Ship that to production and you have thrown away the immutable-image guarantee — the reason you built an image at all was that it carries its own code. Production runs the built image with no source mount.

All of this still runs on exactly one Docker host, which is the boundary the final section draws.

---

## Compose is single-host

Compose provisions and manages containers on one Docker host — the single machine running the engine. It has no scheduler placing work across machines, no multi-node networking, no self-healing when a node dies, and no autoscaling. None of that is a missing feature; it is the deliberate scope of a development, CI, and small single-node deployment tool.

You outgrow it at a specific set of needs: running across many nodes with a scheduler choosing placement, self-healing that reschedules containers when a node fails, rolling updates and autoscaling, and cluster-wide service networking with load balancing. Those needs are the work of an orchestrator — Kubernetes, which has its own domain in this library, or Docker Swarm. The concepts you built here carry over: the health check you wrote for Compose becomes a Kubernetes liveness or readiness probe, and a Compose `service` maps roughly onto a Deployment plus a Service. What does not carry over is the single-host assumption sitting underneath all of it.

> [!INTERVIEW]
> A crisp senior answer: "Compose is the right tool for local dev, integration tests, CI, and single-node deployments. The moment I need multi-node scheduling, rolling updates, and self-healing, that is the signal to move to Kubernetes — Compose deliberately stops at one host."

So a single checked-in `compose.yaml` really is the truth of the deployment: its topology, its networks, its volumes, and the exact tags each service runs, such as `myorg/api:1.4.2`. Yet a tag is only a label, and a registry is free to move it — two machines that pull `myorg/api:1.4.2` on different days can end up with different bytes behind the same name. Why that happens, and what pins an image down for real, is the next topic's problem rather than this one's.

---

## Common follow-up questions

- "Why did my app crash on `up` even though `depends_on` lists the DB?" — `depends_on` only waits for the container to *start*, not to be *ready*. Use `condition: service_healthy` with a health check, or add connection retries in the app.
- "How do two services talk to each other?" — By service name over the shared Compose network via Docker's embedded DNS (`127.0.0.11`); no IPs, no `links`.
- "My code change didn't show up after `docker compose up`." — Compose reused the existing image; run `docker compose up --build`, or bind-mount source in dev.
- "Difference between `ports` and `expose`?" — `ports` publishes to the host; `expose` only advertises to other containers on the network.
- "What's the difference between the `.env` file and `env_file:`?" — `.env` interpolates `${VAR}` in the compose file itself; `env_file:` injects variables into a container.
- "Does `docker compose down` delete my database?" — No, named volumes survive; `down -v` deletes them.
- "Can Compose scale or do HA?" — Replicas on one host with DNS round-robin, yes; multi-node HA and autoscaling, no — that is Kubernetes.
- "Is `version: '3.8'` required?" — No, it is obsolete in the Compose Specification; omit it.
- "How do I keep dev and prod config in one place?" — Override files (base plus override or prod) and profiles.

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
  health checks): see the `kubernetes` domain in this library.
