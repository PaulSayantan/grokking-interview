# Containers on AWS: ECS vs EKS, Fargate and Orchestration

Running containers in production means answering two orthogonal questions: **who
schedules my containers** (the orchestrator: ECS, EKS, or self-managed Kubernetes)
and **who runs the servers underneath** (the compute: Fargate serverless vs
EC2 you manage). AWS lets you mix and match these two axes, and almost every
interview trade-off falls out of that 2x2. This topic goes deep on the selection
logic, the networking and scaling machinery, the service limits that bite real
designs, and the failure modes.

The single most important interviewer skill here is **service selection with
explicit trade-offs**: for every choice you should be able to say what you gain,
what you give up, and when you would pick the alternative (including a non-AWS or
different-AWS option).

---

## Container orchestration on AWS the big picture

**Intuition.** A container image is a frozen, portable filesystem + metadata. An
orchestrator turns "I have images" into "I have N healthy replicas spread across
AZs, wired to a load balancer, that self-heal and roll out new versions safely."
On AWS the orchestrators are:

- **Amazon ECS (Elastic Container Service)** — AWS's own opinionated orchestrator.
  Simple concepts (task definition, task, service, cluster), deep AWS integration,
  no control-plane cost. Lower ops burden, AWS-specific.
- **Amazon EKS (Elastic Kubernetes Service)** — AWS-managed upstream Kubernetes
  control plane. Full Kubernetes API and ecosystem, portable across clouds/on-prem,
  but more moving parts. Control plane costs **$0.10/cluster/hour** (~$73/mo).
- **Self-managed Kubernetes / kOps / kubeadm on EC2** — you run the control plane
  (API server, etcd, scheduler) yourself. Maximum control, maximum ops burden.

**The two axes (memorize this 2x2).**

```
                 COMPUTE: who runs the hosts?
                 Fargate (serverless)      EC2 (you manage nodes)
              +--------------------------+---------------------------+
   ECS        | ECS on Fargate           | ECS on EC2                |
ORCHESTRATOR  | no nodes, per-task bill   | you patch/scale AMIs      |
              +--------------------------+---------------------------+
   EKS        | EKS on Fargate           | EKS on EC2 (managed node   |
              | (per-pod, some limits)    | groups / Karpenter / self)|
              +--------------------------+---------------------------+
```

- **Orchestrator axis** trades *ops burden and lock-in* against *ecosystem and
  portability*. ECS = less to run, AWS-only. EKS = standard K8s, portable, heavier.
- **Compute axis** trades *operational simplicity and isolation* against *cost
  efficiency and control*. Fargate = no host management, per-task VM isolation,
  higher per-vCPU price. EC2 = cheaper at steady high utilization + Spot/RIs, but
  you own patching, scaling, bin-packing.

**Rule of thumb.** Start on **ECS + Fargate** for "just ship my containers with
minimal ops." Move to **EKS** when you need the Kubernetes ecosystem, multi-cloud
portability, or an existing K8s team/tooling. Move to **EC2 capacity** when scale
and steady utilization make Fargate's premium hurt, or you need GPUs / special
instance types / daemon workloads.

---

## ECS core concepts task definitions, services, clusters

**Task definition** — the immutable "recipe" (like a pod spec): one or more
container definitions, each with image, CPU/memory, ports, env, secrets (from SSM
Parameter Store / Secrets Manager), log config, and IAM **task role**. Task
definitions are **versioned/revisioned**; you deploy a specific revision.

**Task** — a running instantiation of a task definition (one or more containers
scheduled together on the same host, sharing a network namespace in `awsvpc` mode).
The unit of scheduling. Analogous to a Kubernetes Pod.

**Service** — keeps *N* tasks running (desired count), replaces unhealthy ones,
registers/deregisters them with a load balancer target group, and orchestrates
**rolling** or **blue/green** (via CodeDeploy) deployments with
`minimumHealthyPercent` / `maximumPercent`. Analogous to a K8s Deployment.

**Cluster** — a logical grouping of tasks/services and the capacity (Fargate and/or
EC2 capacity providers) they run on. A namespace + capacity boundary.

**How it works.** The ECS control plane (AWS-run, free) places tasks according to
the launch type / capacity provider strategy, placement constraints, and
strategies (spread across AZ, binpack on CPU/memory). On EC2 launch type, an
**ECS agent** on each instance registers it and runs tasks.

**Trade-offs.** ECS's small vocabulary is its strength (fast to learn, few failure
modes) and its weakness (no CRDs/operators, no rich ecosystem of Helm charts,
fewer knobs than Kubernetes). Task definitions being immutable revisions makes
rollbacks trivial (deploy the previous revision) — a nice property.

---

## EKS managed Kubernetes core concepts

**What EKS gives you.** AWS runs the **control plane** for you: a highly available
API server and **etcd** spread across 3 AZs, patched and scaled by AWS. You get a
conformant, upstream Kubernetes API endpoint. You bring the **data plane** (worker
nodes) unless you use Fargate/Auto Mode.

**Data-plane options:**
- **Self-managed nodes** — you create the EC2 Auto Scaling group and join it. Most
  control, most work.
- **Managed node groups** — AWS provisions/updates an ASG of EKS-optimized AMIs;
  handles graceful drain on updates. Middle ground.
- **Fargate profiles** — pods matching a selector run serverless, one pod per
  micro-VM. No nodes to manage; several limitations (below).
- **EKS Auto Mode** (GA Dec 2024) — AWS manages compute (via built-in
  **Karpenter**), networking, load balancing, DNS, and storage as first-class
  features. Uses immutable **Bottlerocket** AMIs, disallows SSH/SSM, and enforces a
  **21-day max node lifetime** (auto-replaced) for security. You pay a management
  fee on top of the EC2 instances it launches.

**Key add-ons / integrations:** VPC CNI (pod ENIs), CoreDNS, kube-proxy, the AWS
Load Balancer Controller (provisions ALB/NLB from Ingress/Service), EBS/EFS CSI
drivers, and **IRSA (IAM Roles for Service Accounts)** or **EKS Pod Identity** for
per-pod IAM.

**Trade-offs.** You get the entire Kubernetes ecosystem (Helm, operators, CRDs,
Argo, Istio, KEDA) and portability, at the cost of owning version upgrades
(Kubernetes ships a new minor ~every 4 months; **EKS standard support is ~14
months per version**, then **extended support at +$0.50/cluster/hr** for ~12 more
months), CNI IP planning, add-on lifecycle, and a much larger surface area of
things that can break. EKS Auto Mode buys back much of that ops burden at the cost
of some control and a management premium.

---

## ECS vs EKS vs self-managed trade-offs

**Comparison table.**

| Dimension | ECS | EKS | Self-managed K8s on EC2 |
|---|---|---|---|
| Control-plane cost | $0 | $0.10/cluster/hr (+$0.50 extended) | EC2 for masters + your time |
| Ops burden | Lowest | Medium (Auto Mode lowers it) | Highest |
| Learning curve | Small | Steep (full K8s) | Steep + infra |
| Ecosystem | AWS-native only | Huge (Helm/operators/CRDs) | Huge |
| Portability / lock-in | AWS-locked | Portable (conformant K8s) | Portable |
| Upgrades | AWS handles | You drive (~every 14 mo) | You own everything |
| Multi-cloud / hybrid | No | Yes (EKS Anywhere/Outposts) | Yes |
| Best for | Ship fast, AWS-only, small teams | K8s teams, portability, rich ecosystem | Rare: strict control needs |

**Decision heuristics interviewers reward:**
- **Choose ECS** when the team is small, the workload is AWS-native, you want
  minimal ops and no K8s expertise, and portability is not a requirement. ECS +
  Fargate is the fastest path to "containers in prod with autoscaling + ALB."
- **Choose EKS** when you already have Kubernetes skills/tooling, need the
  ecosystem (operators, service mesh, GitOps), want multi-cloud/hybrid portability,
  or must run software that ships as Helm charts / K8s operators.
- **Choose self-managed** almost never on AWS — only for very specific control
  (custom scheduler, air-gapped, bleeding-edge K8s versions) where the ops cost is
  justified. It's the classic "reinventing undifferentiated heavy lifting" trap.

**The lock-in nuance.** ECS lock-in is real but often overstated: the *containers*
are portable, only the orchestration config is AWS-specific. EKS reduces
orchestration lock-in but you still lean on AWS integrations (ALB controller, IRSA,
VPC CNI), so "K8s = zero lock-in" is a myth. Weigh the *migration cost of the
control layer*, not the containers.

---

## Fargate vs EC2 capacity trade-offs

**Fargate** — serverless containers. AWS runs each task/pod in its own
right-sized micro-VM (Firecracker). No hosts to patch or scale. You pay for the
**vCPU + memory** you request, per second (1-minute minimum), from image pull to
task stop.

**EC2 launch type / node groups** — you run the instances (via Auto Scaling groups
/ capacity providers / Karpenter). You bin-pack many tasks per host, use Spot and
Reserved/Savings Plans, choose special instance families (GPU, high-memory,
Graviton), and run privileged/daemon workloads.

**Fargate sizing (ECS/EKS).** vCPU from 0.25 up to **16 vCPU**; memory up to
**120 GB** (valid CPU/memory combinations only). Ephemeral storage **20 GB by
default, configurable up to 200 GB** (platform 1.4.0+). Supports **ARM64
(Graviton)** and **Windows** containers (Windows/ARM have some feature caveats).

**Fargate limitations that drive design:**
- No GPUs; no privileged mode; no host-level daemonsets; no `docker exec` into the
  host; limited to supported CPU/memory combos; larger cold-start than warm EC2
  (image pull + micro-VM boot, often several to tens of seconds).
- EKS-on-Fargate specifics: **one pod per node/micro-VM** (no bin-packing, no
  DaemonSets — sidecars must be in-pod), no privileged containers, no
  `hostNetwork`/`hostPort`, EBS support via CSI came later, classic node-level
  monitoring agents don't apply.

**Cost intuition.** Fargate's per-vCPU price is a premium over on-demand EC2, but
you pay only for requested resources and zero idle hosts. **Break-even logic:** if
utilization is *spiky/low* or the team is small, Fargate usually wins on TCO
(no idle capacity, no ops). If utilization is *steady and high*, EC2 with
Spot/Savings Plans and good bin-packing is materially cheaper per unit of work —
but you pay in ops. Fargate Spot exists (big discount, interruptible) for
fault-tolerant work.

| | Fargate | EC2 capacity |
|---|---|---|
| Host management | None (AWS) | You patch/scale/bin-pack |
| Isolation | Per-task micro-VM | Shared kernel per host (unless 1 task/host) |
| Cost model | Per requested vCPU+GB, per-sec | Per instance-hour; Spot/RI discounts |
| Best when | Spiky/low util, small team, isolation matters | Steady high util, GPUs, cost-critical, daemons |
| Cold start | Slower (VM boot + pull) | Fast on warm hosts |
| GPU / special HW | No | Yes |

---

## Task networking awsvpc mode and ENI limits

**Network modes (ECS):** `awsvpc` (default and recommended), `bridge`, `host`,
`none`. Fargate **always** uses `awsvpc`.

**`awsvpc` mode** gives each task its own **Elastic Network Interface (ENI)** with
its own private IP in your VPC subnet and its own security group. This is clean
(per-task security groups, VPC Flow Logs per task, no port conflicts) but consumes
**VPC IP addresses and ENIs per task**.

**The ENI limit trap.** On EC2 launch type, each instance type has a hard cap on
ENIs (e.g., an m5.large supports few ENIs). Without help you could fit only a
handful of `awsvpc` tasks per instance. **ENI trunking** (`awsvpcTrunking`
account setting) multiplies the tasks-per-instance by attaching a trunk ENI, so
supported instances can run many more tasks. Interviewers love: *"Your ECS-on-EC2
cluster stops placing tasks even though CPU/memory are free — why?"* Answer: you're
out of ENIs; enable ENI trunking or use larger/more instances.

**EKS VPC CNI + IP exhaustion.** The Amazon VPC CNI assigns **real VPC IPs to
pods**. Each node pre-warms a pool of secondary IPs on its ENIs; **max pods per
node is bounded by ENIs x IPs-per-ENI** for the instance type. At scale this
**exhausts subnet IP space** — a top EKS design pitfall. Mitigations: larger
subnets / secondary CIDRs, **prefix delegation** (assign /28 prefixes to ENIs to
pack far more pods per node), or custom networking. This is the EKS analog of the
ECS ENI-limit problem.

**Trade-off.** `awsvpc`/VPC-CNI gives first-class VPC networking and security
groups per workload, at the cost of IP/ENI planning. Alternatives (bridge mode,
or non-VPC CNIs like Calico overlay on EKS) conserve IPs but lose native
security-group-per-task and add a translation layer.

---

## Service discovery with Cloud Map and ECS Service Connect

**The problem.** Tasks are ephemeral with changing IPs; services need to find each
other.

**Options on ECS:**
1. **Load balancer** in front (ALB/NLB) — stable DNS name; good for
   client→service, adds a hop and cost.
2. **AWS Cloud Map service discovery** — ECS registers task IPs into a Cloud Map
   namespace; consumers resolve via **DNS (A/SRV records in Route 53 private
   zone)** or the Cloud Map API. Simple, but DNS caching/TTL means failover isn't
   instant and there's no L7 traffic control.
3. **ECS Service Connect** (newer, recommended) — a managed **service-to-service**
   layer built on Cloud Map that injects a proxy sidecar (Envoy-based), giving a
   logical service namespace, client-side load balancing, retries, and rich
   metrics/telemetry — **without** running your own App Mesh control plane. It is
   AWS's positioned replacement for App Mesh for east-west traffic.

**EKS equivalents:** Kubernetes **Service + CoreDNS** (ClusterIP virtual IP with
in-cluster DNS) for east-west; **Ingress** or the AWS Load Balancer Controller for
north-south; service meshes (Istio, Linkerd, or App Mesh — deprecating) for
advanced L7.

**Trade-off.** DNS-based discovery (Cloud Map plain) is simplest but suffers DNS
TTL/caching staleness on failover. Service Connect adds resilience (retries,
client-side LB, fast endpoint updates) and observability at the cost of a sidecar
proxy per task (extra CPU/memory and a small latency hop). Putting an ALB between
every service is simplest to reason about but the most expensive and adds latency;
prefer it for north-south and use Service Connect/Cloud Map for east-west.

---

## Load balancer integration ALB and NLB target groups

**ALB (Application Load Balancer, L7)** — HTTP/HTTPS, path/host routing, gRPC,
WebSockets, TLS termination, WAF integration. In `awsvpc` mode ECS registers each
task as an **IP target** in the target group. ALB does health checks and the ECS
service auto-registers/deregisters targets on scale and deploy (with connection
draining / deregistration delay). Best for typical web/microservice HTTP traffic.

**NLB (Network Load Balancer, L4)** — TCP/UDP/TLS, ultra-low latency, millions of
connections, **static IP per AZ / Elastic IP**, preserves source IP. Use for
non-HTTP protocols, extreme throughput, static-IP requirements, or when you need
raw L4 performance.

**On EKS**, the **AWS Load Balancer Controller** provisions an **ALB from an
Ingress** and an **NLB from a Service type=LoadBalancer** (IP-target mode routes
straight to pod IPs, bypassing kube-proxy/NodePort hops).

**Trade-offs.**

| | ALB (L7) | NLB (L4) |
|---|---|---|
| Layer | HTTP/HTTPS/gRPC | TCP/UDP/TLS |
| Routing | Path/host/header | Flow hash (no content routing) |
| Latency | Higher (parses HTTP) | Very low (~microsecond-ish overhead) |
| Static IP | No (DNS name) | Yes (EIP per AZ) |
| Features | WAF, auth, redirects, sticky | Source-IP preserve, huge scale |
| Use when | Web/microservices, routing needed | Non-HTTP, extreme perf, static IP |

**Blue/green & canary.** ECS + CodeDeploy shifts traffic between two target groups;
ALB weighted target groups enable canary. NLB is less feature-rich for L7 canary.

---

## Scaling ECS service auto scaling and capacity providers

**Two layers of scaling** (do not conflate them):
1. **Service auto scaling** — scales the *number of tasks* (desired count) via
   Application Auto Scaling: **target tracking** (e.g., keep avg CPU at 60% or
   `ALBRequestCountPerTarget` at N), **step scaling**, or **scheduled**.
2. **Cluster capacity** — on EC2 launch type you also need *hosts* to place tasks
   on. **ECS Capacity Providers** with **Managed Scaling** adjust the underlying
   Auto Scaling group to a **target capacity %** so there's room for new tasks.
   On Fargate there is no host layer — task scaling is all you need.

**Capacity provider strategies** let you split placement across providers, e.g.,
run a base of tasks on on-demand and the remainder on **Fargate Spot** (or EC2
Spot) for cost, with weights.

**Trade-off.** Fargate collapses two scaling problems into one (just scale tasks) —
simpler, but you can't bin-pack. EC2 capacity providers give cheaper steady-state
and bin-packing but you must tune managed scaling, warm pools, and instance
draining; a common failure is tasks stuck **PROVISIONING** because the ASG hasn't
scaled out hosts fast enough (scale-out latency). Target-tracking on a
request-based metric (`RequestCountPerTarget`) usually reacts better than CPU for
latency-sensitive web tiers.

---

## Scaling EKS Cluster Autoscaler, Karpenter and Auto Mode

**Pod scaling:** the **Horizontal Pod Autoscaler (HPA)** scales replica count on
CPU/memory or custom metrics (via **KEDA** for event-driven/queue-depth scaling);
the **Vertical Pod Autoscaler** tunes requests. That handles pods, not nodes.

**Node scaling — two schools:**
- **Cluster Autoscaler (CA)** — the classic. Works against **node groups (ASGs)**:
  when pods are unschedulable, it scales the matching ASG up; scales down
  underused nodes. Constrained to predefined instance types per group; slower and
  coarser.
- **Karpenter** — AWS's modern, group-less autoscaler. Watches unschedulable pods
  and **provisions right-sized nodes directly from EC2** (choosing instance
  type/size/AZ/Spot to best fit pending pods in seconds), then **consolidates**
  (bin-packs and terminates underused nodes) for cost. Far faster and more
  cost-efficient than CA; the current best practice.
- **EKS Auto Mode** — Karpenter + Bottlerocket + networking/LB/storage, fully
  managed by AWS (21-day node lifetime, no SSH). Lowest ops; a management premium
  and less low-level control.

**Trade-off.** CA is simpler/older and fine for uniform workloads, but wastes
money and reacts slowly. Karpenter is the strong default for heterogeneous/spiky
workloads and Spot diversification, at the cost of running/upgrading the Karpenter
controller and understanding NodePools. Auto Mode removes that work but adds cost
and reduces control — choose it when you want EKS ergonomics without owning the
data-plane machinery.

---

## ECR the container image registry

**Amazon ECR** — a managed OCI/Docker registry. **Private** repos (per-account,
IAM-controlled) and **public** (ECR Public / Gallery). Images are stored in S3
under the hood; auth is via IAM (`ecr:GetAuthorizationToken` → 12-hour token).

**Design-relevant features:**
- **Image scanning:** *basic* (CVE scan on push) and *enhanced* scanning powered by
  **Amazon Inspector** (continuous, OS + language packages).
- **Lifecycle policies** to expire untagged/old images (control storage cost and
  clutter).
- **Immutable tags** (prevent overwriting a tag — critical for reproducible
  deploys and supply-chain integrity).
- **Replication** (cross-region / cross-account) for multi-region deploys and DR.
- **Pull-through cache** for upstream registries (Docker Hub, quay, etc.) to avoid
  rate limits and keep a local cached copy.
- **VPC endpoints (PrivateLink)** so nodes pull images without a NAT/IGW.

**Trade-offs.** Immutable tags + digest-pinning give reproducibility and safer
rollbacks but require a tagging discipline (no `:latest` mutation). Cross-region
replication improves pull latency and regional resilience but adds storage cost and
eventual-consistency lag on new pushes. Pull-through cache avoids Docker Hub rate
limits (a real production outage cause) but adds a cache-warm consideration.

---

## Service mesh App Mesh, Service Connect and alternatives

**Why a mesh.** As service count grows you want consistent mTLS, retries,
timeouts, circuit breaking, traffic shifting (canary), and uniform telemetry —
without baking it into every app. A mesh does this via sidecar proxies (Envoy).

**Options and their trajectory:**
- **AWS App Mesh** — AWS's managed Envoy-based mesh (virtual services/nodes/routers/
  routes). **Important: App Mesh reaches end of support on September 30, 2026.**
  AWS's guidance is to migrate to **Amazon ECS Service Connect** (for ECS) or a
  Kubernetes mesh. Do **not** design new systems on App Mesh.
- **ECS Service Connect** — managed east-west connectivity + telemetry + retries +
  client-side LB for ECS, without running a mesh control plane. The recommended
  ECS successor to App Mesh for most needs.
- **Istio / Linkerd on EKS** — full-featured open-source meshes; Istio is powerful
  but heavy (its own control plane, steep learning curve); Linkerd is lighter.
- **VPC Lattice** — an AWS application networking layer that connects services
  across VPCs/accounts and across ECS/EKS/Lambda/EC2 with auth and observability,
  *without* per-pod sidecars — a mesh-adjacent alternative for cross-account
  service networking.

**Trade-off.** A mesh buys uniform L7 resilience/security/observability but costs
you a **sidecar per task/pod** (CPU/memory overhead + an extra network hop + added
latency) and significant operational complexity. For a handful of services this is
overkill — use ALB + Service Connect/Cloud Map. Adopt a full mesh only when you
have many services and genuinely need mTLS everywhere, fine-grained traffic
policy, and cross-team consistency. Given App Mesh's sunset, new AWS designs should
prefer Service Connect (ECS) or Istio/Linkerd/VPC Lattice (EKS).

---

## Security, IAM roles for tasks and isolation

**IAM layering (get the two roles right):**
- **Task execution role** — used by the ECS agent/Fargate to pull ECR images,
  fetch secrets, and write logs (infrastructure-level).
- **Task role** (ECS) / **IRSA or EKS Pod Identity** (EKS) — the identity the
  *application in the container* assumes to call AWS APIs. This is how you give a
  specific service least-privilege access to, say, one DynamoDB table — **never**
  put static keys in the image or use the node's instance role for app permissions.

**Isolation:**
- **Fargate** gives each task/pod its own micro-VM → strong kernel-level isolation
  between tenants by default. Great for multi-tenant / untrusted workloads.
- **EC2** shares a kernel across co-located tasks/pods; isolation relies on
  container boundaries, security groups, and (on EKS) namespaces/NetworkPolicies.
- **Secrets** via Secrets Manager / SSM Parameter Store injected at runtime;
  encrypt env and use KMS. **Security groups per task** (`awsvpc`) for network
  segmentation. On EKS, NetworkPolicies (Calico or the VPC CNI network policy).

**Trade-off.** Fargate's per-task VM isolation is the easy answer for multi-tenant
isolation but costs the Fargate premium and can't bin-pack. On EC2 you can isolate
tenants with separate node groups/taints or separate clusters, trading cost for a
larger management surface.

---

## Blast radius, multi-tenant clusters and cell-based design

**The multi-tenant cluster question.** Do you run one big shared cluster
(many teams/tenants) or many smaller ones?

- **Shared cluster** — cheaper (one control plane on EKS; better bin-packing),
  easier central ops, but a **larger blast radius**: a bad rollout, a noisy
  neighbor, an etcd/API-server overload, a misconfigured NetworkPolicy, or an IAM
  mistake can affect everyone. On EKS the API server/etcd can become a bottleneck
  with too many objects/controllers.
- **Cluster per team/tenant/environment** — strong isolation and small blast
  radius, but N control planes ($0.10/hr each on EKS), N upgrades, N sets of
  add-ons — more cost and ops.

**Cell-based architecture** (a modern AWS resilience pattern from the Builders'
Library): partition load into independent **cells** (each a full stack — cluster +
data + LB) and route each customer/shard to one cell. A failure is contained to a
cell (bounded blast radius), and you can do **cell-by-cell (wave) deployments** so
a bad deploy hits one cell before promotion. Trades some efficiency and routing
complexity for dramatically better fault isolation and safe rollout.

**Availability zones.** Always spread tasks/nodes across **≥3 AZs** and use the
service scheduler's AZ **spread** strategy; the load balancer is regional and only
routes to healthy targets. An AZ failure should cost you ~1/3 capacity, not an
outage — provision headroom accordingly (static stability: pre-provision so you
don't depend on a control-plane scale-up during the failure).

---

## Cost reasoning and capacity estimation

**What you actually pay for:**
- **ECS control plane:** free. **EKS control plane:** $0.10/cluster/hr (~$73/mo)
  plus **+$0.50/hr** if on extended-support K8s versions.
- **Fargate:** per requested **vCPU-second + GB-second** (1-min minimum) from image
  pull to stop; **Fargate Spot** heavily discounted but interruptible.
- **EC2 capacity:** per instance-hour; slash with **Spot** (up to ~70-90% off,
  interruptible), **Savings Plans / RIs** for steady baseline.
- **Data transfer & LB:** ALB/NLB hourly + LCU/NLCU; **cross-AZ traffic is charged**
  (a real cost driver for chatty east-west services — topology-aware routing
  helps); NAT gateway data processing (use VPC/ECR/S3 endpoints to avoid).

**Back-of-envelope example.** Web service, avg 40% CPU, 20 tasks x 1 vCPU/2 GB,
mostly steady 24/7:
- On **Fargate**: 20 vCPU + 40 GB billed continuously → predictable but at the
  Fargate premium; zero ops.
- On **EC2 + Karpenter + Spot**, bin-packed onto a few right-sized instances at
  higher utilization with Spot pricing → often **materially cheaper per unit**, but
  you own patching, scaling, Spot interruption handling.
- **Break-even:** steady high-utilization + scale favors EC2; spiky/low-utilization
  + small team favors Fargate. Always include *ops cost* (engineer time) in TCO,
  not just the AWS bill — this is the answer interviewers want.

---

## Failure modes and how the design degrades

- **AZ failure:** with tasks spread across 3 AZs and the LB routing only to healthy
  targets, you lose ~1/3 capacity; auto scaling backfills in surviving AZs. If you
  ran single-AZ or lacked headroom, it's an outage. Static stability = provision so
  you survive without needing a scale-up during the event.
- **Region failure:** requires multi-region (active/active or warm standby) with
  ECR cross-region replication, replicated data, and Route 53 failover/latency
  routing. Single region = regional blast radius.
- **Capacity exhaustion:** ECS tasks stuck **PENDING/PROVISIONING** because the ASG
  didn't scale hosts fast enough, or **out of ENIs/IPs** (enable ENI trunking /
  prefix delegation / bigger subnets). Fargate can hit **service quotas** (per-
  region running-task limits) or transient capacity errors — retry with backoff.
- **Throttling:** ECR pull throttling / Docker Hub rate limits during a mass scale-
  out (thundering herd) → use ECR pull-through cache, immutable digests, image
  caching; EKS API server/etcd overload from too many controllers/objects.
- **Bad deploy:** contained by rolling deploys with min-healthy%, circuit-breaker
  rollback (ECS deployment circuit breaker), blue/green with CodeDeploy, and
  cell/wave deployments to limit blast radius.
- **Spot interruption:** Fargate Spot / EC2 Spot can be reclaimed on 2-minute
  notice — only for interruptible/replicated workloads; keep an on-demand base.

---

## Trade-offs and when to use what

A consolidated decision guide (say these out loud in an interview):

- **Ship containers fast, small AWS-native team, minimal ops** → **ECS on Fargate**.
- **Need Kubernetes ecosystem / portability / existing K8s tooling** → **EKS**;
  add **Karpenter** (or **Auto Mode** to offload data-plane ops).
- **Steady, high-utilization, cost-critical at scale, need GPUs/special HW/daemons**
  → **EC2 capacity** (Spot + Savings Plans, bin-packed) under ECS or EKS.
- **Strong multi-tenant / untrusted isolation** → **Fargate** (per-task micro-VM),
  or separate clusters/node groups on EC2.
- **East-west service discovery** → **Cloud Map / ECS Service Connect** (ECS) or
  K8s Service + CoreDNS (EKS); **north-south** → **ALB** (HTTP) or **NLB** (L4/
  static IP/extreme perf).
- **Uniform mTLS + L7 policy across many services** → a mesh, but **not App Mesh**
  (EOL 2026-09-30) — use **Service Connect** (ECS) or **Istio/Linkerd/VPC Lattice**
  (EKS); skip a mesh entirely for a handful of services.
- **Bound blast radius / safe rollout** → multi-AZ spread, deployment circuit
  breaker, blue/green, and **cell-based** partitioning with wave deployments.
- **Avoid the self-managed-K8s trap** unless a hard requirement forces it — it's
  usually undifferentiated heavy lifting.

The meta-point: **there is rarely one right answer** — state the constraints
(scale, utilization pattern, latency budget, isolation needs, team K8s maturity,
budget, portability), then justify the pick against those constraints.

---

## Common interview follow-up questions

1. Your ECS-on-EC2 cluster won't place new tasks though CPU/memory are free — what's
   the likely cause and fix? (Out of ENIs → enable `awsvpcTrunking` / bigger hosts.)
2. When would you pick EKS over ECS despite the higher ops burden and control-plane
   cost? (Ecosystem, portability, existing K8s skills, operator-based software.)
3. Fargate vs EC2 for a workload at steady 70% CPU 24/7 — which is cheaper and why?
   (EC2 + Spot/Savings Plans + bin-packing; include ops cost in TCO.)
4. How do pods on EKS get AWS permissions safely? (IRSA / EKS Pod Identity — per-pod
   IAM, not node role, not static keys.)
5. Your EKS cluster exhausts subnet IPs at scale — why and what do you do?
   (VPC CNI assigns VPC IPs per pod; use prefix delegation / secondary CIDRs.)
6. ALB vs NLB in front of a gRPC service that needs a static IP? (NLB for static IP/
   L4; ALB supports gRPC/L7 routing but no static IP — trade routing vs static IP.)
7. Karpenter vs Cluster Autoscaler — what's the difference and when does it matter?
   (Group-less, right-sized, fast, consolidating vs ASG-bound and slower.)
8. Design a multi-tenant container platform minimizing blast radius. (Cells,
   per-tenant clusters/namespaces, Fargate isolation, wave deploys, quotas.)
9. Should you build a new service on AWS App Mesh? (No — EOL 2026-09-30; use ECS
   Service Connect or a K8s mesh.)
10. How do you make container deploys safe? (Rolling min-healthy%, deployment
    circuit breaker, blue/green via CodeDeploy, canary with weighted target groups.)
11. How do you avoid Docker Hub rate-limit outages during scale-out? (ECR + pull-
    through cache, immutable digests, image caching.)
12. Where is cross-AZ data-transfer cost hiding in your container design, and how do
    you cut it? (Chatty east-west across AZs; topology-aware routing, co-locate.)

## References

- AWS Docs — *Amazon ECS Developer Guide* (task definitions, services, capacity
  providers, `awsvpc` networking, ENI trunking, Service Connect).
- AWS Docs — *Amazon EKS User Guide* (managed node groups, Fargate profiles, VPC
  CNI, prefix delegation, IRSA / EKS Pod Identity, **EKS Auto Mode**).
- AWS Docs — *AWS Fargate for ECS / for EKS* (task sizes up to 16 vCPU / 120 GB,
  ephemeral storage 20→200 GB, ARM64/Windows support).
- AWS Docs — *Amazon ECR User Guide* (image scanning with Inspector, lifecycle
  policies, replication, pull-through cache, immutable tags).
- AWS Docs & Blog — *AWS App Mesh end of support (Sept 30, 2026)* and
  *Migrating from AWS App Mesh to Amazon ECS Service Connect*.
- AWS Pricing — *Amazon EKS pricing* ($0.10/cluster/hr; +$0.50 extended support;
  Auto Mode management fee; EKS-Fargate per vCPU/GB).
- Karpenter documentation (karpenter.sh) — provisioning and consolidation.
- AWS Well-Architected Framework — Reliability & Cost Optimization pillars.
- Amazon Builders' Library — *"Static stability using Availability Zones"* and
  cell-based architecture guidance; re:Invent "deep dive" container sessions
  (CON3xx/CON4xx) on ECS vs EKS design patterns and scaling.
