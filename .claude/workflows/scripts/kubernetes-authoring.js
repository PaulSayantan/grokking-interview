export const meta = {
  name: 'kubernetes-authoring',
  description: 'Author interview-grade concepts.md + a 40-60 MCQ questions.yaml for all 19 Kubernetes topics, then verify each for factual accuracy and schema compliance',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact-check + schema-check each topic, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/kubernetes`

const SCOPE_NOTE = `
DOMAIN SCOPE — "Kubernetes" for BACKEND + SENIOR developer interviews. Teach how K8s actually
works — the control plane, objects/controllers & the reconciliation loop, scheduling, networking,
storage, security, extensibility — concretely and hands-on (real YAML manifests, kubectl commands,
the declarative desired-state model). Concept-first, then specifics. Builds on the Docker domain
(containers) — assume container basics, reference the docker domain rather than re-teaching images.

BOUNDARY vs already-authored / upcoming domains (cross-reference, don't duplicate):
- docker (AUTHORED) owns container/image internals (Dockerfile, layers, overlay2, containerd/runc,
  namespaces/cgroups). K8s consumes containers via the CRI — reference docker; don't re-teach images.
- devops-cicd (AUTHORED) owns the general GitOps concept, deployment strategies, CI/CD. The
  'gitops-continuous-delivery' topic HERE = GitOps AS APPLIED TO K8S (Argo CD/Flux reconciling a
  cluster, app-of-apps, sync waves, progressive delivery with Argo Rollouts/Flagger) + pointer to
  devops-cicd/gitops for the general principle.
- observability (AUTHORED) owns metrics/logs/traces/OTel/Prometheus mechanics. 'troubleshooting-
  observability' HERE = K8S-specific troubleshooting (kubectl describe/logs/events, CrashLoopBackOff/
  ImagePullBackOff/Pending/OOMKilled diagnosis, metrics-server, the K8s events model) + pointer.
- security (AUTHORED) owns general appsec. 'security-rbac' and 'workload-network-security' HERE =
  K8S security specifically (RBAC roles/bindings/service accounts, Pod Security Standards/admission,
  NetworkPolicy, secrets-at-rest/etcd encryption, image/supply-chain admission) + pointer.
- aws (AUTHORED aws-containers-ecs-eks) covers EKS at the AWS-service level. Keep K8s here
  cloud-agnostic; mention EKS/GKE/AKS as managed-control-plane examples, point to aws for EKS depth.
- Cloud/IaC provisioning of the cluster is devops-cicd; here 'cluster-installation-upgrades' is the
  K8s lifecycle (kubeadm, version skew, upgrade order, etcd backup/restore) not general IaC.

Ground claims in authoritative sources: the Kubernetes docs, the K8s API reference, CNCF project
docs (Argo CD/Flux, Helm, Istio/Linkerd, KEDA, Karpenter, cert-manager, Gateway API), the CRI/CNI/
CSI specs, Pod Security Standards, kube-scheduler docs. Verify version-specific behavior via web
research (dockershim removal, PodSecurityPolicy removal→PSS, Gateway API GA status, probe semantics,
HPA v2, topology spread, ephemeral containers).
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (MCQ anchor targets — keep stable).
   - Layered interview-grade answers (beginner def+why -> intermediate trade-offs -> advanced internals/gotchas).
   - Concrete examples: K8s YAML manifests, kubectl commands, comparison tables, a reconciliation-loop
     or traffic-flow walkthrough. Hands-on and accurate; cloud-agnostic.
   - If a diagram helps (control-plane components, reconciliation loop, pod networking, service/ingress
     traffic flow, rolling-update sequence, scheduling flow), use a \`\`\`mermaid fenced block
     (flowchart/stateDiagram-v2/sequenceDiagram). NO ASCII-art. Keep YAML/kubectl in normal code blocks.
     IMPORTANT: in Mermaid sequenceDiagram message text, never use a semicolon (';' is a statement
     separator and breaks the parser) — use commas/"then".
   - End with "## Common follow-up questions" and "## References".
   - Factual accuracy is critical.

2) questions.yaml — top-level keys:
     topic: "<Topic Name>"
     domain: kubernetes
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
   manifest / this kubectl output / this pod status / this Service+Ingress, what happens / what's
   wrong / why is the pod Pending / which fixes it?"); distractors plausible but wrong for a real
   reason; no all/none-of-the-above; every 'ref' resolves to a real "## " heading; id prefix == slug.

Use the Write tool. Do your own web research. Return: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'architecture-control-plane', name: 'Kubernetes Architecture & Control Plane', hints: "control plane components (kube-apiserver = the front door & only thing that talks to etcd; etcd = the consistent key-value store / cluster state; kube-scheduler = places pods; kube-controller-manager = runs controllers; cloud-controller-manager); node components (kubelet = node agent, ensures containers run; kube-proxy = service networking/iptables/IPVS; container runtime via CRI); the declarative model & the RECONCILIATION LOOP (desired state in etcd, controllers drive actual→desired, level-triggered not edge); everything-is-an-object via the API; control-plane HA (stacked vs external etcd, quorum); how a `kubectl apply` flows end-to-end (apiserver→etcd→scheduler→kubelet)." },
  { slug: 'api-objects-kubectl', name: 'Kubernetes API, Objects & kubectl', hints: "the object model (apiVersion/kind/metadata/spec/status; spec=desired, status=actual); API groups & versions (core v1, apps/v1, etc.) & resource/kind; labels & selectors (the glue) vs annotations (non-identifying metadata); namespaces (scoping, namespaced vs cluster-scoped resources); kubectl basics (get/describe/apply/delete/logs/exec/edit/explain, -o yaml/json/wide/jsonpath); declarative `apply` (3-way merge, last-applied) vs imperative create/run; dry-run & server-side apply; kubeconfig (contexts/clusters/users); finalizers & owner references (cascading delete); the resource lifecycle." },
  { slug: 'pods-workload-controllers', name: 'Pods & Workload Controllers', hints: "the Pod (smallest deployable unit, one+ containers sharing net namespace/IP + volumes; usually one app container + sidecars; ephemeral, cattle-not-pets); why you rarely create bare pods → CONTROLLERS: ReplicaSet (maintain N replicas), Deployment (manages ReplicaSets, for stateless), StatefulSet (stable identity/ordinal + stable storage + ordered rollout, for stateful), DaemonSet (one pod per node, e.g. log/metrics agents), Job (run-to-completion) & CronJob (scheduled); init containers vs sidecars (native sidecars as init w/ restartPolicy:Always in 1.29+); pod phases/conditions; multi-container patterns (sidecar/ambassador/adapter); restartPolicy." },
  { slug: 'deployments-rolling-updates', name: 'Deployments, Rolling Updates & Rollbacks', hints: "Deployment manages ReplicaSets for declarative updates; ROLLING UPDATE strategy (maxSurge/maxUnavailable control the pace) vs Recreate (downtime); how a rollout works (new RS scaled up, old scaled down, gated by readiness probes); rollout status/history/undo (kubectl rollout status/history/undo, revisionHistoryLimit); pausing/resuming; the readiness-probe gate is critical (a pod not Ready won't get traffic & stalls the rollout — progressDeadlineSeconds); rollback = scale back the old RS; canary/blue-green need extra tooling (Argo Rollouts — pointer); scaling (kubectl scale, replicas); change-cause annotation." },
  { slug: 'probes-resources', name: 'Health Probes & Resource Management', hints: "the three probes — LIVENESS (restart the container if it fails), READINESS (remove from Service endpoints if not ready, don't restart), STARTUP (protect slow-starting apps, gates the other two) — and the classic mistake of conflating liveness/readiness (liveness failing = restart loop; readiness failing = pulled from LB); probe types (httpGet/tcpSocket/exec/grpc) & timing (initialDelay/period/timeout/success/failureThreshold); RESOURCES — requests (used for SCHEDULING & guarantees) vs limits (enforced cap); CPU (compressible, throttled) vs MEMORY (incompressible → exceed limit = OOMKilled); QoS classes (Guaranteed/Burstable/BestEffort) & eviction order; LimitRange & ResourceQuota; overcommit." },
  { slug: 'config-secrets', name: 'Configuration & Secrets Management', hints: "ConfigMaps (non-sensitive config) & Secrets (base64-ENCODED not encrypted by default — a common gotcha; enable etcd encryption-at-rest + RBAC); consuming config — as env vars (envFrom/valueFrom) vs mounted VOLUMES (files; volume-mounted configmaps update live, env vars do NOT → need pod restart); immutable ConfigMaps/Secrets (perf + safety); secret types (Opaque, dockerconfigjson, tls, service-account-token); external secrets (External Secrets Operator, Secrets Store CSI Driver pulling from Vault/cloud) & sealed-secrets/SOPS for GitOps; 12-factor config; downward API (pod metadata into the container); why not to bake config into images." },
  { slug: 'services-networking', name: 'Services & Cluster Networking', hints: "the K8s network model (every pod gets a routable IP, pods communicate without NAT — CNI implements it: Calico/Cilium/flannel); SERVICE types — ClusterIP (stable virtual IP + DNS for a set of pods, internal), NodePort (port on every node), LoadBalancer (cloud LB), ExternalName; Services select pods by label → Endpoints/EndpointSlices; kube-proxy implements Service VIPs (iptables vs IPVS); cluster DNS (CoreDNS, service-name.namespace.svc.cluster.local); headless Service (clusterIP:None → direct pod DNS, for StatefulSets); how a request reaches a pod (Service VIP → kube-proxy → pod); session affinity; why pod IPs are ephemeral → Services." },
  { slug: 'ingress-gateway-api', name: 'Ingress, Gateway API & External Traffic', hints: "Ingress (L7 HTTP routing by host/path to Services, needs an Ingress CONTROLLER e.g. nginx/Traefik/cloud — the resource alone does nothing); TLS termination & annotations (controller-specific, the Ingress pain point); Ingress limitations → the GATEWAY API (the modern successor, GA/stable; role-oriented: GatewayClass/Gateway/HTTPRoute; more expressive, portable, cross-namespace routing, traffic splitting built-in); Ingress vs Gateway API vs Service type=LoadBalancer; ExternalDNS & cert-manager (ACME/Let's Encrypt automation); north-south (Ingress/Gateway) vs east-west (Service/mesh) traffic; when to use each." },
  { slug: 'storage-volumes-pv-pvc', name: 'Storage: Volumes, PV, PVC & StorageClasses', hints: "the ephemeral-container-fs problem → volumes; volume types (emptyDir, hostPath dangers, configMap/secret, persistentVolumeClaim); the PV/PVC abstraction (PV = a piece of storage in the cluster; PVC = a user's request/claim; binding decouples pods from storage details); STATIC (admin pre-provisions PV) vs DYNAMIC provisioning (StorageClass + CSI driver auto-creates PV on PVC); access modes (RWO/ROX/RWX — and which volume types support RWX); reclaim policies (Retain/Delete); the CSI (Container Storage Interface); StatefulSet volumeClaimTemplates (per-pod PVC); volume expansion; storage for stateful workloads; snapshots." },
  { slug: 'scheduling-affinity-namespaces', name: 'Scheduling, Affinity & Multi-tenancy', hints: "the scheduler's job (filter/predicates → score/priorities → bind) & how it picks a node; nodeSelector (simple) vs node AFFINITY (required/preferred, expressive) vs POD affinity/anti-affinity (co-locate / spread relative to other pods); TAINTS & TOLERATIONS (a node repels pods unless they tolerate it — for dedicated/tainted nodes, e.g. GPU or control-plane); topology spread constraints (even distribution across zones/nodes); resource-request-based placement; priority & preemption (PriorityClass, evict lower-priority when full); MULTI-TENANCY (namespaces + ResourceQuota + LimitRange + RBAC + NetworkPolicy = soft multi-tenancy; hard multi-tenancy needs more, e.g. vCluster); cordon/drain." },
  { slug: 'autoscaling-hpa-vpa', name: 'Autoscaling: HPA, VPA, Cluster Autoscaler, KEDA & Karpenter', hints: "three axes of autoscaling: HPA (Horizontal Pod Autoscaler — scale replicas on CPU/mem or custom/external metrics, needs metrics-server, HPA v2 multiple metrics + behavior/stabilization), VPA (Vertical — right-sizes requests/limits, evicts to resize, DON'T run VPA + HPA on the same CPU metric), Cluster Autoscaler (adds/removes NODES when pods can't schedule / are underused); KEDA (event-driven autoscaling — scale on queue depth/Kafka lag/etc., scale-to-zero); Karpenter (modern node autoscaler — just-in-time right-sized nodes, faster/flexible vs CA); the interplay (HPA scales pods → CA/Karpenter scales nodes); scaling metrics & thrash/stabilization; scale-to-zero." },
  { slug: 'security-rbac', name: 'Authentication, Authorization & RBAC', hints: "the auth pipeline: AUTHENTICATION (who — certs, tokens, OIDC, service-account tokens; users aren't K8s objects, ServiceAccounts are) → AUTHORIZATION (RBAC) → ADMISSION; RBAC objects — Role/ClusterRole (permissions: verbs on resources) + RoleBinding/ClusterRoleBinding (grant to subjects: users/groups/service accounts); namespaced (Role) vs cluster-wide (ClusterRole); least privilege & avoiding cluster-admin; ServiceAccounts for pods (default SA, token projection, bound tokens, IRSA/workload identity for cloud); aggregated ClusterRoles; checking access (kubectl auth can-i); the anonymous/system groups; why RBAC is deny-by-default; pointer to security domain for authz theory." },
  { slug: 'workload-network-security', name: 'Workload & Network Security', hints: "POD SECURITY — Pod Security Standards (Privileged/Baseline/Restricted) enforced by Pod Security Admission (replaced the removed PodSecurityPolicy); securityContext (runAsNonRoot, readOnlyRootFilesystem, drop capabilities, no privilege escalation, seccomp) — mirrors container security; NETWORK POLICY (default pods are non-isolated / allow-all → NetworkPolicy is deny-by-default ONCE a pod is selected; ingress/egress rules by pod/namespace/IP; needs a CNI that enforces it — Calico/Cilium); secrets at rest (etcd encryption); admission control for security (OPA Gatekeeper/Kyverno policy-as-code, image signature verification, disallow :latest/privileged); supply-chain (signed images, admission verification); the 4C's (Cloud/Cluster/Container/Code); pointer to security + docker domains." },
  { slug: 'helm-package-management', name: 'Helm & Package Management', hints: "the problem Helm solves (templating + packaging + release management for the many YAMLs of an app); Helm CHART structure (Chart.yaml, values.yaml, templates/ with Go templating, helpers, _helpers.tpl); RELEASES (a chart instance; helm install/upgrade/rollback/uninstall, revision history); values overriding (--set, -f values-prod.yaml, precedence); template functions & the tpl/include; chart dependencies (subcharts, Chart.lock); repositories & OCI registries; Helm 3 (no Tiller — client-only, release state in secrets); hooks; helm vs Kustomize (templating vs overlay/patch — no templating language) & when each; chart testing/lint." },
  { slug: 'gitops-continuous-delivery', name: 'GitOps & Continuous Delivery (Kubernetes)', hints: "GitOps applied to K8s (git = desired state, an in-cluster agent reconciles the cluster to match — POINT to devops-cicd/gitops for the general principle); ARGO CD (declarative Application CRD, watches git, syncs, drift detection & self-heal, UI, app-of-apps, sync waves & hooks, sync policies auto vs manual) vs FLUX (CRD-based, image automation, GitOps Toolkit controllers); PULL model benefits (creds stay in cluster); environment promotion (branches/directories/overlays); PROGRESSIVE DELIVERY on K8s (Argo Rollouts / Flagger — canary/blue-green with automated analysis & rollback on metrics); rollback = git revert; secrets in GitOps (sealed-secrets/SOPS/ESO); GitOps vs push-based CD; reconciliation & health assessment." },
  { slug: 'operators-crds-extensibility', name: 'Operators, CRDs & Extensibility', hints: "extending the API — CUSTOM RESOURCE DEFINITIONS (CRDs add new object kinds/types to the API, with schema validation/versions/subresources); the OPERATOR pattern (a CRD + a custom controller that encodes operational knowledge to manage a stateful app — e.g. a DB operator does backups/failover; extends the reconciliation loop to app-specific logic); controller/reconcile loop (watch→diff→act, idempotent, level-triggered); building operators (Kubebuilder/Operator SDK/controller-runtime); admission webhooks (validating & mutating — intercept API requests, e.g. inject sidecars, enforce policy); API aggregation layer; finalizers for cleanup; when an operator is worth it vs a Helm chart; the Operator maturity model." },
  { slug: 'troubleshooting-observability', name: 'Observability & Troubleshooting (Kubernetes)', hints: "K8S-SPECIFIC troubleshooting (the observability DOMAIN owns metrics/logs/traces mechanics — POINT to it): the debugging toolkit (kubectl get/describe/logs [-p previous]/events/exec/top/debug ephemeral containers, --previous for crashed containers); reading pod STATUS & common failures — CrashLoopBackOff (app crashing, check logs/probes), ImagePullBackOff/ErrImagePull (registry/tag/auth), Pending (no schedulable node: resources/taints/affinity/PVC unbound), OOMKilled (exit 137, memory limit), CreateContainerConfigError (missing configmap/secret), Evicted (node pressure); the Events object & why events expire; metrics-server & kubectl top; liveness-probe restart loops; init-container stuck; DNS debugging; node NotReady; a systematic 'pod won't start' flow." },
  { slug: 'cluster-installation-upgrades', name: 'Cluster Installation, Upgrades & Lifecycle', hints: "cluster creation options (managed control plane EKS/GKE/AKS vs self-managed kubeadm vs k3s/kind/minikube for local — cloud-agnostic overview); kubeadm init/join & cluster bootstrapping; the etcd datastore (backup/restore via etcdctl snapshot — critical for DR, quorum needs odd members); UPGRADES — version skew policy (kubelet may be up to 3 minor versions behind apiserver; components upgrade in order: control plane then nodes; one minor version at a time), draining nodes (cordon+drain, PodDisruptionBudgets protect availability during drain/upgrade); certificate rotation & expiry (kubeadm certs 1yr); node lifecycle (add/remove, cordon/drain/uncordon); backup strategies; deprecated-API migration on upgrade." },
  { slug: 'service-mesh-traffic-management', name: 'Service Mesh & Advanced Traffic Management', hints: "the problem a mesh solves (mTLS, observability, traffic control, retries/timeouts/circuit-breaking WITHOUT app code changes — offloaded to infra); the SIDECAR model (Envoy proxy injected per pod, intercepts all traffic) vs the newer AMBIENT/sidecar-less mode (ztunnel + waypoint, lower overhead); Istio (control plane istiod, VirtualService/DestinationRule/Gateway, traffic splitting/canary, fault injection, mTLS/PeerAuthentication/AuthorizationPolicy) vs Linkerd (lighter, simpler, Rust micro-proxy) vs Cilium (eBPF-based); east-west traffic management; when a mesh is worth the complexity (and when it's overkill — Gateway API/app libraries may suffice); mesh vs Ingress/Gateway; observability from the mesh (golden metrics free)." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior platform/Kubernetes engineer and interview coach authoring interview-grade study material for the Kubernetes topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / frequently-asked subtopics to cover for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . This is Pass 1 — aim for 40-60 solid MCQs.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer verifying interview content for the Kubernetes topic "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `The files are at ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml . Read BOTH.\n\n` +
    `Check and FIX IN PLACE (using Edit/Write) any of:\n` +
    `1) FACTUAL ERRORS in concepts.md or MCQ answers/explanations. Web-research anything uncertain — control-plane component roles (only apiserver talks to etcd), reconciliation/level-triggered model, the three probes (liveness=restart vs readiness=remove-from-endpoints vs startup), requests-for-scheduling vs limits-enforced + CPU-throttle vs memory-OOMKill + QoS classes, Service types & the pod network model, Ingress-needs-a-controller & Gateway API GA, PV/PVC/StorageClass dynamic provisioning & access modes, taints/tolerations vs affinity, HPA-vs-VPA-vs-CA/Karpenter (+ don't-run-VPA+HPA-on-same-metric), RBAC deny-by-default, PSP-removed→PSS, NetworkPolicy deny-by-default-once-selected, Helm 3 no-Tiller, CRD+operator reconcile, version skew & upgrade order, pod failure statuses (CrashLoopBackOff/ImagePullBackOff/Pending/OOMKilled exit137), sidecar vs ambient mesh. A wrong 'answer' index or a mischaracterized K8s mechanic is the WORST defect — fix it.\n` +
    `2) SCOPE DRIFT / DUPLICATION: this domain owns K8s orchestration mechanics. If it re-teaches container/image internals (docker domain), the general GitOps principle or CI/CD (devops-cicd), observability internals (observability domain), general appsec (security), EKS at the AWS-service level (aws group), or general IaC — TRIM to a cross-reference pointer. Keep the K8s-specific angle.\n` +
    `3) SCHEMA violations: valid YAML; top-level keys topic/domain(kubernetes)/topic_slug(${t.slug})/version/questions; ids (prefix '${t.slug}-', unique, 3-digit seq); difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based 'answer' in range; explanation; correct-option position VARIED (rebalance if any index >40% OR a trivially-guessable repeating cycle). WATCH for unquoted YAML option strings that parse as maps (e.g. a value with a colon+space or leading brace) — quote them.\n` +
    `4) Every 'ref: concepts.md#anchor' resolves to a real '## ' heading (GitHub slug rules). Any Mermaid blocks valid — CRITICAL: no semicolons in sequenceDiagram message text (breaks the parser; use commas). Confirm diagram headers valid.\n` +
    `5) COVERAGE: >=40 questions, every subtopic represented, mixed difficulty, scenario-style questions present. Add if thin.\n\n` +
    `After fixing, return a one-line verdict: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
