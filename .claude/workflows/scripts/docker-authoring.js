export const meta = {
  name: 'docker-authoring',
  description: 'Author interview-grade concepts.md + a 40-60 MCQ questions.yaml for all 16 Docker topics, then verify each for factual accuracy and schema compliance',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact-check + schema-check each topic, fix in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/docker`

const SCOPE_NOTE = `
DOMAIN SCOPE — "Docker" (containers) for BACKEND + SENIOR developer interviews. Teach how
containers and Docker actually work — image/layer internals, the container runtime, Dockerfile
mechanics, networking, storage, security — concretely and hands-on (real Dockerfile snippets,
docker CLI, compose YAML). Concept-first, then specifics.

BOUNDARY vs already-authored / upcoming domains (cross-reference, don't duplicate):
- devops-cicd (AUTHORED) references Docker at the PIPELINE level (building/scanning/pushing images
  in CI, supply-chain SLSA/SBOM/Sigstore). THIS domain owns CONTAINER internals & Docker mechanics.
  For 'image-scanning-supply-chain' here, teach the Docker-specific angle (Trivy/Grype/Docker Scout
  scanning image layers, image signing/cosign for images, SBOM of an image, base-image CVEs,
  distroless) and POINT to devops-cicd/software-supply-chain-security for the general framework.
- kubernetes (UPCOMING, separate domain) orchestrates containers — do NOT teach pods/K8s here;
  where relevant (e.g. runtimes/CRI, health checks) mention K8s as the consumer and point onward.
- security (AUTHORED) owns general appsec. 'docker-security' here = CONTAINER security specifically
  (rootless, user namespaces, capabilities drop, seccomp/AppArmor, --privileged dangers, read-only
  rootfs, secrets not in images/layers, escaping-the-container threat model) + a pointer.
- operating-systems (UPCOMING) will own OS internals deeply. 'runtimes-oci-standards' and isolation
  here use namespaces/cgroups at the CONTAINER-mechanism level (what isolates a container) — teach
  them concretely but note the OS domain covers namespaces/cgroups theory in general.

Ground claims in authoritative sources: Docker docs, the OCI specs (image-spec, runtime-spec,
distribution-spec), containerd/runc docs, BuildKit docs, Linux namespaces/cgroups man pages,
Docker security docs (CIS Docker Benchmark), Trivy/Docker Scout docs. Verify specifics via web
research (layer caching invalidation rules, ENTRYPOINT vs CMD exec/shell forms, network driver
behavior, copy-on-write storage, USER/rootless, healthcheck states, OCI runtime flow).
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (MCQ anchor targets — keep stable).
   - Layered interview-grade answers (beginner def+why -> intermediate trade-offs -> advanced internals/gotchas).
   - Concrete examples: Dockerfile snippets, docker CLI commands, compose YAML, layer/CoW diagrams,
     comparison tables. Hands-on and accurate.
   - If a diagram helps (image layer stack, build cache flow, network topology, OCI runtime flow,
     container lifecycle states), use a \`\`\`mermaid fenced block (flowchart/stateDiagram-v2/
     sequenceDiagram). NO ASCII-art. Keep Dockerfile/CLI/YAML in normal fenced code blocks.
     IMPORTANT: in Mermaid sequenceDiagram message text, never use a semicolon (';' is a statement
     separator and breaks the parser) — use commas/"then".
   - End with "## Common follow-up questions" and "## References".
   - Factual accuracy is critical.

2) questions.yaml — top-level keys:
     topic: "<Topic Name>"
     domain: docker
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001    # unique, zero-padded 3-digit seq; prefix == slug
         difficulty: beginner     # beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options: ["<0>","<1>","<2>","<3>"]
         answer: 2                # 0-BASED index
         explanation: |
           <why correct; teach the concept>
         ref: "concepts.md#<anchor>"  # resolves to a real "## " heading (GitHub slug rules)

   RULES: 40-60 questions (min 40); cover EVERY subtopic; 3-5 options, exactly one correct, 0-based
   answer; VARY the correct index (no clustering, no trivially-guessable repeating cycle); mixed
   difficulty (Pass 1 — don't over-index on expert); INCLUDE scenario-style questions ("given this
   Dockerfile / this docker run / this compose file / this build output, what happens / what's
   wrong / which fixes it / why is the image huge?"); distractors plausible but wrong for a real
   reason; no all/none-of-the-above; every 'ref' resolves to a real "## " heading; id prefix == slug.

Use the Write tool. Do your own web research. Return: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'images-vs-containers', name: 'Docker Fundamentals: Images vs Containers', hints: "image = immutable read-only template (stack of layers + manifest/config); container = running instance = image + a thin writable layer (copy-on-write); the image:tag / digest identity; container vs VM (shared kernel, no guest OS, process isolation via namespaces/cgroups vs full hypervisor); why containers are lightweight/fast/portable; the container is just a process; image layers shared across containers; ephemeral containers & the 12-factor 'disposable' idea; docker run = create+start; the union filesystem intro." },
  { slug: 'container-lifecycle', name: 'Container Lifecycle & Runtime Operations', hints: "lifecycle states (created/running/paused/stopped/exited/dead) & the state machine; docker run/create/start/stop/restart/pause/kill/rm; SIGTERM then SIGKILL on stop (grace period, --time); exit codes & why a container exits (main process ends); restart policies (no/on-failure/always/unless-stopped); detached vs foreground, -it (tty/interactive); exec into a running container; docker ps/inspect/logs/stats; PID 1 & the zombie-reaping problem (--init/tini); attach vs exec; resource limits (--memory/--cpus) at runtime." },
  { slug: 'dockerfile-layers-build-cache', name: 'Dockerfile, Layers & Build Cache', hints: "Dockerfile instructions & which create layers (RUN/COPY/ADD create layers; ENV/WORKDIR/etc. metadata); the build context & .dockerignore; layer caching — cache invalidation rules (a changed instruction busts it AND all subsequent layers); ORDER instructions least-to-most-frequently-changed (deps before source) for cache hits; COPY vs ADD (ADD's tar/URL magic, prefer COPY); combining RUN with && to reduce layers; why each layer adds size (deleting a file in a later layer doesn't shrink earlier ones); RUN cache with package managers; ARG vs ENV; base image (FROM) & scratch." },
  { slug: 'entrypoint-vs-cmd', name: 'ENTRYPOINT vs CMD & Container Startup', hints: "CMD (default args, easily overridden by `docker run` args) vs ENTRYPOINT (the executable, args appended); the two combined (ENTRYPOINT=binary + CMD=default args); EXEC form ([\"exe\",\"arg\"], no shell, PID 1 is the exe, receives signals) vs SHELL form (runs via /bin/sh -c, shell is PID 1, signals go to shell not app — the SIGTERM problem); --entrypoint override; entrypoint scripts (exec \"$@\" to hand off PID 1 and forward signals); why exec-form matters for graceful shutdown; shell-form variable expansion." },
  { slug: 'multi-stage-builds-image-optimization', name: 'Multi-Stage Builds & Image Optimization', hints: "multi-stage builds (multiple FROM, COPY --from=stage, build deps stay in builder stage, only artifacts copied to final = small image); named stages & --target; minimizing image size (small base: alpine/slim/distroless/scratch; combine RUN; clean apt cache; .dockerignore; fewer layers; static binaries); distroless (no shell/package manager -> smaller + more secure but harder to debug); why smaller images = faster pulls/deploys + smaller attack surface; build-time vs runtime deps separation; the fat-image anti-pattern; layer reuse across images." },
  { slug: 'volumes-and-storage', name: 'Volumes, Bind Mounts & Data Persistence', hints: "the ephemeral writable layer (data lost on rm) -> need persistence; named VOLUMES (managed by Docker, /var/lib/docker/volumes, portable, preferred for data) vs BIND MOUNTS (host path, dev/config, host-dependent) vs tmpfs (in-memory); volume lifecycle & docker volume commands; sharing volumes between containers; mount consistency & permissions/UID issues; volume drivers (nfs/cloud); copy-on-write & why DB data should NOT live in the container layer; anonymous vs named volumes; -v vs --mount syntax; backing up volumes." },
  { slug: 'docker-networking', name: 'Docker Networking', hints: "network drivers — bridge (default, containers on a private subnet + NAT to host), host (share host net stack, no isolation), none, overlay (multi-host/swarm), macvlan; the default bridge vs USER-DEFINED bridge (user-defined gives automatic DNS by container name — key difference); port publishing (-p host:container, EXPOSE is just docs); container-to-container comms on the same network; embedded DNS resolver; --network & connecting containers; localhost inside a container != host; iptables/NAT under the hood; compose networks; network namespaces as the isolation mechanism." },
  { slug: 'docker-compose', name: 'Docker Compose & Multi-Container Apps', hints: "compose.yaml structure (services/networks/volumes); defining multi-container apps declaratively; service discovery (services reach each other by service name via the default compose network DNS); depends_on (ordering, and why it does NOT wait for readiness -> need healthchecks/wait); environment/env_file, .env variable substitution; ports/volumes/networks per service; build vs image; scaling (--scale); profiles; override files; compose vs Dockerfile (compose orchestrates, Dockerfile builds); dev vs prod compose; compose is single-host (K8s for multi-host — pointer)." },
  { slug: 'registries-and-distribution', name: 'Registries, Tagging & Distribution', hints: "registries (Docker Hub, GHCR, ECR, private); repository:tag naming (registry/namespace/repo:tag); tags are MUTABLE pointers vs the immutable content-addressable DIGEST (sha256) -> pin by digest for reproducibility; 'latest' is not special & is a foot-gun; push/pull auth (docker login, tokens); the image manifest & manifest lists (multi-arch — one tag, per-platform images); layer dedup/sharing on push (only changed layers uploaded); pull rate limits; distribution spec; image promotion across registries; garbage collection." },
  { slug: 'production-healthchecks-logging', name: 'Health Checks, Logging & Graceful Shutdown', hints: "HEALTHCHECK instruction (CMD, interval/timeout/retries/start-period; states starting->healthy/unhealthy) & why (orchestrators route on health); healthcheck vs liveness/readiness (K8s pointer); LOGGING — containers log to stdout/stderr (12-factor), the json-file driver (default, & log rotation max-size/max-file to avoid disk-fill), other drivers (journald/fluentd/awslogs); don't log to files inside containers; GRACEFUL SHUTDOWN — SIGTERM handling, PID 1 must forward/handle signals (exec form + tini), stop grace period, draining in-flight requests; the 'app ignores SIGTERM' pitfall." },
  { slug: 'debugging-troubleshooting', name: 'Debugging & Troubleshooting Containers', hints: "docker logs (stdout/stderr, -f, --tail, --since); docker exec -it <c> sh/bash to get a shell; docker inspect (config/mounts/network/state/exit code); docker stats (live resource use); why a container won't start / exits immediately (main process ends, bad ENTRYPOINT, missing file, permission); OOMKilled (exit 137 = SIGKILL, check --memory) vs exit 143 (SIGTERM); debugging distroless (no shell -> ephemeral debug container `docker debug`/`kubectl debug`, or copy in busybox); events; diff (fs changes); common errors (port in use, image not found, ENTRYPOINT not executable, arch mismatch exec format error)." },
  { slug: 'docker-security', name: 'Security Best Practices', hints: "run as NON-root (USER instruction; root-in-container ~ risky) & rootless Docker; user namespaces (remap container root to unprivileged host uid); drop Linux capabilities (--cap-drop ALL + add only needed) & why default caps are broad; --privileged is dangerous (full host access — avoid); read-only root filesystem (--read-only + tmpfs for writable); seccomp & AppArmor/SELinux profiles (syscall filtering); no secrets in images/ENV/layers (they persist in history) -> use secrets/mounts; --security-opt no-new-privileges; the docker socket = root (never mount /var/run/docker.sock into untrusted containers); container escape threat model; CIS Docker Benchmark; POINT to security domain for appsec basics." },
  { slug: 'image-scanning-supply-chain', name: 'Image Scanning & Supply-Chain Security', hints: "scanning image layers for CVEs (Trivy, Grype, Docker Scout, Clair) — OS packages + app deps; base-image vulnerabilities & why smaller/distroless base = fewer CVEs; keeping bases updated & rebuild cadence; SBOM of an image (what's inside); image SIGNING & verification (cosign/sigstore, Docker Content Trust/Notary) — provenance & tamper-evidence; pinning base images by digest (not floating tags) for reproducibility & to prevent tag-hijack; scanning in CI (fail on critical) & at registry; admission control verifying signatures; POINT to devops-cicd/software-supply-chain-security for the general SLSA/framework view — here it's the Docker-image-specific angle." },
  { slug: 'buildkit-advanced-builds', name: 'BuildKit & Advanced Builds', hints: "BuildKit (the modern build engine, default in recent Docker) vs the legacy builder — parallel stage execution, better caching, faster; build cache mounts (RUN --mount=type=cache for package/deps caches persisted across builds) & bind/secret/ssh mounts (--mount=type=secret so secrets don't land in layers; --mount=type=ssh for private git); heredocs; the frontend (Dockerfile syntax directive); multi-platform builds with buildx (--platform, QEMU emulation vs native builders); remote/registry cache (--cache-to/--cache-from) for CI; provenance/SBOM attestations; docker buildx bake." },
  { slug: 'image-internals-storage-drivers', name: 'Image Internals & Storage Drivers', hints: "image = ordered layers + a JSON config (env/cmd/entrypoint/architecture) + a manifest; each layer is a content-addressed (sha256) tarball of filesystem changes (diff); the UNION filesystem stacking layers into one view; COPY-ON-WRITE (a container's writable layer copies a file up on modify; unchanged files read from lower layers, shared); overlay2 storage driver (lowerdir/upperdir/merged/workdir) — the default; whiteout files for deletions; why layer order & sharing save space; content-addressable store & dedup; the image config vs manifest vs layers; how digests make images immutable/verifiable." },
  { slug: 'runtimes-oci-standards', name: 'Container Runtimes, Isolation Internals & OCI Standards', hints: "the runtime stack: docker CLI -> dockerd -> containerd (high-level runtime: image pull, lifecycle) -> runc (low-level OCI runtime: actually creates the container via namespaces/cgroups) -> the container process; the OCI specs (image-spec, runtime-spec, distribution-spec) & why standards matter (interoperability); CRI (Container Runtime Interface) so K8s can use containerd/CRI-O (K8s pointer, dockershim removal); ISOLATION internals — Linux NAMESPACES (pid/net/mnt/uts/ipc/user) = what a container sees, CGROUPS = what a container can use (cpu/mem limits); capabilities; alternative runtimes (gVisor/Kata for stronger isolation via sandbox/microVM); rootless containers; namespaces/cgroups theory lives deeper in the OS domain — pointer." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior platform/backend engineer and interview coach authoring interview-grade study material for the Docker topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / frequently-asked subtopics to cover for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . This is Pass 1 — aim for 40-60 solid MCQs.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer verifying interview content for the Docker topic "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `The files are at ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml . Read BOTH.\n\n` +
    `Check and FIX IN PLACE (using Edit/Write) any of:\n` +
    `1) FACTUAL ERRORS in concepts.md or MCQ answers/explanations. Web-research anything uncertain — layer cache invalidation (a changed instruction busts it + all following), ENTRYPOINT vs CMD & exec-vs-shell-form signal behavior, default vs user-defined bridge DNS, named-volume vs bind-mount semantics, tag-vs-digest mutability, exit codes (137 OOMKilled/SIGKILL vs 143 SIGTERM), overlay2 CoW/whiteout, the docker->containerd->runc->namespaces/cgroups stack, OCI specs, non-root/capabilities/--privileged risks. A wrong 'answer' index or a mischaracterized Docker mechanic is the WORST defect — fix it.\n` +
    `2) SCOPE DRIFT / DUPLICATION: this domain owns container internals + Docker mechanics. If it teaches Kubernetes pods/orchestration (upcoming k8s domain), general appsec (security domain), the general supply-chain SLSA framework (devops-cicd owns it — keep the Docker-image-specific angle + pointer), or deep OS namespaces/cgroups theory (upcoming OS domain — keep the container-mechanism level), TRIM to a cross-reference pointer.\n` +
    `3) SCHEMA violations: valid YAML; top-level keys topic/domain(docker)/topic_slug(${t.slug})/version/questions; ids (prefix '${t.slug}-', unique, 3-digit seq); difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based 'answer' in range; explanation; correct-option position VARIED (rebalance if any index >40% OR a trivially-guessable repeating cycle).\n` +
    `4) Every 'ref: concepts.md#anchor' resolves to a real '## ' heading (GitHub slug rules). Any Mermaid blocks valid — CRITICAL: no semicolons in sequenceDiagram message text (breaks the parser; use commas). Confirm diagram headers are valid.\n` +
    `5) COVERAGE: >=40 questions, every subtopic represented, mixed difficulty, scenario-style questions present. Add if thin.\n\n` +
    `After fixing, return a one-line verdict: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
