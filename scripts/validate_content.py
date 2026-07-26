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
  - `id`s are globally unique.
  - `difficulty` is one of the allowed values.
  - If `ref` points to concepts.md#anchor, the anchor resolves in the sibling
    concepts.md (best-effort GitHub-style slugification).

Usage:  python scripts/validate_content.py [topics_dir]
Exit code 0 if all valid, 1 otherwise.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required: pip install pyyaml")

ALLOWED_DIFFICULTY = {"beginner", "intermediate", "advanced", "expert"}
ALLOWED_TYPE = {"single", "multi"}
# Fields every question needs regardless of type; the correct-answer field
# (`answer` for single, `answers` for multi) is checked separately below.
REQUIRED_Q_FIELDS = {"id", "difficulty", "question", "options", "explanation"}


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


def concepts_anchors(concepts_path: Path) -> set[str]:
    anchors: set[str] = set()
    if not concepts_path.exists():
        return anchors
    for line in concepts_path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^#{1,6}\s+(.*)$", line)
        if m:
            anchors.add(slugify_heading(m.group(1)))
    return anchors


def validate_file(path: Path, seen_ids: dict[str, Path]) -> list[str]:
    errors: list[str] = []
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        return [f"{path}: YAML parse error: {e}"]

    if not isinstance(data, dict):
        return [f"{path}: top-level must be a mapping"]

    for key in ("topic", "domain", "topic_slug", "questions"):
        if key not in data:
            errors.append(f"{path}: missing top-level key '{key}'")

    questions = data.get("questions") or []
    if not isinstance(questions, list) or not questions:
        errors.append(f"{path}: 'questions' must be a non-empty list")
        return errors

    anchors = concepts_anchors(path.parent / "concepts.md")

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

        ref = q.get("ref")
        if ref and "#" in str(ref) and anchors:
            anchor = str(ref).split("#", 1)[1]
            if anchor not in anchors:
                errors.append(f"{loc}: ref anchor '#{anchor}' not found in concepts.md")

    return errors


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent.parent / "topics"
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
    total_q = 0
    for f in files:
        seen_ids = per_domain_ids.setdefault(domain_of(f), {})
        before = len(seen_ids)
        all_errors.extend(validate_file(f, seen_ids))
        total_q += len(seen_ids) - before

    if all_errors:
        print(f"❌ {len(all_errors)} problem(s) found:\n")
        for e in all_errors:
            print(f"  - {e}")
        return 1

    print(f"✅ Validated {len(files)} file(s), {total_q} question(s). All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
