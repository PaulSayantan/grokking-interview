# kubernetes — Content Audit

**Executive summary.** The kubernetes domain is in strong shape: across all 19 subtopics the writing is consistently intuition-first, senior-aware, and rich in the exact gotchas and follow-up questions interviewers actually probe. Clarity is near-perfect (avg **4.95/5**, only `security-rbac` at 4) and interview depth is high (avg **4.37/5**). The one systemic weakness — and the entire reason this domain has refinement work — is **worked examples**: the example dimension averages just **3.42/5**, and 11 of 19 files score a 3. No subtopic is rated **high** refine-priority; **16 are medium** and **3 are low** (`architecture-control-plane`, `operators-crds-extensibility`, `troubleshooting-observability`). The headline takeaways: (1) the material *explains* the hard mechanics well but *shows* them with concrete numbers-in/numbers-out traces far too rarely — this is where nearly every medium rating comes from; (2) **every** file is flagged `needs_web_verification=true`, and several carry forward-dated version claims (Gateway API GA "v1.6.0 (2026)", in-place resize "GA 1.35", MutatingAdmissionPolicy "GA 1.36") that are likely wrong and would embarrass a candidate; (3) a cluster of teardown/timing gotchas (graceful shutdown, taint-based eviction timings, default-deny-egress breaking DNS) recur across subtopics and should be fixed as a group. There are no correctness disasters — this is a polish pass focused on adding traced examples and verifying version facts, not a rewrite.

## Scorecard

Sorted: no high-priority rows exist, so all rows are ordered by lowest total (clarity+examples+depth) first; ties broken by clarity then examples then depth.

| Subtopic | Clarity (/5) | Examples (/5) | Depth (/5) | Priority | Verdict |
|---|---|---|---|---|---|
| security-rbac | 4 | 3 | 5 | medium | Strong senior RBAC reference; config snippets stand in for the end-to-end request trace and rule-matching walkthrough that would remove all doubt. |
| api-objects-kubectl | 5 | 3 | 4 | medium | Excellent intuition and framing; the two hardest mechanics (server-side apply field ownership, three-way merge) are taught abstractly and need traced walkthroughs. |
| autoscaling-hpa-vpa | 5 | 3 | 4 | medium | Crystal-clear across five autoscalers but leans on prose over numbers for VPA/KEDA-lag/CA math; one forward-looking version claim to verify. |
| deployments-rolling-updates | 5 | 3 | 4 | medium | Exceptionally clear but under-delivers on numeric rollout traces and omits the graceful-shutdown/endpoint-race gotcha behind "zero-downtime" claims. |
| helm-package-management | 5 | 3 | 4 | medium | Excellent intuition; the hardest bits (whitespace/nindent, value precedence, three-way merge) are shown as syntax rather than traced rendered input/output. |
| pods-workload-controllers | 5 | 3 | 4 | medium | Clarity and depth excellent; manifest-heavy but light on traced walkthroughs (Job parallelism math, StatefulSet ordered ops, a reconciliation trace). |
| probes-resources | 5 | 3 | 4 | medium | Excellent probe teaching; the resource-management half explains scheduling/QoS/CPU-throttling in prose with no numbers-in/numbers-out example. |
| services-networking | 5 | 3 | 4 | medium | Excellent Service/traffic-flow teaching but under-uses numeric examples and omits the L4-per-connection gRPC/HTTP2 imbalance gotcha. |
| storage-volumes-pv-pvc | 5 | 3 | 4 | medium | Excellent PV/PVC "marketplace" model; no numbers-traced binding example and a few missing failure-mode gotchas (fsGroup, ungraceful node detach). |
| config-secrets | 5 | 4 | 4 | medium | Unusually clear and nails the env-vs-volume gotcha; main gap is high-value patterns (checksum restart, base64 decode, KMS) named but not shown. |
| ingress-gateway-api | 5 | 4 | 4 | medium | Excellent, well-sequenced; main risks are a likely-wrong forward-dated GA claim and a few precedence/behavior assertions without a traced example. |
| scheduling-affinity-namespaces | 5 | 3 | 5 | medium | Excellent intuition and senior depth; scoring stage and preemption described abstractly with no numbers-in/numbers-out walkthrough. |
| service-mesh-traffic-management | 5 | 3 | 5 | medium | Unusually well-taught; cost claims (latency/resource) and resilience configs asserted or shown as YAML but never turned into concrete numbers. |
| workload-network-security | 5 | 4 | 4 | medium | Well-taught security doc; one glaring gap — default-deny egress silently breaking DNS, the #1 NetworkPolicy footgun. |
| troubleshooting-observability | 5 | 4 | 4 | low | Genuinely excellent method-first debugging reference; minor polish (one undefined term, a couple of cause-lists lacking a trace). |
| architecture-control-plane | 5 | 4 | 5 | low | Excellent senior-grade file; only a few hard mechanisms (watch/resourceVersion, SSA, HA/eviction timings) stay abstract. |
| cluster-installation-upgrades | 5 | 4 | 5 | medium | Genuinely excellent ops doc; held back by two possibly-outdated factual claims and a couple of missing intuition/number walkthroughs. |
| gitops-continuous-delivery | 5 | 4 | 5 | medium | Excellent senior GitOps coverage; "examples" are config snippets rather than numeric traces, especially for progressive delivery and diff mechanics. |
| operators-crds-extensibility | 5 | 4 | 5 | low | Excellent, intuition-first and interview-deep; gaps are a few abstract concepts lacking a trace plus one forward-dated version claim. |

## Systemic issues

These themes recur across subtopics and are far more efficient to fix as a batch than file-by-file.

### 1. Missing numbers-in/numbers-out worked examples (pervasive — ~15 subtopics, and the dominant cause of every medium rating)
The single systemic weakness of the domain. Concepts are explained correctly in prose but the hard, non-obvious mechanic is almost never *traced with concrete numbers*. This is exactly the second-priority refinement bar (worked examples), and it recurs in nearly every high-severity finding:
- `deployments-rolling-updates` — proportional scaling ("the clever bit") and wave-by-wave rollout have zero numbers.
- `pods-workload-controllers` — Job `completions`/`parallelism`/`backoffLimit` math and StatefulSet ordered create/scale-down never traced.
- `probes-resources` — node-allocatable fit calculation ("why is my Pod Pending?") and CFS throttling (500m → 50ms/100ms period) only qualitative.
- `scheduling-affinity-namespaces` — scoring stage and preemption victim-selection purely abstract.
- `helm-package-management` — whitespace/`nindent` and value precedence shown as syntax, not rendered before/after.
- `service-mesh-traffic-management` — sidecar cost (latency/RAM per hop) and `outlierDetection` ejection timeline never quantified.
- `storage-volumes-pv-pvc` — PV/PVC binding never traced (the 100Gi-PV-consumed-by-20Gi-PVC no-split rule).
- `security-rbac` — no single request traced end-to-end through AuthN→AuthZ→Admission.
- Also: `autoscaling-hpa-vpa` (KEDA lag→replicas, CA scale-down %), `gitops-continuous-delivery` (canary timeline, two-repo CI flow), `services-networking` (EndpointSlice sharding, ndots query trace), `api-objects-kubectl`, `ingress-gateway-api` (path precedence tie-break).

**Fix pattern:** for each, add a short boxed trace with real numbers and, where relevant, the `kubectl` output a student would actually see.

### 2. Version/limit facts need web verification; several forward-dated claims are likely wrong (all 19 flagged; ~10 with explicit correctness risk)
Every file has `needs_web_verification=true`. The highest-risk are **forward-dated version claims** that read as fact but are past the knowledge cutoff and probably inverted/unreleased:
- `ingress-gateway-api` — "TCPRoute/UDPRoute graduated to GA in v1.6.0 (2026), latest v1.6.1 (July 2026)" and listing them in the Standard channel. These have historically stayed **Experimental**; a student would confidently cite an inverted fact. **Highest credibility risk in the domain.**
- `operators-crds-extensibility` — "MutatingAdmissionPolicy — GA in v1.36" (future release).
- `autoscaling-hpa-vpa` — in-place Pod resize "GA/stable in 1.35" (forward-looking).
- `cluster-installation-upgrades` — `--pod-eviction-timeout` presented as the live mechanism (deprecated in favor of taint-based eviction); kube-proxy "±3" skew bound questionable.
- Plus routine version/limit facts to confirm: `services-networking` (nftables GA 1.33, IPVS deprecated 1.35, EndpointSlice GA 1.21), `pods-workload-controllers` (sidecar 1.29/1.33 timeline), `probes-resources` (gRPC probes GA 1.27, CrashLoopBackOff 5m cap), `config-secrets` (SA-token 1.24, immutable 1.18/1.19/1.21, ConfigMap 1MiB), `helm-package-management` (OCI GA 3.8, sql driver), `security-rbac` (anonymous-auth default), `storage-volumes-pv-pvc` (~6min force-detach), `service-mesh-traffic-management` (24h cert default), `scheduling-affinity-namespaces` (default topology-spread constraints).

**Fix pattern:** one dedicated web-verification pass; correct the forward-dated claims first, soften unconfirmed GA versions to "targeting a later release."

### 3. The three-way merge / server-side apply / field-ownership mechanic is hand-waved (4 subtopics)
`api-objects-kubectl`, `architecture-control-plane`, `gitops-continuous-delivery`, and `helm-package-management` all reference SSA field ownership (`managedFields`) or a "three-way(-ish) diff" without ever naming the three inputs, showing a conflict error, or tracing why an HPA-owned field survives. `gitops` even uses the phrase "three-way-ish," which signals the hand-waving.

**Fix pattern:** one canonical worked example (two appliers, one owns `spec.replicas`; show the conflict message and the three resolutions) that can be adapted across the four files, plus a one-line naming of "desired vs live vs last-applied."

### 4. Graceful-shutdown / teardown side of "zero-downtime" missing (3 subtopics)
`deployments-rolling-updates` (high-severity), `pods-workload-controllers`, and `probes-resources` all teach the *new-Pod readiness gate* but omit the teardown race: Endpoint/EndpointSlice deregistration vs SIGTERM, `preStop` sleep, and `terminationGracePeriodSeconds`. This is a top senior probe ("rolling update is Ready but still drops requests — why?").

**Fix pattern:** one shared "graceful shutdown during rollout" subsection (SIGTERM → grace period → SIGKILL, endpoint-removal race, preStop drain) cross-referenced from all three.

### 5. Node-eviction and control-plane timing numbers are vague or outdated (3–4 subtopics)
`architecture-control-plane` ("a grace period," "eventually"), `cluster-installation-upgrades` (outdated `--pod-eviction-timeout`), and `scheduling-affinity-namespaces` (300s tolerationSeconds implied but not stated as the observable ~5-min failover) all under-specify the same defaults: kubelet lease ~10s, node-monitor-grace ~40s, not-ready/unreachable toleration ~300s, leader-election lease ~15s.

**Fix pattern:** standardize one set of version-qualified default numbers and use them consistently.

### 6. DNS-related networking gotchas under-covered (3 subtopics)
`workload-network-security` (high-severity — default-deny egress silently breaks CoreDNS on port 53), `services-networking` (ndots:5 latency trap named but not traced), and `troubleshooting-observability` touch the same DNS failure surface. The egress/DNS trap is a near-guaranteed interview follow-up and is barely covered.

**Fix pattern:** add the default-deny-egress + allow-53-to-kube-system worked YAML, and trace the ndots:5 query fan-out concretely.

### 7. `generation` vs `observedGeneration` asserted but never traced (2 subtopics)
`api-objects-kubectl` and `operators-crds-extensibility` both state the pattern abstractly. A shared 4-line numeric trace (edit spec → generation 2→3; controller writes observedGeneration=3 via `/status` subresource) fixes both.

## High-priority subtopics

**No subtopic carries a `high` refine-priority rating** — the domain has no crisis file. However, 14 of the 16 medium files contain individual **high-severity issues**, and those are the real work. Below are the subtopics carrying high-severity findings, worst first, with their top issues and the concrete fix. (The two mediums without high-severity issues — `config-secrets` and `cluster-installation-upgrades` — are solid; their fixes live in the Refinement plan.)

### deployments-rolling-updates (3 high-severity)
1. **[high] Proportional scaling has zero numbers** (`## Scaling and proportional scaling`). Called "the most interviewer-probed nuance" yet described only as "distributes in proportion to current sizes." Fix: trace `replicas=10` mid-rollout (oldRS=8, newRS=5) then `scale --replicas=15`, apportioning the 5 extra ~8:5 while respecting maxSurge, showing per-RS counts.
2. **[high] No wave-by-wave Pod-count trace** (`## How a rolling update executes step by step`). Fix: add a table for `replicas=4, maxSurge=25%, maxUnavailable=25%` showing each (old,new) transition with the invariants (total≤5, available≥3) visible.
3. **[high] Graceful-shutdown/endpoint race omitted** (`## The readiness-probe gate ...`). "Zero-downtime" is claimed but only the new-Pod side is covered. Fix: add the SIGTERM + terminationGracePeriodSeconds + preStop-sleep + endpoint-deregistration-race subsection.

### security-rbac (2 high-severity; lowest clarity in domain at 4)
1. **[high] No single request traced through the pipeline** (`## The auth pipeline` / `## Role and ClusterRole`). Fix: box a worked example — `jane@corp.com (groups: dev-team)` runs `kubectl get pods -n dev`; show the username/groups AuthN emits, the matching RoleBinding subject, the specific rule (apiGroups/resources/verbs), ending "allowed"; then a 403 variant.
2. **[high] Rule-matching semantics never stated** (`## Role and ClusterRole — permissions`). The AND-across-dimensions / OR-within-list / union-of-rules cross-product behavior is a common over-granting gotcha. Fix: 2–3 sentences plus a tiny multi-value rule enumerating which (apiGroup, resource, verb) combinations it authorizes.

### pods-workload-controllers (2 high-severity)
1. **[high] Job knobs untraced** (`## Job`). Fix: trace `completions:6, parallelism:2` progressing to 6 successes, backoffLimit behavior on failures, and Indexed `JOB_COMPLETION_INDEX` distribution across the 2 slots.
2. **[high] StatefulSet ordered ops abstract** (`## StatefulSet`). Fix: trace scale 0→3 (web-0 Ready → web-1 → web-2), scale 3→1 (delete web-2 then web-1, PVCs preserved), and reverse-ordinal rolling update.

### probes-resources (2 high-severity)
1. **[high] Scheduling fit-calculation is pure prose** (`## Requests vs limits` / `## Overcommit and node allocatable`). Fix: worked node-allocatable example — raw capacity minus kube/system-reserved minus eviction-hard = allocatable; sum Pod requests; show one landing Pending with FailedScheduling.
2. **[high] CFS throttling only qualitative** (`## CPU vs memory: compressible vs incompressible`). Fix: `limit: 500m` = 50ms quota / 100ms CFS period → a flat-out thread runs at half wall-clock speed; 200ms of compute takes ~400ms.

### scheduling-affinity-namespaces (2 high-severity)
1. **[high] Scoring stage abstract** (`## What the scheduler does`). Fix: 2–3 feasible nodes, show each plugin's 0–100 sub-score, apply weights, sum, declare winner; tie back to LeastAllocated vs MostAllocated.
2. **[high] Preemption victim-selection abstract** (`## Priority and preemption`). Fix: trace a full node, an incoming high-priority Pod needing 2 CPU, computing the minimum victim set, setting nominatedNodeName, honoring graceful termination, and what happens when a PDB would be violated.

### helm-package-management (2 high-severity)
1. **[high] Whitespace/`nindent` only in prose** (`## Go templating and values`). Fix: show `toYaml | indent 12` producing wrong/over-indented YAML with the parse error, then the corrected `nindent 12` valid output, plus one `{{-` trim before/after.
2. **[high] Value precedence not traced** (`## Values overriding and precedence`). Fix: values.yaml + values-prod.yaml + `--set` resolving one key to a final value; contrast a deep-merged map key vs a wholesale-replaced list key.

### service-mesh-traffic-management (2 high-severity)
1. **[high] Mesh cost never quantified** (`## The sidecar data-plane model` / `## When a mesh is worth it`). Fix: representative figures (~0.5–2ms p50 per hop, ~40–100MB RAM + fractional CPU per sidecar) multiplied out for a 500-Pod cluster; mark for web verification.
2. **[high] `outlierDetection` YAML never traced** (`## Resilience: retries, timeouts, circuit breaking`). Fix: timeline — 5 consecutive 5xx → eject 30s → rebalance → re-probe → doubling ejection; explain maxEjectionPercent=50 concretely (with 4 pods, at most 2 ejected).

### storage-volumes-pv-pvc (2 high-severity)
1. **[high] Binding never traced; no-split rule invisible** (`## Static vs dynamic provisioning`). Fix: 20Gi PVC binds a 100Gi PV → PVC shows CAPACITY=100Gi, 80Gi stranded; contrast dynamic right-sizing.
2. **[high] Ungraceful-node-failure RWO gotcha omitted** (`## Access modes — Multi-Attach WARNING`). Fix: node dies hard → volume detach uncertain → rescheduled pod stuck in Multi-Attach ~6 min until force-detach (or delete VolumeAttachment / Non-Graceful Node Shutdown taint); verify the ~6min timeout.

### ingress-gateway-api (1 high-severity — factual)
1. **[high] Forward-dated Gateway API GA claim likely wrong** (`## Gateway API GA status and release channels`). "TCPRoute/UDPRoute GA in v1.6.0 (2026)" in the Standard channel — historically Experimental. Fix: web-verify; if still experimental, move them out of the Standard column and correct the sentence; drop/replace the speculative "v1.6.1 (July 2026)".

### services-networking (1 high-severity)
1. **[high] L4-per-connection gRPC/HTTP2 imbalance gotcha missing** (`## Session affinity`). Fix: WARNING that long-lived multiplexed connections pin to one Pod so new replicas sit idle; give fixes (client-side LB, headless + client resolution, L7 proxy/mesh).

### workload-network-security (1 high-severity)
1. **[high] Default-deny egress silently breaks DNS** (`## NetworkPolicy — default behavior`). Fix: "egress and the DNS trap" subsection — default-deny-egress YAML plus the fix allowing UDP/TCP 53 to kube-system (namespaceSelector on `kubernetes.io/metadata.name: kube-system`); describe the hang-on-lookup symptom.

### api-objects-kubectl (1 high-severity)
1. **[high] Server-side apply taught entirely in prose** (`## Server-side apply and field management`). Fix: two appliers (HPA owns `spec.replicas`, GitOps owns image); show a `managedFields` snippet, the literal conflict error, and the three resolutions (force-conflicts, drop field, match value).

### gitops-continuous-delivery (1 high-severity)
1. **[high] Progressive delivery never traced through time** (`## Progressive delivery with Argo Rollouts` / `Flagger`). Fix: minute-by-minute canary timeline (10%→20%→…, success-rate drop to 97% failing checks, snap to 0% on 5 consecutive failures) for both tools.

### autoscaling-hpa-vpa (1 high-severity)
1. **[high] KEDA lag→replicas not traced; activation vs lag threshold conflated** (`## KEDA`). Fix: lag=5,000 / lagThreshold 100 = 50 replicas (clamped); show `activationLagThreshold` separately governs 0→1 while `lagThreshold` governs 1→N.

## Refinement plan

Recommended order of attack, sequenced to fix the systemic issues cheaply and retire the highest-risk items first.

**Phase 0 — Web-verification pass (do first; blocks correctness).** Every one of the 19 files has `needs_web_verification=true`, so run one consolidated verification pass before any prose edits. Prioritize the forward-dated claims that can actively mislead: `ingress-gateway-api` (Gateway API TCPRoute/UDPRoute GA/channel — **highest risk**), `operators-crds-extensibility` (MutatingAdmissionPolicy "GA 1.36"), `autoscaling-hpa-vpa` (in-place resize "GA 1.35"), `cluster-installation-upgrades` (`--pod-eviction-timeout` deprecation, kube-proxy skew). Then sweep the routine version/limit facts in `services-networking`, `pods-workload-controllers`, `probes-resources`, `config-secrets`, `helm-package-management`, `security-rbac`, `storage-volumes-pv-pvc`, `service-mesh-traffic-management`, `scheduling-affinity-namespaces`.

**Phase 1 — Shared-asset fixes (write once, apply to several files).**
- Author the canonical **three-way-merge / server-side-apply** worked example → reuse in `api-objects-kubectl`, `architecture-control-plane`, `gitops-continuous-delivery`, `helm-package-management`.
- Author the **graceful-shutdown-during-rollout** subsection → reuse in `deployments-rolling-updates`, `pods-workload-controllers`, `probes-resources`.
- Standardize the **eviction/control-plane timing defaults** → apply to `architecture-control-plane`, `cluster-installation-upgrades`, `scheduling-affinity-namespaces`.
- Author the **generation/observedGeneration** numeric trace → reuse in `api-objects-kubectl`, `operators-crds-extensibility`.
- Author the **default-deny-egress + DNS** worked YAML → `workload-network-security` (and cross-ref from `services-networking`, `troubleshooting-observability`).

**Phase 2 — Highest-impact per-file example gaps (worst first).** Work the high-severity list in this order, all of which are "add a traced example": `deployments-rolling-updates` (3 issues) → `security-rbac` → `pods-workload-controllers` → `probes-resources` → `scheduling-affinity-namespaces` → `helm-package-management` → `service-mesh-traffic-management` → `storage-volumes-pv-pvc` → `services-networking` → `api-objects-kubectl` → `gitops-continuous-delivery` → `autoscaling-hpa-vpa`. (`ingress-gateway-api`'s high-severity item is a correctness fix already handled in Phase 0.)

**Phase 3 — Medium/low polish.** Remaining medium-severity items (config-secrets' checksum/base64/KMS examples, cluster-installation-upgrades' quorum/split-brain intuition and capacity math, the various depth/gotcha additions), then the three low-priority files (`architecture-control-plane`, `operators-crds-extensibility`, `troubleshooting-observability`) which need only light touch-ups (e.g. defining QoS inline in troubleshooting, a watch-stream trace in architecture).

**needs_web_verification:** **all 19 subtopics** are flagged `true`. This is not a per-file oddity but a domain-wide property (Kubernetes version/limit facts drift every release), which is why Phase 0 is a single consolidated pass rather than folded into each file's edit.

**Missing files:** 0 of 19 (all audit files read successfully).
