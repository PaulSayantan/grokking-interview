# Interview Prep — Learner's Library & Practice TUI

A personal, growing library of **interview questions and answers** across system
design, DevOps (Docker, Kubernetes, CI/CD), and backend frameworks (Spring Boot,
Spring Core, Hibernate/JPA, Apache Tomcat, JVM, messaging & databases) — stored as
plain Markdown so it's readable anywhere, plus an **interactive terminal (TUI)
application** to practice the material as multiple-choice quizzes.

## Project goals

1. **Document** the topics & subtopics frequently asked in interviews as a
   structured Markdown study library (`topics/`).
2. **Author MCQs** for each topic in structured YAML linked back to the study docs.
3. **Build a TUI app** (Python + [Textual](https://textual.textualize.io/)) that lets
   a learner practice questions by topic or at random, tracks scores, and links back
   to the relevant study material.

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
├── app/                    ← the Textual TUI practice application
│   ├── pyproject.toml
│   └── src/interview_practice/
├── scripts/                ← helper scripts (content validation, stats)
├── docs/                   ← schema & authoring specs
└── .claude/skills/         ← reusable AI workflows for authoring & app dev
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
| Apache Tomcat | `topics/apache-tomcat/` |
| Java & JVM | `topics/java-jvm/` |
| Messaging & Databases | `topics/messaging-databases/` |

## Status

This project is built incrementally across multiple AI-assisted sessions. See
**[ROADMAP.md](./ROADMAP.md)** for the current phase and what's done vs. pending.

## Practicing (once the app exists)

```bash
cd app
pip install -e .
interview-practice          # launch the TUI
```
