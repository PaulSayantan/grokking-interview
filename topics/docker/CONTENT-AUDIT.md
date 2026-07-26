# docker — Content Audit

**Executive summary.** The docker domain is in strong shape. Across all 16 subtopics
the audit found **0 high-priority**, **11 medium-priority**, and **5 low-priority**
files — none are structurally broken and none need a rewrite. Clarity is essentially
maxed (avg **4.94/5**; only `docker-compose` sits at 4) and interview depth is high
(avg **4.375/5**), reflecting consistent intuition-first framing, [!INTERVIEW]/gotcha
callouts, and dedicated "Common follow-up questions" sections. The one systemic
weakness is **worked examples** (avg **3.63/5**): six files score only 3/5 because
their most quantitative claims (layer de-dup savings, CFS CPU quota, copy-up cost,
`docker history` byte breakdowns, health-check detection latency, scan reports) are
asserted in prose but never *traced with numbers*. The second cross-cutting risk is
**factual drift** — **15 of 16** files carry `needs_web_verification=true` for
version-sensitive numbers (pull limits, kernel/layer thresholds, default capability
counts, distroless tags, gVisor's default platform). Headline takeaway: this domain
needs **targeted example injection + a fact-verification sweep**, not restructuring.
The best single lever is adding concrete numbers-in/numbers-out walkthroughs to the
seven high-severity `example-gap` spots concentrated in the medium-priority files.

## Scorecard

Sorted high-priority first, then lowest combined (clarity + examples + depth) first.

| Subtopic | Clarity (/5) | Examples (/5) | Depth (/5) | Priority | Verdict |
|---|---|---|---|---|---|
| docker-compose | 4 | 4 | 4 | medium | Strong Compose page; env-precedence rule untraced, restart policies referenced but never defined, node_modules/DNS "why" thin. |
| image-internals-storage-drivers | 5 | 3 | 4 | medium | Exceptionally clear internals; diff_id-vs-digest, `docker history`/empty_layer, and dedup savings explained in prose, never shown. |
| multi-stage-builds-image-optimization | 5 | 3 | 4 | medium | Excellent intuition/depth; "examples" are snippets + cited sizes, not a real `docker history` breakdown or pull-cost math. |
| production-healthchecks-logging | 5 | 3 | 4 | medium | Great three-pillars coverage; missing health-check timing math and one end-to-end 502-deploy timeline; preStop mislabeled for plain Docker. |
| runtimes-oci-standards | 5 | 3 | 4 | medium | Superb runtime-stack tour; CFS quota and userns uid-mapping never traced; gVisor default platform (systrap) outdated. |
| debugging-troubleshooting | 5 | 4 | 4 | medium | Methodology-first field guide; JVM-heap-vs-limit OOM trap and `docker stats` page-cache inflation named but not worked. |
| image-scanning-supply-chain | 5 | 3 | 5 | medium | Clear, senior-depth; almost every "example" is an invocation with no annotated scan output; CVSS scale never defined. |
| images-vs-containers | 5 | 3 | 5 | medium | Excellent analogies/depth; layer-sharing, copy-up, `ps -s` claims stated abstractly; multi-arch manifest index omitted. |
| volumes-and-storage | 5 | 4 | 4 | medium | Strong core model; missing SELinux :z/:Z relabeling, Docker Desktop VirtioFS perf, and a quantified copy-up example. |
| container-lifecycle | 5 | 4 | 5 | medium | Excellent lifecycle doc; needs CFS-quota and restart-backoff traces and one OOM-victim precision fix. |
| docker-security | 5 | 4 | 5 | medium | Senior-grade; the two headline threats (docker.sock, --privileged) asserted as "trivial escape" but never shown as a traced sequence. |
| buildkit-advanced-builds | 5 | 4 | 4 | low | Polished BuildKit tour; missing cache-mount-not-exported-by-registry-cache gotcha and a concrete cache-reuse trace. |
| docker-networking | 5 | 4 | 4 | low | Excellent intuition/framing; needs an end-to-end NAT 4-tuple trace, concrete MTU number, and a few jargon glosses. |
| dockerfile-layers-build-cache | 5 | 4 | 4 | low | Excellent teaching; likely-wrong `grep CACHED` command, and ordering payoff asserted not traced. |
| entrypoint-vs-cmd | 5 | 4 | 5 | low | Exemplary note; only minor polish (trace the `${1#-}` idiom, exec-form missing-interpreter gotcha, exit-code semantics). |
| registries-and-distribution | 5 | 4 | 5 | low | Polished registry mechanics; date-sensitive pull-limit numbers and a couple of prose-only flows (token handshake, multi-arch counting). |

## Systemic issues

Clustered across subtopics, most valuable first.

### 1. Abstract claims that are never traced with numbers (the dominant theme) — ~13 files
The refinement bar's #2 priority (worked examples) is where nearly every file falls
short. Six files score example=3/5 purely on this, and every one of the **7
high-severity findings** in the domain is an `example-gap`. The pattern: a key
quantitative fact is stated in prose but the reader never sees the numbers/output.
- **`docker history` / layer bytes never shown:** `multi-stage-builds` (high),
  `image-internals-storage-drivers` (high), `dockerfile-layers-build-cache`.
- **Layer de-dup / `docker ps -s` savings asserted, not computed:**
  `images-vs-containers` (high), `image-internals-storage-drivers`.
- **Copy-on-write copy-up cost stated abstractly:** `images-vs-containers`,
  `volumes-and-storage`, `multi-stage-builds`, `image-internals`.
- **Scan report output never shown:** `image-scanning-supply-chain`.
- **Health-check detection latency / deploy 502 timeline not traced:**
  `production-healthchecks-logging` (two high-severity).
- **Env-var precedence chain untraced:** `docker-compose` (high).
- **Escape sequences ("trivial") never demonstrated:** `docker-security`.
- **NAT 4-tuple / token handshake / cache-reuse flows prose-only:**
  `docker-networking`, `registries-and-distribution`, `buildkit-advanced-builds`.

**Fix pattern:** inject one small numbers-in/numbers-out block per spot (a trimmed
`docker history`, a `ps -s` disk-math table, a byte-by-byte copy-up trace, a scan-row
table). This is the single highest-leverage change for the whole domain.

### 2. Version-sensitive facts asserted without verification — 15 of 16 files
`needs_web_verification=true` everywhere except `images-vs-containers`. Recurring
`correctness` findings flag numbers that drift across Docker/kernel releases:
- Docker Hub **pull-limit** tiers/windows (`registries-and-distribution`, medium).
- **gVisor default platform** now systrap, not ptrace (`runtimes-oci-standards`, medium).
- Default **capability count (~14)** and seccomp **blocked-syscall count**, plus a
  misleading `ptrace`-is-blocked example (`docker-security`).
- **overlay2 128-layer limit**, kernel thresholds, devicemapper removal version
  (`image-internals-storage-drivers`).
- **Versioned distroless tags** (`multi-stage-builds`); tmpfs-size/mode + prune
  defaults (`volumes-and-storage`); Windows stop-grace + restart-backoff numbers
  (`container-lifecycle`, `entrypoint-vs-cmd`); `docker debug` licensing
  (`debugging-troubleshooting`); provenance-by-default (`buildkit-advanced-builds`);
  Harbor/Fulcio/Trivy-DB claims (`image-scanning-supply-chain`).

**Fix pattern:** one dedicated web-verification pass against current docs.docker.com /
kernel docs, dating each number.

### 3. CPU CFS quota / throttling and exit-137 OOM mechanics under-explained — ~5 files
The two most "math-friendly" runtime concepts are repeatedly glossed.
- **CFS quota/period never defined** (`--cpus=1.5` = 150ms/100ms period, throttling
  vs kill): `runtimes-oci-standards` (high), `container-lifecycle` (medium).
- **Exit 137 / OOM causal chain** (JVM reads host RAM, blows the cgroup limit;
  OOM-victim is by oom_score not "PID 1"; page-cache inflates `docker stats`):
  `debugging-troubleshooting`, `container-lifecycle`, `entrypoint-vs-cmd`,
  `images-vs-containers`, `docker-security`.

### 4. Concepts referenced but never defined, and undefined jargon — ~4 files
Files lean on terms/ideas they never teach.
- **Restart policies** referenced (`unhealthy doesn't auto-restart` / dev-prod table)
  but the four policies are never defined: `docker-compose` (medium).
- **Undefined jargon on first use:** `cgroup`, `nsenter` (`debugging-troubleshooting`);
  `gossip`, `routing mesh`, `hairpin NAT` (`docker-networking`); `CVSS` scale
  (`image-scanning-supply-chain`).

### 5. Missing diagrams for inherently spatial ideas — 3 files (low severity)
Network segmentation topology (`docker-compose`), the visibility/consumption/privilege
triad (`runtimes-oci-standards`), and volume-copy-up-vs-bind-obscure
(`volumes-and-storage`) would each land instantly as a small mermaid diagram.

### 6. Recurring PID-1 / shell-vs-exec-form signal thread
Well-covered in `entrypoint-vs-cmd` but re-probed as a gap elsewhere
(`images-vs-containers` follow-up, `production-healthchecks-logging`,
`docker-security` reaping). Worth a consistent cross-link rather than partial
re-explanations.

## High-priority subtopics

**There are no high-priority (`refine_priority: high`) subtopics in this domain.**
However, seven **high-severity issues** live inside medium-priority files. Because the
refinement bar weights worked examples heavily, these are the concrete work items that
matter most; each is an `example-gap` unless noted.

### production-healthchecks-logging (2 high-severity)
1. **[high] Health-check detection latency never computed** — `## HEALTHCHECK options`
   / `## Health states`. Fix: trace a timeline — app hangs at t=0; interval=30s,
   retries=3 ⇒ failures at ~30/60/90s ⇒ unhealthy at ~t=90s; show the detection-speed
   vs flap-risk trade-off.
2. **[high] Flagship "502s during deploy" answer never assembled end-to-end** — intro
   [!INTERVIEW] / `## Draining`. Fix: add an "anatomy of a deploy" timeline mapping
   each 502 cause (readiness, SIGTERM, drain, deregistration race) to its fix.
3. **[medium] `server.close()` keep-alive trap** — pair with
   `closeIdleConnections()`/`closeAllConnections()` (Node 18+).
4. **[medium] `preStop` mislabeled** — it is Kubernetes-only; give the plain-Docker
   equivalent (in-app sleep before closing the listener).

### docker-compose
1. **[high] Env-var precedence untraced** — `## environment, env_file, .env`. Fix:
   define FOO across all five layers (image ENV, env_file, static `environment:`,
   shell, `--env`) and show a resolved "what the container actually gets" table.
2. **[medium] Restart policies referenced but never defined** — add a subsection on
   no/always/on-failure/unless-stopped and reboot-survival semantics.
3. **[medium] `node_modules` anonymous-volume "why" missing** — explain that the bind
   mount would otherwise mask the container-installed deps.
4. **[medium] DNS round-robin overstated** — note keep-alive/pooled clients pin to one
   replica, so real balancing needs a proxy.

### multi-stage-builds-image-optimization
1. **[high] No real `docker history` output** — `## Auditing and measuring`. Fix: add
   a 5–7 row `docker history --human` block and walk each row back to a taught fix.
2. **[medium] Image-size costs never quantified** — add back-of-envelope egress/cold-
   start math (GB × nodes × deploys; 1GB pull ≈ +10s at 100MB/s).
3. **[medium] Layer-whiteout rule prose-only** — add the +400MB-then-rm-still-475MB
   numeric trace.
4. **[medium] No complete Node multi-stage Dockerfile** — the tricky interpreted-lang
   case (prod-deps reinstall vs copy) is missing.

### image-internals-storage-drivers
1. **[high] diff_id vs digest never shown side by side** — `## diff_id vs digest`.
   Fix: show a manifest blob digest next to the config `rootfs.diff_ids` entry and the
   gzip/uncompressed hashing relationship.
2. **[medium] `docker history`/empty_layer output never shown**; dedup savings never
   computed; **[medium] containerd snapshotters** (modern image store) appear only as
   a bare link — add 2–4 sentences on graph-driver → snapshotter supersession.

### runtimes-oci-standards
1. **[high] CFS quota never traced** — `## cgroups`. Fix: period=100ms, `--cpus=1.5` ⇒
   quota 150ms/period; show a 4-thread throttle example and contrast throttle-vs-OOM;
   add a one-line cpu-shares 2:1 example.
2. **[medium] USER-namespace uid mapping abstract** — add an `/etc/subuid`
   `alice:100000:65536` walkthrough showing why an escape lands as unprivileged.
3. **[medium] gVisor default platform outdated** — systrap is now default, not ptrace.
4. **[medium] gVisor-vs-Kata choice asserted, not reasoned** — add selection guidance
   with rough magnitudes (Firecracker ~125ms boot / <5MiB).

### images-vs-containers
1. **[high] Layer-sharing / `docker ps -s` disk math never shown** — Fix: pull nginx
   (~187MB), run 5 containers, show `ps -s` (SIZE ~2B vs VIRTUAL ~187MB) and total
   ≈187MB vs naive 935MB.
2. **[medium] Copy-up cost prose-only** (2GB file → writable layer jumps 2GB);
   **[medium] multi-arch manifest index** omitted from digest-pinning discussion.

### volumes-and-storage
1. **[high] SELinux :z/:Z relabeling entirely missing** — `## Bind mounts` /
   `## Permissions`. Fix: add the relabel subsection; the doc currently attributes all
   bind-mount denials to UID mismatch, leaving the SELinux "permission denied" case
   undiagnosable.
2. **[medium] Docker Desktop VirtioFS perf mechanism** unexplained; **[medium]**
   quantified copy-up example for the "DBs must not use the container layer" argument.

## Refinement plan

Recommended order of attack (fastest-to-highest-impact first):

1. **Example-injection sprint (biggest lever, raises the domain's weakest axis).**
   Work the seven high-severity `example-gap` items in this order:
   `production-healthchecks-logging` (2 items) → `docker-compose` →
   `multi-stage-builds-image-optimization` → `image-internals-storage-drivers` →
   `runtimes-oci-standards` → `images-vs-containers` → `volumes-and-storage`. Each is a
   self-contained numbers-in/numbers-out block; no restructuring needed.

2. **Fill the two "referenced-but-undefined" holes** while in those files: define the
   four restart policies (`docker-compose`) and add the SELinux :z/:Z subsection
   (`volumes-and-storage`) — these are correctness/completeness gaps, not just polish.

3. **Runtime-mechanics pass:** unify the CFS-quota trace and exit-137/OOM causal chain
   across `runtimes-oci-standards`, `container-lifecycle`, `debugging-troubleshooting`,
   `docker-security`, `entrypoint-vs-cmd`, `images-vs-containers` so the explanation is
   consistent and cross-linked rather than partially re-derived.

4. **Low-priority polish:** `dockerfile-layers-build-cache` (fix the `grep CACHED`
   command → `--progress=plain … 2>&1`), `docker-networking` (NAT 4-tuple trace + MTU
   number + jargon glosses), `buildkit-advanced-builds` (cache-mount-not-exported
   gotcha), `registries-and-distribution` and `entrypoint-vs-cmd` (small traces).

5. **Single web-verification sweep (do last, batch it).** **15 of 16 files** have
   `needs_web_verification=true`; only **`images-vs-containers`** does not. Verify and
   date, against current docs: Docker Hub pull limits (`registries-and-distribution`),
   gVisor default platform (`runtimes-oci-standards`), default capability + seccomp
   counts and the ptrace example (`docker-security`), overlay2 128-layer/kernel/
   devicemapper facts (`image-internals-storage-drivers`), distroless tags + size
   figures + musl DNS (`multi-stage-builds`), tmpfs/prune defaults
   (`volumes-and-storage`), Windows stop-grace + restart-backoff
   (`container-lifecycle`, `entrypoint-vs-cmd`), `docker debug` licensing
   (`debugging-troubleshooting`), provenance-by-default
   (`buildkit-advanced-builds`), Harbor/Fulcio/Trivy-DB claims
   (`image-scanning-supply-chain`).

**Missing/unreadable files:** 0 of 16 (all audit files read successfully).
