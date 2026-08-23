#!/usr/bin/env python3
"""prose.py — the ONE normative tokenizer for this corpus. Import it; never re-roll it.

`scripts/corpus_stats.py` and `scripts/clarity_report.py` both import this module, so
the number a rule is written against and the number a report prints cannot drift apart.
Before this module existed, three documents in the clarity effort reported three different
values for the same file (mean sentence length 20.6 / 19.2 / 16.4; nominalization density
42.2 / 39.1 / 24.1 per 1,000 words) purely because each rolled its own splitter. **If you
need a prose number, add it here and import it. A second tokenizer is a bug.**

Public API
----------
    scan(text)               -> Document   (blocks, headings, callouts; the raw scan)
    iter_prose_blocks(text)  -> Iterator[ProseBlock]
    sentences(text)          -> list[Sentence]
    words(text)              -> list[str]  (prose words, in document order)
    metrics(text)            -> dict       (the flat metric set corpus_stats.md is built from)
    slugify_heading(text)    -> str        (github-slugger compatible)
    reading_minutes(text)    -> int        (the site's own formula, WORDS_PER_MINUTE below)

=============================================================================
TOKENIZER CONTRACT (authoritative; restated verbatim in docs/corpus-stats.md)
=============================================================================

The scan is BLOCK-AWARE, one pass over lines. It is not a regex over the whole file,
because that produces two specific, already-observed lies: an identifier containing a
period ends a sentence, and four bullets get concatenated into one 42-word "sentence".

1. FENCES. A line matching `^\\s*(`{3,}|~{3,})(.*)$` opens a fenced block, remembering
   the char and run length. The block closes on a line whose marker uses the SAME char,
   is at least as long, and carries no info string. Fence marker lines and everything
   between them are CODE: never prose, never headings. So `# comment` inside a
   Dockerfile sample is not an H1, and ```` ```` ```` nests inside ``` correctly.

2. HEADINGS. Outside fences, `^(#{1,6})(?:[ \\t]+(.*))?$`. Anchor slug = lowercase, drop
   everything except word chars / whitespace / hyphen, then map each single whitespace
   char to one hyphen WITHOUT collapsing runs (mirrors github-slugger, so `SQL & NoSQL`
   -> `sql--nosql`). Heading lines are excluded from prose.

3. PROSE vs NON-PROSE. Prose is every line outside fences except: heading lines, table
   rows (`^\\s*\\|`), thematic breaks (`^\\s*([-*_])\\1{2,}\\s*$`), and whole-line HTML
   comments. Blockquote `>` markers and list markers (`-`, `*`, `+`, `1.`, `1)`) are
   stripped from the line start; a callout marker (`[!TIP]`, `[!WARNING]`,
   `[!INTERVIEW]`, `[!KEY-TAKEAWAY]`) is counted and removed. Mermaid diagrams live in
   fences, so they are CODE, not prose. **Tables are NOT prose** — this corpus teaches
   heavily through comparison tables, so `prose_words` understates what a learner reads,
   and a table-dense file looks shorter in prose metrics than it reads. That is a
   deliberate, non-neutral choice; know it before writing a threshold.

4. BLOCK BOUNDARIES (this is the anti-lie rule). A new block starts at a blank line, a
   list item, a blockquote line, a heading, a table row, or a thematic break;
   continuation lines join with a single space. **Every one of those boundaries also ENDS
   a sentence**, so an unterminated bullet is exactly one sentence and a four-item list
   is four sentences, never one 42-word monster. A consequence worth stating out loud
   (SKILL.md C6 states it too): converting an inline enumeration INTO a list raises p90
   sentence length. That rise is an artefact of this rule, not a regression.

5. NORMALIZATION, in this order, per block:
     images `![alt](url)`   -> removed
     links  `[text](url)`   -> `text`
     inline code `` `x` ``  -> ONE opaque token, whatever is inside it
     bold spans             -> counted, then `**`/`__`/`*`/`_`/`~~` removed
   Open-paren and word counts are taken AFTER this, so parens, periods and words inside
   code spans and link URLs never inflate prose metrics. An inline code span is one word
   however many spaces it contains, and **an identifier's internal period can never end
   a sentence.**

6. WORDS. Whitespace split of the normalized block; a token is a WORD only if it
   contains at least one `[A-Za-z0-9]`. So a bare `—` is not a word (it is kept in the
   token stream, and therefore in Sentence.text, but it is not counted). `prose_words`
   is the denominator of every "per 1,000 words" figure in this repo.

7. SENTENCES. Within a block, a sentence ends at a word-final `.`/`!`/`?` (trailing
   quotes/brackets allowed), EXCEPT when the token is a known abbreviation (`e.g.`,
   `i.e.`, `etc.`, `vs.`, `cf.`, `approx.`, `al.`, `Fig.`, `No.`, `Inc.`, `Dr.`, `Mr.`,
   `Ms.`, `Mrs.`, `St.`, `Jr.`, `Sr.`, `ca.`, `resp.`, `ex.`) or a single-letter initial
   (`A.`), and except when the period sits inside a code span (rule 5) or inside a
   decimal number (`99.9` does not end in `.`, so it never terminates). Block end always
   ends a sentence (rule 4). **Sentences of fewer than MIN_SENTENCE_WORDS (3) words are
   DISCARDED as fragments** — table leftovers, run-in labels, one-word bullets. They do
   not enter the mean, the p90, or the over-30 / over-45 counts. So a file written in
   clipped fragments scores a HIGHER mean sentence length here than a naive splitter
   would give it.

8. NOMINALIZATIONS. A prose word, lowercased and stripped to `[a-z]`, length >= 5,
   ending in `tion`, `ment`, `ance`, `ence`, or `ity` with an optional plural `s`.
   Reported per 1,000 prose words. **Code tokens are excluded**: `@Configuration`,
   `Environment` and `LazyInitializationException` are API names, not bureaucratic
   nouns, and counting them added 3,863 spurious hits corpus-wide (+2.13 per 1,000
   words, and +9.8 on `spring-core`) the one time this module tried it. SKILL.md's
   non-goals protect those names verbatim, so a metric that penalises them measures the
   wrong thing. CAVEAT even after that: a pure suffix heuristic, so it still catches
   innocent English ("sentence", "instance", "difference", "quality"). Use it as a
   RELATIVE density signal between files and domains, never as an absolute count.

9. RAW WORDS AND READING MINUTES. Separate from prose words: `raw_words` is the whole
   file whitespace-split (code, tables and headings included), which is what the SITE
   counts. Reading minutes replicate `web/scripts/sync-content.mjs` exactly — strip a
   leading `# H1` line, `trim()`, split on whitespace, drop empties, then
   `max(1, round(words / 200))` with WORDS_PER_MINUTE = 200 and JS-style half-up
   rounding (`floor(x + 0.5)`) — so the figure equals the `readingMinutes` a reader sees.

10. PERCENTILES (helpers here, used by both reports). `median` is conventional (mean of
    the two middle values for an even count). `pctile` is NEAREST-RANK on the ascending
    sorted values: `index = ceil(p/100 * n) - 1`, clamped. No interpolation, so every
    percentile printed is a value that actually occurs.
"""
from __future__ import annotations

import math
import re
import statistics
from collections import Counter
from typing import Iterator, NamedTuple

# --- Constants downstream rules are allowed to cite ---------------------------

WORDS_PER_MINUTE = 200  # MUST match web/scripts/sync-content.mjs
MIN_SENTENCE_WORDS = 3  # shorter "sentences" are fragments, not prose
LONG_SENTENCE = 30
VERY_LONG_SENTENCE = 45

CALLOUT_TYPES = ("TIP", "WARNING", "INTERVIEW", "KEY-TAKEAWAY")

# --- Regexes (see the tokenizer contract above) -------------------------------

FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")
HEADING_RE = re.compile(r"^(#{1,6})(?:[ \t]+(.*))?$")
TABLE_RE = re.compile(r"^\s*\|")
BREAK_RE = re.compile(r"^\s*([-*_])\1{2,}\s*$")
COMMENT_RE = re.compile(r"^\s*<!--.*-->\s*$")
LIST_RE = re.compile(r"^([-*+]|\d+[.)])[ \t]+")
CALLOUT_RE = re.compile(r"^\[!(" + "|".join(map(re.escape, CALLOUT_TYPES)) + r")\]")
IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
CODE_SPAN_RE = re.compile(r"`[^`]*`")
BOLD_RE = re.compile(r"\*\*[^*]+\*\*|__[^_]+__")
EMPHASIS_RE = re.compile(r"\*\*|__|~~|[*_]")
WORDISH_RE = re.compile(r"[A-Za-z0-9]")
NOMINAL_RE = re.compile(r"(tion|ment|ance|ence|ity)s?$")
H1_STRIP_RE = re.compile(r"^﻿?#\s+.+?\r?\n")

ABBREV = frozenset({
    "e.g.", "i.e.", "etc.", "vs.", "cf.", "approx.", "al.", "fig.", "no.",
    "inc.", "dr.", "mr.", "ms.", "mrs.", "st.", "jr.", "sr.", "ca.", "resp.",
    "ex.",
})

# Sentinel for an inline code span: one opaque token, no spaces, wordish (it contains
# `c` and digits), and free of `*`/`_` so emphasis stripping cannot touch it. The spaces
# around it are load-bearing: they reproduce the historical `" code "` substitution
# exactly, which is what keeps `prose_words` and the sentence split byte-identical to the
# numbers already published in docs/corpus-stats.md.
_CODE_SENTINEL = "\x00c%d\x00"
_CODE_SENTINEL_RE = re.compile(r"\x00c(\d+)\x00")


# --- Small stats helpers (shared so both reports percentile identically) -------


def pctile(values, p: float):
    """Nearest-rank percentile (no interpolation). Contract §10."""
    if not values:
        return 0
    s = sorted(values)
    i = math.ceil(p / 100 * len(s)) - 1
    return s[min(max(i, 0), len(s) - 1)]


def median(values):
    return statistics.median(values) if values else 0


def per_k(count: int, words: int) -> float:
    """`count` per 1,000 prose words, 2dp. 0.0 when there is no prose."""
    return round(1000 * count / words, 2) if words else 0.0


def js_round(x: float) -> int:
    """JS Math.round: half away from zero upward (Python's round() is banker's)."""
    return math.floor(x + 0.5)


def slugify_heading(text: str) -> str:
    """github-slugger-compatible anchor slug; whitespace runs are NOT collapsed."""
    text = text.strip().lower()
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"\s", "-", text)


# --- Types --------------------------------------------------------------------


class Heading(NamedTuple):
    """One ATX heading, with its 1-based source line."""

    level: int
    text: str
    line: int
    slug: str


class Token(NamedTuple):
    """One whitespace-delimited token of a normalized prose block.

    `kind` is `code` for an inline code span (and then `text` is what was between the
    backticks, verbatim), else `word`. `wordish` is False for tokens carrying no
    `[A-Za-z0-9]` at all (a bare em-dash, a stray `.`); those are kept so sentence text
    stays readable, but they are not counted as words and cannot end a sentence.
    """

    text: str
    kind: str
    wordish: bool


class ProseBlock(NamedTuple):
    """One prose block: a paragraph, a list item, a blockquote line, or a heading-less run.

    `raw` is the source text with blockquote/list/callout markers stripped and
    continuation lines joined by one space — the string to grep when you need what the
    author actually typed (backticks intact). `norm` is `raw` after contract §5.
    `heading_idx` indexes into `Document.headings` (-1 before the first heading), which
    is how a caller slices a section without re-parsing.
    """

    line: int
    raw: str
    norm: str
    tokens: tuple
    heading_idx: int
    callout: str
    in_blockquote: bool
    list_item: bool
    bold_spans: int
    open_parens: int


class Sentence(NamedTuple):
    """One sentence, already length-filtered by contract §7 unless you ask otherwise."""

    text: str
    n_words: int
    line: int
    block_idx: int
    heading_idx: int
    tokens: tuple


class Fence(NamedTuple):
    start: int
    end: int
    info: str
    heading_idx: int


class TableRow(NamedTuple):
    line: int
    text: str
    heading_idx: int


class CalloutMark(NamedTuple):
    """One `> [!TYPE]` marker line, with the heading it sits under.

    Needed separately from the `callouts` Counter because S9's secondary cap is per-H2.
    The marker line itself yields no prose block (its body is empty after the marker is
    removed), so a per-section count cannot be recovered from the blocks alone.
    """

    line: int
    type: str
    heading_idx: int


class Document(NamedTuple):
    """The whole fence-aware scan of one Markdown file."""

    lines: tuple
    headings: tuple
    prose_blocks: tuple
    fences: tuple
    table_rows: tuple
    callouts: Counter
    callout_marks: tuple
    raw_words: int
    naive_headings: int
    naive_h2: int


# --- Normalization ------------------------------------------------------------


def _normalize(raw: str):
    """Contract §5 + §6. Returns (norm_string, tokens, bold_spans, open_parens).

    The operation order here is load-bearing and must not be "tidied": it reproduces the
    published corpus numbers exactly.
    """
    s = IMAGE_RE.sub(" ", raw)
    s = LINK_RE.sub(r"\1", s)

    spans: list = []

    def _stash(m):
        spans.append(m.group(0)[1:-1])
        return " " + (_CODE_SENTINEL % (len(spans) - 1)) + " "

    s = CODE_SPAN_RE.sub(_stash, s)
    bold_spans = len(BOLD_RE.findall(s))
    open_parens = s.count("(")
    s = EMPHASIS_RE.sub("", s)

    tokens = []
    for tok in s.split():
        m = _CODE_SENTINEL_RE.fullmatch(tok)
        if m:
            tokens.append(Token(spans[int(m.group(1))], "code", True))
        else:
            tokens.append(Token(tok, "word", bool(WORDISH_RE.search(tok))))
    return s, tuple(tokens), bold_spans, open_parens


def token_text(tokens) -> str:
    """Reconstruct readable text from a token stream (code spans re-backticked)."""
    return " ".join("`%s`" % t.text if t.kind == "code" else t.text for t in tokens)


# --- The one scan -------------------------------------------------------------


def scan(text: str) -> Document:
    """One fence-aware pass. Everything else in this module is derived from this."""
    lines = text.splitlines()

    headings: list = []
    prose: list = []
    fences: list = []
    table_rows: list = []
    callouts: Counter = Counter()
    callout_marks: list = []

    # Control measurement: how many lines LOOK like headings if you ignore fences. The
    # gap is the "phantom heading" count that non-fence-aware tooling reports.
    naive_headings = sum(1 for ln in lines if HEADING_RE.match(ln))
    naive_h2 = sum(1 for ln in lines if (hm := HEADING_RE.match(ln)) and len(hm.group(1)) == 2)

    buf: list = []
    buf_line = 0
    buf_meta = {"callout": "", "quote": False, "list": False}

    def flush() -> None:
        if buf:
            raw = " ".join(buf)
            norm, tokens, bold, parens = _normalize(raw)
            prose.append(ProseBlock(
                line=buf_line, raw=raw, norm=norm, tokens=tokens,
                heading_idx=len(headings) - 1, callout=buf_meta["callout"],
                in_blockquote=buf_meta["quote"], list_item=buf_meta["list"],
                bold_spans=bold, open_parens=parens,
            ))
            buf.clear()
        buf_meta.update(callout="", quote=False, list=False)

    fence_char, fence_len, fence_start, fence_info = "", 0, 0, ""
    for lineno, line in enumerate(lines, 1):
        fence = FENCE_RE.match(line)
        if fence:
            marker, info = fence.group(1), fence.group(2)
            if not fence_char:
                fence_char, fence_len = marker[0], len(marker)
                fence_start, fence_info = lineno, info.strip()
                flush()
                continue
            if marker[0] == fence_char and len(marker) >= fence_len and not info.strip():
                fences.append(Fence(fence_start, lineno, fence_info, len(headings) - 1))
                fence_char, fence_len = "", 0
                continue
        if fence_char:
            continue  # inside a fence: code, not prose and not headings

        m = HEADING_RE.match(line)
        if m:
            flush()
            htext = (m.group(2) or "").strip()
            headings.append(Heading(len(m.group(1)), htext, lineno, slugify_heading(htext)))
            continue
        if TABLE_RE.match(line):
            flush()
            table_rows.append(TableRow(lineno, line.strip(), len(headings) - 1))
            continue
        if BREAK_RE.match(line) or COMMENT_RE.match(line):
            flush()
            continue

        body = line.strip()
        if not body:
            flush()
            continue

        starts_block = False
        quote = False
        callout = ""
        if body.startswith(">"):
            body = body.lstrip(">").strip()
            starts_block = True
            quote = True
            cal = CALLOUT_RE.match(body)
            if cal:
                callouts[cal.group(1)] += 1
                callout_marks.append(CalloutMark(lineno, cal.group(1), len(headings) - 1))
                callout = cal.group(1)
                body = body[cal.end():].strip()
        lm = LIST_RE.match(body)
        is_list = bool(lm)
        if lm:
            starts_block = True
            body = body[lm.end():]
        if starts_block:
            flush()
        if body:
            if not buf:
                buf_line = lineno
                buf_meta.update(callout=callout, quote=quote, list=is_list)
            elif quote and not buf_meta["quote"]:
                buf_meta["quote"] = True
            buf.append(body)
    flush()

    if fence_char:  # unterminated fence: record it so callers can see the truncation
        fences.append(Fence(fence_start, len(lines), fence_info, len(headings) - 1))

    stripped_body = H1_STRIP_RE.sub("", text, count=1)
    return Document(
        lines=tuple(lines), headings=tuple(headings), prose_blocks=tuple(prose),
        fences=tuple(fences), table_rows=tuple(table_rows), callouts=callouts,
        callout_marks=tuple(callout_marks),
        raw_words=len(stripped_body.strip().split()),
        naive_headings=naive_headings, naive_h2=naive_h2,
    )


# --- Derived views ------------------------------------------------------------


def iter_prose_blocks(text: str) -> Iterator[ProseBlock]:
    """Every prose block of the document, in order (contract §3, §4)."""
    return iter(scan(text).prose_blocks)


def split_block_sentences(tokens):
    """Sentence token-runs within ONE block (contract §7). Fragments NOT yet dropped.

    Iterates the token stream but only ever counts, or terminates on, a wordish token —
    which is what keeps this byte-identical to the historical implementation that
    iterated the wordish-filtered word list.
    """
    out: list = []
    cur: list = []
    for tok in tokens:
        cur.append(tok)
        if not tok.wordish:
            continue
        if tok.kind == "code":
            continue  # a period inside an identifier never ends a sentence
        stripped = tok.text.rstrip("\"')]}»”’")
        if not stripped or stripped[-1] not in ".!?":
            continue
        low = stripped.lower()
        if low in ABBREV:
            continue
        if len(stripped) == 2 and stripped[0].isalpha() and stripped[1] == ".":
            continue  # single-letter initial, e.g. "J. Doe"
        out.append(cur)
        cur = []
    if any(t.wordish for t in cur):
        out.append(cur)
    return out


def block_sentences(doc: Document, block_idx: int, keep_fragments: bool = False):
    """Sentences of one block, length-filtered per contract §7 unless asked otherwise."""
    b = doc.prose_blocks[block_idx]
    out: list = []
    for run in split_block_sentences(b.tokens):
        n = sum(1 for t in run if t.wordish)
        if not keep_fragments and n < MIN_SENTENCE_WORDS:
            continue
        out.append(Sentence(token_text(run), n, b.line, block_idx, b.heading_idx, tuple(run)))
    return out


def sentences(text, keep_fragments: bool = False):
    """Every sentence in the document, in order. `text` may be a str or a Document."""
    doc = text if isinstance(text, Document) else scan(text)
    out: list = []
    for i in range(len(doc.prose_blocks)):
        out.extend(block_sentences(doc, i, keep_fragments))
    return out


def words(text):
    """Every prose word (contract §6), in document order, as plain strings."""
    doc = text if isinstance(text, Document) else scan(text)
    return [t.text for b in doc.prose_blocks for t in b.tokens if t.wordish]


def is_nominalization(word: str) -> bool:
    """Contract §8. Pure suffix heuristic — a relative signal, never an absolute count."""
    bare = re.sub(r"[^a-z]", "", word.lower())
    return len(bare) >= 5 and bool(NOMINAL_RE.search(bare))


def reading_minutes(text: str) -> int:
    """The site's own `readingMinutes` (contract §9), not an approximation of it."""
    raw = len(H1_STRIP_RE.sub("", text, count=1).strip().split())
    return max(1, js_round(raw / WORDS_PER_MINUTE))


def sentence_stats(lengths) -> dict:
    """mean / p90 / over-30 / over-45 for a list of sentence word-counts."""
    return {
        "n": len(lengths),
        "mean": round(sum(lengths) / len(lengths), 1) if lengths else 0,
        "p90": pctile(lengths, 90),
        "over_%d" % LONG_SENTENCE: sum(1 for s in lengths if s > LONG_SENTENCE),
        "over_%d" % VERY_LONG_SENTENCE: sum(1 for s in lengths if s > VERY_LONG_SENTENCE),
    }


def metrics(text) -> dict:
    """The flat metric set `docs/corpus-stats.md` is built from. One file's worth.

    Accepts a str or an already-scanned Document, so a caller that needs both these
    numbers and the block structure pays for one scan, not two.

    Keys are frozen: `corpus_stats.py` consumes them by name, and any renaming would
    silently change a published number.
    """
    doc = text if isinstance(text, Document) else scan(text)
    sent_lengths: list = []
    prose_words = bold = parens = nominal = 0
    for i, b in enumerate(doc.prose_blocks):
        bold += b.bold_spans
        parens += b.open_parens
        for t in b.tokens:
            if t.wordish:
                prose_words += 1
                if t.kind == "word" and is_nominalization(t.text):
                    nominal += 1
        sent_lengths.extend(s.n_words for s in block_sentences(doc, i))

    return {
        "lines": len(doc.lines),
        "raw_words": doc.raw_words,
        "reading_minutes": max(1, js_round(doc.raw_words / WORDS_PER_MINUTE)),
        "h1": sum(1 for h in doc.headings if h.level == 1),
        "h2": sum(1 for h in doc.headings if h.level == 2),
        "headings": len(doc.headings),
        "naive_headings": doc.naive_headings,
        "naive_h2": doc.naive_h2,
        # First heading wins a duplicated slug, matching how a browser resolves the
        # fragment: build the dict in reverse so the earliest entry overwrites later ones.
        "anchors": {h.slug: h.level for h in reversed(doc.headings) if h.slug},
        "mermaid_blocks": sum(1 for f in doc.fences
                              if f.info.lower().split()[:1] == ["mermaid"]),
        "callouts": dict(doc.callouts),
        "callouts_total": sum(doc.callouts.values()),
        "prose_words": prose_words,
        "sentences": sent_lengths,
        "bold_spans": bold,
        "open_parens": parens,
        "nominalizations": nominal,
    }
