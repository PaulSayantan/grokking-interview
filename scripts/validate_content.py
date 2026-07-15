#!/usr/bin/env python3
"""Validate all questions.yaml files against the content schema.

Contract: docs/content-schema.md

Checks:
  - Required top-level keys present.
  - Each question has required fields with correct types.
  - `answer` is an in-range 0-based index into `options`.
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

ALLOWED_DIFFICULTY = {"beginner", "intermediate", "advanced"}
REQUIRED_Q_FIELDS = {"id", "difficulty", "question", "options", "answer", "explanation"}


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

        options = q.get("options")
        if isinstance(options, list):
            if not (3 <= len(options) <= 5):
                errors.append(f"{loc}: expected 3-5 options, got {len(options)}")
            ans = q.get("answer")
            if not isinstance(ans, int) or not (0 <= ans < len(options)):
                errors.append(f"{loc}: answer '{ans}' out of range for {len(options)} options")
        else:
            errors.append(f"{loc}: 'options' must be a list")

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

    seen_ids: dict[str, Path] = {}
    all_errors: list[str] = []
    for f in files:
        all_errors.extend(validate_file(f, seen_ids))

    if all_errors:
        print(f"❌ {len(all_errors)} problem(s) found:\n")
        for e in all_errors:
            print(f"  - {e}")
        return 1

    total_q = len(seen_ids)
    print(f"✅ Validated {len(files)} file(s), {total_q} question(s). All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
