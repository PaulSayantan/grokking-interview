#!/usr/bin/env python3
"""Validate all questions.yaml files against the content schema.

Contract: docs/content-schema.md

Checks:
  - Required top-level keys present.
  - Each question has required fields with correct types.
  - `type` is `single` (default) or `multi`.
  - single: `answer` is an in-range 0-based index into `options`.
  - multi: `answers` is a list of in-range, unique 0-based indices with at least one
    correct option AND at least one distractor (never all-correct).
  - 3-5 options per question.
  - `id`s are unique within a domain (see the note in main()).
  - `difficulty` is one of the allowed values.
  - `ref`, when present, is exactly `concepts.md#<anchor>` (the topic's OWN
    concepts.md) and the anchor resolves against a real heading there
    (best-effort GitHub-style slugification, code fences excluded).
  - concepts.md structure: exactly one `# H1`, no empty heading text, and no two
    headings that slugify to the same anchor (a duplicate makes one unreachable).

Also maintains the ANCHORS LOCK (`topics/.anchors.lock`) — a frozen manifest of every
heading in the corpus. The checks above catch a `ref` that stops resolving; they do NOT
catch a heading renamed in lockstep with its refs when that was never intended, nor a
heading deleted from a topic whose questions happened not to reference it. The lock does.

Usage:
  python scripts/validate_content.py [topics_dir]               # validate (exit 1 on error)
  python scripts/validate_content.py [topics_dir] --write-lock   # (re)write the anchors lock
  python scripts/validate_content.py [topics_dir] --check-lock   # additions OK, edits/removals fail

Exit code 0 if all valid, 1 otherwise.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import NamedTuple

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required: pip install pyyaml")

ALLOWED_DIFFICULTY = {"beginner", "intermediate", "advanced", "expert"}
ALLOWED_TYPE = {"single", "multi"}
# Fields every question needs regardless of type; the correct-answer field
# (`answer` for single, `answers` for multi) is checked separately below.
REQUIRED_Q_FIELDS = {"id", "difficulty", "question", "options", "explanation"}

# A fenced code block opener/closer: 3+ backticks or 3+ tildes, optional info string.
FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")
# An ATX heading: 1-6 '#' followed by whitespace + text, or nothing at all
# ("##" alone is an empty heading; "#hashtag" is not a heading).
HEADING_RE = re.compile(r"^(#{1,6})(?:[ \t]+(.*))?$")
# The only shape a `ref` may take: a deep-link into the topic's own concepts.md.
REF_RE = re.compile(r"^concepts\.md#(.+)$")


def slugify_heading(text: str) -> str:
    """GitHub heading-anchor slugification.

    Matches github-slugger: lowercase, strip punctuation except word chars /
    whitespace / hyphens, then replace each whitespace char with a hyphen WITHOUT
    collapsing runs. So "A & B" -> "a--b" (the removed "&" leaves two spaces).
    """
    text = text.strip().lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"\s", "-", text)
    return text


class Heading(NamedTuple):
    """One ATX heading in a concepts.md, with its 1-based source line."""

    level: int
    text: str
    line: int
    slug: str


def read_headings(concepts_path: Path) -> list[Heading]:
    """Collect the ATX headings of a Markdown file, ignoring fenced code blocks.

    Inside a ``` / ~~~ fence a leading `#` is a comment (Dockerfile, YAML, shell,
    Python samples are full of them), not a heading. Fences may use either char, be
    longer than three chars, and carry an info string (```bash); a fence is closed
    only by a run of >= as many of the SAME char with no info string.
    """
    headings: list[Heading] = []
    fence_char = ""
    fence_len = 0
    for lineno, line in enumerate(concepts_path.read_text(encoding="utf-8").splitlines(), 1):
        fence = FENCE_RE.match(line)
        if fence:
            marker, info = fence.group(1), fence.group(2)
            if not fence_char:
                fence_char, fence_len = marker[0], len(marker)
                continue
            if marker[0] == fence_char and len(marker) >= fence_len and not info.strip():
                fence_char, fence_len = "", 0
                continue
        if fence_char:
            continue  # inside a code fence: not Markdown
        m = HEADING_RE.match(line)
        if m:
            text = (m.group(2) or "").strip()
            headings.append(Heading(len(m.group(1)), text, lineno, slugify_heading(text)))
    return headings


def check_concepts(concepts_path: Path) -> tuple[list[str], set[str] | None]:
    """Validate concepts.md structure; return (errors, anchors).

    `anchors` is None when the file is missing, i.e. anchor resolution is
    impossible — callers must say so out loud rather than skipping quietly.
    """
    if not concepts_path.exists():
        return ([f"{concepts_path}: missing concepts.md (every topic needs one)"], None)

    errors: list[str] = []
    headings = read_headings(concepts_path)

    h1s = [h for h in headings if h.level == 1]
    if not h1s:
        errors.append(f"{concepts_path}: no '# H1' title heading found")
    elif len(h1s) > 1:
        extra = ", ".join(f"line {h.line} '{h.text}'" for h in h1s[1:])
        errors.append(
            f"{concepts_path}:{h1s[0].line}: {len(h1s)} '# H1' headings, expected exactly 1 "
            f"(extras: {extra})"
        )

    for h in headings:
        if not h.text:
            errors.append(f"{concepts_path}:{h.line}: empty heading text ('{'#' * h.level}')")

    first_line: dict[str, int] = {}
    for h in headings:
        if not h.slug:
            continue
        if h.slug in first_line:
            errors.append(
                f"{concepts_path}:{h.line}: heading '{h.text}' duplicates anchor "
                f"'#{h.slug}' from line {first_line[h.slug]} (one of them is unreachable)"
            )
        else:
            first_line[h.slug] = h.line

    return errors, {h.slug for h in headings}


def validate_file(path: Path, seen_ids: dict[str, Path]) -> tuple[list[str], list[str]]:
    """Validate one questions.yaml (+ its sibling concepts.md); return (errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        return [f"{path}: YAML parse error: {e}"], warnings

    if not isinstance(data, dict):
        return [f"{path}: top-level must be a mapping"], warnings

    for key in ("topic", "domain", "topic_slug", "questions"):
        if key not in data:
            errors.append(f"{path}: missing top-level key '{key}'")

    concepts_errors, anchors = check_concepts(path.parent / "concepts.md")
    errors.extend(concepts_errors)

    questions = data.get("questions") or []
    if not isinstance(questions, list) or not questions:
        errors.append(f"{path}: 'questions' must be a non-empty list")
        return errors, warnings

    unchecked_refs = 0

    for i, q in enumerate(questions):
        loc = f"{path}[q#{i}]"
        if not isinstance(q, dict):
            errors.append(f"{loc}: question must be a mapping")
            continue

        missing = REQUIRED_Q_FIELDS - q.keys()
        if missing:
            errors.append(f"{loc}: missing fields {sorted(missing)}")

        qid = q.get("id")
        if qid:
            if qid in seen_ids:
                errors.append(f"{loc}: duplicate id '{qid}' (also in {seen_ids[qid]})")
            else:
                seen_ids[qid] = path

        diff = q.get("difficulty")
        if diff and diff not in ALLOWED_DIFFICULTY:
            errors.append(f"{loc}: difficulty '{diff}' not in {sorted(ALLOWED_DIFFICULTY)}")

        # Question type: default single. `multi` uses `answers: [..]`, single uses `answer`.
        qtype = q.get("type", "single")
        if qtype not in ALLOWED_TYPE:
            errors.append(f"{loc}: type '{qtype}' not in {sorted(ALLOWED_TYPE)}")

        options = q.get("options")
        if isinstance(options, list):
            n = len(options)
            if not (3 <= n <= 5):
                errors.append(f"{loc}: expected 3-5 options, got {n}")
            if qtype == "multi":
                # multi: `answers` list, no `answer`. Indices in range, unique, and at
                # least one correct AND one distractor (an all-correct SATA teaches nothing).
                if "answer" in q:
                    errors.append(f"{loc}: multi question must use 'answers' (list), not 'answer'")
                answers = q.get("answers")
                if not isinstance(answers, list) or not answers:
                    errors.append(f"{loc}: 'answers' must be a non-empty list of option indices")
                elif not all(isinstance(a, int) and 0 <= a < n for a in answers):
                    errors.append(f"{loc}: 'answers' {answers} has an index out of range for {n} options")
                elif len(set(answers)) != len(answers):
                    errors.append(f"{loc}: 'answers' {answers} has duplicate indices")
                elif len(set(answers)) >= n:
                    errors.append(f"{loc}: multi question marks all options correct — must leave ≥1 distractor")
            else:
                # single: exactly one correct via `answer`, no `answers`.
                if "answers" in q:
                    errors.append(f"{loc}: single question must use 'answer' (int), not 'answers'")
                ans = q.get("answer")
                if not isinstance(ans, int) or not (0 <= ans < n):
                    errors.append(f"{loc}: answer '{ans}' out of range for {n} options")
            # MCQ integrity invariants: no blank options, no duplicate options
            # (a repeated option is either a typo or makes two answers "correct").
            # Compare CASE-SENSITIVELY: options that differ only by case are legitimately
            # distinct (e.g. a question about naming conventions with `Foo` vs `foo`).
            norm = [str(o).strip() for o in options]
            if any(o == "" for o in norm):
                errors.append(f"{loc}: has a blank/empty option")
            nonblank = [o for o in norm if o != ""]
            if len(set(nonblank)) != len(nonblank):
                errors.append(f"{loc}: has duplicate options")
        else:
            errors.append(f"{loc}: 'options' must be a list")

        # Every question must teach: a non-empty explanation is required by the
        # schema, but an all-whitespace one passes the presence check — catch it.
        if "explanation" in q and not str(q.get("explanation") or "").strip():
            errors.append(f"{loc}: 'explanation' is blank")

        # `ref` is optional, but when present it must be a deep-link into THIS topic's
        # concepts.md — anything else (another topic, an external URL, a bare anchor)
        # is a broken "Learn more" link on the site.
        if "ref" in q:
            m = REF_RE.match(str(q.get("ref") or "").strip())
            if not m:
                errors.append(
                    f"{loc}: ref '{q.get('ref')}' must be 'concepts.md#<anchor>' "
                    f"(this topic's own concepts.md)"
                )
            elif anchors is None:
                unchecked_refs += 1
            elif m.group(1) not in anchors:
                errors.append(f"{loc}: ref anchor '#{m.group(1)}' not found in concepts.md")

    if unchecked_refs:
        warnings.append(
            f"{path}: {unchecked_refs} ref anchor(s) NOT checked — "
            f"{path.parent / 'concepts.md'} is missing, so no anchors could be read"
        )

    return errors, warnings


# ======================================================================================
# The anchors lock
#
# `topics/.anchors.lock` freezes every heading in every concepts.md. `--write-lock`
# regenerates it (a deliberate act, reviewed in the diff); `--check-lock` fails when a
# locked heading's text or depth changed, or when it vanished. New headings always pass:
# a prose rewrite may ADD sections, it may not quietly re-word the ~28k anchor targets
# that MCQ `ref:` fields deep-link into.
# ======================================================================================

LOCK_FILENAME = ".anchors.lock"

LOCK_HEADER = """\
# ANCHORS LOCK — generated, do not hand-edit.
#
# Every heading below is a live deep-link target: MCQ `ref: "concepts.md#<anchor>"`
# fields resolve against them. Renaming, merging, splitting or deleting one breaks those
# refs — and if the refs are edited in the same pass, it breaks them SILENTLY.
#
# Format: tab-separated, 4 columns.
#   <domain>/<topic-slug> <TAB> <depth> <TAB> <anchor-slug> <TAB> <heading text>
# The heading text is the last column, so it may itself contain tabs.
# Order: by "<domain>/<topic-slug>", then document order within that concepts.md.
#
#   regenerate (deliberately):  python scripts/validate_content.py --write-lock
#   verify (CI runs this):      python scripts/validate_content.py --check-lock
"""


class LockRow(NamedTuple):
    """One locked heading. `topic` is '<domain>/<topic-slug>'."""

    topic: str
    level: int
    slug: str
    text: str


def topic_of(concepts_path: Path, root: Path) -> str:
    """'<domain>/<topic-slug>' for a concepts.md — the lock's first column."""
    try:
        rel = concepts_path.relative_to(root).parent
    except ValueError:
        rel = concepts_path.parent
    return rel.as_posix()


def collect_lock_rows(root: Path) -> list[LockRow]:
    """Every heading in the live corpus, in lock order.

    Sorting by topic key alone is enough to be deterministic: there is exactly one
    concepts.md per topic directory, so the key is unique and `rglob`'s filesystem-
    dependent order cannot leak in. Within a topic we keep DOCUMENT order, which makes
    an inserted section show up as a clean one-line insertion in the diff.
    """
    rows: list[LockRow] = []
    for path in sorted(root.rglob("concepts.md"), key=lambda p: topic_of(p, root)):
        topic = topic_of(path, root)
        rows.extend(LockRow(topic, h.level, h.slug, h.text) for h in read_headings(path))
    return rows


def parse_lock(text: str, lock_path: Path) -> tuple[list[LockRow], list[str]]:
    """Parse a lock file; return (rows, errors). Comment and blank lines are skipped."""
    rows: list[LockRow] = []
    errors: list[str] = []
    for lineno, line in enumerate(text.splitlines(), 1):
        if not line.strip() or line.startswith("#"):
            continue
        parts = line.split("\t", 3)  # split(…, 3): heading text keeps any tabs it has
        if len(parts) != 4 or not parts[1].isdigit():
            errors.append(f"{lock_path}:{lineno}: malformed lock line {line!r}")
            continue
        rows.append(LockRow(parts[0], int(parts[1]), parts[2], parts[3]))
    return rows, errors


# Parsing a topic's questions.yaml once is fine; doing it once per heading is not.
_REF_COUNTS: dict[tuple[str, str], dict[str, int]] = {}


def ref_counts(root: Path, topic: str) -> dict[str, int]:
    """anchor-slug -> how many of this topic's MCQs deep-link it. Cached per topic."""
    key = (str(root), topic)
    if key not in _REF_COUNTS:
        counts: dict[str, int] = {}
        try:
            data = yaml.safe_load((root / topic / "questions.yaml").read_text(encoding="utf-8"))
        except (yaml.YAMLError, OSError):
            data = None
        questions = data.get("questions") if isinstance(data, dict) else None
        for q in questions if isinstance(questions, list) else []:
            if not isinstance(q, dict):
                continue
            m = REF_RE.match(str(q.get("ref") or "").strip())
            if m:
                counts[m.group(1)] = counts.get(m.group(1), 0) + 1
        _REF_COUNTS[key] = counts
    return _REF_COUNTS[key]


def count_refs(root: Path, topic: str, slug: str) -> int:
    """How many MCQs currently deep-link `#slug` in this topic — the blast radius."""
    return ref_counts(root, topic).get(slug, 0)


def depth_histogram(rows: list[LockRow]) -> str:
    """'H1 460, H2 7000, …' — a one-glance shape summary of the corpus."""
    counts: dict[int, int] = {}
    for r in rows:
        counts[r.level] = counts.get(r.level, 0) + 1
    return ", ".join(f"H{lvl} {counts[lvl]}" for lvl in sorted(counts))


def write_lock(root: Path) -> int:
    rows = collect_lock_rows(root)
    if not rows:
        print(f"No concepts.md found under {root} — refusing to write an empty lock.")
        return 1
    lock_path = root / LOCK_FILENAME
    body = "".join(f"{r.topic}\t{r.level}\t{r.slug}\t{r.text}\n" for r in rows)
    lock_path.write_text(LOCK_HEADER + body, encoding="utf-8")
    topics = len({r.topic for r in rows})
    print(
        f"✅ Wrote {lock_path}: {len(rows)} heading(s) across {topics} topic(s) "
        f"({depth_histogram(rows)})."
    )
    return 0


def check_lock(root: Path) -> int:
    lock_path = root / LOCK_FILENAME
    if not lock_path.exists():
        print(
            f"❌ no anchors lock at {lock_path}. Create the baseline with:\n"
            f"     python scripts/validate_content.py --write-lock"
        )
        return 1

    locked, errors = parse_lock(lock_path.read_text(encoding="utf-8"), lock_path)
    live = collect_lock_rows(root)

    # Key by (topic, anchor-slug): the slug is what a `ref` resolves against, so it is the
    # identity that matters. Two headings in one topic sharing a slug is already an error
    # in check_concepts(), so first-wins here cannot hide anything new.
    live_by_key: dict[tuple[str, str], LockRow] = {}
    for r in live:
        live_by_key.setdefault((r.topic, r.slug), r)
    locked_keys = {(r.topic, r.slug) for r in locked}

    # New anchors, per topic — the likely landing spot of a rename, worth naming in the
    # error so the reader can see at a glance what the heading probably became.
    added: list[LockRow] = [r for r in live if (r.topic, r.slug) not in locked_keys]
    added_by_topic: dict[str, list[str]] = {}
    for r in added:
        added_by_topic.setdefault(r.topic, []).append(f"#{r.slug}")

    # A topic that lost its concepts.md entirely gets ONE error, not one per heading —
    # 40 near-identical lines would bury whatever else the run found.
    live_topics = {r.topic for r in live}
    gone_topics: dict[str, list[LockRow]] = {}
    for r in locked:
        if r.topic not in live_topics:
            gone_topics.setdefault(r.topic, []).append(r)
    for topic, rows in gone_topics.items():
        exists = (root / topic / "concepts.md").exists()
        why = "has no headings left" if exists else "is GONE"
        refs = sum(count_refs(root, topic, r.slug) for r in rows)
        errors.append(
            f"{topic}: concepts.md {why} — all {len(rows)} locked heading(s) removed "
            f"(H1 '{rows[0].text}'); {refs} MCQ ref(s) in this topic point at them"
        )

    for r in locked:
        if r.topic in gone_topics:
            continue  # already reported once, above
        cur = live_by_key.get((r.topic, r.slug))
        if cur is not None and cur.text == r.text and cur.level == r.level:
            continue  # unchanged: the common case, and it must stay cheap (no YAML parse)
        refs = count_refs(root, r.topic, r.slug)
        if cur is None:
            msg = (
                f"{r.topic}: heading '{'#' * r.level} {r.text}' (anchor '#{r.slug}') was "
                f"REMOVED or RENAMED — {refs} MCQ ref(s) still point at '#{r.slug}'"
            )
            if refs == 0:
                # The dangerous case: nothing looks broken today, so only this lock objects.
                msg += (
                    " — so the ref check alone stays green (the refs were moved in lockstep, "
                    "or this heading was never referenced)"
                )
            candidates = added_by_topic.get(r.topic, [])
            if candidates:
                shown = ", ".join(candidates[:3])
                more = f" (+{len(candidates) - 3} more)" if len(candidates) > 3 else ""
                msg += f"; new anchor(s) in this topic: {shown}{more}"
            errors.append(msg)
        else:
            errors.append(
                f"{r.topic}: heading '#{r.slug}' was MODIFIED: "
                f"'{'#' * r.level} {r.text}' -> '{'#' * cur.level} {cur.text}' "
                f"— {refs} MCQ ref(s) point at '#{r.slug}'"
            )

    if errors:
        print(f"❌ anchors lock: {len(errors)} heading change(s) that MCQ refs depend on:\n")
        for e in errors:
            print(f"  - {e}")
        print(
            "\nIf every change above is intended, update each affected `ref:` in the same "
            "commit, prove it with `python scripts/validate_content.py`, then re-baseline "
            "with `python scripts/validate_content.py --write-lock`."
        )
        return 1

    note = f" (+{len(added)} new heading(s); additions are allowed)" if added else ""
    print(
        f"✅ anchors lock: all {len(locked)} locked heading(s) across "
        f"{len({r.topic for r in locked})} topic(s) intact{note}."
    )
    return 0


def main() -> int:
    args = sys.argv[1:]
    mode = "validate"
    positional: list[str] = []
    for arg in args:
        if arg in ("--write-lock", "--check-lock"):
            mode = arg[2:]
        elif arg.startswith("-"):
            print(
                f"unknown option '{arg}'\n"
                f"usage: validate_content.py [topics_dir] [--write-lock | --check-lock]"
            )
            return 1
        else:
            positional.append(arg)

    root = Path(positional[0]) if positional else Path(__file__).parent.parent / "topics"

    if mode == "write-lock":
        return write_lock(root)
    if mode == "check-lock":
        return check_lock(root)

    files = sorted(root.rglob("questions.yaml"))
    if not files:
        print(f"No questions.yaml found under {root} (nothing to validate yet).")
        return 0

    # Question ids only need to be unique WITHIN a domain (the id already embeds the
    # topic-slug, and two different domains may legitimately reuse a topic-slug, e.g.
    # spring-boot and spring-core both have "configuration-profiles-properties"). So we
    # dedupe per domain, keyed by the domain folder directly under topics/.
    def domain_of(path: Path) -> str:
        parts = path.parts
        if "topics" in parts:
            i = parts.index("topics")
            if i + 1 < len(parts):
                return parts[i + 1]
        return str(path.parent.parent)

    per_domain_ids: dict[str, dict[str, Path]] = {}
    all_errors: list[str] = []
    all_warnings: list[str] = []
    total_q = 0
    for f in files:
        seen_ids = per_domain_ids.setdefault(domain_of(f), {})
        before = len(seen_ids)
        errors, warnings = validate_file(f, seen_ids)
        all_errors.extend(errors)
        all_warnings.extend(warnings)
        total_q += len(seen_ids) - before

    # Warnings name every check that could NOT run. A validator that skips silently is
    # worse than one that fails, so these are printed even when everything else passes.
    if all_warnings:
        print(f"⚠️  {len(all_warnings)} check(s) skipped:\n")
        for w in all_warnings:
            print(f"  - {w}")
        print()

    if all_errors:
        print(f"❌ {len(all_errors)} problem(s) found:\n")
        for e in all_errors:
            print(f"  - {e}")
        return 1

    print(f"✅ Validated {len(files)} file(s), {total_q} question(s). All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
