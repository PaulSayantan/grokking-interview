<div align="center">

# 🎯 Grokking Interview

### An interview-prep library that refuses to be shallow

**28,064** hand-authored MCQs · **460** subtopics · **20** domains · every answer explained, every question linked back to the theory it tests

<p>
  <img alt="Questions" src="https://img.shields.io/badge/MCQs-28%2C064-FF6B00?style=for-the-badge&labelColor=0a0a0a" />
  <img alt="Subtopics" src="https://img.shields.io/badge/Subtopics-460-10B981?style=for-the-badge&labelColor=0a0a0a" />
  <img alt="Domains" src="https://img.shields.io/badge/Domains-20-3B82F6?style=for-the-badge&labelColor=0a0a0a" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-377%20passing-8B5CF6?style=for-the-badge&labelColor=0a0a0a" />
</p>

<p>
  <img alt="Astro" src="https://img.shields.io/badge/Astro-5-BC52EE?style=flat-square&logo=astro&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind-CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" />
  <img alt="Preact" src="https://img.shields.io/badge/Preact-island-673AB8?style=flat-square&logo=preact&logoColor=white" />
  <img alt="Python" src="https://img.shields.io/badge/Python-validators-3776AB?style=flat-square&logo=python&logoColor=white" />
</p>

</div>

---

## 💡 Why this exists

Most interview-prep material is a flashcard deck. You memorise "what is a B-tree,"
walk into the room, get asked *"why does your index make this query slower?"* — and
discover you learned the label, not the thing.

This repository is the opposite bet: **senior/staff-grade depth, explained plainly.**
Two axes, never conflated —

> **The difficulty of the idea stays.** Edge cases, failure modes, version-gated
> behaviour and real trade-offs are the point. Nothing is simplified away.
>
> **The complexity of the explanation comes down.** Including in the deepest
> passages, which is exactly where most writing gives up.

A topic must be **understandable from its own file alone**. If you have to open three
other tabs to follow a paragraph, that paragraph is a defect.

---

## ✨ What's inside

<table>
<tr>
<td width="50%" valign="top">

### 📚 A study library
Plain Markdown in `topics/`, readable in any editor. Worked examples, mermaid
diagrams, comparison tables, and callouts that mark the traps
(`TIP` / `WARNING` / `INTERVIEW` / `KEY-TAKEAWAY`).

</td>
<td width="50%" valign="top">

### 🧠 A practice engine
28,064 MCQs in YAML, each with a `ref` deep-link back to the exact heading that
teaches it. Single-answer and select-all-that-apply. Every option explained —
including **why the wrong ones are wrong**.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🌐 A real web app
Astro 5 static site, Tailwind, one Preact island for the quiz. Light and dark
themes, works on a phone, and **works with JavaScript disabled**.

</td>
<td width="50%" valign="top">

### 🤖 The authoring machinery
The `.claude/` skills and workflow scripts that wrote and audited this corpus —
including the adversarial review loops that caught the mistakes. Shipped, not hidden.

</td>
</tr>
</table>

---

## 📊 The corpus

| Domain | Subtopics | Questions |
|:---|---:|---:|
| System Design | 94 | 6,611 |
| Spring Boot | 18 | 1,851 |
| Low-Level & Object-Oriented Design | 33 | 1,671 |
| REST APIs & API Design | 20 | 1,633 |
| Java & JVM | 25 | 1,555 |
| Spring Framework Core | 19 | 1,511 |
| Hibernate & JPA | 18 | 1,401 |
| Networking & Protocols | 16 | 1,372 |
| Security (Application & Web) | 17 | 1,341 |
| Reliability Engineering & Operations | 16 | 1,279 |
| Messaging & Databases | 20 | 1,086 |
| DevOps & CI/CD | 21 | 1,065 |
| Kubernetes | 19 | 981 |
| Observability | 17 | 844 |
| gRPC | 16 | 806 |
| Docker | 16 | 794 |
| Interview Craft (behavioural & seniority) | 16 | 793 |
| Software Testing | 16 | 784 |
| Data Structures, Algorithms & Coding | 20 | 456 |
| System Design Case Studies | 23 | 230 |
| **Total** | **460** | **28,064** |

---

## 🚀 Quick start

```bash
git clone <this-repo> interview-prep
cd interview-prep/web
npm install
npm run dev          # syncs content, then serves on localhost:4321
```

Just want to read? Every topic is Markdown — open `topics/<domain>/<subtopic>/concepts.md`.

```bash
npm run build                          # static site -> web/dist
npm test                               # 377 unit tests
npm run check                          # astro check (0 errors)
python3 scripts/validate_content.py    # validate all 28,064 questions
```

---

## 🗂️ Layout

```
topics/<domain>/<subtopic>/
├── concepts.md        the study material (## H2 headings are MCQ anchor targets)
├── questions.yaml     the MCQs (answer is a 0-based index)
└── prompts.yaml       optional: think-prompts + a cliffhanger to the next topic

web/                   Astro 5 app — sync-content.mjs reads topics/ and generates everything
scripts/               Python validators: schema, anchors lock, clarity metrics, rewrite audit
docs/                  the authoritative content contract + continuity ledgers
.claude/               skills + workflow scripts: how the corpus is authored and audited
```

---

## 🔒 How quality is actually enforced

Not by good intentions — by gates that fail the build.

- **`## H2` headings are immutable anchors.** 28,064 questions carry
  `concepts.md#anchor` refs. `topics/.anchors.lock` freezes all **8,817** headings:
  additions pass, renames and deletions fail.
- **The slug algorithm is cross-validated.** The Python validator's slugs are diffed
  against real `github-slugger` output for every heading — 0 mismatches, or it's a bug.
  It once wasn't, and 5 refs silently pointed at ids the browser never rendered.
- **A rewrite audit** compares every prose change against the previous version and
  flags dropped facts, code fences and table rows.
- **Adversarial review.** Content changes face independent verifiers plus a web
  fact-checker restricted to primary sources — specs, JEPs, RFCs, vendor docs.
  Never a blog, never recollection.
- **Reading-comfort invariants are asserted**, not eyeballed: the prose measure,
  leading and block rhythm are pinned by tests.

> **The loop earns its keep.** In one domain, **9 of 16** topics had a real defect the
> author's own audit missed and a separate verifier caught. In another, the verifier
> caught a false universal that had *already* been recorded as an established fact —
> where every later topic would have inherited it.

---

## 🧭 Design notes worth stealing

A few decisions that took measurement rather than taste:

- **A hero parallax was deleted, not tuned.** Its layers sheared because a Z-translation
  amplified apparent travel under perspective, inverting the intended depth ladder —
  the headline moved 51px while the logo above it moved 110px.
- **A sticky card deck was deleted.** It cost 3,171px of scroll to deliver 1,073px of
  content: **33.6% of the entire page**.
- **The reading measure is capped, not maximised.** An earlier "wider is better" change
  let line length grow with the monitor — 95 characters at 1440px but 118 at 1920px.
  It is now pinned to ~95 everywhere.
- **The UI never shows state it cannot compute.** Where per-section progress is not
  knowable, it says `NO RECORD` and renders an em dash — never a confident `0`.

---

## 🤝 Contributing

Adding a topic? Copy `content-templates/`, write `concepts.md`, then `questions.yaml`,
then run `python3 scripts/validate_content.py`. The full loop lives in
`.claude/skills/authoring-content/`, and `docs/content-schema.md` is authoritative —
follow it exactly.

Read [`CLAUDE.md`](CLAUDE.md) and [`ROADMAP.md`](ROADMAP.md) first; they carry the
locked decisions and the session-by-session history.

---

<div align="center">

**Built to be read, not skimmed.**

<sub>Content authored with AI assistance and adversarially fact-checked against primary sources</sub>

</div>
