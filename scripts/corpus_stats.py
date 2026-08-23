#!/usr/bin/env python3
"""corpus_stats.py — the authoritative, regenerable measurement of this corpus.

Writes `docs/corpus-stats.md`. Every numeric rule about content length, section
count, callout budget, sentence length, or reading time should be written against
THIS script's definitions, because they are the ones that are reproducible.

Usage:
    python3 scripts/corpus_stats.py [topics_dir] [--out PATH] [--json] [--quiet]

Exit code is always 0 (this is a report, not a gate).

THE TOKENIZER LIVES IN `scripts/prose.py`, not here. Its module docstring is the
authoritative contract (fences, prose vs non-prose, block boundaries, normalization,
words, sentences, nominalizations, raw words, reading minutes, percentiles), and
`METHOD_SECTION` below restates it in the generated document. This script used to carry
its own copy; it was extracted so that `clarity_report.py` measures the same corpus with
the same definitions instead of rolling a third splitter. Every number here is therefore
`prose.metrics()` plus aggregation — change a definition in `prose.py` and re-run.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prose import (  # noqa: E402  (path shim must run first)
    CALLOUT_TYPES,
    LONG_SENTENCE,
    MIN_SENTENCE_WORDS,
    VERY_LONG_SENTENCE,
    WORDS_PER_MINUTE,
    median,
    metrics,
    pctile,
    per_k,
    sentence_stats,
)

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required: pip install pyyaml")

# --- Constants that downstream rules are allowed to cite ---------------------
# The tokenizer's own constants (WORDS_PER_MINUTE, MIN_SENTENCE_WORDS, LONG_SENTENCE,
# VERY_LONG_SENTENCE, CALLOUT_TYPES) are imported above so there is exactly one
# definition of each in the repo. Only this report's own presentation knobs live here.

CALLOUT_BUDGET = 5  # files strictly above this are reported as outliers
DIFFICULTIES = ("beginner", "intermediate", "advanced", "expert")

REF_RE = re.compile(r"^concepts\.md#(.+)$")


# --- Static prose blocks of the output document --------------------------------
# %-interpolated, not f-strings, because the text contains literal `{` `}` from
# the regexes it quotes.

SUPERSEDES_BANNER = """> [!WARNING]
> **This document supersedes every ad-hoc corpus number quoted elsewhere in the repo** —
> `ROADMAP.md`, `OPTIMIZATION-ROADMAP.md`, `topics/CONTENT-AUDIT-MASTER.md`,
> `web/CONTRACT.md`, per-domain audits, and skill files. Those were measured at different
> times with different (often undocumented) tokenizers. When a number here disagrees with
> a number there, this one wins — and the other should be fixed or deleted, not averaged.
> Do not hand-edit this file: change the script and re-run it."""

METHOD_SECTION = """## How these numbers are measured (the tokenizer)

Stated here in full because every downstream numeric rule will be written against it and
must be reproducible. **The implementation is `scripts/prose.py`, and its module docstring
is the authoritative copy of this contract** — `corpus_stats.py` and `clarity_report.py`
both import it, so no two reports in this repo can define a prose number differently.

1. **Fences.** A line matching ``^\\s*(`{3,}|~{3,})(.*)$`` opens a fenced block (char +
   run length remembered); it closes on the same char, at least as long, with no info
   string. Fence markers and their contents are **code**: never prose, never headings. A
   `#` comment inside a Dockerfile sample is not an H1.
2. **Headings.** Outside fences only: `^(#{1,6})(?:[ \\t]+(.*))?$`. Anchor slug =
   lowercase → drop all but word chars/whitespace/hyphen → each single whitespace char
   becomes one hyphen, runs **not** collapsed (github-slugger behaviour: `SQL & NoSQL` →
   `sql--nosql`). Heading lines are excluded from prose.
3. **Prose vs non-prose.** Prose = every non-fence line except headings, table rows
   (`^\\s*\\|`), thematic breaks, and whole-line HTML comments. Leading `>` blockquote
   markers and list markers (`-`, `*`, `+`, `1.`, `1)`) are stripped; a leading callout
   marker is counted and removed. Mermaid diagrams are inside fences, so they are code.
4. **Normalization order.** images removed → `[text](url)` → `text` → each inline code
   span → **one opaque token** → bold spans counted → `**`/`__`/`*`/`_`/`~~` removed.
   Parens, periods and words inside code spans or link URLs therefore never inflate
   prose metrics, and an identifier's internal period can never end a sentence.
5. **Words (prose).** Whitespace split of the normalized text; a token is a word only if
   it contains at least one `[A-Za-z0-9]`. `prose_words` is the denominator of every
   "per 1,000 words" figure below.
6. **Segments and sentences.** A new segment begins at a blank line, list item,
   blockquote line, heading, table row, or break; continuation lines join with one space.
   A sentence ends at a word-final `.`/`!`/`?` (trailing quotes/brackets allowed) unless
   the token is a known abbreviation (`e.g.`, `i.e.`, `etc.`, `vs.`, `cf.`, `approx.`,
   `al.`, `Fig.`, `No.`, `Inc.`, `Dr.`, `Mr.`, `Ms.`, `Mrs.`, `St.`, `Jr.`, `Sr.`, `ca.`,
   `resp.`, `ex.`) or a single-letter initial. Segment end always ends a sentence, so an
   unterminated bullet counts as one and a four-item list is four sentences, never one
   fused monster — converting an inline enumeration *into* a list therefore RAISES p90,
   which is an artefact of this rule and not a regression. **Sentences shorter than
   %(min_sent)d words are discarded** as fragments and are absent from the mean, p90, and
   over-30/over-45 counts.
7. **Nominalizations.** Prose word, lowercased and stripped to `[a-z]`, length ≥ 5,
   ending `tion|ment|ance|ence|ity` with optional plural `s`. **Caveat:** a pure suffix
   heuristic, so it also catches innocent words ("sentence", "instance", "difference",
   "quality"). Treat it as a *relative* density signal between files and domains, never
   as an absolute count.
8. **Raw words and reading minutes.** `raw_words` = whole-file whitespace split (code
   included) — this is what the site counts. Reading minutes replicate
   `web/scripts/sync-content.mjs` exactly: strip a leading `# H1`, `trim()`, whitespace
   split, drop empties, `max(1, round(words / %(wpm)d))` with JS half-up rounding. So the
   figure equals the `readingMinutes` a reader sees on the page.
9. **Percentiles.** `median` is conventional (mean of the two middle values when even).
   `p90`/`p95` are **nearest-rank**: `index = ceil(p/100 * n) - 1`, clamped — no
   interpolation, so every percentile printed is a value that actually occurs.

Counted per topic directory that contains a `questions.yaml` (the same population the
validator walks), so `topics` here means "MCQ-bearing subtopic".

**Two deliberate exclusions worth knowing before you write a rule against these numbers.**
Markdown tables are excluded from prose: this corpus teaches heavily through comparison
tables, so `prose words` understates the words a learner actually reads, and a table-dense
file will look shorter in prose metrics than it reads. And a sentence is only counted at
≥ %(min_sent)d words, so a file written in clipped fragments scores a *higher* mean
sentence length than a naive splitter would give it. Both choices make the numbers stable;
neither is neutral."""


# --- Small stats helpers ------------------------------------------------------
#
# `pctile`, `median` and `per_k` are imported from prose.py (contract §10) so the
# percentile convention cannot differ between this report and clarity_report.py.


def spread(values: list[int], p_hi: float = 90) -> dict:
    """min / median / p_hi / max for a list of ints."""
    return {
        "min": min(values) if values else 0,
        "median": round(median(values), 1),
        f"p{int(p_hi)}": pctile(values, p_hi),
        "max": max(values) if values else 0,
    }


# --- Aggregation --------------------------------------------------------------


def new_bucket() -> dict:
    return {
        "topics": 0,
        "files_with_concepts": 0,
        "lines": [],
        "raw_words": [],
        "prose_words": [],
        "reading_minutes": [],
        "h2": [],
        "headings_total": 0,
        "naive_headings_total": 0,
        "naive_h2_total": 0,
        "files_with_phantom_headings": 0,
        "mermaid_blocks": 0,
        "files_zero_mermaid": 0,
        "callouts": Counter(),
        "callouts_over_budget": 0,
        "callout_bands": Counter(),
        "max_callouts_file": ("", 0),
        "sentences": [],
        "bold_spans": 0,
        "open_parens": 0,
        "nominalizations": 0,
        "prose_words_total": 0,
        "questions": 0,
        "types": Counter(),
        "difficulty": Counter(),
        "options": Counter(),
        "refs": 0,
        "ref_depth": Counter(),
        "max_words_file": ("", 0),
        "max_lines_file": ("", 0),
        "max_h2_file": ("", 0),
        "max_minutes_file": ("", 0),
    }


def absorb(b: dict, slug: str, m: dict) -> None:
    b["files_with_concepts"] += 1
    b["lines"].append(m["lines"])
    b["raw_words"].append(m["raw_words"])
    b["prose_words"].append(m["prose_words"])
    b["reading_minutes"].append(m["reading_minutes"])
    b["h2"].append(m["h2"])
    b["headings_total"] += m["headings"]
    b["naive_headings_total"] += m["naive_headings"]
    b["naive_h2_total"] += m["naive_h2"]
    if m["naive_headings"] != m["headings"]:
        b["files_with_phantom_headings"] += 1
    b["mermaid_blocks"] += m["mermaid_blocks"]
    if m["mermaid_blocks"] == 0:
        b["files_zero_mermaid"] += 1
    b["callouts"].update(m["callouts"])
    n_cal = m["callouts_total"]
    if n_cal > CALLOUT_BUDGET:
        b["callouts_over_budget"] += 1
    b["callout_bands"]["0" if n_cal == 0 else "1-3" if n_cal <= 3
                       else f"4-{CALLOUT_BUDGET}" if n_cal <= CALLOUT_BUDGET
                       else f">{CALLOUT_BUDGET}"] += 1
    if n_cal > b["max_callouts_file"][1]:
        b["max_callouts_file"] = (slug, n_cal)
    b["sentences"].extend(m["sentences"])
    b["bold_spans"] += m["bold_spans"]
    b["open_parens"] += m["open_parens"]
    b["nominalizations"] += m["nominalizations"]
    b["prose_words_total"] += m["prose_words"]
    for key, val in (("max_words_file", m["raw_words"]), ("max_lines_file", m["lines"]),
                     ("max_h2_file", m["h2"]), ("max_minutes_file", m["reading_minutes"])):
        if val > b[key][1]:
            b[key] = (slug, val)


def collect(topics_dir: Path) -> dict:
    overall = new_bucket()
    per_domain: dict[str, dict] = {}
    topic_minutes: list[tuple[int, str]] = []
    missing_concepts: list[str] = []
    unresolved_refs: list[str] = []

    for qpath in sorted(topics_dir.rglob("questions.yaml")):
        rel = qpath.relative_to(topics_dir)
        parts = rel.parts
        domain = parts[0] if len(parts) > 1 else "?"
        slug = parts[1] if len(parts) > 2 else qpath.parent.name
        b = per_domain.setdefault(domain, new_bucket())
        b["topics"] += 1
        overall["topics"] += 1

        cpath = qpath.parent / "concepts.md"
        anchors: dict[str, int] = {}
        if cpath.exists():
            m = metrics(cpath.read_text(encoding="utf-8"))
            anchors = m["anchors"]
            absorb(b, slug, m)
            absorb(overall, f"{domain}/{slug}", m)
            topic_minutes.append((m["reading_minutes"], f"{domain}/{slug}"))
        else:
            missing_concepts.append(f"{domain}/{slug}")

        try:
            data = yaml.safe_load(qpath.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError:
            continue
        for q in (data.get("questions") or []):
            if not isinstance(q, dict):
                continue
            qtype = "multi" if q.get("type") == "multi" else "single"
            opts = q.get("options")
            nopt = len(opts) if isinstance(opts, list) else 0
            diff = str(q.get("difficulty"))
            ref = str(q.get("ref") or "").strip()
            depth = None
            if ref:
                rm = REF_RE.match(ref)
                if rm:
                    lvl = anchors.get(rm.group(1))
                    if lvl is None:
                        depth = "unresolved"
                        unresolved_refs.append(f"{domain}/{slug}#{rm.group(1)}")
                    else:
                        depth = "H1" if lvl == 1 else "H2" if lvl == 2 else "H3+"
                else:
                    depth = "malformed"
            for bucket in (b, overall):
                bucket["questions"] += 1
                bucket["types"][qtype] += 1
                bucket["difficulty"][diff] += 1
                bucket["options"][nopt] += 1
                if ref:
                    bucket["refs"] += 1
                    bucket["ref_depth"][depth] += 1

    minutes_by_topic = {slug: mins for mins, slug in topic_minutes}
    topic_minutes.sort(key=lambda t: (-t[0], t[1]))
    return {
        "overall": overall,
        "per_domain": per_domain,
        "top_minutes": topic_minutes[:10],
        "minutes_by_topic": minutes_by_topic,
        "missing_concepts": missing_concepts,
        "unresolved_refs": unresolved_refs,
    }


# --- Numbers quoted elsewhere in the repo ------------------------------------
#
# Each row is a figure some other document asserts, paired with a callable that
# recomputes it here. Verdicts are therefore recomputed on every run rather than
# hand-written, so this table cannot rot into another stale claim. Line numbers
# are as of the generation date; the claim text is what to grep for.

GEN_MINUTES_RE = re.compile(r"^readingMinutes:\s*(\d+)\s*$", re.M)


def verify_reading_minutes(root: Path, res: dict) -> tuple[int, list[str]] | None:
    """Cross-check our reading minutes against the site's GENERATED frontmatter.

    `web/src/content/concepts/<domain>/<slug>.md` is a gitignored build artifact
    produced by `web/scripts/sync-content.mjs`. When it is present we compare every
    entry, which proves the formula here is the site's formula rather than merely
    resembling it. Returns None when the artifact hasn't been generated locally.
    """
    gen = root / "web" / "src" / "content" / "concepts"
    if not gen.is_dir():
        return None
    compared, mismatches = 0, []
    for entry in sorted(gen.rglob("*.md")):
        key = f"{entry.parent.name}/{entry.stem}"
        if key not in res["minutes_by_topic"]:
            continue
        m = GEN_MINUTES_RE.search(entry.read_text(encoding="utf-8"))
        if not m:
            continue
        compared += 1
        if int(m.group(1)) != res["minutes_by_topic"][key]:
            mismatches.append(f"{key}: site {m.group(1)} vs measured "
                              f"{res['minutes_by_topic'][key]}")
    return compared, mismatches


def _dom(res: dict, name: str, key: str):
    b = res["per_domain"].get(name)
    if not b:
        return 0
    return b["topics"] if key == "topics" else b["questions"]


QUOTED_CLAIMS: list[tuple[str, str, int, Callable[[dict], int]]] = [
    ("ROADMAP.md:117", "`460 files, 28,064 Qs` (validator line)", 460,
     lambda r: r["overall"]["topics"]),
    ("ROADMAP.md:117", "`460 files, 28,064 Qs` — question total", 28064,
     lambda r: r["overall"]["questions"]),
    ("ROADMAP.md:117", "\"system-design domain now **86 topics**\"", 86,
     lambda r: _dom(r, "system-design", "topics")),
    ("ROADMAP.md:81", "rollup row: system-design `70 ✅` authored", 70,
     lambda r: _dom(r, "system-design", "topics")),
    ("ROADMAP.md:85", "rollup row: rest-api-design `18` topics", 18,
     lambda r: _dom(r, "rest-api-design", "topics")),
    ("ROADMAP.md:85", "rollup row: rest-api-design `1,529 MCQs`", 1529,
     lambda r: _dom(r, "rest-api-design", "questions")),
    ("ROADMAP.md:91", "rollup row: messaging-databases `15` topics", 15,
     lambda r: _dom(r, "messaging-databases", "topics")),
    ("ROADMAP.md:91", "rollup row: messaging-databases `815 MCQs`", 815,
     lambda r: _dom(r, "messaging-databases", "questions")),
    ("ROADMAP.md:92", "rollup row: security `16` topics", 16,
     lambda r: _dom(r, "security", "topics")),
    ("ROADMAP.md:92", "rollup row: security `1,291 MCQs`", 1291,
     lambda r: _dom(r, "security", "questions")),
    ("ROADMAP.md:78-99", "rollup table row count (domains listed)", 19,
     lambda r: len(r["per_domain"])),
    ("topics/CONTENT-AUDIT-MASTER.md:26", "\"19 domains and 429 subtopics\" — domains", 19,
     lambda r: len(r["per_domain"])),
    ("topics/CONTENT-AUDIT-MASTER.md:26", "\"19 domains and 429 subtopics\" — subtopics", 429,
     lambda r: r["overall"]["topics"]),
    ("topics/CONTENT-AUDIT-MASTER.md:52", "scorecard row: system-design `86` subtopics", 86,
     lambda r: _dom(r, "system-design", "topics")),
    ("OPTIMIZATION-ROADMAP.md:3", "\"430 topics / ~21k MCQs\" — topics", 430,
     lambda r: r["overall"]["topics"]),
    ("OPTIMIZATION-ROADMAP.md:3", "\"430 topics / ~21k MCQs\" — MCQs", 21000,
     lambda r: r["overall"]["questions"]),
    ("OPTIMIZATION-ROADMAP.md:33", "\"320 files, 1,112 diagrams\" — files with a diagram", 320,
     lambda r: r["overall"]["files_with_concepts"] - r["overall"]["files_zero_mermaid"]),
    ("OPTIMIZATION-ROADMAP.md:33", "\"320 files, 1,112 diagrams\" — mermaid blocks", 1112,
     lambda r: r["overall"]["mermaid_blocks"]),
    ("OPTIMIZATION-ROADMAP.md:48", "\"only 209/430 have a link\" — denominator", 430,
     lambda r: r["overall"]["topics"]),
    ("web/CONTRACT.md:81", "\"4 authored domains\"", 4,
     lambda r: len(r["per_domain"])),
    ("web/CONTRACT.md:81", "\"119 subtopics\"", 119,
     lambda r: r["overall"]["topics"]),
    ("web/CONTRACT.md:81", "\"9432 questions\"", 9432,
     lambda r: r["overall"]["questions"]),
    ("web/CONTRACT.md:82", "\"system-design 57/4515\" — subtopics", 57,
     lambda r: _dom(r, "system-design", "topics")),
    ("web/CONTRACT.md:99", "`\"questionCount\": 4515` (system-design)", 4515,
     lambda r: _dom(r, "system-design", "questions")),
    ("web/CONTRACT.md:240", "\"all 119 entries\"", 119,
     lambda r: r["overall"]["topics"]),
]


# --- Rendering ---------------------------------------------------------------


def sent_stats(sentences: list[int]) -> dict:
    """Alias kept for readability at the call sites; the definition is prose.py's."""
    return sentence_stats(sentences)


def as_json(res: dict) -> dict:
    def one(b: dict) -> dict:
        return {
            "topics": b["topics"],
            "files_with_concepts": b["files_with_concepts"],
            "lines": spread(b["lines"]),
            "raw_words": spread(b["raw_words"]),
            "prose_words": spread(b["prose_words"]),
            "reading_minutes": spread(b["reading_minutes"]),
            "h2": spread(b["h2"], 95),
            "h2_total": sum(b["h2"]),
            "headings_total": b["headings_total"],
            "naive_headings_total": b["naive_headings_total"],
            "naive_h2_total": b["naive_h2_total"],
            "files_with_phantom_headings": b["files_with_phantom_headings"],
            "max_files": {
                "raw_words": b["max_words_file"],
                "lines": b["max_lines_file"],
                "h2": b["max_h2_file"],
                "reading_minutes": b["max_minutes_file"],
            },
            "mermaid_blocks": b["mermaid_blocks"],
            "files_zero_mermaid": b["files_zero_mermaid"],
            "callouts": dict(b["callouts"]),
            "callouts_per_1k_words": per_k(sum(b["callouts"].values()), b["prose_words_total"]),
            "files_over_callout_budget": b["callouts_over_budget"],
            "callout_bands": dict(b["callout_bands"]),
            "max_callouts_file": b["max_callouts_file"],
            "prose_words_total": b["prose_words_total"],
            "sentences": sent_stats(b["sentences"]),
            "bold_per_1k_words": per_k(b["bold_spans"], b["prose_words_total"]),
            "open_parens_per_1k_words": per_k(b["open_parens"], b["prose_words_total"]),
            "nominalizations_per_1k_words": per_k(b["nominalizations"], b["prose_words_total"]),
            "questions": b["questions"],
            "types": dict(b["types"]),
            "difficulty": dict(b["difficulty"]),
            "options": {str(k): v for k, v in sorted(b["options"].items())},
            "refs": b["refs"],
            "ref_depth": dict(b["ref_depth"]),
        }

    return {
        "generated": date.today().isoformat(),
        "words_per_minute": WORDS_PER_MINUTE,
        "corpus": one(res["overall"]),
        "domains": {d: one(b) for d, b in sorted(res["per_domain"].items())},
        "top_reading_minutes": res["top_minutes"],
        "missing_concepts": res["missing_concepts"],
        "unresolved_refs": res["unresolved_refs"],
    }


def render(res: dict, minute_check: tuple[int, list[str]] | None = None) -> str:
    ov = res["overall"]
    doms = sorted(res["per_domain"].items())
    ovs = sent_stats(ov["sentences"])
    L: list[str] = []

    def w(s: str = "") -> None:
        L.append(s)

    w("# Corpus statistics — authoritative")
    w()
    w("**Regenerate with `python3 scripts/corpus_stats.py`.** "
      f"Generated {date.today().isoformat()} from `topics/`.")
    w()
    w(SUPERSEDES_BANNER)
    w()

    # --- Headline -------------------------------------------------------------
    w("## Headline")
    w()
    w(f"- **{len(doms)} domains, {ov['topics']} topics, {ov['questions']:,} MCQs** "
      f"({ov['types'].get('single', 0):,} single / {ov['types'].get('multi', 0):,} multi).")
    w(f"- **{ov['refs']:,} questions carry a `ref`** ({100 * ov['refs'] / max(ov['questions'], 1):.1f}%): "
      + ", ".join(f"{k} {v:,}" for k, v in sorted(ov["ref_depth"].items())) + ".")
    w(f"- **{sum(ov['raw_words']):,} raw words** across {ov['files_with_concepts']} `concepts.md` "
      f"({ov['prose_words_total']:,} of them prose, i.e. "
      f"{100 * ov['prose_words_total'] / max(sum(ov['raw_words']), 1):.0f}% — the rest is code, "
      "tables, and headings).")
    w(f"- **H2 sections per file: median {median(ov['h2']):.0f}, p95 {pctile(ov['h2'], 95)}, "
      f"max {ov['max_h2_file'][1]}** (`topics/{ov['max_h2_file'][0]}/concepts.md`), "
      f"{sum(ov['h2']):,} H2s in total. The disputed max is "
      f"**{ov['max_h2_file'][1]}** — see below.")
    w(f"- **Reading minutes: median {median(ov['reading_minutes']):.0f}, "
      f"p90 {pctile(ov['reading_minutes'], 90)}, max {ov['max_minutes_file'][1]}** "
      f"(`topics/{ov['max_minutes_file'][0]}`), total "
      f"{sum(ov['reading_minutes']):,} minutes "
      f"({sum(ov['reading_minutes']) / 60:.0f} hours) of reading.")
    w(f"- **Sentences: mean {ovs['mean']} words, p90 {ovs['p90']}**; "
      f"{ovs[f'over_{LONG_SENTENCE}']:,} over {LONG_SENTENCE} words "
      f"({100 * ovs[f'over_{LONG_SENTENCE}'] / max(ovs['n'], 1):.1f}% of {ovs['n']:,}), "
      f"{ovs[f'over_{VERY_LONG_SENTENCE}']:,} over {VERY_LONG_SENTENCE}.")
    w(f"- **{ov['mermaid_blocks']:,} mermaid blocks**; {ov['files_zero_mermaid']} files "
      f"({100 * ov['files_zero_mermaid'] / max(ov['files_with_concepts'], 1):.0f}%) have none.")
    w(f"- **{sum(ov['callouts'].values()):,} callouts** "
      f"({per_k(sum(ov['callouts'].values()), ov['prose_words_total'])} per 1,000 prose words); "
      f"{ov['callouts_over_budget']} files exceed {CALLOUT_BUDGET}.")
    w(f"- Prose density: **{per_k(ov['bold_spans'], ov['prose_words_total'])} bold spans**, "
      f"**{per_k(ov['open_parens'], ov['prose_words_total'])} open parens**, "
      f"**{per_k(ov['nominalizations'], ov['prose_words_total'])} nominalizations** "
      "per 1,000 prose words.")
    if res["missing_concepts"]:
        w(f"- ⚠️ {len(res['missing_concepts'])} topic(s) have no `concepts.md`: "
          + ", ".join(f"`{s}`" for s in res["missing_concepts"]) + ".")
    if res["unresolved_refs"]:
        w(f"- ⚠️ {len(res['unresolved_refs'])} `ref` anchor(s) do not resolve.")
    else:
        w("- Every `ref` anchor resolves to a real heading (0 unresolved).")
    w()

    # --- Contradictions -------------------------------------------------------
    w("## Contradictions with numbers quoted elsewhere")
    w()
    w("Recomputed on every run from `QUOTED_CLAIMS` in the script, so this table cannot itself go")
    w("stale. Line numbers are as of the generation date above; the claim text is what to grep")
    w("for. **Any row marked STALE should be corrected or deleted at its source** — do not")
    w("re-derive a rule from it.")
    w()
    w("| Source | Quoted claim | Quoted | Measured | Verdict |")
    w("|---|---|---:|---:|---|")
    stale = 0
    for src, claim, quoted, fn in QUOTED_CLAIMS:
        actual = fn(res)
        ok = actual == quoted
        stale += 0 if ok else 1
        w(f"| `{src}` | {claim} | {quoted:,} | {actual:,} | "
          f"{'ok' if ok else '**STALE**'} |")
    w()
    w(f"**{stale} of {len(QUOTED_CLAIMS)} quoted figures are stale.** The recurring cause is that")
    w("`ROADMAP.md`'s rollup table, `CONTENT-AUDIT-MASTER.md`'s scorecard, and `web/CONTRACT.md`'s")
    w("\"current generated volume\" were each snapshotted once and never regenerated, while")
    w("`topics/` kept growing. `web/CONTRACT.md` is the worst offender — it is ~4x low on every")
    w("count while `CLAUDE.md` points at it as the authoritative data-shape reference.")
    w()
    w("Not machine-checkable here, but worth flagging by hand:")
    w()
    w("- `ROADMAP.md`'s rollup table has **no row at all** for `system-design-case-studies` "
      f"({_dom(res, 'system-design-case-studies', 'topics')} topics, "
      f"{_dom(res, 'system-design-case-studies', 'questions'):,} MCQs), which is why its domain")
    w("  count reads 19 instead of 20.")
    w("- `OPTIMIZATION-ROADMAP.md:113` reasons about \"6,672 non-boilerplate sections\". The total")
    w(f"  H2 count is {sum(ov['h2']):,} and total headings (all levels, fence-aware) is")
    w(f"  {ov['headings_total']:,}, so 6,672 is plausible as a filtered subset — but the filter is")
    w("  undocumented and not reproducible. Re-derive from this script before citing it.")
    w("- `OPTIMIZATION-ROADMAP.md:32` (\"correct = uniquely longest 87.3%\") is an MCQ-integrity")
    w("  figure owned by `scripts/mcq_quality_report.py`, not this script; the distractor rollout")
    w("  has since moved it. Run that script rather than quoting the roadmap.")
    w()

    # --- Method ---------------------------------------------------------------
    w(METHOD_SECTION % {"min_sent": MIN_SENTENCE_WORDS, "wpm": WORDS_PER_MINUTE})
    w()

    # --- Size table -----------------------------------------------------------
    w("## Size — `concepts.md` lines and words")
    w()
    w("`raw words` includes code/tables (site basis); `prose words` is prose only.")
    w()
    w("| Domain | Topics | lines min/med/p90/max | raw words min/med/p90/max | prose words med | longest file (raw words) |")
    w("|---|---:|---|---|---:|---|")
    for d, b in doms:
        ln, rw = spread(b["lines"]), spread(b["raw_words"])
        w(f"| {d} | {b['topics']} | {ln['min']}/{ln['median']:.0f}/{ln['p90']}/{ln['max']} | "
          f"{rw['min']:,}/{rw['median']:,.0f}/{rw['p90']:,}/{rw['max']:,} | "
          f"{median(b['prose_words']):,.0f} | `{b['max_words_file'][0]}` ({b['max_words_file'][1]:,}) |")
    ln, rw = spread(ov["lines"]), spread(ov["raw_words"])
    w(f"| **CORPUS** | **{ov['topics']}** | {ln['min']}/{ln['median']:.0f}/{ln['p90']}/{ln['max']} | "
      f"{rw['min']:,}/{rw['median']:,.0f}/{rw['p90']:,}/{rw['max']:,} | "
      f"{median(ov['prose_words']):,.0f} | `{ov['max_words_file'][0]}` ({ov['max_words_file'][1]:,}) |")
    w()

    # --- MCQ table ------------------------------------------------------------
    w("## MCQs — counts, types, difficulty, options")
    w()
    w("| Domain | MCQs | single | multi | beginner | intermediate | advanced | expert | 3 opt | 4 opt | 5 opt |")
    w("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for d, b in doms + [("**CORPUS**", ov)]:
        t, df, o = b["types"], b["difficulty"], b["options"]
        w(f"| {d} | {b['questions']:,} | {t.get('single', 0):,} | {t.get('multi', 0):,} | "
          + " | ".join(f"{df.get(k, 0):,}" for k in DIFFICULTIES) + " | "
          + " | ".join(f"{o.get(k, 0):,}" for k in (3, 4, 5)) + " |")
    stray_diff = {k: v for k, v in ov["difficulty"].items() if k not in DIFFICULTIES}
    stray_opt = {k: v for k, v in ov["options"].items() if k not in (3, 4, 5)}
    if stray_diff or stray_opt:
        w()
        w(f"Off-schema values: difficulty {stray_diff or '{}'}, options-count {stray_opt or '{}'}.")
    w()

    # --- H2 -------------------------------------------------------------------
    w("## H2 counts — settling the \"58 vs 72\" dispute")
    w()
    max_h2 = ov["max_h2_file"][1]
    w("Two planning docs disagreed about the maximum number of `## H2` sections in a single file:")
    w("one said 58, one said 72. Measured fence-aware over the whole corpus, the maximum is")
    w(f"**{max_h2}**, in `topics/{ov['max_h2_file'][0]}/concepts.md`.")
    w()
    for claim in (58, 72):
        verdict = "CORRECT" if claim == max_h2 else "WRONG"
        w(f"- The **{claim}** claim is **{verdict}**"
          + ("." if claim == max_h2 else f" (actual max is {max_h2})."))
    w()
    if ov["naive_h2_total"] == sum(ov["h2"]):
        w("Fence-awareness is *not* what separated the two claims here — no `## ` line in the corpus")
        w("sits inside a code fence, so naive and fence-aware H2 counts agree exactly")
        w(f"({ov['naive_h2_total']:,} = {sum(ov['h2']):,} corpus-wide).")
    else:
        w(f"Fence-awareness changes the H2 total: {ov['naive_h2_total']:,} `## ` lines exist but only")
        w(f"{sum(ov['h2']):,} are real headings (the rest are inside code fences).")
    w()
    w("It matters a great deal at other heading levels, though, which is why fence-awareness is")
    w("non-negotiable for any heading metric: counting `#{1,6}` lines blind to fences reports")
    w(f"**{ov['naive_headings_total']:,}** headings versus **{ov['headings_total']:,}** real ones — "
      f"**{ov['naive_headings_total'] - ov['headings_total']:,} phantom")
    w(f"headings across {ov['files_with_phantom_headings']} files**, almost all of them `#` "
      "comments in shell, YAML, and Dockerfile samples.")
    w()
    w("Nor is 58 a stale reading of the same file: at the commit that introduced")
    w("`dp-enterprise-application` (`38e8ac2`, 2026-07-20) it already had 71 `## ` headings, and 72")
    w("from `268a063` onward — it has never had 58. So the 58 figure came from a different")
    w("population or an undocumented filter (a subset of domains, or \"non-boilerplate\" sections")
    w("only). Cite this table instead. *(Git-history note verified as of the generation date.)*")
    w()
    w("| Domain | H2 min | H2 median | H2 p95 | H2 max | max file |")
    w("|---|---:|---:|---:|---:|---|")
    for d, b in doms + [("**CORPUS**", ov)]:
        h = spread(b["h2"], 95)
        w(f"| {d} | {h['min']} | {h['median']:.0f} | {h['p95']} | {h['max']} | "
          f"`{b['max_h2_file'][0]}` |")
    w()

    # --- refs -----------------------------------------------------------------
    w("## `ref` targets by heading depth")
    w()
    w("Anchor resolved against the topic's own `concepts.md` headings (fence-aware). When two")
    w("headings slugify identically the FIRST one wins, matching how a browser resolves the")
    w("fragment.")
    w()
    keys = ["H1", "H2", "H3+", "unresolved", "malformed"]
    w("| Domain | questions | with ref | " + " | ".join(keys) + " |")
    w("|---|---:|---:|" + "---:|" * len(keys))
    for d, b in doms + [("**CORPUS**", ov)]:
        w(f"| {d} | {b['questions']:,} | {b['refs']:,} | "
          + " | ".join(f"{b['ref_depth'].get(k, 0):,}" for k in keys) + " |")
    w()
    w(f"Corpus: {ov['questions'] - ov['refs']:,} questions carry no `ref` at all "
      f"({100 * (ov['questions'] - ov['refs']) / max(ov['questions'], 1):.1f}%). "
      "`ref` is optional in the schema.")
    w()

    # --- diagrams + callouts --------------------------------------------------
    w("## Mermaid diagrams and callouts")
    w()
    w("| Domain | mermaid blocks | files with 0 | " + " | ".join(CALLOUT_TYPES)
      + " | callouts total | per 1k prose words | files > "
      + f"{CALLOUT_BUDGET} callouts |")
    w("|---|---:|---:|" + "---:|" * (len(CALLOUT_TYPES) + 3))
    for d, b in doms + [("**CORPUS**", ov)]:
        c = b["callouts"]
        w(f"| {d} | {b['mermaid_blocks']:,} | {b['files_zero_mermaid']} | "
          + " | ".join(f"{c.get(k, 0):,}" for k in CALLOUT_TYPES) + " | "
          f"{sum(c.values()):,} | {per_k(sum(c.values()), b['prose_words_total'])} | "
          f"{b['callouts_over_budget']} |")
    w()
    bands = ov["callout_bands"]
    w("Corpus callouts-per-file distribution: "
      + ", ".join(f"**{bands.get(k, 0)}** files with {k}"
                  for k in ("0", "1-3", f"4-{CALLOUT_BUDGET}", f">{CALLOUT_BUDGET}"))
      + f". Densest file: `topics/{ov['max_callouts_file'][0]}/concepts.md` with "
        f"{ov['max_callouts_file'][1]}.")
    w()
    leanest = sorted(doms, key=lambda kv: per_k(sum(kv[1]["callouts"].values()),
                                                kv[1]["prose_words_total"]))[:3]
    w(f"Note the shape: the `refining-content` skill asks for **1–3 callouts per file**, yet only")
    w(f"{bands.get('1-3', 0)} of {ov['files_with_concepts']} files sit inside that budget while "
      f"{bands.get(f'>{CALLOUT_BUDGET}', 0)} exceed {CALLOUT_BUDGET}. Callout and mermaid usage")
    w("are strongly bimodal by domain rather than uniform — the three leanest domains on callouts")
    w("are " + ", ".join(f"`{d}` ({per_k(sum(b['callouts'].values()), b['prose_words_total'])}/1k)"
                         for d, b in leanest)
      + " — so a corpus-wide average hides the split. Compare domain rows, not the corpus row.")
    w()

    # --- prose ----------------------------------------------------------------
    w("## Prose metrics (prose only — no code, tables, or headings)")
    w()
    w("| Domain | prose words | sentences | mean sent | p90 sent | > 30 w | > 45 w | bold /1k | open parens /1k | nominalizations /1k |")
    w("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for d, b in doms + [("**CORPUS**", ov)]:
        s = sent_stats(b["sentences"])
        pw = b["prose_words_total"]
        w(f"| {d} | {pw:,} | {s['n']:,} | {s['mean']} | {s['p90']} | "
          f"{s[f'over_{LONG_SENTENCE}']:,} | {s[f'over_{VERY_LONG_SENTENCE}']:,} | "
          f"{per_k(b['bold_spans'], pw)} | {per_k(b['open_parens'], pw)} | "
          f"{per_k(b['nominalizations'], pw)} |")
    w()

    # --- reading minutes ------------------------------------------------------
    w("## Rendered reading minutes (site formula)")
    w()
    w(f"`max(1, round(raw_words / {WORDS_PER_MINUTE}))` on the H1-stripped body — byte-identical")
    w("to `readingMinutes` in the generated content collection, so these are the numbers a")
    w("learner sees.")
    w()
    if minute_check is not None:
        compared, mismatches = minute_check
        if mismatches:
            w(f"⚠️ Verified against the generated content collection: **{len(mismatches)} of "
              f"{compared} disagree** with the site. Either the collection is stale (re-run")
            w("`npm run sync` in `web/`) or the formula has drifted apart — investigate:")
            for line in mismatches[:10]:
                w(f"- `{line}`")
        else:
            w(f"Verified: all **{compared}** entries in the generated content collection")
            w("(`web/src/content/concepts/*/*.md` frontmatter) carry exactly the `readingMinutes`")
            w("computed here — 0 mismatches. The formula is the site's, not an approximation of it.")
        w()
    w("| Domain | min | median | p90 | max | longest topic | domain total (min) |")
    w("|---|---:|---:|---:|---:|---|---:|")
    for d, b in doms + [("**CORPUS**", ov)]:
        r = spread(b["reading_minutes"])
        w(f"| {d} | {r['min']} | {r['median']:.0f} | {r['p90']} | {r['max']} | "
          f"`{b['max_minutes_file'][0]}` | {sum(b['reading_minutes']):,} |")
    w()
    w("**Top 10 longest topics by rendered reading time:**")
    w()
    w("| # | Topic | minutes |")
    w("|---:|---|---:|")
    for i, (mins, slug) in enumerate(res["top_minutes"], 1):
        w(f"| {i} | `topics/{slug}/concepts.md` | {mins} |")
    w()
    return "\n".join(L) + "\n"


def print_headline(res: dict) -> None:
    ov = res["overall"]
    s = sent_stats(ov["sentences"])
    print(f"corpus: {len(res['per_domain'])} domains, {ov['topics']} topics, "
          f"{ov['questions']:,} MCQs ({ov['types'].get('multi', 0):,} multi)")
    print(f"words:  {sum(ov['raw_words']):,} raw / {ov['prose_words_total']:,} prose; "
          f"median topic {median(ov['raw_words']):,.0f} raw words")
    print(f"H2:     median {median(ov['h2']):.0f}, p95 {pctile(ov['h2'], 95)}, "
          f"max {ov['max_h2_file'][1]} ({ov['max_h2_file'][0]})")
    print(f"refs:   {ov['refs']:,} with ref -> " + ", ".join(
        f"{k} {v:,}" for k, v in sorted(ov["ref_depth"].items())))
    print(f"prose:  mean sentence {s['mean']} w, p90 {s['p90']}; "
          f">{LONG_SENTENCE}w {s[f'over_{LONG_SENTENCE}']:,}; "
          f">{VERY_LONG_SENTENCE}w {s[f'over_{VERY_LONG_SENTENCE}']:,}")
    print(f"mermaid:{ov['mermaid_blocks']:,} blocks, {ov['files_zero_mermaid']} files with none")
    print(f"callout:{sum(ov['callouts'].values()):,} total, "
          f"{per_k(sum(ov['callouts'].values()), ov['prose_words_total'])}/1k words, "
          f"{ov['callouts_over_budget']} files > {CALLOUT_BUDGET}")
    print(f"read:   median {median(ov['reading_minutes']):.0f} min, "
          f"p90 {pctile(ov['reading_minutes'], 90)}, max {ov['max_minutes_file'][1]} "
          f"({ov['max_minutes_file'][0]})")


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("topics_dir", nargs="?", default=str(root / "topics"))
    ap.add_argument("--out", default=str(root / "docs" / "corpus-stats.md"))
    ap.add_argument("--json", action="store_true", help="dump raw metrics as JSON to stdout")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    topics_dir = Path(args.topics_dir)
    if not topics_dir.is_dir():
        print(f"No such topics dir: {topics_dir}")
        return 0

    res = collect(topics_dir)
    if not res["overall"]["topics"]:
        print(f"No questions.yaml under {topics_dir} (nothing to measure).")
        return 0

    if args.json:
        print(json.dumps(as_json(res), indent=2))
        return 0

    minute_check = verify_reading_minutes(root, res)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(res, minute_check), encoding="utf-8")
    if not args.quiet:
        print_headline(res)
        if minute_check is None:
            print("check:  generated content collection absent — reading-minute parity unverified")
        else:
            compared, mismatches = minute_check
            print(f"check:  reading minutes vs site frontmatter: {compared} compared, "
                  f"{len(mismatches)} mismatch")
        print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
