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
  - prompts.yaml, WHEN PRESENT (the optional clarity sidecar — see validate_prompts):
    required fields, per-domain-unique ids, closed `kind`/`tier` sets, tier-C/tier-D
    obligations, <=14 prompts and <=1 per anchor, and every pointer resolving —
    `ref`, `answer_in` (in this topic, another topic, or `external`), `resolves.anchor`
    and `cliffhanger.payoff.anchor` (which must land in the NEXT topic by README row
    order). A topic with no prompts.yaml is valid, forever.

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

# --- prompts.yaml (the optional clarity sidecar) ---------------------------------------
# Contract: docs/content-schema.md ("`prompts.yaml` — think-prompts and the cliffhanger").
# Absence of the file is ALWAYS valid: the clarity rollout is one domain at a time, so
# migrated and un-migrated topics must both validate, forever.
PROMPTS_FILENAME = "prompts.yaml"
REQUIRED_PROMPTS_KEYS = ("topic", "domain", "topic_slug", "schema", "pass")
ALLOWED_PROMPTS_KEYS = set(REQUIRED_PROMPTS_KEYS) | {"resolves", "prompts", "cliffhanger"}
# The five prompt kinds, closed set (clarity-standard: "The five kinds — no others").
ALLOWED_PROMPT_KINDS = {
    "predict-failure",
    "name-the-price",
    "draw-the-boundary",
    "refute",
    "notice-in-wild",
}
# The four closure tiers: A in-file, B another topic, C primary source, D open.
ALLOWED_PROMPT_TIERS = {"A", "B", "C", "D"}
ALLOWED_PROMPT_KEYS = {
    "id", "ref", "kind", "tier", "prompt", "hint", "answer_in",
    "success_criterion", "answer_shape", "search_hint",
}
PROMPT_WORD_CAP = 35          # prompt body; success_criterion/answer_shape are exempt
MAX_PROMPTS_PER_TOPIC = 14    # hard cap, does not scale with file length
MAX_TEASER_QUESTIONS = 3
CLIFFHANGER_MIN_WORDS = 80    # prose only, code artifact excluded
CLIFFHANGER_MAX_WORDS = 140
CLIFFHANGER_MAX_SENTENCE_WORDS = 25
CLIFFHANGER_MAX_EM_DASHES = 1
# Trailer register, banned verbatim by the standard's "Hard form limits".
CLIFFHANGER_BANNED = (
    "surprising", "shocking", "secret", "devastating", "brutal", "notorious",
    "most engineers don't know", "never look at", "there's a catch", "stay tuned",
    "read on",
)
# `answer_in` / `payoff.anchor` pointing at ANOTHER topic. Two spellings are legal:
# "<domain>/<slug>#anchor" (what the shipped observability sidecar uses) and
# "/study/<domain>/<slug>#anchor" (the site URL, what the standard's tier-B text shows).
CROSS_TOPIC_RE = re.compile(r"^/?(?:study/)?([a-z0-9][a-z0-9-]*)/([a-z0-9][a-z0-9-]*)#(.+)$")
# A prompt id conventionally embeds the topic slug, like a question id: "<slug>-pNNN".
PROMPT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*-p\d{3,}$")


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
# Reading order — the ONE definition, shared by the prompts checks and continuity_check.py
#
# It mirrors `web/scripts/sync-content.mjs` exactly, because a cliffhanger's destination is
# resolved from it at build time and a second definition would put the validator and the
# rendered pager in disagreement:
#   * slug order comes from the domain README's table rows (readReadmeOrder), and
#   * system-design is grouped first (sdGroupKey / SD_GROUP_ORDER), so its reading order is
#     group-major, README-minor. Every other domain is one group, i.e. plain README order.
# The prefix tests below are ORDER-SENSITIVE: `aws-cdp-` must be matched before `aws-`.
# ======================================================================================

SD_ADVANCED = {
    "interview-method-scenario-playbooks",
    "consensus-clocks-and-time",
    "distributed-transactions-advanced",
    "capacity-modeling-and-tail-latency",
    "failure-theory-advanced",
    "data-internals-storage-engines",
    "probabilistic-data-structures",
    "microservices-ddd-and-boundaries",
}
SD_GROUP_ORDER = ["core", "advanced", "patterns", "architecture", "ccp", "aws", "cdp"]

# Table rows only ("|" first), first backticked slug-shaped token wins — same scan as
# readReadmeOrder() in sync-content.mjs, so prose backticks cannot inject an order.
README_ROW_SLUG_RE = re.compile(r"`([a-z0-9][a-z0-9-]*)`")


def sd_group_key(slug: str) -> str:
    """Group key for a system-design subtopic slug (mirror of sync-content.mjs)."""
    if slug.startswith("ccp-"):
        return "ccp"
    if slug.startswith("aws-cdp-"):  # MUST precede the aws- test
        return "cdp"
    if slug.startswith("aws-"):
        return "aws"
    if slug.startswith("dp-"):
        return "patterns"
    if slug.startswith("arch-"):
        return "architecture"
    if slug in SD_ADVANCED:
        return "advanced"
    return "core"


def readme_order(domain_dir: Path) -> dict[str, int]:
    """slug -> 0-based row index from the domain README's topic tables."""
    readme = domain_dir / "README.md"
    order: dict[str, int] = {}
    if not readme.exists():
        return order
    for line in readme.read_text(encoding="utf-8").splitlines():
        if not line.lstrip().startswith("|"):
            continue
        m = README_ROW_SLUG_RE.search(line)
        if m and m.group(1) not in order:
            order[m.group(1)] = len(order)
    return order


_READING_ORDER: dict[str, list[str]] = {}


def reading_order(domain_dir: Path) -> list[str]:
    """The domain's topic slugs in learning order — the site's own sequence.

    Population: every subdirectory holding a questions.yaml (the same population the
    validator walks). A slug absent from the README sinks to the end of its group,
    alphabetically, exactly as sync-content.mjs does it (which also warns about it).
    """
    key = str(domain_dir)
    if key in _READING_ORDER:
        return _READING_ORDER[key]
    slugs = sorted(
        p.name for p in domain_dir.iterdir()
        if p.is_dir() and (p / "questions.yaml").exists()
    )
    order = readme_order(domain_dir)
    is_sd = domain_dir.name == "system-design"

    def sort_key(slug: str) -> tuple[int, int, str]:
        group = sd_group_key(slug) if is_sd else "all"
        gi = SD_GROUP_ORDER.index(group) if group in SD_GROUP_ORDER else 0
        return (gi, order.get(slug, len(order) + 1), slug)

    _READING_ORDER[key] = sorted(slugs, key=sort_key)
    return _READING_ORDER[key]


def next_topic(domain_dir: Path, slug: str) -> str | None:
    """The topic a cliffhanger must point at: the next one in reading order, or None."""
    seq = reading_order(domain_dir)
    if slug not in seq:
        return None
    i = seq.index(slug)
    return seq[i + 1] if i + 1 < len(seq) else None


# ======================================================================================
# prompts.yaml — the optional clarity sidecar
#
# Gate model, chosen per check (a false-positive-heavy hard gate on prose style gets
# switched off within a week, so only mechanical, information-losing defects fail):
#   ERROR   — the file does not parse; a required field is missing; an id collides inside
#             the domain; `kind`/`tier` outside their closed sets; a tier-C prompt with no
#             success_criterion or a tier-D prompt with no answer_shape; more than 14
#             prompts; two prompts on one anchor; ANY dangling anchor (ref, answer_in,
#             resolves, cliffhanger payoff). Each of these either breaks a link the reader
#             clicks or makes the prompt unanswerable.
#   WARNING — every prose-shaped budget: the 35-word prompt cap, the cliffhanger's
#             80-140 words / 25-word sentences / em-dash / hype-string limits, id format,
#             unknown keys, tier-vs-answer_in mismatch that still resolves, and the K7
#             "payoff target is a real topic but is no longer next" case.
# ======================================================================================

_ANCHORS: dict[str, set[str] | None] = {}


def anchors_of(concepts_path: Path) -> set[str] | None:
    """Heading anchors of a concepts.md, or None when the file is missing. Cached."""
    key = str(concepts_path)
    if key not in _ANCHORS:
        _ANCHORS[key] = (
            {h.slug for h in read_headings(concepts_path)} if concepts_path.exists() else None
        )
    return _ANCHORS[key]


def count_words(text: str) -> int:
    """Words the way corpus_stats.py counts them: a token needs one alphanumeric."""
    return sum(1 for t in str(text).split() if any(c.isalnum() for c in t))


def cliffhanger_prose(hook: str) -> str:
    """The hook's PROSE, with any code artifact removed.

    A code artifact carries no sentence terminators, so leaving it in fuses it with the
    surrounding prose and over-reports both the word count and the longest sentence (the
    standard's own shipped example measures 85 words / 16 with it out, 97 / 17 with it in).
    Artifacts are indented blocks or fenced blocks inside the folded scalar.
    """
    out: list[str] = []
    fenced = False
    for line in str(hook).splitlines():
        if FENCE_RE.match(line):
            fenced = not fenced
            out.append("")  # the artifact is a break, not a join (see split_sentences)
            continue
        if fenced or (line.strip() and line.startswith("    ")):
            out.append("")
            continue
        out.append(line)
    return "\n".join(out)


def split_sentences(text: str) -> list[str]:
    """Sentence split for the cliffhanger's report-only length checks.

    A blank line ends a sentence, the way corpus_stats.py ends a segment. Without that,
    prose either side of a removed code artifact fuses into one over-long sentence: the
    standard's own shipped example then reads 17 words instead of its true 16.
    """
    out: list[str] = []
    for block in re.split(r"\n\s*\n", text):
        joined = " ".join(block.split())
        out.extend(s.strip() for s in re.split(r"(?<=[.!?])\s+", joined) if s.strip())
    return out


def resolve_pointer(value: str, own: Path, root: Path) -> tuple[str | None, str]:
    """Resolve an `answer_in` / anchor pointer; return (error_or_None, form).

    Forms: "concepts.md#anchor" (this topic), "<domain>/<slug>#anchor" or
    "/study/<domain>/<slug>#anchor" (another topic — a deliberate exception to the
    own-folder rule MCQ refs follow), and the literal "external" (tier C).
    """
    text = str(value).strip()
    if text == "external":
        return None, "external"
    m = REF_RE.match(text)
    if m:
        anchors = anchors_of(own / "concepts.md")
        if anchors is None:
            return f"cannot resolve '{text}': {own / 'concepts.md'} is missing", "in-file"
        if m.group(1) not in anchors:
            return f"anchor '#{m.group(1)}' not found in {own / 'concepts.md'}", "in-file"
        return None, "in-file"
    m = CROSS_TOPIC_RE.match(text)
    if m:
        domain, slug, anchor = m.groups()
        target = root / domain / slug / "concepts.md"
        anchors = anchors_of(target)
        if anchors is None:
            return f"cross-topic target '{domain}/{slug}' has no concepts.md", "cross-topic"
        if anchor not in anchors:
            return f"target '#{anchor}' not found in {target}", "cross-topic"
        return None, "cross-topic"
    return (
        f"'{text}' is not a legal pointer — use 'concepts.md#anchor', "
        f"'<domain>/<slug>#anchor', or 'external'"
    ), "malformed"


def validate_prompts(
    path: Path, root: Path, seen_ids: dict[str, Path]
) -> tuple[list[str], list[str]]:
    """Validate one prompts.yaml. `seen_ids` is the per-DOMAIN prompt-id namespace."""
    errors: list[str] = []
    warnings: list[str] = []
    topic_dir = path.parent
    domain_dir = topic_dir.parent
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        return [f"{path}: YAML parse error: {e}"], warnings

    if not isinstance(data, dict):
        return [f"{path}: top-level must be a mapping"], warnings

    for key in REQUIRED_PROMPTS_KEYS:
        if key not in data:
            errors.append(f"{path}: missing top-level key '{key}'")
    unknown = sorted(set(data) - ALLOWED_PROMPTS_KEYS)
    if unknown:
        warnings.append(f"{path}: unknown top-level key(s) {unknown} (typo? they are ignored)")

    # Identity must match the directory, or the generated artifact keys the wrong topic.
    if "domain" in data and str(data["domain"]) != domain_dir.name:
        errors.append(f"{path}: domain '{data['domain']}' != folder '{domain_dir.name}'")
    if "topic_slug" in data and str(data["topic_slug"]) != topic_dir.name:
        errors.append(f"{path}: topic_slug '{data['topic_slug']}' != folder '{topic_dir.name}'")
    if "schema" in data and not isinstance(data["schema"], int):
        errors.append(f"{path}: 'schema' must be an integer (got {data['schema']!r})")

    # `resolves` — where THIS topic settles the previous topic's open loop (rule K1).
    resolves = data.get("resolves")
    if resolves is not None:
        if not isinstance(resolves, dict) or "anchor" not in resolves:
            errors.append(f"{path}: 'resolves' must be a mapping with an 'anchor'")
        else:
            err, _form = resolve_pointer(resolves["anchor"], topic_dir, root)
            if err:
                errors.append(f"{path}: resolves.anchor {err}")

    prompts = data.get("prompts")
    if prompts is None:
        warnings.append(f"{path}: no 'prompts' list (only the cliffhanger will render)")
        prompts = []
    elif not isinstance(prompts, list) or not prompts:
        errors.append(f"{path}: 'prompts' must be a non-empty list when present")
        prompts = []

    if len(prompts) > MAX_PROMPTS_PER_TOPIC:
        errors.append(
            f"{path}: {len(prompts)} prompts exceeds the hard cap of "
            f"{MAX_PROMPTS_PER_TOPIC} per topic (it does not scale with file length)"
        )

    seen_anchors: dict[str, str] = {}
    for i, p in enumerate(prompts):
        loc = f"{path}[p#{i}]"
        if not isinstance(p, dict):
            errors.append(f"{loc}: prompt must be a mapping")
            continue
        pid = p.get("id")
        loc = f"{path}[{pid}]" if pid else loc
        unknown = sorted(set(p) - ALLOWED_PROMPT_KEYS)
        if unknown:
            warnings.append(f"{loc}: unknown key(s) {unknown} (ignored by the renderer)")

        if not pid:
            errors.append(f"{loc}: missing 'id' (it is the reveal-state key, so it must exist)")
        elif pid in seen_ids:
            errors.append(f"{loc}: duplicate prompt id '{pid}' (also in {seen_ids[pid]})")
        else:
            seen_ids[pid] = path
            if not PROMPT_ID_RE.match(str(pid)):
                warnings.append(f"{loc}: id '{pid}' is not '<topic-slug>-pNNN'")

        kind = p.get("kind")
        if kind not in ALLOWED_PROMPT_KINDS:
            errors.append(f"{loc}: kind {kind!r} not in {sorted(ALLOWED_PROMPT_KINDS)}")
        tier = p.get("tier")
        if tier not in ALLOWED_PROMPT_TIERS:
            errors.append(f"{loc}: tier {tier!r} not in {sorted(ALLOWED_PROMPT_TIERS)}")

        body = p.get("prompt")
        if not str(body or "").strip():
            errors.append(f"{loc}: 'prompt' is missing or blank")
        else:
            n = count_words(body)
            if n > PROMPT_WORD_CAP:
                warnings.append(f"{loc}: prompt is {n} words (cap {PROMPT_WORD_CAP})")

        # A tier-C hunt is unbounded without its success criterion, and a tier-D prompt
        # with no answer_shape is the abandonment failure. Both are hard.
        if tier == "C" and not str(p.get("success_criterion") or "").strip():
            errors.append(f"{loc}: tier C needs a 'success_criterion' (it bounds the hunt)")
        if tier == "D" and not str(p.get("answer_shape") or "").strip():
            errors.append(f"{loc}: tier D needs an 'answer_shape' (the dimensions to price)")
        if tier == "C" and not str(p.get("search_hint") or "").strip():
            warnings.append(f"{loc}: tier C has no 'search_hint' (the reader has no entry point)")

        ref = p.get("ref")
        if ref is None:
            errors.append(f"{loc}: missing 'ref' (a prompt is placed after one section)")
        else:
            m = REF_RE.match(str(ref).strip())
            if not m:
                errors.append(
                    f"{loc}: ref '{ref}' must be 'concepts.md#<anchor>' "
                    f"(a prompt sits after a section of its OWN topic)"
                )
            else:
                err, _form = resolve_pointer(ref, topic_dir, root)
                if err:
                    errors.append(f"{loc}: ref {err}")
                anchor = m.group(1)
                if anchor in seen_anchors:
                    errors.append(
                        f"{loc}: second prompt on anchor '#{anchor}' "
                        f"(already used by '{seen_anchors[anchor]}') — max 1 per anchor"
                    )
                else:
                    seen_anchors[anchor] = str(pid)

        answer_in = p.get("answer_in")
        if answer_in is None:
            if tier in ("A", "B"):
                errors.append(
                    f"{loc}: tier {tier} needs an 'answer_in' pointer "
                    f"(the reveal is a deep link, and there is nothing to link)"
                )
        else:
            err, form = resolve_pointer(answer_in, topic_dir, root)
            if err:
                errors.append(f"{loc}: answer_in {err}")
            elif (
                (tier == "A" and form != "in-file")
                or (tier == "B" and form != "cross-topic")
                or (tier == "C" and form != "external")
            ):
                warnings.append(
                    f"{loc}: tier {tier} with a {form} answer_in "
                    f"(A=in-file, B=another topic, C=external)"
                )
            elif tier == "D":
                warnings.append(
                    f"{loc}: tier D carries an answer_in — an open prompt has no answer"
                )

    errors.extend(check_cliffhanger(path, data.get("cliffhanger"), topic_dir, root, warnings))
    return errors, warnings


def check_cliffhanger(
    path: Path, cliff: object, topic_dir: Path, root: Path, warnings: list[str]
) -> list[str]:
    """Validate the `cliffhanger:` block. Returns errors; appends its warnings in place."""
    errors: list[str] = []
    if cliff is None:
        warnings.append(f"{path}: no 'cliffhanger' block (the topic leaves no open loop)")
        return errors
    if not isinstance(cliff, dict):
        return [f"{path}: 'cliffhanger' must be a mapping"]

    hook = str(cliff.get("hook") or "").strip()
    if not hook:
        errors.append(f"{path}: cliffhanger.hook is missing or blank")
    else:
        prose = cliffhanger_prose(hook)
        words = count_words(prose)
        if not (CLIFFHANGER_MIN_WORDS <= words <= CLIFFHANGER_MAX_WORDS):
            warnings.append(
                f"{path}: cliffhanger.hook is {words} prose words "
                f"(want {CLIFFHANGER_MIN_WORDS}-{CLIFFHANGER_MAX_WORDS}; artifact excluded)"
            )
        longest = max((count_words(s) for s in split_sentences(prose)), default=0)
        if longest > CLIFFHANGER_MAX_SENTENCE_WORDS:
            warnings.append(
                f"{path}: cliffhanger.hook's longest prose sentence is {longest} words "
                f"(cap {CLIFFHANGER_MAX_SENTENCE_WORDS})"
            )
        dashes = hook.count("—")
        if dashes > CLIFFHANGER_MAX_EM_DASHES:
            warnings.append(f"{path}: cliffhanger.hook has {dashes} em-dashes (cap 1)")
        if "!" in prose:
            warnings.append(f"{path}: cliffhanger.hook has an exclamation mark")
        low = hook.lower()
        hits = [s for s in CLIFFHANGER_BANNED if s in low]
        if hits:
            warnings.append(f"{path}: cliffhanger.hook uses trailer language {hits}")

    teasers = cliff.get("teaser_questions")
    if teasers is None:
        warnings.append(f"{path}: cliffhanger has no 'teaser_questions'")
    elif not isinstance(teasers, list) or not all(
        isinstance(t, str) and t.strip() for t in teasers
    ):
        errors.append(f"{path}: cliffhanger.teaser_questions must be a list of non-empty strings")
    elif len(teasers) > MAX_TEASER_QUESTIONS:
        warnings.append(
            f"{path}: {len(teasers)} teaser_questions (max {MAX_TEASER_QUESTIONS})"
        )

    payoff = cliff.get("payoff")
    if not isinstance(payoff, dict) or not str(payoff.get("anchor") or "").strip():
        errors.append(f"{path}: cliffhanger.payoff needs an 'anchor' that resolves")
        return errors
    if not str(payoff.get("claim") or "").strip():
        warnings.append(
            f"{path}: cliffhanger.payoff has no 'claim' — record what you read at the anchor"
        )
    anchor = str(payoff["anchor"]).strip()
    errors.extend(check_payoff_anchor(path, anchor, topic_dir, root, warnings))
    return errors


def check_payoff_anchor(
    path: Path, anchor: str, topic_dir: Path, root: Path, warnings: list[str]
) -> list[str]:
    """The payoff must land in the topic that reading order says comes NEXT (rule K7).

    Two spellings: "concepts.md#a" is relative to the next topic (never to this one), and
    "<domain>/<slug>#a" names its destination outright — which is what a domain-final
    cliffhanger has to use, since it has no next topic.

    Mid-wave README insertions must not hard-fail two untouched files: commit 62afa14
    dropped 7 topics into the middle of a 94-topic domain. So a payoff that still resolves
    somewhere real but is no longer `next` is a WARNING naming the README, never an error.
    """
    domain_dir = topic_dir.parent
    nxt = next_topic(domain_dir, topic_dir.name)
    m = REF_RE.match(anchor)
    if m:
        if nxt is None:
            return [
                f"{path}: cliffhanger.payoff.anchor is relative ('{anchor}') but "
                f"'{domain_dir.name}/{topic_dir.name}' is the LAST topic in reading order — a "
                f"finale must name its destination as '<domain>/<slug>#anchor'"
            ]
        slug = m.group(1)
        dest = domain_dir / nxt / "concepts.md"
        anchors = anchors_of(dest)
        if anchors is None:
            return [f"{path}: next topic '{domain_dir.name}/{nxt}' has no concepts.md"]
        if slug in anchors:
            return []
        # Not in `next` — is it a real anchor of some other topic in this domain?
        elsewhere = [
            s for s in reading_order(domain_dir)
            if s != topic_dir.name
            and slug in (anchors_of(domain_dir / s / "concepts.md") or set())
        ]
        if elsewhere:
            warnings.append(
                f"{path}: cliffhanger.payoff.anchor '#{slug}' does not exist in the next topic "
                f"'{nxt}', but it does exist in {elsewhere[:3]} — topics/{domain_dir.name}/"
                f"README.md was probably reordered under this topic. Re-point the payoff (or fix "
                f"the README row order); this is not failing the build."
            )
            return []
        return [
            f"{path}: cliffhanger.payoff.anchor '#{slug}' not found in the next topic "
            f"'{domain_dir.name}/{nxt}' (nor anywhere else in the domain) — one broken payoff "
            f"teaches readers to skip every other one"
        ]

    err, form = resolve_pointer(anchor, topic_dir, root)
    if err:
        return [f"{path}: cliffhanger.payoff.anchor {err}"]
    if form != "cross-topic":
        return [
            f"{path}: cliffhanger.payoff.anchor must be 'concepts.md#anchor' (the next topic) "
            f"or '<domain>/<slug>#anchor', not {anchor!r}"
        ]
    cm = CROSS_TOPIC_RE.match(anchor)
    assert cm is not None  # resolve_pointer already matched it
    named = f"{cm.group(1)}/{cm.group(2)}"
    if nxt is not None and named != f"{domain_dir.name}/{nxt}":
        warnings.append(
            f"{path}: cliffhanger.payoff names '{named}' but reading order says the next topic "
            f"is '{domain_dir.name}/{nxt}' (source: topics/{domain_dir.name}/README.md row "
            f"order). Intentional pivot, or a stale row?"
        )
    return []


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

    # prompts.yaml is OPTIONAL and always will be: the clarity rollout runs one domain at
    # a time, so a topic with no sidecar is valid forever. Prompt ids live in their own
    # per-domain namespace (they are "<slug>-pNNN", question ids are "<slug>-NNN").
    prompt_files = sorted(root.rglob(PROMPTS_FILENAME))
    per_domain_prompt_ids: dict[str, dict[str, Path]] = {}
    total_prompts = 0
    for f in prompt_files:
        seen = per_domain_prompt_ids.setdefault(domain_of(f), {})
        before = len(seen)
        errors, warnings = validate_prompts(f, root, seen)
        all_errors.extend(errors)
        all_warnings.extend(warnings)
        total_prompts += len(seen) - before

    # Warnings name every check that could NOT run, plus every prompts.yaml budget that a
    # file exceeded without breaking a link (see validate_prompts' gate model). A validator
    # that skips silently is worse than one that fails, so these print even on success —
    # and none of them changes the exit code.
    if all_warnings:
        print(f"⚠️  {len(all_warnings)} warning(s) — none of these fails the build:\n")
        for w in all_warnings:
            print(f"  - {w}")
        print()

    if all_errors:
        print(f"❌ {len(all_errors)} problem(s) found:\n")
        for e in all_errors:
            print(f"  - {e}")
        return 1

    sidecars = (
        f", {len(prompt_files)} prompts.yaml sidecar(s), {total_prompts} prompt(s)"
        if prompt_files
        else " (no prompts.yaml sidecars yet — optional)"
    )
    print(f"✅ Validated {len(files)} file(s), {total_q} question(s){sidecars}. All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
