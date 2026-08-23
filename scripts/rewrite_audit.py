#!/usr/bin/env python3
"""rewrite_audit.py — diff-level safety harness for the clarity rewrite.

Contract: `.claude/skills/clarity-standard/SKILL.md` ("Fact safety" + the review
checklist). Corpus numbers: `docs/corpus-stats.md`. Ledger: `docs/verified-facts.yaml`.

    The unit of verification is the DIFF, not the file.

Commit `268a063` rewrote 59 files and silently downgraded verified facts while every gate
stayed green: `SCPs per org` went from **10,000** to "order of **~1,000** (verify live)",
and the NLB TCP idle timeout was asserted as "fixed at 350 s / generally not tunable" when
it defaults to 350 s and is configurable 60-6000 s. (SKILL.md tells this story as
"SCPs-per-entity 10 -> 5". Verified against git: the string "5 attached per entity" has
never existed in tracked history, `10 attached per entity` has been correct since the
file was authored in `50f2396`, and `268a063`'s own message claims it FIXED an
SCP-attached-per-entity=10 error. The row it actually broke is SCPs-per-org. Same shape,
same lesson, different row — and the ledger below pins both, plus the RCP row whose
"5 per entity" is the real source of the confusion.) Three later regressions on the
same effort changed **no number, no version and no citation** at all — a de-hedge that
invented a condition ("on some JVMs" -> "on a 32-bit JVM"), a mechanism substituted for
an observable property (`incrementAndGet` "calls `compareAndSet`"), and a deleted
qualifier plus an added absolute (x86 "TSO ... nothing else can"). Nothing mechanical
could see them.

So this script does three separable jobs, with three different levels of authority:

  1. HARD — an information inventory over the diff, plus volume and structure floors.
     A number with a unit, a version, a spec citation, an inline-code identifier or a URL
     that the base file had and the new file does not is a failure. So is a drop in raw
     words beyond 10%, in table rows, in code fences, in mermaid blocks, or in the H2 set.
     These are set-based and file-scoped: a fact may MOVE anywhere in the file, appear
     fewer times, or change its markup, and nothing fires. Only disappearance does.
     Fence and table CONTENT is deliberately not hashed into the hard gate — a rewritten
     code sample and the mandated ASCII->mermaid conversion (S4) both change it
     legitimately, so content changes are REPORT rows and the identifier inventory plus
     the count floors carry the gate.
  2. HARD — the verified-facts ledger. Every entry in `docs/verified-facts.yaml` names a
     fact, its file, its source URL and the date it was verified, and carries a
     `require:` string that must still appear and/or `forbid:` patterns that must not.
     This is what makes a known regression structurally impossible rather than merely
     findable, in BOTH directions: `require` catches a deletion, `forbid` catches the
     re-introduction of a specific wrong claim (which is what three of the four real
     regressions were — additions, not removals).
  3. REPORT — a claim-diff table built by sentence ALIGNMENT, not by grep. Every new or
     modified sentence is classified, and every MODIFIED sentence whose approximate
     subject-verb-object shape differs from its original is emitted whether or not it
     carries a marker word. The marker grep (`so|because|which means|therefore|cannot|
     always|never|only`) runs last, as a NET over rows the alignment did not already
     produce — SKILL.md is explicit that it is a net and not a gate, because the real
     run's highest-severity finding carried no marker word.
     Two sub-classes ARE hard, because they are the mechanical signature of `268a063`:
     ADDED_NUMBER_UNCITED and NUMBER_CHANGED_UNCITED.

HOW BIG IS THE MANDATORY WEB-VERIFICATION PHASE (--emit-factlines)
Measured on this corpus, not estimated. Taking every line of all 460 files as "touched"
(`--factlines-scope all`), the unfiltered net is 22,109 lines, median 37 per file — that
is a second corpus, not a phase, and an earlier 34k-38k guess was the same order. So the
default is narrowed twice:
  * `--factlines-scope changed` (default) keeps only lines inside the diff's hunks;
  * `--factlines-tier high` (default) keeps only lines a PRIMARY SOURCE can settle — a
    spec citation, a URL, a version pin, a number next to a limit/quota/default/price/
    "since" word, or a number this diff introduced. It drops worked-example arithmetic,
    which SKILL.md step 6 says to RE-DERIVE locally rather than look up.
Corpus-wide that is 7,750 lines (median 10/file, p90 43) at tier=high, and on a real
prose pass the per-topic figure is what matters: replaying `268a063` gives a median of 5
high-tier lines per file (636 -> 427 total across 59 files), and the much number-heavier
Wave 1 worked-examples pass gives a median of 18 (2,677 -> 2,277 across 123 files).
Extrapolated over 460 topics the wave owes roughly 2,300-8,300 primary-source checks
depending on how number-dense the rewrites are. Use `--factlines-tier all` when a topic is
vendor-limit-heavy and you want the wider net.

Reading minutes are reported before/after and NEVER gated: the user's decision is "let
files grow" (SKILL.md, "BINDING versus REPORT-ONLY"). Callout counts are reported and
NEVER gated either: the S9 budget forces `[!WARNING]`/`[!INTERVIEW]` counts DOWN on 193
of 460 files, so gating them would fail 42% of the corpus by construction. What SKILL.md
gates instead is the demotion log, which is prose a human writes, not a thing a script
can see.

Prose-style metrics (bold density, hedges, slot labels, sentence length, register swap)
are deliberately NOT here — they belong to the style reporter, and mixing a report-only
style metric into a hard gate is how a hard gate gets disabled.

Usage:
    python3 scripts/rewrite_audit.py                      # working tree vs HEAD
    python3 scripts/rewrite_audit.py --base HEAD~1
    python3 scripts/rewrite_audit.py --base A --new B      # audit a past commit
    python3 scripts/rewrite_audit.py --base origin/main --new HEAD    # what CI should run
    python3 scripts/rewrite_audit.py --domain java-jvm
    python3 scripts/rewrite_audit.py --file topics/d/t/concepts.md
    python3 scripts/rewrite_audit.py --json
    python3 scripts/rewrite_audit.py --show-added --max-rows 200   # the unflagged added rows
    python3 scripts/rewrite_audit.py --emit-factlines      # lines the web pass must check
    python3 scripts/rewrite_audit.py --emit-factlines --factlines-tier all
    python3 scripts/rewrite_audit.py --audit-ledger        # self-check the ledger, no diff

Exit code: 1 if any HARD finding, else 0. `--audit-ledger` exits 1 on a broken ledger.

    HOW TO CLEAR A FINDING (three honest ways, best first)
    1. Restore the information, or cite a primary source in the sentence that added the
       number.
    2. Ledger the fact in docs/verified-facts.yaml with its source URL and the date you
       opened it. A number vouched for by a ledger entry for that file stops counting as
       uncited, and the fact gains a permanent guard instead of a one-off waiver.
    3. Allowlist the loss with a reason in `loss_allowlist:` (`file` + `item`, or
       `file` + `kind`). Reviewed as a diff line, which is the point.
    A ledger `require:` that no longer matches means the fact line was reworded. Re-verify
    it against the source, then update that entry's `require` and `verified` date IN THE
    SAME COMMIT. A ledger edit with no re-verification is the failure this file exists to
    prevent, and it is visible in review precisely because it is a ledger edit.

    HARD kinds:   LOST_NUMBERS / LOST_VERSIONS / LOST_SPECS / LOST_IDENTIFIERS /
                  LOST_URLS, WORDS_DROPPED, COUNT_DROPPED, H2_REMOVED_OR_RENAMED,
                  FILE_DELETED, ADDED_NUMBER_UNCITED, NUMBER_CHANGED_UNCITED,
                  LEDGER_VALUE_MISSING, LEDGER_FORBIDDEN_CLAIM, LEDGER_FILE_MISSING,
                  FILE_NOT_FOUND, LEDGER_SCHEMA.
    REPORT kinds: H2_ADDED, FENCE_MODIFIED, FENCE_REPLACED, NEW_FILE, and the claim-diff
                  row flags ADDED_SENTENCE, REMOVED_SENTENCE, ADDED_NUMBER, DEHEDGED,
                  ABSOLUTE_ADDED, QUANTIFIER_STRENGTHENED, SVO_SHIFT, CAUSAL_MARKER.

    THE ADDED_SENTENCE BLIND SPOT — read this before trusting a green run.
    DEHEDGED, ABSOLUTE_ADDED, QUANTIFIER_STRENGTHENED and SVO_SHIFT are COMPARISON flags:
    `classify()` runs them only when an original sentence exists to compare against. An
    ADDED sentence therefore carries at most CAUSAL_MARKER, and a sentence that is new,
    wrong and marker-free carries nothing at all. Those rows are listed only with
    `--show-added` or `--json`; the default listing prints their count and says so. On the
    hard-case draft (java-jvm/synchronized-volatile-jmm) two of the four known fact
    regressions were exactly this shape. The default `--factlines-tier high` net does not
    reach them either — it selects on numbers, versions, specs and URLs, and none of the
    four regressions changed one. **Mechanical coverage of a NEW fact regression is the
    ledger's `forbid:` patterns plus loop steps 7 and 8, not this claim-diff.**
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable, NamedTuple

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required: pip install pyyaml")

REPO = Path(__file__).resolve().parent.parent
LEDGER = REPO / "docs" / "verified-facts.yaml"

WORDS_PER_MINUTE = 200  # MUST match web/scripts/sync-content.mjs (and corpus_stats.py)
WORD_FLOOR_PCT = 10.0  # raw word count may not drop by more than this
FENCE_TOKEN_KEPT = 0.8  # a vanished fence whose tokens mostly survive is MODIFIED, not LOST
SVO_OBJECT_JACCARD = 0.6  # below this the object bag counts as a different object
PAIR_RATIO = 0.5  # difflib ratio under which a replace pair is ADDED+REMOVED, not MODIFIED

# --------------------------------------------------------------------------------------
# Markdown structure — the same fence/heading/table conventions as corpus_stats.py and
# validate_content.py. Deliberately re-stated rather than imported: those two files are
# owned elsewhere, and a shared mutable tokenizer is how a gate starts disagreeing with
# itself mid-wave.
# --------------------------------------------------------------------------------------
FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")
HEADING_RE = re.compile(r"^(#{1,6})(?:[ \t]+(.*))?$")
TABLE_RE = re.compile(r"^\s*\|")
TABLE_SEP_RE = re.compile(r"^\s*\|[\s:|-]*\|\s*$")
BREAK_RE = re.compile(r"^\s*([-*_])\1{2,}\s*$")
LIST_RE = re.compile(r"^\s*([-*+]|\d+[.)])[ \t]+")
QUOTE_RE = re.compile(r"^\s*>\s?")
CALLOUT_TYPES = ("TIP", "WARNING", "INTERVIEW", "KEY-TAKEAWAY")
CALLOUT_RE = re.compile(r"\[!(" + "|".join(map(re.escape, CALLOUT_TYPES)) + r")\]")
CODE_SPAN_RE = re.compile(r"`([^`\n]+)`")
EMPHASIS_RE = re.compile(r"\*\*|__|~~|(?<!\w)[*_](?!\s)|(?<!\s)[*_](?!\w)")
LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)]*)\)")

# --------------------------------------------------------------------------------------
# Fact shapes. Every one of these is an inventory class, and every one is also what makes
# a line "fact-shaped" for --emit-factlines.
# --------------------------------------------------------------------------------------
UNIT_ALIASES = {
    "s": "s", "sec": "s", "secs": "s", "second": "s", "seconds": "s",
    "ms": "ms", "us": "us", "µs": "us", "ns": "ns",
    "min": "min", "mins": "min", "minute": "min", "minutes": "min",
    "h": "h", "hr": "h", "hrs": "h", "hour": "h", "hours": "h",
    "d": "d", "day": "d", "days": "d", "week": "wk", "weeks": "wk",
    "month": "mo", "months": "mo", "year": "yr", "years": "yr",
    "b": "B", "byte": "B", "bytes": "B", "kb": "KB", "kib": "KiB", "mb": "MB",
    "mib": "MiB", "gb": "GB", "gib": "GiB", "tb": "TB", "tib": "TiB",
    "bit": "bit", "bits": "bit", "bps": "bps", "kbps": "Kbps", "mbps": "Mbps",
    "gbps": "Gbps", "%": "%", "x": "x", "×": "x",
    "char": "char", "chars": "char", "character": "char", "characters": "char",
    "rps": "rps", "qps": "qps", "tps": "tps", "iops": "iops",
    "core": "core", "cores": "core", "vcpu": "vCPU", "vcpus": "vCPU",
    "thread": "thread", "threads": "thread", "node": "node", "nodes": "node",
    "replica": "replica", "replicas": "replica", "shard": "shard", "shards": "shard",
    "partition": "partition", "partitions": "partition",
    "connection": "conn", "connections": "conn", "level": "level", "levels": "level",
    "khz": "kHz", "mhz": "MHz", "ghz": "GHz",
}
_UNIT_ALT = "|".join(sorted((re.escape(u) for u in UNIT_ALIASES), key=len, reverse=True))
_NUM = r"\d[\d,_]*(?:\.\d+)?"
NUM_UNIT_RE = re.compile(rf"(?<![\w.])({_NUM})[ \t -]*({_UNIT_ALT})(?![\w])", re.I)
NUM_RANGE_RE = re.compile(
    rf"(?<![\w.])({_NUM})\s*[-–—]\s*({_NUM})[ \t -]*({_UNIT_ALT})(?![\w])", re.I
)
MONEY_RE = re.compile(rf"\$\s?({_NUM})")
# A "spec-shaped" bare number: >= 3 significant digits, a thousands comma, or a decimal.
# Two-digit counts ("3 retries", "5 levels") are prose; 350, 10,000 and 0.1 are data.
BARE_NUM_RE = re.compile(rf"(?<![\w.$])({_NUM})(?![\w])")
# A bare `1.5` is a decimal, not a version: it is already covered by the numbers class,
# and treating it as a version reported the same loss twice ('99.99' as a "version").
# A version needs a prefix (v1.5, JDK 21, HTTP/2) or three components (1.2.3).
VERSION_RE = re.compile(
    r"\b(?:v|version\s+)\d+\.\d+(?:\.\d+)*(?:-[A-Za-z0-9.]+)?\b"
    r"|\b\d+\.\d+\.\d+(?:\.\d+)*(?:-[A-Za-z0-9.]+)?\b"
    r"|\b(?:JDK|Java|JVM|Python|Node|Go|Rust|Spring(?:\s+Boot)?|Kubernetes|k8s|"
    r"Postgres(?:QL)?|MySQL|Redis|Kafka|HTTP|TLS|SSL|gRPC|OTel|OpenTelemetry)"
    r"[ /]\d+(?:\.\d+)*\b"
)
SPEC_RE = re.compile(
    r"\b(?:RFC|JEP|JSR|JLS|CWE|CVE|SP\s?800|PEP|ISO|IEEE|NIST\s+SP\s?800)"
    r"[\s ]*[-–§#]?[\s ]*\d[\d.\-]*\b",
    re.I,
)
URL_RE = re.compile(r"https?://[^\s)>\]\"'`,]+")
# Words that make an otherwise plain sentence a vendor/spec assertion worth a web check.
# NOTE on what is deliberately absent: bare `min` (in this corpus it is "20 min", the
# unit, far more often than "minimum"), and `cap`/`caps`/`capped` (used metaphorically —
# "caps the damage to one change"). Both produced most of the measured false positives on
# the historical worked-example passes. `max` stays: "max is 12h" is a real vendor claim.
LIMIT_WORDS_RE = re.compile(
    r"\b(?:limit|limits|quota|quotas|default|defaults|maximum|max|minimum|ceiling|"
    r"throttl\w*|price|prices|pricing|cost per|per month|SLA|SLO|free tier|hard limit|"
    r"soft limit|adjustable|configurable|tunable|not tunable|since|as of|deprecated|"
    r"removed in|added in|introduced in|per account|per table|per region|per entity)\b",
    re.I,
)

# --------------------------------------------------------------------------------------
# Claim-shape lexicons. These drive REPORT classes only.
# --------------------------------------------------------------------------------------
MARKER_RE = re.compile(
    r"\b(?:so|because|which means|therefore|cannot|can't|always|never|only)\b", re.I
)
HEDGES = {
    "almost", "apparently", "arguably", "fairly", "generally", "largely", "likely",
    "mostly", "nearly", "often", "perhaps", "possibly", "presumably", "probably",
    "relatively", "roughly", "seemingly", "significantly", "some", "somewhat",
    "sometimes", "substantially", "typically", "usually", "may", "might", "could",
    "can", "approximately", "about", "around", "circa", "tends", "tend",
}
ABSOLUTES = {
    "always", "never", "all", "every", "none", "nothing", "no", "only", "must",
    "cannot", "impossible", "guaranteed", "guarantees", "any", "identical", "exactly",
    "invariably", "unconditionally", "does", "will",
}
STOPWORDS = {
    "a", "an", "the", "of", "to", "in", "on", "at", "by", "for", "with", "and", "or",
    "but", "if", "then", "than", "that", "this", "these", "those", "it", "its", "as",
    "from", "into", "over", "under", "up", "down", "out", "off", "so", "not", "no",
    "you", "your", "we", "our", "they", "their", "he", "she", "his", "her", "there",
    "here", "which", "who", "whom", "whose", "what", "when", "where", "why", "how",
    "be", "been", "being", "am", "one", "also", "just", "still", "already", "very",
}
# Finite verb forms this corpus actually uses. A closed lexicon is the honest option: see
# the `svo_shape` docstring for exactly what this approximation cannot do.
VERBS = {
    "is", "are", "was", "were", "isn't", "aren't", "has", "have", "had", "does", "do",
    "did", "can", "cannot", "can't", "could", "may", "might", "will", "won't", "would",
    "shall", "should", "must", "gives", "give", "gets", "get", "makes", "make", "lets",
    "let", "allows", "allow", "uses", "use", "calls", "call", "returns", "return",
    "requires", "require", "needs", "need", "holds", "hold", "keeps", "keep", "sends",
    "send", "reads", "read", "writes", "write", "sets", "set", "runs", "run", "blocks",
    "block", "fails", "fail", "breaks", "break", "happens", "happen", "means", "mean",
    "becomes", "become", "depends", "depend", "permits", "permit", "forbids", "forbid",
    "guarantees", "guarantee", "ensures", "ensure", "prevents", "prevent", "adds", "add",
    "removes", "remove", "splits", "split", "delays", "delay", "costs", "cost", "sits",
    "sit", "stays", "stay", "moves", "move", "arrives", "arrive", "exposes", "expose",
    "reorders", "reorder", "emits", "emit", "throws", "throw", "creates", "create",
    "starts", "start", "stops", "stop", "waits", "wait", "serves", "serve", "scales",
    "scale", "applies", "apply", "carries", "carry", "points", "point", "shows", "show",
    "takes", "take", "pays", "pay", "buys", "buy", "wins", "win", "loses", "lose",
}
QUANTIFIER_PAIRS = [  # (weak, strong) — a weak -> strong swap is a claim strengthening
    ({"some", "many", "most", "several", "a few"}, {"all", "every", "each", "any"}),
    ({"may", "might", "could", "can"}, {"does", "will", "must", "always"}),
    ({"usually", "typically", "often", "generally", "mostly"}, {"always", "invariably"}),
    ({"rarely", "seldom", "unlikely"}, {"never"}),
]

ABBREV = {
    "e.g.", "i.e.", "etc.", "vs.", "cf.", "approx.", "al.", "fig.", "no.", "inc.",
    "dr.", "mr.", "ms.", "mrs.", "st.", "jr.", "sr.", "ca.", "resp.", "ex.",
    "incl.", "min.", "max.", "sec.", "req.", "esp.", "ref.",
}
SENT_END_RE = re.compile(r"[.!?][\"'”’)\]]*$")


# ======================================================================================
# git
# ======================================================================================
def git(*args: str) -> str:
    """Run a git command in the repo and return stdout ('' on failure)."""
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO), *args],
            capture_output=True, text=True, check=False,
        )
    except OSError as exc:  # git missing: say so rather than reporting "no changes"
        sys.exit(f"cannot run git: {exc}")
    return out.stdout if out.returncode == 0 else ""


def git_show(ref: str, rel: str) -> str | None:
    """File contents at a ref, or None when the path does not exist there."""
    out = subprocess.run(
        ["git", "-C", str(REPO), "show", f"{ref}:{rel}"],
        capture_output=True, text=True, check=False,
    )
    return out.stdout if out.returncode == 0 else None


def rev_parse(ref: str) -> str:
    sha = git("rev-parse", "--short", ref).strip()
    if not sha:
        sys.exit(f"unknown git ref: {ref!r}")
    return sha


def read_new(rel: str, new_ref: str | None) -> str | None:
    """The 'after' side: a git ref when --new is given, else the working tree."""
    if new_ref:
        return git_show(new_ref, rel)
    path = REPO / rel
    return path.read_text(encoding="utf-8") if path.exists() else None


def changed_concepts(base: str, new_ref: str | None) -> list[str]:
    """Every topics/*/*/concepts.md that differs between base and the 'after' side."""
    args = ["diff", "--name-only", base]
    if new_ref:
        args.append(new_ref)
    args += ["--", "topics/*/*/concepts.md"]
    names = [ln.strip() for ln in git(*args).splitlines() if ln.strip()]
    if not new_ref:  # untracked new topics never show up in `git diff`
        untracked = git("ls-files", "--others", "--exclude-standard", "--",
                        "topics/*/*/concepts.md").splitlines()
        names += [ln.strip() for ln in untracked if ln.strip()]
    return sorted(set(names))


# ======================================================================================
# The text model
#
# Fence-aware, and the same "what counts as prose" rules as corpus_stats.py: prose is
# every non-fence line except headings, table rows, thematic breaks and whole-line HTML
# comments, with blockquote/list/callout markers stripped. Tables and fences are still
# scanned for FACTS (a limit in a table row is a fact); they are just not prose WORDS.
# ======================================================================================
class Fence(NamedTuple):
    info: str
    start: int
    body: str

    @property
    def digest(self) -> str:
        return hashlib.sha1(norm_fence(self.body).encode("utf-8")).hexdigest()[:12]

    @property
    def is_mermaid(self) -> bool:
        return self.info.strip().lower().startswith("mermaid")


class Sentence(NamedTuple):
    text: str  # markdown-normalised, whitespace-collapsed
    line: int  # 1-based line of the segment the sentence starts in
    heading: str  # nearest heading text, for grouping the claim-diff table


def norm_fence(body: str) -> str:
    """Fence body for hashing: trailing whitespace and blank-line runs are not content."""
    lines = [ln.rstrip() for ln in body.splitlines()]
    return "\n".join(ln for ln in lines if ln != "")


def strip_markdown(text: str) -> str:
    """Inline markdown removed, backticked code kept verbatim, whitespace collapsed.

    Emphasis is removed rather than replaced so that `**350 s**` and `350 s` compare
    equal; a `_` inside an identifier (`MAX_VALUE`) survives.
    """
    text = LINK_RE.sub(r"\1", text)
    text = EMPHASIS_RE.sub("", text)
    text = text.replace("`", "")
    text = text.replace(" ", " ").replace("‑", "-")
    for dash in ("–", "—"):
        text = text.replace(dash, "-")
    return re.sub(r"\s+", " ", text).strip()


def js_round(x: float) -> int:
    """JS Math.round: half UP, not Python's banker's rounding."""
    return int(x + 0.5) if x >= 0 else -int(-x + 0.5)


def scan(text: str) -> dict:
    """Everything both sides of the diff need, in one fence-aware pass."""
    lines = text.splitlines()
    fences: list[Fence] = []
    headings: list[tuple[int, str, int]] = []
    callouts: dict[str, int] = {t: 0 for t in CALLOUT_TYPES}
    table_rows = 0
    prose_words = 0
    fact_lines: list[tuple[int, str]] = []  # (lineno, normalised text) incl. tables
    segments: list[tuple[int, list[str]]] = []
    row_sentences: list[Sentence] = []
    fence_char, fence_len, fence_info, fence_body, fence_start = "", 0, "", [], 0
    cur_heading = ""
    prev_quote = False
    seg: list[str] | None = None
    seg_line = 0

    def close_segment() -> None:
        nonlocal seg, seg_line
        if seg:
            segments.append((seg_line, seg))
        seg, seg_line = None, 0

    for lineno, raw in enumerate(lines, 1):
        fence = FENCE_RE.match(raw)
        if fence:
            marker, info = fence.group(1), fence.group(2)
            if not fence_char:
                fence_char, fence_len, fence_info = marker[0], len(marker), info
                fence_body, fence_start = [], lineno
                close_segment()
                continue
            if marker[0] == fence_char and len(marker) >= fence_len and not info.strip():
                fences.append(Fence(fence_info, fence_start, "\n".join(fence_body)))
                fence_char, fence_len, fence_info, fence_body = "", 0, "", []
                continue
        if fence_char:
            fence_body.append(raw)
            continue

        heading = HEADING_RE.match(raw)
        if heading:
            cur_heading = (heading.group(2) or "").strip()
            headings.append((len(heading.group(1)), cur_heading, lineno))
            close_segment()
            prev_quote = False
            continue
        if TABLE_RE.match(raw):
            close_segment()
            if not TABLE_SEP_RE.match(raw):
                table_rows += 1
                row = strip_markdown(raw)
                fact_lines.append((lineno, row))
                # A table row IS a claim, and in this corpus it is usually where the
                # vendor limits live: the 268a063 SCP regression happened inside one. So
                # rows enter the sentence stream — one row, one sentence, never split on
                # its internal full stops — even though they are excluded from prose WORD
                # counts, as in corpus_stats.py.
                row_sentences.append(Sentence(row, lineno, cur_heading))
            continue
        if BREAK_RE.match(raw) or re.match(r"^\s*<!--.*-->\s*$", raw):
            close_segment()
            continue
        if not raw.strip():
            close_segment()
            prev_quote = False
            continue

        is_quote = bool(QUOTE_RE.match(raw))
        body = QUOTE_RE.sub("", raw) if is_quote else raw
        for m in CALLOUT_RE.finditer(raw):
            callouts[m.group(1)] += 1
        body = CALLOUT_RE.sub("", body)
        body = LIST_RE.sub("", body)
        norm = strip_markdown(body)
        if norm:
            fact_lines.append((lineno, norm))
            prose_words += sum(1 for w in norm.split() if re.search(r"[A-Za-z0-9]", w))
        # A new segment starts at a list item or at the FIRST line of a blockquote, and
        # after any of the closers above; continuation lines join with one space.
        # corpus_stats.py starts a segment at every blockquote line, which is right for
        # its sentence-length metrics and wrong here: it would chop each callout into
        # line-length fragments and destroy the alignment inside exactly the blocks that
        # carry the warnings.
        if seg is None or LIST_RE.match(raw) or (is_quote and not prev_quote):
            close_segment()
            seg, seg_line = [], lineno
        if norm:
            seg.append((norm, cur_heading))  # type: ignore[arg-type]
        prev_quote = is_quote
    close_segment()
    if fence_char:  # unterminated fence: keep what we have rather than dropping it
        fences.append(Fence(fence_info, fence_start, "\n".join(fence_body)))

    # Code fences are still scanned for facts: a version pin in a YAML sample is a fact.
    for f in fences:
        for i, ln in enumerate(f.body.splitlines()):
            if ln.strip():
                fact_lines.append((f.start + 1 + i, ln.strip()))

    body_for_minutes = re.sub(r"^#\s+.*\n?", "", text, count=1)
    raw_words = [w for w in body_for_minutes.strip().split() if w]

    return {
        "lines": lines,
        "fences": fences,
        "headings": headings,
        "callouts": callouts,
        "table_rows": table_rows,
        "prose_words": prose_words,
        "raw_words": len(raw_words),
        "reading_minutes": max(1, js_round(len(raw_words) / WORDS_PER_MINUTE)),
        "fact_lines": sorted(fact_lines),
        "sentences": sorted(split_segments(segments) + row_sentences,
                            key=lambda s: (s.line, s.text)),
        "normalised": "\n".join(t for _, t in sorted(fact_lines)),
    }


def split_segments(segments: list[tuple[int, list]]) -> list[Sentence]:
    """Segments -> sentences. A segment always ends a sentence, so an unterminated
    bullet counts as one (the corpus tokenizer's rule, and the reason a converted list
    raises sentence counts without anything having got worse)."""
    out: list[Sentence] = []
    for start, items in segments:
        text = " ".join(t for t, _ in items)
        heading = items[0][1] if items else ""
        cur: list[str] = []
        for word in text.split():
            cur.append(word)
            low = word.lower()
            if SENT_END_RE.search(word) and low not in ABBREV and not re.fullmatch(
                r"[A-Za-z]\.", word
            ):
                out.append(Sentence(" ".join(cur), start, heading))
                cur = []
        if cur:
            out.append(Sentence(" ".join(cur), start, heading))
    return [s for s in out if len(s.text.split()) >= 2]


# ======================================================================================
# The information inventory
#
# Set-based and file-scoped ON PURPOSE. A rewrite is allowed to move a fact into another
# section, state it once instead of three times, or drop its bold. What it may not do is
# lose it. That is the difference between a gate a wave can live with and one it disables
# in week one.
# ======================================================================================
INVENTORY_CLASSES = ("numbers", "versions", "specs", "identifiers", "urls")


def norm_unit(unit: str) -> str:
    return UNIT_ALIASES.get(unit.lower(), unit.lower())


def norm_num(num: str) -> str:
    n = num.replace(",", "").replace("_", "")
    if "." in n:
        n = n.rstrip("0").rstrip(".") or "0"
    return n


def is_spec_shaped_number(num: str) -> bool:
    """A number that reads as data rather than as prose counting.

    'three retries' and '5 levels' are prose; 350, 10,000, 10,240 and 0.1 are data. The
    rule: a thousands separator, a decimal point, or >= 3 digits.
    """
    plain = num.replace(",", "").replace("_", "")
    return "," in num or "." in plain or len(plain.split(".")[0]) >= 3


def number_matches(text: str) -> list[tuple[str, str, str]]:
    """Every meaningful number as (inventory item, numeric part, normalised unit).

    Unit is "" for a spec-shaped bare number and "$" for currency.
    """
    out: list[tuple[str, str, str]] = []
    for m in NUM_RANGE_RE.finditer(text):
        unit = norm_unit(m.group(3))
        for g in (1, 2):
            out.append((f"{norm_num(m.group(g))}{unit}", norm_num(m.group(g)), unit))
    for m in NUM_UNIT_RE.finditer(text):
        unit = norm_unit(m.group(2))
        out.append((f"{norm_num(m.group(1))}{unit}", norm_num(m.group(1)), unit))
    for m in MONEY_RE.finditer(text):
        out.append((f"${norm_num(m.group(1))}", norm_num(m.group(1)), "$"))
    for m in BARE_NUM_RE.finditer(text):
        if is_spec_shaped_number(m.group(1)):
            out.append((norm_num(m.group(1)), norm_num(m.group(1)), ""))
    return out


def extract_numbers(text: str) -> set[str]:
    """Numbers that carry meaning: with a unit, with currency, or spec-shaped bare."""
    return {item for item, _, _ in number_matches(text)}


# Units whose numbers are always data rather than rhetoric. A byte size, a rate, a
# percentage or a price is a fact even at one digit; "a 30-second recap" is not.
DATA_UNITS = {
    "B", "KB", "KiB", "MB", "MiB", "GB", "GiB", "TB", "TiB", "bit", "bps", "Kbps",
    "Mbps", "Gbps", "%", "x", "rps", "qps", "tps", "iops", "$", "kHz", "MHz", "GHz",
    "ms", "us", "ns",
}


# An arithmetic derivation: a worked example, a trace, or a table row doing sums. SKILL.md
# step 6 says to RE-DERIVE these locally, not to cite them — you cannot cite a primary
# source for "500 x 0.2 s = 100 concurrent executions". They are REPORT rows and factlines.
ARITH_RE = re.compile(r"[=≈×÷]|→|->|\s[x*/+]\s|\bper\s+\d|\btotal\b|\bsum\b")


def hard_numbers(sentence: str) -> set[str]:
    """The numbers in one sentence that a HARD added/changed-number gate may fire on.

    Two conditions, and BOTH must hold:

      * the sentence carries a limit / quota / default / maximum / price / SLA /
        "since" / "as of" / version word — i.e. it asserts something a vendor or a spec
        owns, which is the only kind of number a primary source can settle; AND
      * the sentence is not an arithmetic derivation (no `=`, `x`, `/`, `->`, `per <n>`).

    Why this is narrower than "every new number": measured over the four real prose
    passes in this repo's history, the unrestricted rule fires 1,599 times across 123
    files on the Wave 1 worked-examples pass (13 per file) and almost every hit is a
    worked example's own arithmetic — "500 x 0.2 s = 100 concurrent executions",
    "99% SLO -> 1% x 43,200 = 432 min". C4 REQUIRES those numbers (a concrete instance
    inside 60 words), and SKILL.md step 6 asks for them to be RE-DERIVED rather than
    cited, so demanding a citation is both unsatisfiable and contrary to the standard.
    A hard gate at 13 hits per file is a hard gate that gets deleted in week one.

    Both `268a063` signatures survive the narrowing: "max 10 attached per entity" wins on
    the limit word `max`, and "idle timeout ... fixed at 350 s" on `idle timeout`'s
    `default`/`fixed` neighbourhood. Everything dropped here still appears as the
    REPORT flag ADDED_NUMBER and in `--emit-factlines`, which is the queue the web pass
    actually works from.
    """
    if not LIMIT_WORDS_RE.search(sentence) or ARITH_RE.search(sentence):
        return set()
    return {item for item, _, _ in number_matches(sentence)}


def domain_slugs() -> set[str]:
    """The 20 domain directory names, cached — used to recognise a cross-reference."""
    global _DOMAINS
    if _DOMAINS is None:
        root = REPO / "topics"
        _DOMAINS = {p.name for p in root.iterdir() if p.is_dir()} if root.is_dir() else set()
    return _DOMAINS


def long_topic_slugs() -> set[str]:
    """Topic directory names with 3+ words, cached.

    The 3-word floor is deliberate: `aws-api-layer-apigateway-appsync` is only ever a
    cross-reference, while a two-word slug can also be a real name a reader searches for
    (`docker-compose` is both a topic and a command), so those stay in the inventory.
    """
    global _TOPICS
    if _TOPICS is None:
        _TOPICS = {p.parent.name for p in (REPO / "topics").glob("*/*/concepts.md")
                   if p.parent.name.count("-") >= 2}
    return _TOPICS


_DOMAINS: set[str] | None = None
_TOPICS: set[str] | None = None
XREF_RE = re.compile(r"^([a-z0-9]+(?:-[a-z0-9]+)*)/([a-z0-9]+(?:-[a-z0-9]+)*)$")


def is_cross_reference(span: str) -> bool:
    """`docker/entrypoint-vs-cmd` is an author-facing cross-reference, not an identifier.

    Rule S3 REQUIRES a clarity rewrite to delete cross-reference directories and hold the
    file to <= 2 such references, so counting their removal as information loss would put
    the inventory gate in direct conflict with the standard it serves. Matched only when
    the left side is a real domain directory, so `application/json` and `text/plain`
    remain ordinary identifiers.
    """
    m = XREF_RE.match(span)
    if m and m.group(1) in domain_slugs():
        return True
    return span in long_topic_slugs()


def extract_identifiers(text: str) -> set[str]:
    """Inline-code identifiers.

    A backticked span counts as an identifier when it has NO internal whitespace and
    contains at least one letter: `volatile`, `@Async`, `context.Background()`,
    `http_requests_total{service=~"$service"}`. A span with spaces is a snippet or a
    whole expression (`debit(account, amount)`, `base62(125) = "cb"`), and holding a
    rewrite to the letter of one fires on every legitimate rewording; a purely numeric
    span (`100`) is already covered by the numbers class.
    """
    found: set[str] = set()
    for m in CODE_SPAN_RE.finditer(text):
        span = m.group(1).strip()
        if not span or len(span) > 60 or re.search(r"\s", span):
            continue
        if re.search(r"[A-Za-z]", span) and not is_cross_reference(span):
            found.add(span)
    return found


def inventory(text: str) -> dict[str, set[str]]:
    """The five loss-gated fact classes, over the WHOLE file (tables and fences too)."""
    return {
        "numbers": extract_numbers(text),
        "versions": {re.sub(r"\s+", " ", m.group(0)) for m in VERSION_RE.finditer(text)},
        "specs": {
            re.sub(r"[\s ]+", " ", m.group(0)).upper().replace("§", "").strip()
            for m in SPEC_RE.finditer(text)
        },
        "identifiers": extract_identifiers(text),
        "urls": {m.group(0).rstrip(".,;:") for m in URL_RE.finditer(text)},
    }


# ======================================================================================
# Approximate SVO
# ======================================================================================
def svo_shape(sentence: str) -> tuple[str, str, frozenset[str]]:
    """A deliberately cheap (subject-head, verb, object-bag) approximation.

    How it works: tokenise, find the first token in a closed lexicon of finite verb forms
    (VERBS), take the SUBJECT HEAD to be the rightmost non-stopword token before it
    (English noun phrases are right-headed), and the OBJECT BAG to be the non-stopword
    tokens after it.

    What it CANNOT do, stated plainly because an oversold parser is worse than none:

      * It does not parse. No clause structure, no coordination, no apposition.
      * A passive with a hidden agent ("is dispersed by bees") gives subject "pollen",
        so an active/passive flip reads as a subject change and over-reports.
      * A sentence whose real verb is outside the lexicon gets verb "" and is compared on
        subject head and bag alone, which under-reports verb swaps such as
        "behaves like" -> "delegates to".
      * A pronoun subject ("it", "this") is a stopword, so the head becomes whatever
        content word precedes it — usually nothing. Those rows compare on the bag only.
      * Negation is invisible: "does" vs "does not" is the same shape.

    It exists to POPULATE a review queue, not to decide anything: every use of it in this
    script is REPORT-only, exactly as SKILL.md requires of the marker grep. Its job is to
    make the four real marker-free regressions land in a table a human reads.
    """
    tokens = [t for t in re.findall(r"[A-Za-z0-9_$.()#/-]+", sentence.lower()) if t]
    verb_at = next((i for i, t in enumerate(tokens) if t in VERBS), None)
    if verb_at is None:
        content = [t for t in tokens if t not in STOPWORDS]
        return ("", "", frozenset(content[3:]) or frozenset(content))
    before = [t for t in tokens[:verb_at] if t not in STOPWORDS]
    after = [t for t in tokens[verb_at + 1:] if t not in STOPWORDS]
    return (before[-1] if before else "", tokens[verb_at], frozenset(after))


def jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a and not b:
        return 1.0
    return len(a & b) / max(1, len(a | b))


def svo_differs(old: str, new: str) -> tuple[bool, str]:
    so, vo, oo = svo_shape(old)
    sn, vn, on = svo_shape(new)
    reasons = []
    if so != sn:
        reasons.append(f"subject {so or '-'}->{sn or '-'}")
    if vo != vn:
        reasons.append(f"verb {vo or '-'}->{vn or '-'}")
    j = jaccard(oo, on)
    if j < SVO_OBJECT_JACCARD:
        reasons.append(f"object bag {j:.2f}")
    return (bool(reasons), "; ".join(reasons))


# ======================================================================================
# Sentence alignment and claim classification
# ======================================================================================
class Row(NamedTuple):
    verdict: str  # UNCHANGED | MODIFIED | ADDED | REMOVED
    old: str
    new: str
    line: int
    heading: str
    flags: list[str]
    note: str


def align_key(text: str) -> str:
    """The string alignment runs on: lowercased, punctuation-light, whitespace-collapsed.

    Case and terminal punctuation must not make an untouched sentence look modified, and
    numbers must NOT be normalised away here — a 10 -> 5 swap has to survive into the
    pair so NUMBER_CHANGED_UNCITED can see it.
    """
    t = text.lower()
    t = re.sub(r"[\"'“”‘’]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t.rstrip(" .;:,")


def pair_up(olds: list[Sentence], news: list[Sentence]) -> list[tuple[Sentence | None, Sentence | None]]:
    """Greedy best-similarity pairing inside one difflib 'replace' block."""
    pairs: list[tuple[Sentence | None, Sentence | None]] = []
    remaining = list(olds)
    for n in news:
        best, best_r = None, 0.0
        for o in remaining:
            r = difflib.SequenceMatcher(None, align_key(o.text), align_key(n.text)).ratio()
            if r > best_r:
                best, best_r = o, r
        if best is not None and best_r >= PAIR_RATIO:
            remaining.remove(best)
            pairs.append((best, n))
        else:
            pairs.append((None, n))
    pairs.extend((o, None) for o in remaining)
    return pairs


def repair_globally(
    rows: list[tuple[Sentence | None, Sentence | None]]
) -> list[tuple[Sentence | None, Sentence | None]]:
    """Second pass: pair leftover ADDs with leftover DELETEs across the WHOLE file.

    difflib works positionally, so a sentence that was reworded AND moved (which a
    three-beat restructure does constantly) comes out of pass one as an unrelated delete
    plus an unrelated insert. That would hide it from every comparison flag — DEHEDGED,
    SVO_SHIFT and NUMBER_CHANGED_UNCITED all need the pair. So re-pair leftovers by
    similarity, cheapest filter first: a word-set overlap prefilter, then difflib's ratio.
    """
    paired = [r for r in rows if r[0] is not None and r[1] is not None]
    dels = [r[0] for r in rows if r[0] is not None and r[1] is None]
    adds = [r[1] for r in rows if r[0] is None and r[1] is not None]
    del_words = [words_of(s.text) for s in dels]
    used: set[int] = set()
    for a in adds:
        aw = words_of(a.text)
        ak = align_key(a.text)
        best, best_r = -1, 0.0
        for i, d in enumerate(dels):
            if i in used or jaccard(frozenset(aw), frozenset(del_words[i])) < 0.25:
                continue
            r = difflib.SequenceMatcher(None, align_key(d.text), ak).ratio()
            if r > best_r:
                best, best_r = i, r
        if best >= 0 and best_r >= PAIR_RATIO:
            used.add(best)
            paired.append((dels[best], a))
        else:
            paired.append((None, a))
    paired.extend((d, None) for i, d in enumerate(dels) if i not in used)
    return sorted(paired, key=lambda p: (p[1].line if p[1] else 10**9,
                                         p[0].line if p[0] else 0))


def align(base: list[Sentence], new: list[Sentence]) -> list[tuple[Sentence | None, Sentence | None]]:
    """Sentence-level alignment of two files. difflib on normalised sentences."""
    bk = [align_key(s.text) for s in base]
    nk = [align_key(s.text) for s in new]
    out: list[tuple[Sentence | None, Sentence | None]] = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, bk, nk, autojunk=False).get_opcodes():
        if tag == "equal":
            out.extend((base[i], new[j]) for i, j in zip(range(i1, i2), range(j1, j2)))
        elif tag == "insert":
            out.extend((None, new[j]) for j in range(j1, j2))
        elif tag == "delete":
            out.extend((base[i], None) for i in range(i1, i2))
        else:
            out.extend(pair_up(base[i1:i2], new[j1:j2]))
    return repair_globally(out)


def has_citation(text: str) -> bool:
    """A sentence carries its own source when it cites a spec or links one."""
    return bool(URL_RE.search(text) or SPEC_RE.search(text))


def is_reference_context(heading: str) -> bool:
    """`## References` (four spellings exist corpus-wide) and its friends.

    A line under References IS a citation, so holding it to "cite a source in the same
    sentence" is circular. cd08d66 added its NLB numbers exactly there.
    """
    h = heading.lower()
    return any(k in h for k in ("reference", "further reading", "sources", "bibliograph"))


def ledger_attested_numbers(ledger: dict, rel: str) -> set[str]:
    """Numbers a ledger entry for THIS file already vouches for, with a source and a date.

    This is the third and best way to clear ADDED_NUMBER_UNCITED: a rewriter who adds a
    verified value ledgers it (source URL + verified date + why it is easy to get wrong),
    and the gate goes green because the fact now has a permanent guard rather than a
    one-off waiver.
    """
    out: set[str] = set()
    for fact in ledger.get("facts") or []:
        if not isinstance(fact, dict) or fact.get("file") != rel:
            continue
        # `claim` and `require` only. NEVER `forbid`: a forbid pattern spells out the
        # KNOWN-WRONG value, and attesting that would have silenced the very regression
        # this ledger exists to catch (measured: it suppressed 268a063's 10,000 -> ~1,000).
        for field in ("claim", "require"):
            out |= extract_numbers(strip_markdown(str(fact.get(field) or "")))
    return out


def words_of(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z']+", text.lower())}


def classify(old: Sentence | None, new: Sentence | None, base_numbers: set[str],
             attested: set[str] = frozenset()) -> Row:  # type: ignore[assignment]
    """One claim-diff row. HARD flags are ADDED_NUMBER_UNCITED and NUMBER_CHANGED_UNCITED."""
    if new is None:
        assert old is not None
        return Row("REMOVED", old.text, "", old.line, old.heading, ["REMOVED_SENTENCE"], "")
    if old is not None and align_key(old.text) == align_key(new.text):
        return Row("UNCHANGED", old.text, new.text, new.line, new.heading, [], "")

    flags: list[str] = []
    notes: list[str] = []
    new_nums = extract_numbers(new.text)
    old_nums = extract_numbers(old.text) if old else set()
    cited = has_citation(new.text) or is_reference_context(new.heading)

    fresh = {n for n in new_nums if n not in base_numbers and n not in attested}
    if fresh:
        hard_fresh = fresh & hard_numbers(new.text)
        if hard_fresh and not cited:
            flags.append("ADDED_NUMBER_UNCITED")
            notes.append("new number(s) " + ", ".join(sorted(hard_fresh))
                         + " absent from the base file")
        elif not cited:
            flags.append("ADDED_NUMBER")  # rhetorical or prose-counting: REPORT only
            notes.append("new number(s) " + ", ".join(sorted(fresh)) + " (not fact-shaped)")
    if old is not None:
        dropped = old_nums - new_nums
        gained = new_nums - old_nums
        gained_hard = (gained & hard_numbers(new.text)) - attested
        if dropped and gained and not cited and gained_hard:
            flags.append("NUMBER_CHANGED_UNCITED")
            notes.append(
                "value swap " + ", ".join(sorted(dropped)) + " -> " + ", ".join(sorted(gained))
            )
        ow, nw = words_of(old.text), words_of(new.text)
        lost_hedges = (ow & HEDGES) - nw
        gained_abs = (nw & ABSOLUTES) - ow
        if lost_hedges:
            flags.append("DEHEDGED")
            notes.append("hedge removed: " + ", ".join(sorted(lost_hedges)))
        if gained_abs:
            flags.append("ABSOLUTE_ADDED")
            notes.append("absolute added: " + ", ".join(sorted(gained_abs)))
        for weak, strong in QUANTIFIER_PAIRS:
            if (ow & weak) - nw and (nw & strong) - ow:
                flags.append("QUANTIFIER_STRENGTHENED")
                notes.append(
                    f"{sorted((ow & weak) - nw)} -> {sorted((nw & strong) - ow)}"
                )
                break
        shifted, why = svo_differs(old.text, new.text)
        if shifted:
            flags.append("SVO_SHIFT")
            notes.append(why)
    if MARKER_RE.search(new.text) and (old is None or not MARKER_RE.search(old.text)):
        flags.append("CAUSAL_MARKER")  # the net, not the gate
    if old is None:
        flags.append("ADDED_SENTENCE")

    verdict = "ADDED" if old is None else "MODIFIED"
    return Row(verdict, old.text if old else "", new.text, new.line, new.heading,
               flags, "; ".join(notes))


HARD_CLAIM_FLAGS = {"ADDED_NUMBER_UNCITED", "NUMBER_CHANGED_UNCITED"}


# ======================================================================================
# The verified-facts ledger (docs/verified-facts.yaml)
#
# `require` makes a deletion impossible; `forbid` makes a specific known-wrong claim
# impossible. Both are needed: the SCP regression was a CHANGED value, but three of the
# four regressions on this effort were ADDITIONS of a wrong claim next to a fact that was
# still technically present, and no require-only ledger can see those.
# ======================================================================================
class Finding(NamedTuple):
    severity: str  # HARD | REPORT
    kind: str
    file: str
    message: str


def flat_text(text: str) -> str:
    """Whole file as one whitespace-collapsed, markdown-stripped string.

    Flattened across newlines so a ledgered `require` may span a wrapped line, which most
    of them do in an 88-column file.
    """
    return strip_markdown(text.replace("\n", " "))


def load_ledger(path: Path) -> dict:
    if not path.exists():
        return {"facts": [], "loss_allowlist": []}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        sys.exit(f"{path}: top-level must be a mapping")
    data.setdefault("facts", [])
    data.setdefault("loss_allowlist", [])
    return data


def ledger_schema_errors(ledger: dict, path: Path) -> list[str]:
    """A malformed ledger is a hard failure: a silently skipped entry is worse than none."""
    errors: list[str] = []
    seen: set[str] = set()
    for i, fact in enumerate(ledger["facts"]):
        loc = f"{path}: facts[{i}]"
        if not isinstance(fact, dict):
            errors.append(f"{loc}: entry must be a mapping")
            continue
        for key in ("id", "file", "claim", "source", "verified", "note"):
            if not str(fact.get(key) or "").strip():
                errors.append(f"{loc}: missing or empty '{key}'")
        fid = str(fact.get("id") or "")
        if fid in seen:
            errors.append(f"{loc}: duplicate id '{fid}'")
        seen.add(fid)
        if not fact.get("require") and not fact.get("forbid"):
            errors.append(f"{loc} ('{fid}'): needs at least one of 'require' / 'forbid'")
        rel = str(fact.get("file") or "")
        if rel and not (REPO / rel).exists():
            errors.append(f"{loc} ('{fid}'): file '{rel}' does not exist")
        for pat in fact.get("forbid") or []:
            try:
                re.compile(pat, re.I)
            except re.error as exc:
                errors.append(f"{loc} ('{fid}'): forbid pattern {pat!r} is not a regex: {exc}")
    return errors


def check_ledger(ledger: dict, new_ref: str | None, only: set[str] | None = None) -> list[Finding]:
    """Every ledgered fact, against the 'after' side. Runs on ALL entries, always —
    a ledgered file is guarded whether or not this diff happens to touch it."""
    findings: list[Finding] = []
    cache: dict[str, str | None] = {}
    for fact in ledger["facts"]:
        if not isinstance(fact, dict):
            continue
        rel = str(fact.get("file") or "")
        if only is not None and rel not in only:
            continue
        if rel not in cache:
            text = read_new(rel, new_ref)
            cache[rel] = flat_text(text) if text is not None else None
        flat = cache[rel]
        fid = fact.get("id")
        if flat is None:
            findings.append(Finding("HARD", "LEDGER_FILE_MISSING", rel,
                                    f"{fid}: file is gone, so its verified fact cannot be checked"))
            continue
        req = fact.get("require")
        if req:
            needle = strip_markdown(str(req)).lower()
            if needle not in flat.lower():
                findings.append(Finding(
                    "HARD", "LEDGER_VALUE_MISSING", rel,
                    f"{fid}: verified value {req!r} no longer appears.\n"
                    f"      claim:  {fact.get('claim')}\n"
                    f"      source: {fact.get('source')} (verified {fact.get('verified')})\n"
                    f"      why it is easy to get wrong: {fact.get('note')}\n"
                    f"      -> re-verify against the source, then update 'require' and "
                    f"'verified' in docs/verified-facts.yaml in THIS commit"))
        for pat in fact.get("forbid") or []:
            m = re.search(pat, flat, re.I)
            if m:
                findings.append(Finding(
                    "HARD", "LEDGER_FORBIDDEN_CLAIM", rel,
                    f"{fid}: known-wrong claim is back — /{pat}/ matched {m.group(0)!r}.\n"
                    f"      correct claim: {fact.get('claim')}\n"
                    f"      source: {fact.get('source')} (verified {fact.get('verified')})"))
    return findings


def allowlisted(ledger: dict, rel: str, kind: str, item: str) -> str | None:
    """Reason string when (file, kind/item) is signed off, else None."""
    for entry in ledger.get("loss_allowlist") or []:
        if not isinstance(entry, dict) or entry.get("file") not in (rel, "*"):
            continue
        if entry.get("item") is not None and str(entry["item"]) == item:
            return str(entry.get("reason") or "no reason given")
        if entry.get("kind") is not None and str(entry["kind"]) == kind:
            return str(entry.get("reason") or "no reason given")
    return None


# ======================================================================================
# Fact lines — the input to the mandatory web-verification pass
# ======================================================================================
def is_fact_line(text: str) -> bool:
    return bool(
        SPEC_RE.search(text) or URL_RE.search(text) or VERSION_RE.search(text)
        or NUM_UNIT_RE.search(text) or MONEY_RE.search(text)
        or any(is_spec_shaped_number(m.group(1)) for m in BARE_NUM_RE.finditer(text))
    )


def is_high_tier(text: str, new_numbers: set[str]) -> bool:
    """Worth a PRIMARY-SOURCE lookup, as opposed to worth a local re-derivation.

    Fires on: a spec citation or URL, a version pin, a number sitting next to a
    limit/quota/default/pricing/'since' word, or a number this diff introduced. It does
    NOT fire on arithmetic inside a worked example — SKILL.md step 6 says to RE-DERIVE
    those, which is a local operation and does not need the web.
    """
    if SPEC_RE.search(text) or URL_RE.search(text) or VERSION_RE.search(text):
        return True
    nums = extract_numbers(text)
    if nums and LIMIT_WORDS_RE.search(text):
        return True
    return bool(nums & new_numbers)


def changed_line_numbers(base: str, new: str) -> set[int]:
    """1-based line numbers on the NEW side that this diff inserted or replaced."""
    b, n = base.splitlines(), new.splitlines()
    changed: set[int] = set()
    for tag, _i1, _i2, j1, j2 in difflib.SequenceMatcher(None, b, n, autojunk=False).get_opcodes():
        if tag in ("insert", "replace"):
            changed.update(range(j1 + 1, j2 + 1))
    return changed


def collect_factlines(rel: str, base_text: str | None, new_text: str, scope: str,
                      tier: str) -> list[tuple[int, str]]:
    sc = scan(new_text)
    base_nums = extract_numbers(base_text) if base_text else set()
    new_nums = {n for n in extract_numbers(new_text) if n not in base_nums}
    changed = (changed_line_numbers(base_text, new_text)
               if (scope == "changed" and base_text is not None) else None)
    out: list[tuple[int, str]] = []
    seen: set[str] = set()
    for lineno, text in sc["fact_lines"]:
        if changed is not None and lineno not in changed:
            continue
        if not is_fact_line(text):
            continue
        if tier == "high" and not is_high_tier(text, new_nums):
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append((lineno, text))
    return out


# ======================================================================================
# Per-file audit
# ======================================================================================
def fence_tokens(body: str) -> set[str]:
    return {t for t in re.findall(r"[A-Za-z0-9_$.]{2,}", body)}


def floor_finding(rel: str, what: str, before: int, after: int) -> Finding | None:
    if after >= before:
        return None
    return Finding("HARD", "COUNT_DROPPED", rel,
                   f"{what}: {before} -> {after} (a drop of {before - after}); "
                   f"restore them or move the content, do not delete it")


def audit_file(rel: str, base_ref: str, new_ref: str | None, ledger: dict,
               factlines_scope: str, factlines_tier: str,
               want_factlines: bool) -> dict:
    base_text = git_show(base_ref, rel)
    new_text = read_new(rel, new_ref)
    findings: list[Finding] = []
    if new_text is None:
        gone = base_text is not None
        return {
            "file": rel, "status": "deleted" if gone else "missing", "metrics": {},
            "rows": [], "factlines": [],
            "findings": [Finding(
                "HARD", "FILE_DELETED" if gone else "FILE_NOT_FOUND", rel,
                "concepts.md was deleted; every MCQ ref into it breaks" if gone else
                f"no such path at {base_ref} or in the working tree — check the --file "
                f"argument (a typo must not pass silently)")],
        }
    if base_text is None:
        base_text = ""  # a brand-new topic: nothing to lose, everything is an addition
    is_new = not base_text.strip()

    b, n = scan(base_text), scan(new_text)
    b_inv, n_inv = inventory(base_text), inventory(new_text)

    # ---- HARD: information inventory -------------------------------------------------
    inv_delta: dict[str, list[str]] = {}
    allowed_notes: list[str] = []
    for cls in INVENTORY_CLASSES:
        lost = sorted(b_inv[cls] - n_inv[cls])
        kept: list[str] = []
        for item in lost:
            reason = allowlisted(ledger, rel, f"LOST_{cls.upper()}", item)
            if reason:
                allowed_notes.append(f"{cls}: {item} — allowlisted: {reason}")
            else:
                kept.append(item)
        if kept:
            inv_delta[cls] = kept
            findings.append(Finding(
                "HARD", f"LOST_{cls.upper()}", rel,
                f"{len(kept)} {cls} present in {base_ref} and gone: "
                + ", ".join(repr(k) for k in kept[:12])
                + (f" (+{len(kept) - 12} more)" if len(kept) > 12 else "")))

    # ---- HARD: volume and structure floors -------------------------------------------
    if b["raw_words"]:
        drop = 100.0 * (b["raw_words"] - n["raw_words"]) / b["raw_words"]
        if drop > WORD_FLOOR_PCT:
            findings.append(Finding(
                "HARD", "WORDS_DROPPED", rel,
                f"raw words {b['raw_words']} -> {n['raw_words']} ({drop:.1f}% down, "
                f"floor is {WORD_FLOOR_PCT:.0f}%). A shorter rewrite has lost content, "
                f"not burden"))
    for f in (
        floor_finding(rel, "table rows", b["table_rows"], n["table_rows"]),
        floor_finding(rel, "code fences", len(b["fences"]), len(n["fences"])),
        floor_finding(rel, "mermaid blocks",
                      sum(1 for x in b["fences"] if x.is_mermaid),
                      sum(1 for x in n["fences"] if x.is_mermaid)),
    ):
        if f:
            findings.append(f)

    n_digests = {x.digest for x in n["fences"]}
    n_tokens = set().union(*[fence_tokens(x.body) for x in n["fences"]]) if n["fences"] else set()
    for x in b["fences"]:
        if x.digest in n_digests:
            continue
        toks = fence_tokens(x.body)
        kept_frac = len(toks & n_tokens) / max(1, len(toks))
        kind = "FENCE_MODIFIED" if kept_frac >= FENCE_TOKEN_KEPT else "FENCE_REPLACED"
        findings.append(Finding(
            "REPORT", kind, rel,
            f"fence at base line {x.start} ({x.info or 'no info string'}) no longer matches; "
            f"{kept_frac:.0%} of its code tokens survive somewhere in the file"
            + ("" if kept_frac >= FENCE_TOKEN_KEPT else
               " — read this one: either a rewritten sample, or the mandated ASCII->mermaid "
               "conversion (S4), or a deleted example. The fence COUNT floor and the "
               "identifier inventory are the hard gates on fence content")))

    b_h2 = [t for lvl, t, _ in b["headings"] if lvl == 2]
    n_h2 = [t for lvl, t, _ in n["headings"] if lvl == 2]
    gone_h2 = [t for t in b_h2 if t not in n_h2]
    if gone_h2:
        findings.append(Finding(
            "HARD", "H2_REMOVED_OR_RENAMED", rel,
            f"{len(gone_h2)} H2 heading(s) removed or renamed: "
            + "; ".join(repr(t) for t in gone_h2[:5])
            + " — MCQ refs resolve against these. `validate_content.py --check-lock` is "
              "the authoritative check and will name the affected refs"))
    added_h2 = [t for t in n_h2 if t not in b_h2]
    if added_h2:
        findings.append(Finding("REPORT", "H2_ADDED", rel,
                                f"{len(added_h2)} new H2(s) (legal): "
                                + "; ".join(repr(t) for t in added_h2[:5])))

    # ---- claim-diff rows -------------------------------------------------------------
    attested = ledger_attested_numbers(ledger, rel)
    rows = [classify(o, nw, b_inv["numbers"], attested)
            for o, nw in align(b["sentences"], n["sentences"])]
    rows = [r for r in rows if r.verdict != "UNCHANGED"]
    if is_new:
        findings.append(Finding(
            "REPORT", "NEW_FILE", rel,
            f"no {base_ref} version, so every sentence is an addition and there is no "
            f"inventory to lose. Added-claim flags are REPORT here; verify this file "
            f"through the authoring loop and --emit-factlines, not through a diff"))
    for r in rows:
        for flag in (() if is_new else r.flags):
            if flag not in HARD_CLAIM_FLAGS:
                continue
            items = sorted(hard_numbers(r.new) - b_inv["numbers"]) or ["*"]
            unallowed = [i for i in items if not allowlisted(ledger, rel, flag, i)]
            if not unallowed:
                allowed_notes.append(f"{flag} at line {r.line}: allowlisted")
                continue
            findings.append(Finding(
                "HARD", flag, rel,
                f"line {r.line} under '{r.heading}': {r.note}\n"
                f"      NEW: {r.new[:300]}\n"
                + (f"      WAS: {r.old[:300]}\n" if r.old else "")
                + "      -> cite a primary source in the sentence, or allowlist it with a "
                  "reason in docs/verified-facts.yaml"))

    factlines = (collect_factlines(rel, base_text, new_text, factlines_scope, factlines_tier)
                 if want_factlines else [])

    return {
        "file": rel,
        "status": "audited",
        "metrics": {
            "raw_words": [b["raw_words"], n["raw_words"]],
            "prose_words": [b["prose_words"], n["prose_words"]],
            "reading_minutes": [b["reading_minutes"], n["reading_minutes"]],
            "table_rows": [b["table_rows"], n["table_rows"]],
            "fences": [len(b["fences"]), len(n["fences"])],
            "mermaid": [sum(1 for x in b["fences"] if x.is_mermaid),
                        sum(1 for x in n["fences"] if x.is_mermaid)],
            "callouts": [b["callouts"], n["callouts"]],
            "h2": [len(b_h2), len(n_h2)],
            "sentences": [len(b["sentences"]), len(n["sentences"])],
        },
        "inventory_lost": inv_delta,
        "allowlisted": allowed_notes,
        "rows": rows,
        "factlines": factlines,
        "findings": findings,
    }


# ======================================================================================
# Reporting
# ======================================================================================
def pct(before: int, after: int) -> str:
    if not before:
        return "new"
    return f"{100.0 * (after - before) / before:+.1f}%"


def callout_str(c: dict) -> str:
    return " ".join(f"{t[:4]} {c[t]}" for t in CALLOUT_TYPES)


def flag_histogram(rows: Iterable[Row]) -> dict[str, int]:
    hist: dict[str, int] = {}
    for r in rows:
        for f in r.flags:
            hist[f] = hist.get(f, 0) + 1
    return dict(sorted(hist.items(), key=lambda kv: (-kv[1], kv[0])))


def render_file(res: dict, max_rows: int, show_added: bool = False) -> None:
    m = res["metrics"]
    print(f"\n── {res['file']}")
    if res["status"] != "audited":
        for f in res["findings"]:
            print(f"   ❌ {f.kind}: {f.message}")
        return
    print(f"   raw words {m['raw_words'][0]:,} -> {m['raw_words'][1]:,} "
          f"({pct(*m['raw_words'])}; floor -{WORD_FLOOR_PCT:.0f}%)   "
          f"prose {m['prose_words'][0]:,} -> {m['prose_words'][1]:,}   "
          f"minutes {m['reading_minutes'][0]} -> {m['reading_minutes'][1]} (never gated)")
    print(f"   table rows {m['table_rows'][0]} -> {m['table_rows'][1]}   "
          f"fences {m['fences'][0]} -> {m['fences'][1]}   "
          f"mermaid {m['mermaid'][0]} -> {m['mermaid'][1]}   "
          f"H2 {m['h2'][0]} -> {m['h2'][1]}   "
          f"sentences {m['sentences'][0]} -> {m['sentences'][1]}")
    print(f"   callouts [{callout_str(m['callouts'][0])}] -> [{callout_str(m['callouts'][1])}]"
          f"   (REPORT ONLY — S9 forces these down on 193 files; gate the demotion log instead)")

    for note in res["allowlisted"]:
        print(f"   ▫ {note}")
    for f in res["findings"]:
        if f.severity == "HARD":
            print(f"   ❌ {f.kind}: {f.message}")
    for f in res["findings"]:
        if f.severity == "REPORT":
            print(f"   ·  {f.kind}: {f.message}")

    rows = res["rows"]
    if not rows:
        print("   claim-diff: no sentence changed")
        return
    verdicts: dict[str, int] = {}
    for r in rows:
        verdicts[r.verdict] = verdicts.get(r.verdict, 0) + 1
    hist = flag_histogram(rows)
    print(f"   claim-diff: {len(rows)} row(s) — "
          + ", ".join(f"{k} {v}" for k, v in sorted(verdicts.items()))
          + (f"; flags: {', '.join(f'{k} {v}' for k, v in hist.items())}" if hist else ""))
    # An ADDED sentence with no other flag is a claim the base never made, and the
    # comparison detectors (DEHEDGED / ABSOLUTE_ADDED / QUANTIFIER_STRENGTHENED / SVO_SHIFT)
    # cannot run on it because there is no original sentence to compare against — see
    # `classify()`, where all four sit behind `if old is not None`. So these rows are the
    # LEAST covered ones, not the most. They are withheld from the default listing only
    # because a real rewrite adds dozens; withholding them SILENTLY was a defect. On the
    # hard case (topics/java-jvm/synchronized-volatile-jmm, pre-repair draft) two of the four
    # known fact regressions landed here and nowhere else: the marker-free stage
    # misattribution "Which moves are legal at the last stage depends on the chip" and the
    # added absolute "nothing else can". Both were invisible in this report until --json.
    added_only = [r for r in rows if r.flags == ["ADDED_SENTENCE"]]
    review = [r for r in rows if r.flags] if show_added \
        else [r for r in rows if r.flags and r.flags != ["ADDED_SENTENCE"]]
    if review:
        label = ("the SVO/de-hedge/marker net plus every added sentence"
                 if show_added else "the SVO/de-hedge/marker net")
        print(f"   rows to verify ({len(review)}; {label}, REPORT-only):")
    for r in review[:max_rows]:
        print(f"     [{r.verdict} {','.join(r.flags)}] L{r.line} «{r.heading}»")
        if r.old:
            print(f"        WAS: {r.old[:220]}")
        print(f"        NEW: {r.new[:220]}")
        if r.note:
            print(f"        why: {r.note}")
    if len(review) > max_rows:
        print(f"     … {len(review) - max_rows} more (raise --max-rows or use --json)")
    if added_only and not show_added:
        print(f"   ⚠ {len(added_only)} ADDED sentence(s) carry no other flag and are NOT "
              f"listed above.\n"
              f"     No comparison detector can run on an added sentence, so these are the "
              f"least-covered\n"
              f"     rows in the diff, not the safest. Every one is a claim the base did not "
              f"make and owes\n"
              f"     a source (SKILL.md fact-safety steps 2-3). Read them: --show-added, or "
              f"--json.")


def render_factlines(results: list[dict], scope: str, tier: str) -> int:
    total = sum(len(r["factlines"]) for r in results)
    print(f"\n{'=' * 86}\nFACT LINES — {total} line(s) across "
          f"{sum(1 for r in results if r['factlines'])} file(s)  [scope={scope} tier={tier}]")
    print("Every line below needs a PRIMARY source opened (SKILL.md fact-safety step 6).")
    for r in results:
        if not r["factlines"]:
            continue
        print(f"\n## {r['file']}  ({len(r['factlines'])})")
        for lineno, text in r["factlines"]:
            print(f"  L{lineno:<5} {text[:200]}")
    return total


def render(results: list[dict], ledger_findings: list[Finding], base_sha: str,
           new_label: str, max_rows: int, show_added: bool = False) -> None:
    print(f"rewrite audit — base {base_sha}, after = {new_label}, "
          f"{len(results)} concepts.md changed")
    for res in results:
        render_file(res, max_rows, show_added)

    print(f"\n{'=' * 86}")
    if ledger_findings:
        print(f"verified-facts ledger: {len(ledger_findings)} HARD finding(s)")
        for f in ledger_findings:
            print(f"   ❌ {f.kind} [{f.file}]\n      {f.message}")
    else:
        print("verified-facts ledger: ✅ every ledgered value present, "
              "no known-wrong claim reintroduced")

    hard = [f for res in results for f in res["findings"] if f.severity == "HARD"]
    hard += ledger_findings
    report = [f for res in results for f in res["findings"] if f.severity == "REPORT"]
    review_rows = sum(1 for res in results for r in res["rows"]
                      if r.flags and r.flags != ["ADDED_SENTENCE"])
    added_only_rows = sum(1 for res in results for r in res["rows"]
                          if r.flags == ["ADDED_SENTENCE"])
    print(f"\nHARD findings: {len(hard)}   REPORT findings: {len(report)}   "
          f"rows queued for human/agent verification: {review_rows}"
          + (f" (+{added_only_rows} unflagged added sentence(s))" if added_only_rows else ""))
    if hard:
        kinds: dict[str, int] = {}
        for f in hard:
            kinds[f.kind] = kinds.get(f.kind, 0) + 1
        print("❌ FAIL — " + ", ".join(f"{k} x{v}" for k, v in sorted(kinds.items())))
    else:
        print("✅ PASS — no information loss, no floor breach, no ledger regression.")
        print("   This is NOT a fact-check. The rows above still need the adversarial "
              "verifier (loop step 7) and the web pass (step 8).")


def as_json(results: list[dict], ledger_findings: list[Finding], base_sha: str,
            new_label: str) -> dict:
    return {
        "base": base_sha,
        "after": new_label,
        "hard_findings": [f._asdict() for res in results for f in res["findings"]
                          if f.severity == "HARD"] + [f._asdict() for f in ledger_findings],
        "report_findings": [f._asdict() for res in results for f in res["findings"]
                            if f.severity == "REPORT"],
        "files": [{
            "file": res["file"],
            "status": res["status"],
            "metrics": res["metrics"],
            "inventory_lost": res.get("inventory_lost", {}),
            "allowlisted": res.get("allowlisted", []),
            "factlines": [{"line": ln, "text": t} for ln, t in res["factlines"]],
            "claim_diff": [r._asdict() for r in res["rows"]],
        } for res in results],
    }


# ======================================================================================
# main
# ======================================================================================
def all_concepts(domain: str | None) -> list[str]:
    pat = f"topics/{domain or '*'}/*/concepts.md"
    return sorted(p.relative_to(REPO).as_posix() for p in REPO.glob(pat))


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Diff-level information-loss and added-claim audit for concepts.md.")
    ap.add_argument("--base", default="HEAD", help="git ref to compare against (default HEAD)")
    ap.add_argument("--new", default=None,
                    help="git ref for the 'after' side (default: the working tree)")
    ap.add_argument("--domain", default=None, help="restrict to one domain slug")
    ap.add_argument("--file", action="append", default=None,
                    help="restrict to this concepts.md (repeatable)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--emit-factlines", action="store_true",
                    help="print the lines a web-verification pass must check")
    ap.add_argument("--factlines-scope", choices=("changed", "all"), default="changed",
                    help="changed hunks only (default), or every line in the file")
    ap.add_argument("--factlines-tier", choices=("high", "all"), default="high",
                    help="high = primary-source-checkable (default); all = every fact line")
    ap.add_argument("--audit-ledger", action="store_true",
                    help="check docs/verified-facts.yaml against the tree and exit")
    ap.add_argument("--no-ledger", action="store_true", help="skip the ledger check")
    ap.add_argument("--ledger", default=str(LEDGER))
    ap.add_argument("--max-rows", type=int, default=12,
                    help="claim-diff rows printed per file (default 12)")
    ap.add_argument("--show-added", action="store_true",
                    help="also list ADDED sentences carrying no other flag — the rows no "
                         "comparison detector can reach (raise --max-rows with it)")
    args = ap.parse_args()

    ledger_path = Path(args.ledger)
    ledger = load_ledger(ledger_path)
    schema_errors = ledger_schema_errors(ledger, ledger_path)

    if args.audit_ledger:
        findings = [] if schema_errors else check_ledger(ledger, args.new)
        payload = {"schema_errors": schema_errors,
                   "facts": len(ledger["facts"]),
                   "allowlist": len(ledger["loss_allowlist"]),
                   "findings": [f._asdict() for f in findings]}
        if args.json:
            print(json.dumps(payload, indent=2))
        else:
            print(f"verified-facts ledger: {payload['facts']} fact(s), "
                  f"{payload['allowlist']} allowlist entr(ies) — {ledger_path}")
            for e in schema_errors:
                print(f"   ❌ schema: {e}")
            for f in findings:
                print(f"   ❌ {f.kind} [{f.file}]\n      {f.message}")
            if not schema_errors and not findings:
                print("   ✅ every entry well-formed; every 'require' present; "
                      "every 'forbid' absent. Zero false positives on the live corpus.")
        return 1 if (schema_errors or findings) else 0

    base_sha = rev_parse(args.base)
    new_label = rev_parse(args.new) if args.new else "working tree"
    if args.new and not args.no_ledger and not args.json:
        print(f"note: the ledger is checked against {new_label}, so an entry verified after "
              f"that commit will fail legitimately — pass --no-ledger for a historical audit.")

    if args.file:
        files = [Path(f).as_posix() for f in args.file]
    elif args.emit_factlines and args.factlines_scope == "all":
        files = all_concepts(args.domain)  # nothing to diff: we are inventorying the corpus
    else:
        files = changed_concepts(args.base, args.new)
        if args.domain:
            files = [f for f in files if f.startswith(f"topics/{args.domain}/")]

    results = [audit_file(f, args.base, args.new, ledger, args.factlines_scope,
                          args.factlines_tier, args.emit_factlines) for f in files]

    ledger_findings: list[Finding] = []
    if not args.no_ledger:
        ledger_findings = [Finding("HARD", "LEDGER_SCHEMA", str(ledger_path), e)
                           for e in schema_errors]
        if not schema_errors:
            ledger_findings = check_ledger(ledger, args.new)

    if args.json:
        payload = as_json(results, ledger_findings, base_sha, new_label)
        payload["factlines_total"] = sum(len(r["factlines"]) for r in results)
        print(json.dumps(payload, indent=2))
    elif not files:
        print(f"No concepts.md differs between {base_sha} and {new_label} — nothing to audit.")
        if ledger_findings:
            print(f"verified-facts ledger: {len(ledger_findings)} HARD finding(s)")
        for f in ledger_findings:
            print(f"   ❌ {f.kind} [{f.file}]\n      {f.message}")
        if not ledger_findings:
            print("verified-facts ledger: ✅ intact.")
    else:
        render(results, ledger_findings, base_sha, new_label, args.max_rows,
               args.show_added)
        if args.emit_factlines:
            render_factlines(results, args.factlines_scope, args.factlines_tier)

    hard = [f for res in results for f in res["findings"] if f.severity == "HARD"]
    return 1 if (hard or ledger_findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
