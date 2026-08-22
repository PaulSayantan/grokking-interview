# System Design Case Studies

23 topics. Study content and MCQs live in per-topic subfolders. See the master
taxonomy in `../../TOPICS.md`.

Real architecture stories from top companies' engineering blogs, retold in plain
language as interview-grade case studies. Each topic takes one published post —
a problem a real company hit at scale and how they solved it — and teaches it the
way a great mentor would: the problem first, the naive approach and why it broke,
the actual design, the concrete numbers, the trade-offs, and the interview
takeaways. Every claim is sourced from the linked post.

Organized **by company** (topics are grouped and ordered company-by-company).
Cross-references: `system-design` owns the general patterns (sharding, caching,
consensus) in the abstract; this domain shows those patterns *in the wild*, with
names, numbers, and the messy real-world constraints that theory leaves out.

Source seed: the "Company Engineering Blogs" list in
`github.com/OpesanyaAdebayo/systems-design`; stories are the canonical,
most-instructive posts from each company's live engineering blog.

**Row order below is the learning order the site renders** (the web build reads
this table top-to-bottom — see `web/scripts/sync-content.mjs`), so every topic
directory must have exactly one row here. Within each company the stories are
sequenced so each one builds on the previous: the architecture story comes before
the outage that broke it, the storage platform before the tooling that operates
it, the offline pipeline before the online stack that consumes it.

| Topic | Slug | Company | Freq | Difficulty | Status |
|---|---|---|---|---|---|
| Uber: Zone-Failure-Resilient Search (OpenSearch) | `uber-zone-failure-resilient-opensearch` | Uber | high | advanced | ● |
| Uber: A Data Abstraction Layer over Heterogeneous Stores | `uber-data-abstraction-layer` | Uber | medium | intermediate | ● |
| Uber GitFarm: Git-as-a-Service for Monorepos at Scale | `uber-gitfarm-monorepo` | Uber | medium | intermediate | ● |
| Discord: Moving Real-Time Voice to the Edge for Lower Latency | `discord-voice-to-the-edge` | Discord | high | advanced | ● |
| Discord: How a Routine Scale-Up Cascaded Into a 3-Hour Voice Outage | `discord-voice-outage-postmortem` | Discord | high | advanced | ● |
| Discord: Indexing Trillions of Messages for Search | `discord-indexes-trillions-of-messages` | Discord | high | advanced | ● |
| Discord: Automating ScyllaDB Clusters at Scale | `discord-automates-scylladb-at-scale` | Discord | medium | intermediate | ● |
| Cloudflare: How Transit Providers Quietly Rewrite the BGP ORIGIN Attribute | `cloudflare-bgp-origin-attribute` | Cloudflare | medium | advanced | ● |
| Cloudflare: When a Broken DNSSEC Rollover Took an Entire Country's TLD Offline | `cloudflare-dnssec-outage-al` | Cloudflare | medium | intermediate | ● |
| Cloudflare: Smart Tiered Cache for Public Cloud Regions | `cloudflare-smart-tiered-cache` | Cloudflare | high | intermediate | ● |
| Cloudflare Meerkat: Global Consensus Without a Leader | `cloudflare-meerkat-global-consensus` | Cloudflare | high | advanced | ● |
| Cloudflare Workflows: Saga-Style Rollbacks for Durable Execution | `cloudflare-saga-rollbacks-workflows` | Cloudflare | high | advanced | ● |
| Stripe: Designing a Payments API That Survives 10 Years of Change | `stripe-idempotency-and-api-design` | Stripe | very-high | intermediate | ● |
| Stripe: Ledger — Tracking and Validating Money Movement | `stripe-ledger-money-movement` | Stripe | high | advanced | ● |
| Stripe: Zero-Downtime Data Migrations on a Custom MongoDB-Based DBaaS | `stripe-zero-downtime-data-migrations` | Stripe | high | advanced | ● |
| Stripe: Auto-Remediating a Global MongoDB Fleet with Graph Search and State Machines | `stripe-database-auto-remediation` | Stripe | medium | intermediate | ● |
| Slack: Rebuilding Notifications for Correctness Across Devices | `slack-rebuilt-notifications` | Slack | high | intermediate | ● |
| Slack Shipyard: Making EC2 Instances Immutable, Deployable Artifacts | `slack-shipyard-ec2-platform` | Slack | medium | intermediate | ● |
| LinkedIn: Optimizing Sales Navigator's Search Pipeline with Spark | `linkedin-sales-navigator-spark-pipeline` | LinkedIn | medium | intermediate | ● |
| LinkedIn: Reimagining the Search Stack with LLMs at Query-per-Second Scale | `linkedin-reimagining-search-stack` | LinkedIn | high | advanced | ● |
| LinkedIn: Northguard and Xinfra — Rebuilding Log Storage Past Kafka's Scaling Walls | `linkedin-northguard-xinfra-log-storage` | LinkedIn | high | advanced | ● |
| Dropbox Magic Pocket: Reclaiming Wasted Space in an Exabyte-Scale Immutable Blob Store | `dropbox-magic-pocket-storage-efficiency` | Dropbox | high | advanced | ● |
| Dropbox Riviera: One Content-Processing Platform for Previews, Search, and AI | `dropbox-riviera-content-platform` | Dropbox | medium | intermediate | ● |

Status: ☐ not started · ◐ concepts done · ● concepts+MCQs · ✅ validated
