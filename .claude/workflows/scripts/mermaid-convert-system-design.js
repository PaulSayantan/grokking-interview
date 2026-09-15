export const meta = {
  name: 'mermaid-convert-system-design',
  description: 'Pilot: convert ONLY genuine ASCII flow/structure/sequence diagrams in system-design concepts.md files into ```mermaid fenced blocks; leave all code/CLI/HTTP/byte-layout/table blocks untouched; then verify fidelity + syntax + that nothing off-limits changed',
  phases: [
    { title: 'Convert', detail: 'one agent per file rewrites qualifying ASCII diagrams as mermaid' },
    { title: 'Verify', detail: 'check mermaid syntax + semantic fidelity + no off-limits edits' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`

// 49 system-design subtopic slugs that contain >=1 diagram candidate.
// (realtime-streaming-systems is intentionally EXCLUDED — it has an uncommitted edit.)
const SLUGS = ["aws-analytics-datalake-redshift-emr","aws-api-layer-apigateway-appsync","aws-caching-elasticache-dax","aws-compute-ec2-fargate-lambda","aws-cost-optimization-scaling","aws-dns-cdn-route53-cloudfront","aws-dynamodb-deep-dive","aws-fundamentals-well-architected","aws-iot-edge-computing","aws-messaging-sqs-sns-eventbridge","aws-microservices-patterns","aws-migration-modernization","aws-ml-genai-sagemaker-bedrock","aws-networking-vpc-privatelink","aws-observability-cloudwatch-xray","aws-reference-architectures","aws-security-iam-deep-dive","aws-security-kms-secrets-cognito-waf","aws-serverless-lambda-stepfunctions","aws-storage-ebs-efs-fsx","aws-storage-s3-deep-dive","aws-streaming-kinesis-msk","caching-and-cdn","cap-theorem-and-consistency","capacity-modeling-and-tail-latency","data-internals-storage-engines","databases-sql-nosql-sharding-replication","design-coordination-locking-collaboration","design-feed-chat-notification","design-job-scheduler-task-queue","design-location-and-payment-systems","design-search-autocomplete-typeahead","design-url-shortener","design-video-platform-distributed-cache","design-web-crawler-data-processing","distributed-transactions-advanced","event-driven-cqrs-saga-cdc","failure-theory-advanced","fundamentals-and-framework","genai-llm-system-design","interview-method-scenario-playbooks","message-queues-and-async","microservices-monolith-api-design","networking-and-protocols","observability-monitoring-reliability","rate-limiting-and-consistent-hashing","resilience-tradeoffs-deep-dive","scalability-and-load-balancing","security-authentication-data-protection"]

const CONVERT_RULES = `
TASK: In this ONE concepts.md file, convert QUALIFYING ASCII-art diagrams inside fenced
code blocks into Mermaid diagrams (a fenced block with language "mermaid"). This is a
careful, surgical refactor — fidelity and safety matter far more than converting many blocks.

WHAT QUALIFIES (convert ONLY these): a fenced code block whose content is a DIAGRAM —
- box-and-arrow architecture/flow diagrams (services, queues, DBs, LBs connected by arrows),
- tree / hierarchy / layered diagrams (drawn with ├─ └─ │ or indentation boxes),
- request/response SEQUENCE diagrams drawn as ASCII (participants + arrows over time),
- state machines, entity-relationship sketches.
Pick the best Mermaid type per diagram: 'flowchart LR/TD', 'sequenceDiagram', 'stateDiagram-v2',
'erDiagram', or 'classDiagram'.

WHAT MUST NOT BE TOUCHED (leave the fence EXACTLY as-is — do not convert, reformat, or delete):
- Any block with a language tag (\`\`\`java, \`\`\`http, \`\`\`json, \`\`\`yaml, \`\`\`sql, \`\`\`bash, etc.).
- Source code of any kind, config, or API request/response samples (even untagged).
- CLI / shell / tool OUTPUT (dig, curl, nslookup, netstat, console output, log lines).
- BYTE / PACKET / bit-field LAYOUTS and memory layouts (e.g. rows with +----+ bit rulers,
  "0 1 2 3" bit-position headers, struct field breakdowns) — Mermaid cannot represent these
  faithfully; keep them as ASCII.
- ASCII TABLES and any tabular data (convert nothing to a table).
- Math, formulas, capacity-estimation number blocks, big-O notes.
- Prose that happens to be inside a stray/unbalanced fence — do NOT invent a diagram.
If a block is AMBIGUOUS or you are not confident it is a true diagram, LEAVE IT UNCHANGED.
It is completely fine to convert ZERO blocks in a file. Never convert a block you can't
faithfully represent.

FIDELITY RULES for each conversion:
- Preserve every node/label and every connection/arrow direction. Don't drop or rename
  components. Keep edge labels (e.g. "async", "read", "write", "replicate") as edge text.
- Keep it readable: choose LR vs TD to match the original's flow orientation.
- Node text with special characters must be quoted: A["API Gateway (L7)"].
- Do NOT add new information the ASCII didn't have; do NOT editorialize. A faithful
  translation only.
- Leave one blank line before and after the \`\`\`mermaid block, exactly like the original.
- Mermaid syntax must be valid: correct header keyword, valid arrows (-->, --x, -.->,
  ->> / -->> for sequence), subgraph ... end balanced, no reserved-word bare node ids
  (quote them), no trailing junk.

Do NOT change ANY prose, heading, list, table, or "## " anchor. Only swap qualifying
diagram code blocks. The file's H2 headings are MCQ anchor targets — they must stay byte-identical.

Use the Edit tool for each conversion (target the specific block). Return one line:
"<slug>: converted <n> diagram(s) of <m> candidate block(s); left <k> non-diagram blocks untouched; types: [flowchart x2, sequence x1, ...]".
`

const VERIFY_RULES = (slug) => `
Verify the Mermaid conversion in ${DIR}/${slug}/concepts.md. Read the file. For EACH
\`\`\`mermaid block, and by comparing against git (the diff for this file shows what changed):

1) SYNTAX: is the Mermaid valid? Correct diagram header ('flowchart LR|TD', 'sequenceDiagram',
   'stateDiagram-v2', 'erDiagram', 'classDiagram'); valid arrow syntax for that type; balanced
   subgraph/end; node ids with special chars or spaces are quoted; no reserved words as bare
   ids ('end', 'graph', etc.); no leftover ASCII box characters inside the mermaid block; no
   trailing backticks or stray text. FIX any syntax error in place.
2) FIDELITY: does the Mermaid preserve every node label and every arrow/direction from the
   ORIGINAL ASCII (check the git diff)? If nodes/edges/labels were dropped, renamed, invented,
   or an arrow direction flipped, FIX it to match the original.
3) SAFETY (critical): confirm NOTHING off-limits was altered — no code/CLI/HTTP/JSON/byte-layout/
   table block was converted or reformatted; no prose/heading/list/anchor text changed. The diff
   must be ONLY diagram-block swaps. If a code block, byte-layout, table, or any prose/heading was
   touched, REVERT that part (restore the original text; keep only legitimate diagram conversions).
4) JUDGMENT: if a converted block was NOT really a diagram (was actually code/output/layout/prose),
   revert it to the original ASCII fenced block.

After fixing, return one line: "${slug}: <n> mermaid blocks, <clean|fixed>, notes: ...".
`

phase('Convert')
const results = await pipeline(
  SLUGS,
  (slug) => agent(
    `You are refactoring interview-prep study content. File: ${DIR}/${slug}/concepts.md\n\n` +
    `Read the whole file first, identify every fenced code block, and decide block-by-block ` +
    `whether it is a genuine diagram that should become Mermaid.\n\n${CONVERT_RULES}`,
    { label: `convert:${slug}`, phase: 'Convert' }
  ),
  (convertSummary, slug) => agent(
    VERIFY_RULES(slug),
    { label: `verify:${slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
