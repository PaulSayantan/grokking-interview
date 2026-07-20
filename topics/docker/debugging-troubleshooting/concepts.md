# Debugging & Troubleshooting Containers

This page is a **field guide to figuring out why a container is misbehaving** — it won't
start, it exits immediately, it gets killed, it can't reach the network, or it's eating
memory. The toolkit is small and you should know it cold for interviews: `docker logs`,
`docker exec`, `docker inspect`, `docker stats`, `docker events`, `docker diff`, exit-code
reading, and the newer `docker debug` for shell-less images.

It is concept-first and hands-on. Neighbouring topics own the deeper theory:
the lifecycle state machine and signal/exit-code semantics live in `container-lifecycle`;
`HEALTHCHECK` states and log drivers live in `production-healthchecks-logging`; network
driver internals live in `docker-networking`; `ENTRYPOINT`/`CMD` exec-vs-shell mechanics
live in `entrypoint-vs-cmd`; image layers/CoW live in `image-internals-storage-drivers`.
Kubernetes is the downstream *consumer* — `kubectl logs`/`kubectl debug` mirror these
commands but pods are out of scope here.

> [!KEY-TAKEAWAY]
> Debugging containers is a disciplined loop, not guesswork. **(1) Read the exit code and
> state first** (`docker ps -a`, `docker inspect`) — it tells you *how* it died (137 =
> SIGKILL/OOM, 143 = SIGTERM, 127 = command not found, 126 = not executable, "exec format
> error" = wrong CPU arch). **(2) Read the logs** (`docker logs`) — apps log to stdout/stderr,
> not files, by design. **(3) Get inside** (`docker exec` for fat images, `docker debug` for
> distroless/slim ones). **(4) Inspect config vs reality** (`docker inspect`, `docker diff`,
> `docker stats`, `docker events`). Most "mystery" bugs are a process that ended, a missing
> file, a permission denial, a port clash, or a memory limit.

---

## A debugging methodology for containers

Before reaching for any single command, have a mental order of operations. Containers fail in
a small number of characteristic ways, and the diagnosis path is almost always the same.

1. **What state is it in?** `docker ps` shows *running* containers; `docker ps -a` shows
   *all*, including exited ones. A container that "isn't there" usually exited — look at the
   `STATUS` column (`Exited (137) 3 seconds ago`).
2. **How did it die?** The exit code in that status (or `docker inspect --format '{{.State.ExitCode}}'`)
   tells you the failure class before you read a single log line.
3. **What did it say?** `docker logs <c>` shows what the process wrote to stdout/stderr —
   stack traces, "bind: address already in use", "permission denied".
4. **Is the config what I think?** `docker inspect` reveals the *actual* resolved command,
   env, mounts, networks, and restart policy — often different from what you assumed.
5. **Get inside / reproduce.** `docker exec` (or `docker debug`) to poke at the live
   filesystem, DNS, and processes; `docker run --entrypoint sh -it <image>` to interrogate a
   broken image without running its real command.

> [!INTERVIEW]
> A great answer to "how do you debug a container that won't stay up?" walks this ladder:
> *check `docker ps -a` for the exit code → `docker logs` → `docker inspect` the resolved
> command/mounts → override the entrypoint with a shell to poke around.* Naming the exit
> codes (137/143/126/127) signals real operational experience.

---

## Reading container logs (docker logs)

`docker logs <container>` prints whatever the container's main process wrote to **stdout and
stderr**. This is the single most important debugging habit and it depends on a design
convention: **containerised apps should log to stdout/stderr, not to files inside the
container.** The runtime captures those streams via the logging driver; writing to a file
buries the logs inside an ephemeral layer where `docker logs` can't see them.

Key flags:

```bash
docker logs my-app                 # dump everything captured so far
docker logs -f my-app              # follow (stream) new output, like tail -f
docker logs --tail 100 my-app      # last 100 lines only (default: all)
docker logs --since 10m my-app     # only logs from the last 10 minutes
docker logs --since 2026-07-21T09:00:00 my-app   # RFC3339 absolute time
docker logs --until 5m my-app      # logs older than 5 minutes ago
docker logs -t my-app              # prepend RFC3339Nano timestamps
```

- **stdout and stderr are both shown** and interleaved; redirect if you need only one:
  `docker logs my-app 2>/dev/null` keeps stdout, `1>/dev/null` keeps stderr.
- `docker logs` only works with logging drivers that keep a local copy — **`json-file`
  (the default) and `local`.** If you configure a remote driver like `syslog`, `gelf`,
  `awslogs`, or `fluentd`, `docker logs` returns an error (`configured logging driver does
  not support reading`) — you read logs in the destination system instead.
- Logs live under `/var/lib/docker/containers/<id>/<id>-json.log` on the host for the
  default driver. Unbounded, this fills the disk — cap it with `--log-opt max-size=10m
  --log-opt max-file=3` (or `daemon.json` defaults).

> [!WARNING]
> If `docker logs` is empty for a service you *know* is chatty, the usual culprit is that the
> app logs to a file (e.g. `/var/log/app.log`) or that output is buffered. For Python, set
> `PYTHONUNBUFFERED=1` (or `python -u`); many runtimes buffer stdout when it isn't a TTY, so
> logs appear only in bursts or on exit.

---

## Getting a shell inside a running container (docker exec)

`docker exec` runs a **new process inside an already-running container**, sharing its
namespaces (PID, network, mount, etc.). It is the workhorse for interactive debugging:

```bash
docker exec -it my-app sh          # interactive shell (sh is safest — always present-ish)
docker exec -it my-app bash        # bash if the image has it
docker exec -it my-app /bin/sh -c 'ps aux; ls -la /app'
docker exec -u root -it my-app sh  # exec as root even if the container runs as non-root
docker exec my-app env             # one-off command, no TTY needed
```

- **`-i` keeps stdin open, `-t` allocates a pseudo-TTY.** For an interactive shell you need
  both (`-it`). For a scripted one-off command you need neither.
- `docker exec` requires the container to be **running**. It cannot help you debug a container
  that has already exited or that crash-loops before you can attach — for those, override the
  entrypoint at `run` time or use ephemeral debug containers.
- `exec` vs `attach`: **`exec` starts a *new* process** (a fresh shell), while **`attach`
  connects to the *existing* PID 1's stdio.** Typing `exit` in an `attach`ed shell can kill
  PID 1 and stop the container; `exec` is almost always what you want for debugging.
- The extra process shares the container's environment but **`docker exec` env/user overrides
  do not persist** and don't change the container's declared config.

> [!TIP]
> To debug an image whose entrypoint crashes immediately, don't fight `exec` — start a shell
> instead of the real command: `docker run --rm -it --entrypoint sh myimage`. You get the
> exact filesystem and env of the image with a prompt, so you can run the failing command by
> hand and read the real error.

---

## docker inspect: config, state, mounts, networks, exit code

`docker inspect` dumps the full JSON metadata for a container or image — the **source of
truth** for what Docker *actually* configured, which is frequently not what you assumed. Use
Go-template `--format` to extract exactly what you need:

```bash
docker inspect my-app                                        # full JSON
docker inspect --format '{{.State.Status}}' my-app           # running / exited / restarting
docker inspect --format '{{.State.ExitCode}}' my-app         # 0, 137, 1 ...
docker inspect --format '{{.State.OOMKilled}}' my-app        # true if the kernel OOM-killed it
docker inspect --format '{{json .Config.Cmd}}' my-app        # resolved CMD
docker inspect --format '{{json .Config.Entrypoint}}' my-app # resolved ENTRYPOINT
docker inspect --format '{{json .Mounts}}' my-app            # volumes & bind mounts
docker inspect --format '{{.NetworkSettings.IPAddress}}' my-app
docker inspect --format '{{json .HostConfig.RestartPolicy}}' my-app
```

The most useful fields for debugging:

| Path | Tells you |
|---|---|
| `.State.Status` / `.State.Running` | current lifecycle state |
| `.State.ExitCode` | how the last run ended |
| `.State.OOMKilled` | whether the kernel OOM-killer fired (distinguishes real OOM from a plain SIGKILL) |
| `.State.Error` | daemon-side start error (e.g. exec/mount failure) |
| `.State.Health` | HEALTHCHECK status + last probe output (if defined) |
| `.Config.Entrypoint` / `.Config.Cmd` / `.Config.Env` | the resolved startup command and env |
| `.Mounts` | every volume/bind mount and its source/destination/RW flag |
| `.NetworkSettings` | IP, ports, and which networks it's attached to |
| `.HostConfig.RestartPolicy` | why it may be crash-looping (`always`/`on-failure`) |

> [!TIP]
> `docker inspect` works on **images too**: `docker inspect --format '{{json .Config}}' myimage`
> shows the baked-in `Entrypoint`, `Cmd`, `Env`, `User`, `WorkingDir`, and exposed ports —
> invaluable when a pulled image behaves unexpectedly and you don't have its Dockerfile.

---

## Live resource usage with docker stats

`docker stats` streams a live view of per-container CPU, memory, network, and block I/O —
your first stop for "why is it slow / why did it get killed?"

```bash
docker stats                       # live table for all running containers
docker stats my-app                # just one
docker stats --no-stream           # single snapshot (scriptable, exits immediately)
docker stats --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}'
```

Reading it:

- **`MEM USAGE / LIMIT`** — if usage sits pinned at the limit, you're heading for an OOM kill.
  The limit shown is the cgroup limit (from `--memory`), or the host total if none was set.
- **`MEM %`** is usage ÷ limit — near 100% is the warning sign.
- **`CPU %`** can exceed 100% on multi-core hosts (100% = one full core). A container capped
  with `--cpus=1` that's pinned at 100% is CPU-throttled.
- **`PIDS`** — number of processes/threads; a runaway climbing PID count hints at a fork bomb
  or a zombie-reaping problem (PID 1 not reaping children).

Under the hood `docker stats` reads the container's **cgroup** accounting (`memory.current`,
`cpu.stat`, etc.), which is why the numbers reflect the enforced limits, not the host's raw
usage. For deeper profiling you still `exec` in and run `top`/`ps`, but `stats` is the fast
triage view.

---

## Why a container won't start or exits immediately

This is the most common real-world and interview scenario. Because **a container lives exactly
as long as its main (PID 1) process**, "exits immediately" almost always means *the main
process ended right away*. Work through the causes:

| Symptom / exit | Likely cause | How to confirm |
|---|---|---|
| Exits `0` instantly | The command had nothing to do and returned (e.g. `docker run ubuntu` → bash with no TTY) | `docker ps -a` shows `Exited (0)`; give it a foreground task |
| Exits non-zero instantly | The app crashed on startup — bad config, missing env, can't bind | `docker logs` shows the stack trace / error |
| `exec: "xyz": executable file not found in $PATH` → exit 127 | ENTRYPOINT/CMD names a binary that isn't installed or isn't on PATH | check the Dockerfile; `docker run --entrypoint sh -it img` then `which xyz` |
| `permission denied` → exit 126 | The entrypoint file exists but isn't executable, or the `USER` lacks permission | `chmod +x` the script; `RUN chmod +x entrypoint.sh` in the Dockerfile |
| `exec format error` | Architecture mismatch (arm64 image on amd64 host, or a script missing its `#!` shebang) | `docker inspect img` / `docker image inspect --format '{{.Architecture}}'`; rebuild with `--platform` |
| Won't start, `docker: Error response from daemon: ... mount` | A bind-mount source path doesn't exist on the host | check the `-v`/`--mount` path |

The classic "daemonize" trap: a container running `service nginx start` exits because that
command **backgrounds** nginx and returns, so PID 1 finishes. The fix is to run the process in
the **foreground**: `nginx -g 'daemon off;'`, `postgres` directly, `java -jar app.jar`, etc.

```bash
# Triage a crash-looping container
docker ps -a                                   # find its exit code
docker logs <c>                                # read the error
docker run --rm -it --entrypoint sh <image>    # get a shell WITHOUT running the broken cmd
# ...then run the real command by hand to see the actual failure
```

> [!WARNING]
> A container in a `restart: always` policy that crashes on startup will **crash-loop** —
> `docker ps` shows `Restarting`, and the logs scroll the same error forever. Temporarily
> remove the restart policy (or run the image with `--entrypoint sh`) to break the loop and
> investigate calmly.

---

## Exit codes: OOMKilled (137), SIGTERM (143), and friends

A container's exit code is its **main process's exit code**, and for signal deaths Linux
encodes it as **128 + signal number**. Memorising the common ones is the fastest way to
classify a failure:

| Exit code | Meaning | Typical cause |
|---|---|---|
| `0` | Clean exit | Process finished successfully (or had nothing to do) |
| `1` | Generic application error | Uncaught exception, bad config |
| `125` | Docker daemon error | `docker run` itself failed (bad flag, image issue) — the container never started |
| `126` | Command not executable | Entrypoint file lacks `+x`, or is not a valid executable |
| `127` | Command not found | Binary missing / wrong PATH in ENTRYPOINT/CMD |
| `137` | **128 + 9 = SIGKILL** | **OOMKilled** (hit memory limit) *or* `docker kill` / `docker stop` timeout escalated to SIGKILL |
| `139` | 128 + 11 = SIGSEGV | Segmentation fault (native crash) |
| `143` | 128 + 15 = SIGTERM | Graceful stop — `docker stop` sent SIGTERM and the app exited on it |

**137 is the interview favourite.** It means the process received **SIGKILL**. Two distinct
scenarios produce it, and you distinguish them with `docker inspect`:

- **OOMKilled:** the container exceeded its `--memory` cgroup limit and the kernel's
  OOM-killer terminated it. Confirm with `docker inspect --format '{{.State.OOMKilled}}' <c>`
  → `true`. Fix by raising `--memory`, fixing the leak, or tuning the app's heap
  (e.g. JVM `-XX:MaxRAMPercentage`).
- **Kill timeout:** `docker stop` sends SIGTERM, waits the grace period (default 10s), then
  SIGKILLs a process that ignored SIGTERM → also exit 137, but `OOMKilled` is `false`. Fix by
  handling SIGTERM for graceful shutdown.

```bash
docker inspect --format 'exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' my-app
# exit=137 oom=true   → memory limit; raise --memory or fix the leak
# exit=137 oom=false  → SIGKILL after stop timeout; handle SIGTERM
# exit=143            → clean SIGTERM shutdown
```

> [!INTERVIEW]
> "A container keeps dying with exit 137 — what's happening and how do you confirm?" Answer:
> 137 = 128+9 = SIGKILL. Most often the cgroup memory limit was hit and the OOM-killer fired;
> confirm with `docker inspect ... .State.OOMKilled`. If false, it was a SIGKILL escalation
> after a `stop`/`kill`, meaning the app didn't honour SIGTERM in time.

---

## Debugging distroless & shell-less images

Minimal images — **distroless**, `scratch`, or `-slim`/`alpine` stripped further — deliberately
ship **no shell and no tools** (no `sh`, `bash`, `ps`, `curl`) to shrink attack surface and
size. That makes `docker exec -it <c> sh` fail with `exec: "sh": executable file not found`.
Options, in order of preference:

1. **`docker debug <container-or-image>`** (Docker Desktop feature) — attaches a debug shell
   with a *built-in toolbox* (`vim`, `curl`, `htop`, install more from nixos) into **any**
   container or image, **even one with no shell**, without modifying the image. Filesystem
   changes on a running container are live; on images/stopped containers they're discarded on
   exit. This is the modern, purpose-built answer.

   ```bash
   docker debug my-distroless-app        # shell into a shell-less container
   docker debug --command 'ls -la /app' my-distroless-app
   ```

2. **Ephemeral debug container sharing namespaces** — run a *fat* toolbox image joined to the
   target's namespaces so you can inspect its process tree, network, and (via `/proc`) its
   filesystem:

   ```bash
   docker run --rm -it \
     --pid container:my-app \
     --network container:my-app \
     nicolaka/netshoot sh
   # now `ps`, `nsenter`, `curl`, `tcpdump`, `dig` all work against the target
   ```

   Its root filesystem is reachable via `/proc/1/root` (or another PID) inside the debug
   container. In Kubernetes the equivalent is `kubectl debug --target` (ephemeral containers).

3. **Copy tools in / build a debug variant** — a multi-stage `debug` build target that adds
   busybox, or `docker cp` a static busybox binary into the container. Cruder, but works
   without Docker Desktop.

> [!TIP]
> Build lean *and* debuggable: keep the production stage distroless, but add a
> `FROM production AS debug` stage that installs busybox/curl. Ship `production` by default;
> `docker build --target debug` when you need to poke around. You get a small attack surface
> in prod and a usable shell on demand.

---

## Watching the daemon with docker events

`docker events` streams **real-time events from the Docker daemon** — container
create/start/die/oom/kill, image pulls, network connects, volume mounts, health-status
changes. It answers "*what just happened?*" when a container vanishes or restarts on its own.

```bash
docker events                                   # live stream of everything
docker events --filter container=my-app         # just one container
docker events --filter event=die --filter event=oom
docker events --since 1h --until 10m            # historical window
docker events --filter type=container --format '{{.Time}} {{.Action}} {{.Actor.Attributes.name}}'
```

- Emits an explicit **`oom`** event when the kernel OOM-kills a container — a clean signal
  distinct from the eventual `die`.
- Shows **`health_status:` transitions** (from `HEALTHCHECK`), so you can watch a container
  flip `unhealthy` in real time.
- Because it's daemon-wide and time-filterable, it's the tool for catching *intermittent*
  restarts you'd otherwise miss — leave `docker events --filter event=die` running and wait.

---

## Inspecting filesystem changes with docker diff

`docker diff <container>` lists every file/directory that has been **Added, Changed, or
Deleted** in the container's writable layer relative to its image, using the copy-on-write
storage layer's records:

```bash
docker diff my-app
# A /app/tmp
# C /etc/nginx/nginx.conf
# D /var/run/foo.pid
```

- **`A`** = added, **`C`** = changed, **`D`** = deleted (relative to the image layers).
- It's a quick way to answer "*what has this container written to its filesystem?*" —
  useful for spotting apps that write logs/state into the container (an anti-pattern; those
  belong in volumes) or to see what a `RUN`/entrypoint mutated.
- **Volume and bind-mount paths do not appear** in `docker diff`: those live outside the
  container's writable layer (they're separate mounts), so writes there are invisible to
  `diff`. If a path you expect is missing from the output, it's probably a mount.
- Pairs well with `docker commit` when reverse-engineering an image, but the real lesson is
  usually "move this mutable path to a volume."

---

## Common errors and their fixes

A cheat-sheet of the errors you'll see most, and what each actually means:

| Error message | Meaning | Fix |
|---|---|---|
| `bind: address already in use` / `port is already allocated` | The host port in `-p 8080:80` is already taken by another process/container | `lsof -i :8080` or `docker ps` to find the holder; pick another host port or stop the holder |
| `pull access denied` / `repository does not exist` / `manifest unknown` | Image name/tag wrong, or it's private and you're not logged in | fix the tag; `docker login`; check the registry path |
| `exec: "./entrypoint.sh": permission denied` (exit 126) | Entrypoint script isn't executable | `RUN chmod +x entrypoint.sh` in the Dockerfile |
| `exec: "myapp": executable file not found in $PATH` (exit 127) | Binary not installed or wrong PATH/WORKDIR | verify install step; use an absolute path |
| `exec format error` | CPU-arch mismatch (e.g. arm64 image on amd64) or missing shebang in a script | rebuild for the host arch (`--platform`), use buildx multi-arch, add `#!/bin/sh` |
| `no space left on device` | Host disk full of images/layers/volumes/logs | `docker system df` then `docker system prune` (careful!); cap log sizes |
| `Cannot connect to the Docker daemon` | Daemon not running or wrong socket/permissions | start Docker; check `DOCKER_HOST`; add user to `docker` group |
| `OCI runtime create failed: ... no such file or directory` | Entrypoint path/interpreter missing inside the image | check the binary/shebang exists in the final image |

```bash
# Port clash triage
docker ps --format '{{.Names}} {{.Ports}}'     # who's publishing 8080?
sudo lsof -i :8080                             # or a non-docker process on the host

# Arch mismatch check
docker image inspect --format '{{.Os}}/{{.Architecture}}' myimage   # vs `docker version`
```

> [!WARNING]
> `docker system prune` reclaims space by deleting **stopped containers, dangling images, and
> unused networks**; add `-a` and it removes *all* unused images, and `--volumes` deletes
> unused volumes — which can wipe data you meant to keep. Read the prompt before confirming;
> in production, prune explicitly and narrowly rather than with `-a --volumes`.

---

## Common follow-up questions

- **"How do you debug a container that exits before you can `docker exec` into it?"** Override
  the entrypoint: `docker run --rm -it --entrypoint sh <image>`, then run the real command by
  hand. `exec` can't help — the container is already gone.
- **"`docker logs` shows nothing but the app is clearly running — why?"** Either the app logs
  to a file instead of stdout/stderr, output is buffered (set `PYTHONUNBUFFERED=1`), or a
  remote logging driver is configured so `docker logs` can't read local logs.
- **"Exit 137 vs 143 — what's the difference?"** 137 = SIGKILL (OOM or forced kill after stop
  timeout); 143 = SIGTERM (graceful stop the app honoured). Check `.State.OOMKilled` to tell
  OOM from a kill-timeout.
- **"How do you get a shell into a distroless image with no `sh`?"** `docker debug`, or run a
  toolbox image (`nicolaka/netshoot`) joined to the target's PID/network namespaces, or ship a
  separate `debug` build stage.
- **"How do you tell whether the kernel OOM-killed the container or the app just crashed?"**
  `docker inspect --format '{{.State.OOMKilled}}'` → `true` means OOM; also watch for an `oom`
  event in `docker events`.
- **"What's the difference between `docker exec` and `docker attach`?"** `exec` starts a new
  process (safe for a debug shell); `attach` connects to PID 1's stdio and can accidentally
  kill the container on exit.

## References

- Docker docs — [`docker logs`](https://docs.docker.com/reference/cli/docker/container/logs/),
  [`docker exec`](https://docs.docker.com/reference/cli/docker/container/exec/),
  [`docker inspect`](https://docs.docker.com/reference/cli/docker/inspect/),
  [`docker stats`](https://docs.docker.com/reference/cli/docker/container/stats/),
  [`docker events`](https://docs.docker.com/reference/cli/docker/system/events/),
  [`docker diff`](https://docs.docker.com/reference/cli/docker/container/diff/),
  [`docker debug`](https://docs.docker.com/reference/cli/docker/debug/)
- Docker docs — [Configure logging drivers](https://docs.docker.com/engine/logging/configure/)
- Docker docs — [Runtime metrics / resource constraints](https://docs.docker.com/engine/containers/runmetrics/)
- Linux — signal numbers (`man 7 signal`); shell exit-status convention 128+N
- `nicolaka/netshoot` — a Docker + Kubernetes network-troubleshooting toolbox image
