# CLAUDE.md — Working conventions for this repository

This repo is built **incrementally across many AI-assisted sessions**. Read this file
and `ROADMAP.md` at the start of every session to recover context.

## What this project is

A learner's library of interview Q&A (Markdown) + a responsive **web app** (Astro) that
publishes the concepts as HTML and lets learners practice them as MCQs on laptop or phone.
See `README.md` for the full picture and `TOPICS.md` for the taxonomy.

## Key decisions (do not re-litigate without user sign-off)

- **Web stack:** [Astro](https://astro.build/) (static output) + Tailwind CSS, with a
  small Preact island for the interactive practice quiz. Lives in `web/`. A prebuild
  `sync-content.mjs` step reads `topics/` and generates content-collection entries +
  per-pool question JSON. Static `dist/` deploys to Netlify/Vercel.
  (A Python/Textual TUI was considered early on and **dropped** — do not reintroduce it.)
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

### When building the web app
1. The site lives in `web/` (Astro). Read `web/CONTRACT.md` for the data shapes,
   route map, layout, and design tokens before adding pages.
2. Content is read-only source of truth: `web/scripts/sync-content.mjs` reads `topics/`
   and generates the content collection + question JSON pools. Never edit `topics/` from
   the web app.
3. Run `cd web && npm run dev` (runs sync then astro dev). `npm run build` produces `dist/`.
4. Generated artifacts (content collection copies, question JSON, `dist/`) are gitignored —
   only source is committed.

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
- Web app: TypeScript; Astro + Tailwind + Preact; minimalist, responsive, accessible.
- `scripts/validate_content.py` (content validator) still runs on Python + PyYAML.
- Keep commits scoped: content commits separate from web-app commits.
