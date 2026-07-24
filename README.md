# Interview Prep — Learner's Library & Practice Website

A personal, growing library of **interview questions and answers** across system
design, DevOps (Docker, Kubernetes, CI/CD), and backend frameworks (Spring Boot,
Spring Core, Hibernate/JPA, JVM, messaging & databases) — stored as
plain Markdown so it's readable anywhere, plus a **responsive web app** (Astro) that
publishes the concepts as HTML and lets learners practice the material as
multiple-choice quizzes on laptop or phone.

## Project goals

1. **Document** the topics & subtopics frequently asked in interviews as a
   structured Markdown study library (`topics/`).
2. **Author MCQs** for each topic in structured YAML linked back to the study docs.
3. **Build a web app** ([Astro](https://astro.build/) + Tailwind, with a Preact
   quiz island) that renders the concepts as web pages and lets a learner study any
   topic and practice 25-question MCQ sessions by subtopic or domain, with score
   tracking and deep links back to the study material — all mobile-friendly.

## Repository layout

```
interview-prep/
├── README.md               ← you are here
├── CLAUDE.md               ← conventions & workflow for AI-assisted sessions
├── TOPICS.md               ← master taxonomy: every domain → topics → subtopics
├── ROADMAP.md              ← phased build plan + live progress checklist
├── topics/                 ← the learner's library, one folder per domain
│   └── <domain>/
│       ├── README.md        ← domain overview + topic index
│       └── <topic-slug>/
│           ├── concepts.md   ← study content (answers), anchored headings
│           └── questions.yaml ← MCQs referencing concepts.md sections
├── content-templates/      ← copy-me templates for new topics
│   ├── concepts.template.md
│   └── questions.template.yaml
├── web/                    ← the Astro practice website (see web/CONTRACT.md)
│   ├── scripts/sync-content.mjs  ← generates pages + question pools from topics/
│   └── src/                      ← pages, layouts, practice island
├── scripts/                ← helper scripts (content validation, stats)
├── docs/                   ← schema & authoring specs
└── .claude/skills/         ← reusable AI workflows for authoring content
```

## Domains covered

| Domain | Folder |
|---|---|
| System Design | `topics/system-design/` |
| Docker | `topics/docker/` |
| Kubernetes | `topics/kubernetes/` |
| DevOps & CI/CD | `topics/devops-cicd/` |
| Spring Boot | `topics/spring-boot/` |
| Spring Framework Core | `topics/spring-core/` |
| Hibernate & JPA | `topics/hibernate-jpa/` |
| Java & JVM | `topics/java-jvm/` |
| Messaging & Databases | `topics/messaging-databases/` |

## Status

This project is built incrementally across multiple AI-assisted sessions. See
**[ROADMAP.md](./ROADMAP.md)** for the current phase and what's done vs. pending.

## Running the website

```bash
cd web
npm install
npm run dev        # runs content sync, then starts Astro dev server
npm run build      # generates static dist/ (deploy to Netlify/Vercel)
```
