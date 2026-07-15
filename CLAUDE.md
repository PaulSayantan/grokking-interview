# CLAUDE.md — Working conventions for this repository

This repo is built **incrementally across many AI-assisted sessions**. Read this file
and `ROADMAP.md` at the start of every session to recover context.

## What this project is

A learner's library of interview Q&A (Markdown) + a Python/Textual TUI to practice
them as MCQs. See `README.md` for the full picture and `TOPICS.md` for the taxonomy.

## Key decisions (do not re-litigate without user sign-off)

- **TUI stack:** Python 3.11+ with [Textual](https://textual.textualize.io/) + Rich.
- **Content model:** study content in `concepts.md`; MCQs in a separate
  `questions.yaml` per topic, linked via a `ref: concepts.md#anchor` field.
- **Content contract:** `docs/content-schema.md` is authoritative. Follow it exactly.
- **Slugs are stable identifiers** — never rename a domain/topic slug once questions
  reference it.

## How to work in this repo

### When authoring study content or questions
1. Pick a topic from `TOPICS.md` that is not yet marked done in `ROADMAP.md`.
2. Copy templates from `content-templates/` into `topics/<domain>/<topic>/`.
3. Write `concepts.md` (interview-grade answers) then `questions.yaml` (8–15 MCQs).
4. Run `python scripts/validate_content.py` — must pass.
5. Update the progress checklist in `ROADMAP.md` and the Claude memory index.
6. Use the `authoring-content` skill in `.claude/skills/` for the full loop.

### When building the app
1. Follow the architecture in `ROADMAP.md` (data layer → core quiz engine → UI).
2. App code lives under `app/src/interview_practice/`.
3. The app reads content from `../topics/` via the loader in `core/`.
4. Use the `tui-development` skill in `.claude/skills/`.

## Progress tracking (IMPORTANT)

At the **end of every session**, before finishing:
- Update the checklist in `ROADMAP.md` (mark topics/tasks done).
- Update Claude memory at
  `~/.claude/projects/<this-repo-project-dir>/memory/`
  (see `MEMORY.md` index there) with what changed and what's next.

This is how future sessions stay smooth — treat it as non-optional.

## Conventions

- Markdown: one `# H1` per file; `## H2` per subtopic (these are MCQ anchor targets).
- YAML: 2-space indent; `answer` is a **0-based** index into `options`.
- Python: type hints, `ruff`/`black` friendly, no heavy deps beyond Textual + PyYAML.
- Keep commits scoped: content commits separate from app-code commits.
