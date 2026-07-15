---
name: tui-development
description: Build or extend the Python/Textual terminal MCQ practice app in app/. Use when the user wants to work on the interactive quiz application — the content loader, quiz engine, Textual UI screens, scoring, or packaging.
---

# Building the TUI practice app

The app lives in `app/src/interview_practice/`. Stack is **Python 3.11+ + Textual +
Rich + PyYAML** (locked decision — see repo `CLAUDE.md`). Content contract is
`docs/content-schema.md`.

## Before you start
1. Read `ROADMAP.md` Phase 2 for the target architecture and what's done.
2. Read `app/README.md` for the planned module layout.
3. Set up the env: `cd app && pip install -e ".[dev]"`.

## Build order (respect dependencies)
1. **`core/models.py`** — dataclasses: `Question`, `Topic`, `Domain`, `QuizSession`.
2. **`core/loader.py`** — walk `../../topics/**/questions.yaml`, parse into models,
   reuse the validation logic from `scripts/validate_content.py` (or import it).
   Loader must refuse invalid files loudly.
3. **`core/engine.py`** — selection modes (by-topic, by-domain, random, weak-topic),
   shuffling, scoring, per-question result capture.
4. **`core/progress.py`** — persist history under `~/.interview-practice/`.
5. **`ui/`** — Textual `App` with screens: Home → Topic picker → Quiz → Results.
   Use widgets for the question card and option list; bind keys (1–5 to answer,
   arrows to navigate, `q` quit). Render `explanation` and `concepts.md` sections
   with Rich/Markdown.
6. **`__main__.py`** — `main()` entry point wired to `pyproject.toml`.
7. **Tests** — `pytest` for loader + engine (pure logic, no UI needed).

## Running & verifying
- `interview-practice` — normal run.
- `textual run --dev src/interview_practice/ui/app.py` — dev console for debugging.
- Always actually launch the app and drive a quiz to confirm a change works, not just
  run unit tests. Use the `verify` skill.

## Conventions
- Type hints everywhere; keep deps minimal (Textual, Rich, PyYAML only).
- Keep UI (`ui/`) free of file-parsing logic — that belongs in `core/`.
- Don't hard-code content paths; resolve `topics/` relative to the repo root.

## Progress tracking
Update `ROADMAP.md` Phase 2 checklist and Claude memory at the end of the session.
