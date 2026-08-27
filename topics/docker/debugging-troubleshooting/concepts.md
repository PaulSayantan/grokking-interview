# Debugging & Troubleshooting Containers

The previous topic, `production-healthchecks-logging`, left one thing you could not observe
from the outside. It taught you to handle SIGTERM so the process shuts down cleanly, but not
how to check afterwards whether your app actually caught the signal or was killed ignoring it. The exit code is that missing
observable, and `137` versus `143` is the whole tell — [Exit codes](#exit-codes-oomkilled-137-sigterm-143-and-friends)
is where it settles.

A container you deployed an hour ago is gone. `docker ps` shows nothing and the service is
down. That is where most container debugging starts: a process that ended, and a status line
you have not read yet. Run `docker ps -a` and it reappears — `Exited (137) 3 seconds ago` —
and that number already names the failure class before you open a single log line. So the
real skill here is not a big toolbox; it is a fixed order for reading a symptom like that one
back to its cause. Which command do you reach for, in what sequence, and what can each of them
actually see?

> [!TIP]
> **Reading map.** About 20 minutes. This is a tour of eight commands and one diagnosis order.
> Read the methodology and the exit-codes sections closely; treat the rest as a per-symptom
> reference you dip into. If you already read exit codes cold (`137`, `143`, `126`, `127`) and
> have shelled into containers before, skip to
> [Debugging distroless & shell-less images](#debugging-distroless--shell-less-images) — that
> section and the daemon-connection errors are the only genuinely new material; everything
> else is command detail you can look up here when you hit it.

---

## A debugging methodology for containers

The fastest way to a cause is to ask the same five questions in the same order, and the first
one is always `docker ps -a`: the exited container that plain `docker ps` hid is sitting right
there, its exit code in the `STATUS` column as `Exited (137) 3 seconds ago`. Almost every
container mystery resolves to one of five plain things — a process that ended, a missing file,
a permission denial, a port already taken, or a memory limit — and the order below finds which
one it is without guessing.

Each rung answers one question and narrows the next:

1. What state is it in? `docker ps` lists only running containers; `docker ps -a` lists all
   of them, including exited ones. A container that "isn't there" almost always exited — the
   `STATUS` column tells you when and with what code.
2. How did it die? The exit code in that status line — or `docker inspect --format
   '{{.State.ExitCode}}'` — names the failure class before you read a single log line. `137`
   points at a kill, `127` at a missing command, and so on down the table two sections below.
3. What did it say? `docker logs <c>` shows what the process wrote to stdout and stderr:
   the stack trace, the `bind: address already in use`, the `permission denied`.
4. Is the config what I think it is? `docker inspect` shows the *resolved* command, env,
   mounts, networks, and restart policy — routinely not what you assumed you configured.
5. Get inside, or reproduce. `docker exec` (or `docker debug`) pokes at the live
   filesystem, DNS, and process tree; `docker run --entrypoint sh -it <image>` gives you the
   image's exact filesystem without running the command that is failing.

> [!INTERVIEW]
> Asked "how do you debug a container that won't stay up?", walk this ladder out loud: check
> `docker ps -a` for the exit code, read `docker logs`, `docker inspect` the resolved
> command and mounts, then override the entrypoint with a shell to poke around. Naming the
> exit codes — `137`, `143`, `126`, `127` — is what signals you have actually done this.

Rung three is where most answers live, so logs come first: what `docker logs` shows, and the
short list of reasons it sometimes shows nothing at all.

---

## Reading container logs (docker logs)

`docker logs <container>` prints only what `PID 1` and its children wrote to two streams,
stdout and stderr — the `Listening on :8080` line your server logs at boot, say, or the stack
trace it printed on the way down. It reads nothing else, and that one fact is the most
important logging habit in containers: apps should log to stdout and stderr, not to a file
inside the container. The runtime captures those two streams through the logging driver. A file
written inside the container instead lands in the writable layer, which the driver never reads
and which vanishes when the container is removed.

The flags all answer the same question — which slice of the stream do you want to see?

```bash
docker logs my-app                 # dump everything captured so far
docker logs -f my-app              # follow (stream) new output, like tail -f
docker logs --tail 100 my-app      # last 100 lines only (default: all)
docker logs --since 10m my-app     # only logs from the last 10 minutes
docker logs --since 2026-07-21T09:00:00 my-app   # RFC3339 absolute time
docker logs --until 5m my-app      # logs older than 5 minutes ago
docker logs -t my-app              # prepend RFC3339Nano timestamps
```

stdout and stderr both come out, interleaved. There is no `--stderr` flag; to keep only one
stream you redirect at the shell — `docker logs my-app 2>/dev/null` keeps stdout, and
`docker logs my-app 1>/dev/null` keeps stderr.

Two things decide whether `docker logs` can show you anything. The first is the logging driver.
Only drivers that keep a local copy can be read back: `json-file` (the default) and `local`.
Point the container at a remote driver — `syslog`, `gelf`, `awslogs`, `fluentd` — and
`docker logs` fails outright with `configured logging driver does not support reading`, because
there is no local copy to read; the logs are in the destination system instead. The second is
where those local logs live: `/var/lib/docker/containers/<id>/<id>-json.log` on the host for
the default driver, which grows without bound until you cap it with `--log-opt max-size=10m
--log-opt max-file=3` (or the same keys as `daemon.json` defaults).

> [!WARNING]
> "`docker logs` shows nothing, but the app is clearly running" is the classic false alarm,
> and it is almost never a Docker problem. Either the app writes to a file such as
> `/var/log/app.log` instead of stdout, or its output is buffered — many runtimes buffer
> stdout when it is not a terminal, so lines appear only in bursts or at exit. For Python,
> `PYTHONUNBUFFERED=1` (or `python -u`) turns the buffering off and the logs reappear.

When the logs do come through, the next question is why the process is running as it is —
which means getting a shell inside the container while it is still alive.

---

## Getting a shell inside a running container (docker exec)

`docker exec -it my-app sh` drops you into a shell inside a container that is already running,
as a brand-new process that shares the container's namespaces — its `PID`, network, and mount
views of the world. That word "running" is the whole catch: `exec` cannot touch a container
that has already exited, or one that crash-loops faster than you can type. It is the workhorse
of live debugging, so long as the thing you want to debug is still alive.

```bash
docker exec -it my-app sh          # interactive shell (sh is the safest bet — usually present)
docker exec -it my-app bash        # bash if the image ships it
docker exec -it my-app /bin/sh -c 'ps aux; ls -la /app'
docker exec -u root -it my-app sh  # run the shell as root even if the container runs non-root
docker exec my-app env             # one-off command, no TTY needed
```

The two flags you always reach for are `-i`, which keeps stdin open, and `-t`, which allocates
a pseudo-terminal; an interactive shell needs both (`-it`), while a scripted one-off command
such as `docker exec my-app env` needs neither. Anything you override at `exec` time — a
different user with `-u root`, an extra env var — applies to that one new process only and
never rewrites the container's declared config.

There is a second command that looks similar and does something dangerous. `docker attach`
does not start a process; it connects your terminal to the *existing* `PID 1`'s stdin, stdout,
and stderr. Type `exit` in an `attach`ed session and you send end-of-input straight to `PID 1`,
which can stop it and take the whole container down with it. `exec` starts a separate process,
so leaving its shell touches nothing else — which is why `exec`, not `attach`, is what you want
for a debug shell almost every time.

One case `exec` cannot help with is an image whose entrypoint crashes on startup: there is no
running container to enter. Do not fight it — start a shell *instead of* the failing command
with `docker run --rm -it --entrypoint sh <image>`. You get the image's exact filesystem and
environment at a prompt, and you run the real command by hand to read the actual error.

### Confirming what is really PID 1: docker top

`docker top <container>` reads the container's process tree from outside, as the host kernel
sees it, without opening a shell at all — the cleanest way to settle which process is actually
`PID 1`. Start a container whose shell has more than one thing to do and look:

```bash
docker run -d alpine sh -c 'sleep 300; true'   # shell form, two commands
docker top <container>
# PID 1 is /bin/sh; the sleep 300 you asked for is its CHILD, not PID 1
```

The number of commands you hand the shell decides the outcome. Give it a single command —
`sh -c 'sleep 300'` — and the shell does not stick around: it replaces itself with that command,
so `sleep` becomes `PID 1` and a `SIGTERM` reaches it directly. Give it more than one thing to
do, as above, and the shell must stay to run them in order, so `/bin/sh` keeps `PID 1` and
`sleep` runs as its child. That second case is the trap: a `SIGTERM` now lands on the shell,
which does not forward it, so your real process never sees the signal. The exec form
(`sh -c 'exec sleep 300'`) or a JSON-array `CMD` settles it either way — your command is `PID 1`
regardless of how many commands there are. It is the same PID-1 rule from `entrypoint-vs-cmd`,
the one that decides whether a `SIGTERM` reaches your app or dies at an unforwarding shell, and
`docker top` is how you confirm which case you have on a live container.

A live shell answers "what is it doing?"; the next question — what the container was actually
configured to run and how it ended — is answered by reading its metadata rather than looking
inside it, and that is what `docker inspect` dumps.

---

## docker inspect: config, state, mounts, networks, exit code

`docker inspect --format '{{.State.ExitCode}}' my-app` prints one number — the exit code of
the last run — pulled from the full JSON blob the daemon holds for every container and image.
That JSON is the source of truth for what Docker actually resolved, which is regularly not what
you thought you configured; the Go-template `--format` flag lets you lift out exactly one field
instead of reading all of it:

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

The split that trips people up is `State` versus `Config`. `Config` is what the container was
*built and asked* to be — its `Entrypoint`, `Cmd`, `Env`, `User`. `State` is what happened when
it *ran* — its status, its exit code, whether the kernel OOM-killed it. So the exit code is
`.State.ExitCode`, never `.Config.ExitCode`; a container's configuration has no exit code,
only its run does. The fields worth knowing by name:

| Path | Tells you |
|---|---|
| `.State.Status` / `.State.Running` | current lifecycle state |
| `.State.ExitCode` | how the last run ended |
| `.State.OOMKilled` | whether the kernel OOM-killer fired — this is what splits a real OOM from a plain `SIGKILL` |
| `.State.Error` | daemon-side start error (an exec or mount failure, say) |
| `.State.Health` | `HEALTHCHECK` status and last probe output, if one is defined |
| `.Config.Entrypoint` / `.Config.Cmd` / `.Config.Env` | the resolved startup command and env |
| `.Mounts` | every volume and bind mount, with source, destination, and read/write flag |
| `.NetworkSettings` | IP, ports, and which networks it is attached to |
| `.HostConfig.RestartPolicy` | why it may be crash-looping (`always` / `on-failure`) |

The same command works on an image, not just a running container: `docker inspect --format
'{{json .Config}}' myimage` shows the baked-in `Entrypoint`, `Cmd`, `Env`, `User`,
`WorkingDir`, and exposed ports. That is how you find out what a pulled image will do before you
run it, when you have no Dockerfile to read.

`inspect` freezes a snapshot of config and last state; when the container is still up but slow
or heading for a kill, the live numbers — CPU, memory, PID count as they move — come from
`docker stats` instead.

---

## Live resource usage with docker stats

`docker stats` streams a live, in-place table — one row per running container — of CPU %,
memory used against its limit, network, and block I/O. It is the first place to look when a
container is up but slow, or when you want to watch it climb toward the OOM kill that is coming.

```bash
docker stats                       # live table for all running containers
docker stats my-app                # just one
docker stats --no-stream           # single snapshot (scriptable, exits immediately)
docker stats --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}'
```

Four columns carry the diagnosis. `MEM USAGE / LIMIT` shows the memory used against the ceiling
the container is allowed; sit pinned at that ceiling and an OOM kill is on the way. The limit
shown is the cgroup limit set by `--memory`, or the host's total when you set none. `MEM %` is
just usage over that limit, so a figure near 100% is the same warning stated as a percentage.
`CPU %` is measured against a single core, so it runs past 100% on a multi-core host: `320%`
is roughly 3.2 cores of work on an 8-core machine. A container capped at `--cpus=1` and pinned
at `100%` is being throttled at its ceiling. `PIDS` counts the
processes and threads inside the container, and a count that only ever climbs is the signature
of a fork bomb, or of `PID 1` not reaping its children so zombies pile up.

`docker stats` reads these numbers straight from the container's own cgroup accounting —
`memory.current`, `cpu.stat`, and the rest — which is why they reflect the limits enforced on
that container rather than the host's raw usage. For heavier profiling you still `exec` in and
run `top` or `ps`; `stats` is the fast triage glance, not the microscope.

`stats` only helps once the container stays up long enough to have live numbers. The harder
case is the container that exits the instant you start it, and reading that is next.

---

## Why a container won't start or exits immediately

A container lives exactly as long as its `PID 1`, so "exits immediately" almost always means
`PID 1` finished right away and the runtime had nothing left to supervise. `docker run ubuntu`
exiting `0` the moment you start it is the harmless version: `bash` came up, found no command
to run and no terminal to read a command from, and returned. The rest sort by the code they
leave behind:

| Symptom / exit | Likely cause | How to confirm |
|---|---|---|
| Exits `0` instantly | The command had nothing to do and returned (e.g. `docker run ubuntu` → bash with no TTY) | `docker ps -a` shows `Exited (0)`; give it a foreground task |
| Exits non-zero instantly | The app crashed on startup — bad config, missing env, can't bind | `docker logs` shows the stack trace / error |
| `exec: "xyz": executable file not found in $PATH` → exit 127 | ENTRYPOINT/CMD names a binary that isn't installed or isn't on PATH | check the Dockerfile; `docker run --entrypoint sh -it img` then `which xyz` |
| `permission denied` → exit 126 | The entrypoint file exists but isn't executable, or the `USER` lacks permission | `chmod +x` the script; `RUN chmod +x entrypoint.sh` in the Dockerfile |
| `exec format error` | Architecture mismatch (arm64 image on amd64 host, or a script missing its `#!` shebang) | `docker inspect img` / `docker image inspect --format '{{.Architecture}}'`; rebuild with `--platform` |
| Won't start, `docker: Error response from daemon: ... mount` | A bind-mount source path doesn't exist on the host | check the `-v`/`--mount` path |

The subtler trap is a container that runs `service nginx start` and exits anyway. That command
starts nginx in the background and returns, so `PID 1` — the init script, not nginx — has
nothing left to do and finishes, taking the container down with it. The fix is to run the real
process in the foreground so it *is* `PID 1` for as long as the service should live:
`nginx -g 'daemon off;'`, or `postgres` directly, or `java -jar app.jar`.

```bash
# Triage a crash-looping container
docker ps -a                                   # find its exit code
docker logs <c>                                # read the error
docker run --rm -it --entrypoint sh <image>    # get a shell WITHOUT running the broken cmd
# ...then run the real command by hand to see the actual failure
```

A crash on startup under a `restart: always` policy turns into a crash-loop: `docker ps` shows
`Restarting` and the logs scroll the same error forever. Break the loop before you investigate
— temporarily drop the restart policy, or run the image with `--entrypoint sh` — so the
container sits still long enough to read.

Every row in that table is at heart an exit code, and two of them, `137` and `143`, carry far
more meaning than "it failed" — which is the section that finally settles the `137` question.

---

## Exit codes: OOMKilled (137), SIGTERM (143), and friends

A container's exit code is its `PID 1`'s exit code, handed straight up. When `PID 1` dies from
a signal, Linux reports `128 + the signal number`: `137` is `128 + 9`, which is `SIGKILL`, and
`143` is `128 + 15`, which is `SIGTERM`. That one convention turns a bare number into a failure
class you can read at a glance:

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

Three of those codes break the "it is `PID 1`'s exit status" rule, and it is worth knowing why.
`125`, `126`, and `127` are not your program's exit status at all: `125` is the Docker daemon
refusing to start the run — a bad flag, a broken image reference; `126` is the runtime finding
your entrypoint but unable to execute it; `127` is the runtime never finding the entrypoint. In
all three, no program of yours ever ran, so there is no `PID 1` status to hand up — the number
is Docker or the OCI runtime telling you it stopped before your code began.

### Telling the two 137s apart: OOM versus a stop-timeout

`137` is the one you will actually chase, and two very different events both leave it. In the
first, the container blew past its `--memory` cgroup limit and the kernel's OOM-killer
terminated it. The killer picks the process with the highest `oom_score` in the cgroup, which
need not be `PID 1`. In the second, `docker stop` sent `SIGTERM`, waited the grace period —
10 seconds by default on Linux — and escalated to `SIGKILL` because the app never exited on its
own. One field separates them:

```bash
docker inspect --format 'exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' my-app
# exit=137 oom=true   → memory limit; raise --memory or fix the leak
# exit=137 oom=false  → SIGKILL after stop timeout; handle SIGTERM
# exit=143            → clean SIGTERM shutdown
```

This is the observable the shutdown story was missing. You were told to handle `SIGTERM` for a
clean exit, but never how to check, from outside, whether your handler actually ran.
Now you can read it off the exit code: `143` means the app caught `SIGTERM` and exited on its
own — the clean death you were aiming for. `137` with `OOMKilled: false` is the opposite
verdict: the app sat through the whole grace period ignoring `SIGTERM` and was `SIGKILL`ed for
it. Fix the OOM case by raising `--memory`, fixing the leak, or tuning the runtime's heap (the
JVM's `-XX:MaxRAMPercentage`, say); fix the timeout case by making the app honour `SIGTERM`
inside the grace period.

> [!INTERVIEW]
> "A container keeps dying with exit `137` — what is happening, and how do you confirm?"
> Answer: `137` is `128 + 9`, a `SIGKILL`. Most often the cgroup memory limit was hit and the
> OOM-killer fired — confirm with `docker inspect` on `.State.OOMKilled`. If that is `false`,
> it was a `SIGKILL` escalation after a `stop` or `kill`, which means the app did not honour
> `SIGTERM` in time.

Reading exit codes and logs both assume you can get at the container's output and, when needed,
a shell inside it. Images built to have no shell at all break that assumption, and handling them
is next.

---

## Debugging distroless & shell-less images

Minimal images — distroless, `scratch`, or `alpine` stripped down further — ship no shell and
no tools on purpose (`sh`, `bash`, `ps`, `curl` are all absent), to shrink both attack surface
and size. The immediate cost lands the first time you debug one: `docker exec -it <c> sh` fails
with `exec: "sh": executable file not found`, and every habit from the last five sections stops
working. Three ways in, in order of how little they ask of you:

1. `docker debug <container-or-image>` — a Docker Desktop feature that attaches a debug
   shell carrying its own toolbox (`vim`, `curl`, `htop`, and more you install from the Nix
   package set) to *any* container or image, even one with no shell, and without modifying it.
   On a running container the filesystem changes you make are live; on an image or a stopped
   container they are discarded when you leave the shell. This is the modern, purpose-built
   answer.

   ```bash
   docker debug my-distroless-app        # shell into a shell-less container
   docker debug --command 'ls -la /app' my-distroless-app
   ```

2. An ephemeral debug container joined to the target's namespaces — run a *fat* toolbox
   image welded onto the target so its process tree, network, and filesystem are all reachable:

   ```bash
   docker run --rm -it \
     --pid container:my-app \
     --network container:my-app \
     nicolaka/netshoot sh
   # now ps, nsenter, curl, tcpdump, dig all work against the target
   ```

   In Kubernetes the same move is `kubectl debug --target` (ephemeral containers).

3. Build a debug variant, or copy tools in. A multi-stage build with a `FROM production AS
   debug` stage that adds busybox or curl lets you ship the distroless `production` stage by
   default and reach for `docker build --target debug` only when you need to poke around — a
   small attack surface in prod, a usable shell on demand. Cruder but Desktop-free: `docker cp`
   a static busybox binary into the running container.

### Why "join it" works: shared namespaces and /proc/1/root

The second option can look like sleight of hand — a separate container running `ps` against
another container's processes — but it is only namespaces, from `images-vs-containers`, used
deliberately.
`--pid container:my-app` puts the debug container in the *same* PID namespace as the target, so
the target's `PID 1` is simply visible from inside the toolbox. `--network container:my-app`
shares the network namespace the same way, which is why `curl localhost:8080` and `tcpdump`
reach the target's own ports and traffic.

The filesystem is the one thing those flags do not share, and `/proc/1/root` is how you get it
anyway. The kernel publishes every process's root directory at `/proc/<pid>/root`; once the
target's `PID 1` is visible in your shared PID namespace, `/proc/1/root` is a live window onto
that process's filesystem root. So you read a distroless image's files through the toolbox
container's own tools, and neither image ever needed a shell. Every one of these routes works by
opening the isolation boundary on purpose — you join the very namespaces that were built to keep
the container apart.

`docker debug` and namespace-joining tell you what is inside a container right now; when the
question is what the daemon *did* to it, and exactly when, `docker events` is the record.

---

## Watching the daemon with docker events

`docker events --filter container=my-app` streams a live feed of everything the Docker daemon
does to that container — `create`, `start`, `die`, `kill`, `oom` — as it happens, alongside
image pulls, network connects, and volume mounts for the whole host. It answers "what just
happened?" for a container that vanished or restarted with no one watching:

```bash
docker events                                   # live stream of everything
docker events --filter container=my-app         # just one container
docker events --filter event=die --filter event=oom
docker events --since 1h --until 10m            # historical window
docker events --filter type=container --format '{{.Time}} {{.Action}} {{.Actor.Attributes.name}}'
```

Two of those actions do real diagnostic work. When the kernel OOM-kills a container, the daemon
emits an explicit `oom` event, separate from the `die` that follows. That lets you tell a
memory kill from an ordinary crash straight from the stream, without waiting to inspect the
corpse.
And a container with a `HEALTHCHECK` emits `health_status` events, letting you watch it flip to
`unhealthy` the instant it does. Because the stream is daemon-wide and accepts `--since` and
`--until` windows, it is how you catch the *intermittent* restart you would otherwise miss:
leave `docker events --filter event=die` running and wait for it to fire.

Events tell you that a container restarted or died; when the question is what it wrote to disk
while it was alive, `docker diff` shows the file-level changes.

---

## Inspecting filesystem changes with docker diff

`docker diff my-app` lists every path added, changed, or deleted in the container's writable
layer since it started from its image, read from the copy-on-write layer's own change records:

```bash
docker diff my-app
# A /app/tmp
# C /etc/nginx/nginx.conf
# D /var/run/foo.pid
```

`A` is added, `C` is changed, `D` is deleted, each relative to the image layers underneath. It
answers "what has this container written to its own filesystem?" — which is how you catch an app
quietly writing logs or state into the container instead of a volume, or see what a `RUN` step
or entrypoint mutated on the way up.

One category is missing on purpose: volume and bind-mount paths never appear in `docker diff`.
Those paths live outside the writable layer — they are separate mounts grafted onto the tree —
so writes into them are invisible to a tool that only reads the copy-on-write layer's records.
A path you expected to see and cannot find is almost always one of those mounts. `docker diff`
pairs with `docker commit` when you are reverse-engineering an image, but the lesson it usually
hands you is plainer: the mutable path it keeps flagging belongs in a volume.

`docker diff` and everything before it assume the container at least started. The last section
collects the errors that stop you before that — a port already taken, a pull that fails, a full
disk, and a daemon you cannot even reach.

---

## Common errors and their fixes

Most of the errors you hit before a container even runs come from a small, memorisable set. The
message tells you which one, and each has a fix that follows directly from what it means:

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

`Cannot connect to the Docker daemon` is a different animal from the rest, because nothing of
yours ever reached the daemon. The CLI talks to it over a Unix socket, `/var/run/docker.sock`
(or whatever `DOCKER_HOST` points at). So the error means one of three things: the daemon is
down, the socket path is wrong, or your user lacks permission on it — start Docker, check
`DOCKER_HOST`, or add your user to the `docker` group. It is the usual failure in CI too. A job
that runs Docker commands from inside a container reaches the daemon only because that same
`/var/run/docker.sock` was mounted into the runner, so a missing mount is exactly why it cannot
connect. That mounting one socket lets a container drive the whole daemon is worth holding onto.

> [!WARNING]
> `docker system prune` reclaims space by deleting **stopped containers, dangling images, and
> unused networks**; add `-a` and it removes *all* unused images, and `--volumes` deletes unused
> volumes — which can wipe data you meant to keep. Run `docker system df` first to see where the
> space actually went, read the confirmation prompt, and in production prune narrowly rather than
> reaching for `-a --volumes`.

That is the whole toolbox: read the state and exit code, read the logs, get inside or reproduce,
and check config against reality. Every escalation you learned for a stubborn container — joining
its namespaces, reading it through `/proc/1/root`, reaching the daemon through a mounted socket —
works by prying open the isolation that normally keeps containers apart. The debug move and an
attack move use the identical primitives; the difference between them is only intent.

## Common follow-up questions

- "How do you debug a container that exits before you can `docker exec` into it?" Override
  the entrypoint: `docker run --rm -it --entrypoint sh <image>`, then run the real command by
  hand. `exec` can't help — the container is already gone.
- "`docker logs` shows nothing but the app is clearly running — why?" Either the app logs
  to a file instead of stdout/stderr, output is buffered (set `PYTHONUNBUFFERED=1`), or a
  remote logging driver is configured so `docker logs` can't read local logs.
- "Exit 137 vs 143 — what's the difference?" `137` = SIGKILL (OOM or forced kill after a
  stop timeout); `143` = SIGTERM (a graceful stop the app honoured). Check `.State.OOMKilled` to
  tell OOM from a kill-timeout.
- "How do you get a shell into a distroless image with no `sh`?" `docker debug`, or run a
  toolbox image (`nicolaka/netshoot`) joined to the target's PID/network namespaces, or ship a
  separate `debug` build stage.
- "How do you tell whether the kernel OOM-killed the container or the app just crashed?"
  `docker inspect --format '{{.State.OOMKilled}}'` → `true` means OOM; also watch for an `oom`
  event in `docker events`.
- "What's the difference between `docker exec` and `docker attach`?" `exec` starts a new
  process (safe for a debug shell); `attach` connects to `PID 1`'s stdio and can accidentally
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
