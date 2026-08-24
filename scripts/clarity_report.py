#!/usr/bin/env python3
"""clarity_report.py — non-blocking clarity metrics for the clarity rewrite.

The standard is `.claude/skills/clarity-standard/SKILL.md`. This script measures the
metrics that standard names, using ONLY `scripts/prose.py` — the one normative tokenizer.
Three earlier documents in this effort reported three different values for the same file
(mean sentence length 20.6 / 19.2 / 16.4; nominalization density 42.2 / 39.1 / 24.1 per
1,000 words) because each rolled its own splitter, so **every number here is defined by
prose.py's contract and by nothing else.**

    python3 scripts/clarity_report.py [topics_dir] [--domain d] [--file PATH]
                                      [--sections] [--json] [--write-baseline [PATH]]
                                      [--self-test] [--top N]

**Exit code is always 0. This is a report, not a gate.** It adds no CI check and it
cannot fail a build. That is deliberate: a false-positive-heavy hard gate on prose style
gets switched off within a week, and the hard gate this repo already has
(`scripts/validate_content.py`) is reserved for checks with essentially zero false
positives. The binding gate for clarity is human — the REGISTER SWAP in SKILL.md.

WHAT IS FLAGGED, AND WHAT IS ONLY PRINTED
-----------------------------------------
A `FLAG` here means "SKILL.md states an arithmetic or zero-tolerance rule and this file
breaks it". Nothing else gets a verdict, no matter how ugly its number:

  FLAGGED   C8 bold budget (<= 12 spans / 1,000 prose words, and <= 1 per paragraph);
            S9 callout budget (max(1, round(1.2 * prose_words / 1000)), <= 1 per H2);
            the zero-tolerance greps — C10 audience-tier labels, C11 interviewer
            substitution outside `[!INTERVIEW]`, S2 "This topic covers", S7 teaser
            strings, S8's deleted heading, `[!NOTE]`-style unsupported callouts.
  PRINTED   sentence length (SKILL.md: "There is no word-count limit" and length
            reporting is REPORT-ONLY), passive rate, nominalization density, open
            parens, hedges, metaconcepts, metadiscourse, C4 offsets, reading minutes,
            C3 multi-gloss candidates, C5 demonstratives, S1/S6 structure counts.

Sentence length in particular is NOT flagged at any value. Length is not this corpus's
problem (mean 14.9, p90 28), the repo tokenizer counts each list item as a sentence, and
a C7 conversion of an inline enumeration into a list legitimately RAISES p90.

THE DETECTORS, STATED SO THEY CAN BE ARGUED WITH
------------------------------------------------
**C4, the concrete-instance detector (rewritten).** The old detector recognised only
discourse markers ("for example", "consider", "say") and reported 38.2% of sections as
having no concrete instance; 67% of those contained a backticked identifier or a bare
number inside their first 60 words, i.e. exactly the instances C4 asks for, so the figure
was roughly a 3x overstatement and it fired on well-written sections. **That old detector's
source is not in this repo** — it lived in the deleted `/tmp` design docs — so 38.2% is not
reproducible here by construction, and the cross-check table says so instead of pretending.
What IS reproducible is the shape of the finding: 72.2% of the sections a marker-only
detector flags do carry a backticked identifier or a number (the review said 67%).

The corrected detector scans the first `C4_WINDOW` (60) prose words after a heading — with
S5's claim line included, as C4 requires — and accepts ANY of:

    fence      a fenced code block inside the window
    table      a Markdown table row inside the window
    code       an inline code span (a named class, method, field, header, flag, path)
    number     a quantity followed by a unit or a noun ("45% CPU", "3 replicas",
               "60-100 ms"), excluding a stoplist of function words. Two extensions
               the calibration run FORCED, both from SKILL.md's own GOOD passages: a
               spelled cardinal from "two" upward ("twelve stability patterns ... three
               places"), and a rate ("one queue hop per message"). "one"/"a" plus a noun
               alone is deliberately NOT accepted — "one approach to consider" is the
               decorative hit C4 says does not count
    named      a CamelCase identifier, an `@Annotation`, an HTTP verb + path, or a
               3-digit HTTP status code
    marker     a discourse marker ("for example", "suppose", "imagine", "say", ...)

`marker` alone is reported as WEAK, because SKILL.md says a token "for example, in a
distributed system" does not count. Four numbers come out of one pass: the corrected miss
rate over content sections, the same over H2s only, the same including the two boilerplate
tails, and the marker-only reconstruction (a strict LOWER BOUND on what any
discourse-marker detector can find, which is why it reads 97.9%, not 38.2%). The
offset detector is REPORT-ONLY in SKILL.md and stays report-only here; a decorative number
salted in to satisfy the regex is a judgement call no regex can make.

**Passive voice.** Proxy: a form of *be* (`is are was were be been being` and the
contracted negatives), optionally followed by up to two adverbs or negators, then a past
participle — a word ending in `-ed` (>= 4 letters, not in `PARTICIPLE_STOP`) or a member of
`IRREGULAR_PARTICIPLES`. Reported as hits per 100 sentences.

**Measured false-positive rate: 3 clear plus 1 arguable out of a hand-checked random
sample of 40 of the corpus's 12,398 hits — 7.5% to 10%.** The three classes, all from that
sample: a hyphenated compound adjective whose last segment ends in `-ed` ("serverless
functions are finer-grained" -> `are finergrained` after punctuation stripping); a stative
predicate adjective ("the model is broken", "`saveOrUpdate` is deprecated"); and the
arguable case, a participle used as a property rather than an action ("it is optimized for
search"). It also UNDER-counts, which no threshold should ignore: an agentless passive with
an elided *be* ("the value returned by the JIT") is invisible to it, and so is "gets
rewritten". SKILL.md does not ban the passive at all — "Pollen is dispersed by bees" is the
better sentence inside a paragraph about pollen — so this number exists to spot a *change*
between two measurements of the same file, not to be minimised.

**Nominalizations, hedges, metaconcepts.** Nominalizations are prose.py's suffix heuristic
(contract §8) — a relative signal only. Hedges and metaconcepts are C9's two lists,
implemented verbatim, plus C9's five named term-of-art exemptions (SQL *isolation level*,
consistency *model*, threat *model*, Kubernetes *workload*, statistical *variable*), which
are skipped by looking at the preceding word. Per-file exemptions belong in the ledger, not
here.

**Composite clarity index.** One number per file, for ranking only: a weighted mean of
nine burden metrics, each divided by that metric's corpus MEDIAN, so 1.00 means "exactly
median burden on every axis" and 2.00 means "twice the median burden". Weights are in
`INDEX_WEIGHTS` below and are a judgement, not a measurement — the index sorts a work
queue, it never judges a file. Files under `RANK_MIN_PROSE_WORDS` (1,000 prose words) are
excluded from the best/worst lists so a stub cannot win by having no prose.

CALIBRATION (`--self-test`)
---------------------------
Neither `docs/corpus-stats.md` nor SKILL.md nominates named best-written FILES — grep both
for "best" and you get nothing. What SKILL.md does supply is 11 verbatim GOOD passages and
its full AFTER rewrite, plus the matching BAD passages. `--self-test` runs every metric
over both sets: **no flag may fire on a GOOD passage, and the BAD passages must be caught
by the rule they illustrate.** That is the acceptance test for this script. It also runs
the flag set over the corpus's own 10 least-burdened real files, because a threshold that
fires on those is calibrated wrong and should be reported rather than shipped.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prose  # noqa: E402  (path shim must run first)
from prose import (  # noqa: E402
    LONG_SENTENCE,
    VERY_LONG_SENTENCE,
    WORDS_PER_MINUTE,
    median,
    per_k,
)

# --- Thresholds, every one of them from SKILL.md ------------------------------

C4_WINDOW = 60            # C4: "a concrete instance inside the first 60 words"
C2_GLOSS_WINDOW = 25      # C2: gloss marker within 25 words of a term's first use
BOLD_PER_1K_CAP = 12      # C8 primary, BINDING
BOLD_PER_PARAGRAPH = 1    # C8 secondary, BINDING
CALLOUT_PER_1K = 1.2      # S9 primary: max(1, round(1.2 * prose_words / 1000))
CALLOUTS_PER_H2 = 1       # S9 secondary (anti-clustering)
READING_MAP_RAW_WORDS = 3500  # S6, measured on RAW words (not prose words)
SEAM_LINES = 50           # S1: an H2 over ~50 lines needs a content-named H3 seam
RANK_MIN_PROSE_WORDS = 1000

INDEX_WEIGHTS = {
    "pct_sentences_over_30": 1.0,
    "bold_per_1k": 1.0,
    "nominalizations_per_1k": 1.0,
    "c4_miss_rate": 1.0,
    "slot_labels_per_1k": 1.0,
    "hedges_per_1k": 0.5,
    "metaconcepts_per_1k": 0.5,
    "open_parens_per_1k": 0.5,
    "passive_per_100_sentences": 0.5,
}

# --- C9's two lists, verbatim -------------------------------------------------

HEDGES = ("almost", "apparently", "fairly", "generally", "largely", "mostly", "nearly",
          "relatively", "roughly", "somewhat", "typically")
HEDGE_PHRASES = ("tends to", "tend to")

METACONCEPTS = ("approach", "assumption", "concept", "context", "framework", "issue",
                "level", "model", "perspective", "process", "role", "strategy",
                "subject", "tendency", "variable")
# C9's hard exemptions, "never find-and-replaced": keyed by the metaconcept, valued by the
# preceding word that makes it a term of art rather than a container word.
METACONCEPT_EXEMPT = {
    "level": ("isolation", "log"),
    "levels": ("isolation", "log"),
    "model": ("consistency", "threat", "memory"),
    "models": ("consistency", "threat", "memory"),
    "variable": ("statistical", "random", "environment"),
    "variables": ("statistical", "random", "environment"),
}

# --- Metadiscourse: talk about the document instead of the subject -------------

METADISCOURSE = (
    r"this (?:topic|note|section|page|document) (?:covers|is about|explains|discusses|teaches|builds)",
    r"in this (?:topic|note|section|page|document)",
    r"the rest of this (?:topic|note|section|page|document)",
    r"as (?:we|you) (?:have )?(?:seen|discussed|noted|covered)",
    r"as (?:mentioned|noted|described|discussed) (?:above|earlier|below|before)",
    r"we(?:'ll| will) (?:see|cover|look|discuss|come back)",
    r"note that", r"notice that", r"keep in mind", r"bear in mind",
    r"it is (?:worth|important) (?:noting|to note|remembering)",
    r"in other words", r"put differently", r"to summari[sz]e", r"in summary",
    r"recall that", r"as a reminder", r"before we", r"first,? we",
)

# --- The zero-tolerance greps SKILL.md specifies, verbatim --------------------

S2_OPENER_RE = re.compile(
    r"^\s*This (topic|note|section|page|document)\s+"
    r"(covers|is about|explains|discusses|teaches|builds)")
S2_LOOSE_RE = re.compile(r"^\s*This (topic|note|section|page|document)\b")
C11_PROBE_RE = re.compile(r"[Ii]nterviewer(s)?\s+(probe|want|expect)")
C11_IN_INTERVIEW_RE = re.compile(r"in an interview", re.I)
C11_RE = re.compile(
    r"[Ii]nterviewer(s)?\s+(probe|want|expect|ask|love|use|listen)|in an interview|"
    r"the (senior|strong) (probe|signal|answer)|high-signal|[Cc]oncepts you must name|"
    r"The bar is not|come up in interviews|commonly asked|a favourite question|"
    r"worth being able to say out loud")
C10_SLOT_RE = re.compile(r"^\s*(?:[-*]\s+)?\*\*[^*\n]{2,60}[.:]\*\*")
# C10's zero-tolerance audience triple. The trailing group requires PUNCTUATION after the
# audience word, so `**Advanced — reordering sources.**` and `**Beginner.**` are caught
# while a genuine term first use that merely starts with one of the words
# (`**Advanced Message Queuing Protocol**`) is not.
AUDIENCE_RE = re.compile(
    r"\*\*\s*(?:Beginner|Intermediate|Advanced|Expert|Deep dive|Deep-dive)\b"
    r"(?:\s*[—:.,-][^*]{0,60})?\*\*|"
    r"^#{2,6}\s+(?:Beginner|Intermediate|Advanced|Deep dive|Deep-dive)\b", re.M)
# SKILL.md's S7 grep, VERBATIM. It has a serious false-positive problem: `read on` with no
# trailing boundary matches "read only" and "read on demand", and "coming up" is ordinary
# English ("the new Pods coming up"). Every one of the 37 corpus hits sampled by hand was a
# false positive. Implemented as written because the standard says so; the corrected
# variant below is what a gate would have to use.
S7_TEASER_RE = re.compile(
    r"there'?s a catch|read on|we'?ll see|coming up|stay tuned|you'?ll never look at", re.I)
S7_TEASER_STRICT_RE = re.compile(
    r"there'?s a catch|\bread on\s*[.!]|we'?ll see (?:why|how|what|that|in a|later)|"
    r"\bstay tuned|you'?ll never look at|coming up (?:next|in the next)", re.I)
S8_HEADING_RE = re.compile(r"^## (What breaks next|Where this goes next)")
S3_RE = re.compile(r"Boundaries|Cross-references|don't duplicate|do not duplicate")

# C12: the punt shapes — the file handing an explanation to an outside source instead of
# writing the sentence. Reported PER HIT, not as zero tolerance, because the shape has
# honest instances: "traded some testability for brevity" prices a design decision, while
# "pods are out of scope here" is about the document. The corpus baseline is 7 hits in 7
# of 460 files (`## References` excluded), so a spike is a rewrite regression, not a
# pre-existing condition. Keep this pattern byte-identical to SKILL.md's C12 fence.
C12_PUNT_RE = re.compile(
    r"(?i)\b(?:see|refer to|consult|check) the "
    r"(?:docs\b|documentation|official docs|man page|manual\b)"
    r"|for (?:more|further) (?:details|reading|information),? (?:see|refer|consult)"
    r"|(?:beyond|outside) the scope of (?:this|the)"
    r"|out of scope (?:here|for this|in this)"
    r"|not covered (?:here|in this)"
    r"|we (?:won'?t|will not|do not|don'?t) (?:cover|go into|discuss)"
    r"|left as an exercise|the reader is encouraged|we leave (?:this|that|it) to"
    r"|(?:you|just|simply) (?:can |could |should )?look (?:it|this|that) up"
    r"|read more (?:about|on) (?:this|it)"
    r"|for brevity|space (?:does not|doesn'?t) permit|suffice it to say"
    r"|the (?:full|whole) story is|the details are (?:involved|beyond|elsewhere)"
    r"|is well[- ]documented|for the curious")
S3_XREF_RE = re.compile(r"`[a-z0-9-]+/[a-z0-9-]+`")
NOTE_CALLOUT_RE = re.compile(r"^\s*>\s*\[!([A-Za-z-]+)\]")
C5_DEMONSTRATIVES = ("This", "That", "These", "Those", "It")
C5_VERBS = ("is", "are", "means", "gives", "makes", "lets", "allows")

# --- C4 instance detectors ----------------------------------------------------

NUMBER_NOUN_RE = re.compile(
    r"(?<![\w.])\d[\d,._]*\s*(%|[A-Za-z][\w/-]*)")
NUMBER_STOP = frozenset("""
and or to of the a an in on at is are was were for with but if then than per as by from
that which when while so not no do does did have has had will would can could may might
""".split())
UNITS = frozenset("""
ms us ns s sec secs second seconds min mins minute minutes h hr hrs hour hours day days
week weeks month months year years b kb mb gb tb kib mib gib pb bit bits byte bytes
rps qps tps iops ops eps mbps gbps kbps hz khz mhz ghz cpu cores core thread threads
node nodes replica replicas shard shards partition partitions connection connections
request requests row rows column columns instance instances pod pods container containers
user users key keys byte writes reads calls retries hops queries records messages events
x times percent bp cents usd eur
""".split())
CAMEL_RE = re.compile(r"\b[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+\b")
ANNOTATION_RE = re.compile(r"@[A-Z][A-Za-z0-9]+")
HTTP_RE = re.compile(r"\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/|\b[1-5]\d\d\b")
MARKER_RE = re.compile(
    r"\b(for example|for instance|e\.g\.|say(?:,| that)|suppose|imagine|consider|"
    r"picture|take the case|here is|here's|concretely|in practice)\b", re.I)
LEGACY_MARKER_RE = MARKER_RE  # the old detector, kept so both numbers come from one pass


# Spelled-out cardinals count as C4 quantities from TWO upward. "one" and "a" are
# deliberately excluded: "one approach to consider" would otherwise register as a
# concrete instance, which is exactly the decorative hit C4 says does not count. The
# calibration run needed this extension — SKILL.md's own C7 GOOD passage ("Nygard's
# twelve stability patterns ... only three places to put it") carries no digit at all.
CARDINAL_RE = re.compile(
    r"\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|twenty|"
    r"thirty|forty|fifty|hundred|thousand|million)\s+([A-Za-z][\w-]*)", re.I)
# A rate IS a number with a unit: "one queue hop per message", "3 retries per request".
# This is the second extension the calibration run forced, from C10's GOOD passage.
RATE_RE = re.compile(r"\b(?:a|one|\d[\d,._]*|two|three|four|five)\s+"
                     r"(?:[\w-]+\s+){0,2}per\s+[\w-]+", re.I)


def number_with_noun(text: str) -> bool:
    """C4 `number`: a quantity followed by a unit or a noun, not a function word.

    Accepts a digit run, a spelled cardinal >= two, or a rate ("X per Y").
    """
    for m in NUMBER_NOUN_RE.finditer(text):
        tail = m.group(1).lower().strip("/-")
        if tail == "%" or tail in UNITS:
            return True
        if tail and tail not in NUMBER_STOP and not tail.isdigit():
            return True
    for m in CARDINAL_RE.finditer(text):
        if m.group(2).lower().strip("/-") not in NUMBER_STOP:
            return True
    return bool(RATE_RE.search(text))


# --- Passive voice ------------------------------------------------------------

BE_FORMS = frozenset("""
is are was were be been being isn't aren't wasn't weren't
""".split())
ADVERBIAL = frozenset("""
not never also already often usually then only still now thus always sometimes
generally typically largely mostly nearly fully partially simply merely therefore
""".split())
IRREGULAR_PARTICIPLES = frozenset("""
done gone seen given taken made held kept sent built written driven known shown thrown
put set read left lost found told meant bound drawn torn broken chosen frozen hidden
spent split spread cast cut hit run begun become forgotten gotten got brought bought
caught taught sought fought dealt felt led fed said paid laid sold stood understood
withheld overwritten rewritten thrown flown grown blown swept swung struck stuck
sung sunk drunk shrunk woken worn wound rebuilt reset overridden undone redone
""".split())
# `-ed` words that are almost always predicate adjectives after `be`; excluding them is
# what takes the hand-checked false-positive rate from ~18% to ~10%.
PARTICIPLE_STOP = frozenset("""
tired interested excited pleased worried scared bored complicated sophisticated
detailed talented dedicated aged red bed fed led wed sacred hundred
""".split())


def _bare(tok: str) -> str:
    return re.sub(r"[^A-Za-z']", "", tok).lower()


def is_participle(word: str) -> bool:
    if word in PARTICIPLE_STOP:
        return False
    if word in IRREGULAR_PARTICIPLES:
        return True
    return len(word) >= 4 and word.endswith("ed")


def passive_hits(tokens) -> int:
    """Count be + (adverb){0,2} + past participle in one sentence's token stream."""
    ws = [_bare(t.text) for t in tokens if t.kind == "word" and t.wordish]
    hits = 0
    for i, w in enumerate(ws):
        if w not in BE_FORMS:
            continue
        for j in range(i + 1, min(i + 4, len(ws))):
            nxt = ws[j]
            if is_participle(nxt):
                hits += 1
                break
            if nxt not in ADVERBIAL:
                break
    return hits


# ==============================================================================
# Per-file measurement
# ==============================================================================


class Section:
    """One heading and the body that belongs to it, sliced from a prose.Document."""

    def __init__(self, doc, idx: int):
        h = doc.headings[idx]
        nxt = doc.headings[idx + 1].line if idx + 1 < len(doc.headings) else len(doc.lines) + 1
        self.level, self.text, self.slug, self.line = h.level, h.text, h.slug, h.line
        self.end_line = nxt - 1
        self.lines = self.end_line - self.line + 1
        self.blocks = [b for b in doc.prose_blocks if b.heading_idx == idx]
        self.fences = [f for f in doc.fences if f.heading_idx == idx]
        self.tables = [t for t in doc.table_rows if t.heading_idx == idx]
        self.callouts = [c for c in doc.callout_marks if c.heading_idx == idx]
        self.paragraphs = [b for b in self.blocks
                           if not b.list_item and not b.in_blockquote]
        self.prose_words = sum(1 for b in self.blocks for t in b.tokens if t.wordish)

    @property
    def is_tail(self) -> bool:
        """`## References` / `## Common follow-up questions` — boilerplate tails.

        SKILL.md exempts them from S7 and from prompt instrumentation. C4 does not
        formally exempt them, but a References list has no case to open, so counting them
        in the headline miss rate would import a fixed ~2 misses per file. Both numbers
        are reported.
        """
        s = self.slug
        return s.startswith("references") or "follow-up" in s or "followup" in s


def c4_scan(sec: Section):
    """First concrete instance inside C4's 60-word window. See the module docstring.

    Returns (offset_words | None, signals, legacy_hit). `offset_words` is the 1-based
    prose-word index at which the first accepted signal appears; None means the window
    closed without one. A fence or table opening inside the window counts at the word
    count reached when it opens, which is why they are interleaved by line here.
    """
    items = []
    for b in sec.blocks:
        items.append((b.line, "block", b))
    for f in sec.fences:
        items.append((f.start, "fence", f))
    for t in sec.tables:
        items.append((t.line, "table", t))
    items.sort(key=lambda it: it[0])

    seen = 0
    signals = set()
    offset = None
    legacy = False
    window_text: list = []

    def note(sig: str, at: int) -> None:
        nonlocal offset
        signals.add(sig)
        if sig == "marker":
            return
        if offset is None:
            offset = at

    for _, kind, obj in items:
        if seen >= C4_WINDOW:
            break
        if kind in ("fence", "table"):
            note(kind, max(seen, 1))
            continue
        toks = list(obj.tokens)
        for i, tok in enumerate(toks):
            if not tok.wordish:
                continue
            seen += 1
            if seen > C4_WINDOW:
                break
            window_text.append(tok.text)
            if tok.kind == "code":
                note("code", seen)
                continue
            ahead = " ".join(t.text for t in toks[i:i + 5])
            if CAMEL_RE.search(tok.text) or ANNOTATION_RE.search(tok.text):
                note("named", seen)
            elif HTTP_RE.search(ahead[:40]):
                note("named", seen)
            elif (any(ch.isdigit() for ch in tok.text)
                    or CARDINAL_RE.match(ahead) or RATE_RE.match(ahead)) \
                    and number_with_noun(ahead):
                note("number", seen)
        if seen >= C4_WINDOW:
            break

    joined = " ".join(window_text)
    if LEGACY_MARKER_RE.search(joined):
        legacy = True
        signals.add("marker")
    return offset, signals, legacy


def grep_lines(doc):
    """Source lines outside fences, as (lineno, text, callout_type_in_force)."""
    fenced = set()
    for f in doc.fences:
        fenced.update(range(f.start, f.end + 1))
    out = []
    current = ""
    for n, line in enumerate(doc.lines, 1):
        if n in fenced:
            continue
        s = line.strip()
        if s.startswith(">"):
            m = NOTE_CALLOUT_RE.match(line)
            if m:
                current = m.group(1)
        elif s:
            current = ""
        out.append((n, line, current))
    return out


def measure_file(path: Path, text: str) -> dict:
    """Every clarity metric for one concepts.md. Pure function of the text."""
    doc = prose.scan(text)
    base = prose.metrics(doc)
    sections = [Section(doc, i) for i in range(len(doc.headings))]
    sents = prose.sentences(doc)
    lengths = [s.n_words for s in sents]
    pw = base["prose_words"]

    # --- sentence shape -------------------------------------------------------
    sstats = prose.sentence_stats(lengths)

    # --- passive, hedges, metaconcepts, metadiscourse -------------------------
    passive = sum(passive_hits(s.tokens) for s in sents)
    body_words = [_bare(t.text) for b in doc.prose_blocks for t in b.tokens
                  if t.kind == "word" and t.wordish]
    hedges = sum(1 for w in body_words if w in HEDGES)
    lowered = " ".join(body_words)
    for phr in HEDGE_PHRASES:
        hedges += lowered.count(phr)
    meta = 0
    for i, w in enumerate(body_words):
        if w not in METACONCEPTS and w.rstrip("s") not in METACONCEPTS:
            continue
        prev = body_words[i - 1] if i else ""
        if prev in METACONCEPT_EXEMPT.get(w, ()):
            continue
        meta += 1
    metadiscourse = Counter()
    for pat in METADISCOURSE:
        n = len(re.findall(pat, lowered))
        if n:
            metadiscourse[pat] += n

    # --- C3 / C5 --------------------------------------------------------------
    c3 = sum(1 for s in sents
             if s.text.count("(") >= 2 or s.text.count("—") >= 4)
    # C5 is CASE-SENSITIVE on purpose: the standard's regex matches `This|That|These|
    # Those|It`, i.e. a sentence opener, not the same word mid-sentence.
    c5 = c5_verb = 0
    for s in sents:
        ws = [re.sub(r"[^A-Za-z']", "", t.text) for t in s.tokens if t.wordish]
        ws = [x for x in ws if x]
        if ws and ws[0] in C5_DEMONSTRATIVES:
            c5 += 1
            if len(ws) > 1 and ws[1] in C5_VERBS:
                c5_verb += 1

    # --- C8 bold ---------------------------------------------------------------
    bold_terms: Counter = Counter()
    for b in doc.prose_blocks:
        for m in prose.BOLD_RE.finditer(b.raw):
            term = re.sub(r"[^a-z0-9 ]", "", m.group(0).strip("*_").lower()).strip()
            if term:
                bold_terms[term] += 1
    paragraphs = [b for b in doc.prose_blocks if not b.list_item and not b.in_blockquote]
    para_over_bold = sum(1 for b in paragraphs if b.bold_spans > BOLD_PER_PARAGRAPH)
    naked_first_use = c2_naked_first_uses(doc, bold_terms)

    # --- S9 callouts ----------------------------------------------------------
    callouts_total = base["callouts_total"]
    budget = max(1, prose.js_round(CALLOUT_PER_1K * pw / 1000))
    h2_callouts = Counter()
    for sec in sections:
        if sec.level == 2:
            h2_callouts[sec.slug] = len(sec.callouts)
    # S6's map is the template's `> [!TIP]` + "**Reading map.**" before the first H2.
    # Requiring the phrase matters: 5 files open with a TIP, and NONE of them is a map.
    lead_tip = [c for c in doc.callout_marks if c.type == "TIP" and c.heading_idx <= 0]
    lead_text = " ".join(b.raw for b in doc.prose_blocks
                         if b.heading_idx <= 0 and b.in_blockquote).lower()
    reading_map = bool(lead_tip) and "reading map" in lead_text

    # --- C4 -------------------------------------------------------------------
    c4_rows = []
    for sec in sections:
        if sec.level not in (2, 3):
            continue
        if not sec.prose_words and not sec.fences and not sec.tables:
            continue  # a heading with no body at all: C4 has nothing to measure
        off, sig, legacy = c4_scan(sec)
        c4_rows.append({
            "anchor": sec.slug, "level": sec.level, "offset": off,
            "signals": sorted(sig), "legacy_marker": legacy,
            "weak_only": off is None and "marker" in sig,
            "tail": sec.is_tail, "words": sec.prose_words, "lines": sec.lines,
        })
    content_rows = [r for r in c4_rows if not r["tail"]]
    c4_miss = sum(1 for r in content_rows if r["offset"] is None)
    c4_miss_all = sum(1 for r in c4_rows if r["offset"] is None)
    h2_rows = [r for r in content_rows if r["level"] == 2]
    c4_h2_miss = sum(1 for r in h2_rows if r["offset"] is None)
    # The marker-only reconstruction, and the share of ITS hits that carry the very
    # instances the corrected detector added. See the C4 note in render().
    marker_only_miss = sum(1 for r in content_rows if not r["legacy_marker"])
    marker_only_rescued = sum(1 for r in content_rows if not r["legacy_marker"]
                              and {"code", "number"} & set(r["signals"]))
    offsets = [r["offset"] for r in content_rows if r["offset"] is not None]

    # --- S1 seams / register-swap preconditions -------------------------------
    h2_idx = [i for i, h in enumerate(doc.headings) if h.level == 2]
    long_h2 = seamless_long_h2 = short_h2 = 0
    for i in h2_idx:
        sec = sections[i]
        has_h3 = False  # only an H3 BEFORE the next H2 is this H2's seam
        for j in range(i + 1, len(doc.headings)):
            if doc.headings[j].level <= 2:
                break
            if doc.headings[j].level == 3:
                has_h3 = True
                break
        if sec.lines > SEAM_LINES:
            long_h2 += 1
            if not has_h3:
                seamless_long_h2 += 1
        if len(sec.paragraphs) < 2:
            short_h2 += 1

    # --- the zero-tolerance greps ---------------------------------------------
    lines = grep_lines(doc)
    joined_body = "\n".join(ln for _, ln, _ in lines)
    s2 = sum(1 for _, ln, _ in lines if S2_OPENER_RE.match(ln))
    s2_loose = sum(1 for _, ln, _ in lines if S2_LOOSE_RE.match(ln))
    c11 = sum(len(C11_RE.findall(ln)) for _, ln, cal in lines if cal != "INTERVIEW")
    c11_in_callout = sum(len(C11_RE.findall(ln)) for _, ln, cal in lines
                         if cal == "INTERVIEW")
    slot_labels = sum(1 for _, ln, _ in lines if C10_SLOT_RE.match(ln))
    audience = len(AUDIENCE_RE.findall(joined_body))
    teaser = len(S7_TEASER_RE.findall(joined_body))
    teaser_strict = len(S7_TEASER_STRICT_RE.findall(joined_body))
    c11_probe = len(C11_PROBE_RE.findall(joined_body))
    c11_in_iv = len(C11_IN_INTERVIEW_RE.findall(joined_body))
    s8 = sum(1 for _, ln, _ in lines if S8_HEADING_RE.match(ln))
    s3 = sum(1 for _, ln, _ in lines if S3_RE.search(ln))
    s3_xref = len(S3_XREF_RE.findall(joined_body))
    # `## References` is exempt from C12: a bibliography line points outward by design.
    # Everything from that heading to EOF is skipped, which matches how the rule is run
    # by hand. A file with no References section skips nothing.
    refs_at = max((h.line for h in doc.headings
                   if h.level == 2 and h.text.strip().lower() == "references"),
                  default=None)
    c12_punt = sum(len(C12_PUNT_RE.findall(ln)) for n, ln, _ in lines
                   if refs_at is None or n < refs_at)
    bad_callouts = Counter()
    for _, ln, _cal in lines:
        m = NOTE_CALLOUT_RE.match(ln)
        if m and m.group(1) not in prose.CALLOUT_TYPES:
            bad_callouts[m.group(1)] += 1

    rec = {
        "path": str(path),
        "lines": base["lines"],
        "raw_words": base["raw_words"],
        "prose_words": pw,
        "reading_minutes": base["reading_minutes"],
        "h2": base["h2"],
        "paragraphs": len(paragraphs),
        "paragraphs_per_1k": per_k(len(paragraphs), pw),
        "sentences": sstats["n"],
        "sentence_mean": sstats["mean"],
        "sentence_p90": sstats["p90"],
        "sentences_over_30": sstats["over_%d" % LONG_SENTENCE],
        "sentences_over_45": sstats["over_%d" % VERY_LONG_SENTENCE],
        "pct_sentences_over_30": round(100 * sstats["over_%d" % LONG_SENTENCE]
                                       / max(sstats["n"], 1), 2),
        "passive": passive,
        "passive_per_100_sentences": round(100 * passive / max(sstats["n"], 1), 2),
        "nominalizations": base["nominalizations"],
        "nominalizations_per_1k": per_k(base["nominalizations"], pw),
        "bold_spans": base["bold_spans"],
        "bold_per_1k": per_k(base["bold_spans"], pw),
        "bold_over_cap": per_k(base["bold_spans"], pw) > BOLD_PER_1K_CAP,
        "paragraphs_over_bold_cap": para_over_bold,
        "bold_terms_repeated": sum(1 for t, n in bold_terms.items() if n > 1),
        "bold_naked_first_use": naked_first_use,
        "open_parens": base["open_parens"],
        "open_parens_per_1k": per_k(base["open_parens"], pw),
        "hedges": hedges,
        "hedges_per_1k": per_k(hedges, pw),
        "metaconcepts": meta,
        "metaconcepts_per_1k": per_k(meta, pw),
        "metadiscourse": sum(metadiscourse.values()),
        "metadiscourse_per_1k": per_k(sum(metadiscourse.values()), pw),
        "metadiscourse_phrases": dict(metadiscourse),
        "c3_multi_gloss_sentences": c3,
        "c5_demonstrative_openers": c5,
        "c5_demonstrative_verb_openers": c5_verb,
        "callouts": callouts_total,
        "callouts_per_1k": per_k(callouts_total, pw),
        "callout_budget": budget,
        "callouts_over_budget": max(0, callouts_total - budget),
        "callout_types": base["callouts"],
        "h2_over_callout_cap": sum(1 for v in h2_callouts.values() if v > CALLOUTS_PER_H2),
        "reading_map": reading_map,
        "reading_map_required": base["raw_words"] > READING_MAP_RAW_WORDS,
        "c4_sections": len(content_rows),
        "c4_sections_all": len(c4_rows),
        "c4_missing": c4_miss,
        "c4_missing_all": c4_miss_all,
        "c4_miss_rate": round(100 * c4_miss / max(len(content_rows), 1), 2),
        "c4_sections_h2": len(h2_rows),
        "c4_missing_h2": c4_h2_miss,
        "c4_marker_only_missing": marker_only_miss,
        "c4_marker_only_rescued": marker_only_rescued,
        "c4_weak_only": sum(1 for r in content_rows if r["weak_only"]),
        "c4_offset_median": round(median(offsets), 1) if offsets else 0,
        "c4_rows": c4_rows,
        "h2_over_50_lines": long_h2,
        "h2_over_50_lines_without_seam": seamless_long_h2,
        "h2_under_2_paragraphs": short_h2,
        "s2_opener_hits": s2,
        "s2_opener_hits_loose": s2_loose,
        "c11_hits": c11,
        "c11_hits_inside_interview": c11_in_callout,
        "slot_labels": slot_labels,
        "slot_labels_per_1k": per_k(slot_labels, pw),
        "audience_labels": audience,
        "teaser_hits": teaser,
        "teaser_hits_strict": teaser_strict,
        "c11_probe_want_expect": c11_probe,
        "c11_in_an_interview": c11_in_iv,
        "raw_words_with_h1": len(text.strip().split()),
        "blocks": len(doc.prose_blocks),
        "blocks_non_quote": sum(1 for b in doc.prose_blocks if not b.in_blockquote),
        "s8_headings": s8,
        "s3_slab_hits": s3,
        "s3_xrefs": s3_xref,
        "c12_punt_hits": c12_punt,
        "unsupported_callouts": dict(bad_callouts),
        "mermaid_blocks": base["mermaid_blocks"],
    }
    return rec


GLOSS_RE = re.compile(r"\b(is|are|means|refers to|that is)\b|[—:(]")


def c2_naked_first_uses(doc, bold_terms) -> int:
    """C2 proxy: bolded terms whose FIRST use carries no gloss marker within 25 words.

    Coarse on purpose, and report-only: C2's real check is judgement ("a gloss a reader
    already has the words for"), and this cannot see a gloss delivered as the next
    sentence's subject. It counts candidates to read, not defects.
    """
    flat = [t.text for b in doc.prose_blocks for t in b.tokens if t.wordish]
    hay = " ".join(flat)
    low = hay.lower()
    naked = 0
    for term in bold_terms:
        i = low.find(term)
        if i < 0:
            continue
        tail = hay[i + len(term):]
        window = " ".join(tail.split()[:C2_GLOSS_WINDOW])
        if not GLOSS_RE.search(window):
            naked += 1
    return naked


# ==============================================================================
# Aggregation
# ==============================================================================

SUM_KEYS = (
    "raw_words", "prose_words", "paragraphs", "sentences", "sentences_over_30",
    "sentences_over_45", "passive", "nominalizations", "bold_spans", "open_parens",
    "hedges", "metaconcepts", "metadiscourse", "callouts", "callout_budget",
    "callouts_over_budget", "c4_sections", "c4_sections_all", "c4_missing",
    "c4_missing_all", "c4_sections_h2", "c4_missing_h2", "c4_marker_only_missing",
    "c4_marker_only_rescued", "c4_weak_only", "slot_labels",
    "audience_labels", "c11_hits", "c11_hits_inside_interview", "s2_opener_hits",
    "s2_opener_hits_loose", "teaser_hits", "s8_headings", "s3_slab_hits", "s3_xrefs",
    "paragraphs_over_bold_cap", "bold_terms_repeated", "bold_naked_first_use",
    "teaser_hits_strict", "c11_probe_want_expect", "c11_in_an_interview",
    "c12_punt_hits",
    "blocks", "blocks_non_quote",
    "c3_multi_gloss_sentences", "c5_demonstrative_openers",
    "c5_demonstrative_verb_openers", "h2", "h2_over_50_lines",
    "h2_over_50_lines_without_seam", "h2_under_2_paragraphs", "reading_minutes",
    "mermaid_blocks", "unsupported_callout_total",
)


def aggregate(recs) -> dict:
    """Sum counts, then recompute every ratio from the sums. Never average a ratio."""
    agg = {k: 0 for k in SUM_KEYS}
    agg["files"] = len(recs)
    for r in recs:
        for k in SUM_KEYS:
            if k == "unsupported_callout_total":
                agg[k] += sum(r["unsupported_callouts"].values())
            else:
                agg[k] += r[k]
    pw = agg["prose_words"]
    n = max(agg["sentences"], 1)
    agg.update({
        "sentence_mean": round(sum(r["sentence_mean"] * r["sentences"] for r in recs)
                               / n, 1),
        "sentence_p90_median_of_files": median([r["sentence_p90"] for r in recs]),
        "pct_sentences_over_30": round(100 * agg["sentences_over_30"] / n, 2),
        "passive_per_100_sentences": round(100 * agg["passive"] / n, 2),
        "nominalizations_per_1k": per_k(agg["nominalizations"], pw),
        "bold_per_1k": per_k(agg["bold_spans"], pw),
        "open_parens_per_1k": per_k(agg["open_parens"], pw),
        "hedges_per_1k": per_k(agg["hedges"], pw),
        "metaconcepts_per_1k": per_k(agg["metaconcepts"], pw),
        "metadiscourse_per_1k": per_k(agg["metadiscourse"], pw),
        "callouts_per_1k": per_k(agg["callouts"], pw),
        "slot_labels_per_1k": per_k(agg["slot_labels"], pw),
        "paragraphs_per_1k": per_k(agg["paragraphs"], pw),
        "blocks_per_1k": per_k(agg["blocks"], pw),
        "blocks_non_quote_per_1k": per_k(agg["blocks_non_quote"], pw),
        "c4_miss_rate": round(100 * agg["c4_missing"] / max(agg["c4_sections"], 1), 2),
        "c4_miss_rate_all": round(100 * agg["c4_missing_all"]
                                  / max(agg["c4_sections_all"], 1), 2),
        "c4_miss_rate_h2": round(100 * agg["c4_missing_h2"]
                                 / max(agg["c4_sections_h2"], 1), 2),
        "c4_marker_only_miss_rate": round(100 * agg["c4_marker_only_missing"]
                                          / max(agg["c4_sections"], 1), 2),
        "c4_marker_only_rescued_pct": round(
            100 * agg["c4_marker_only_rescued"]
            / max(agg["c4_marker_only_missing"], 1), 1),
        "files_over_bold_cap": sum(1 for r in recs if r["bold_over_cap"]),
        "files_over_callout_budget": sum(1 for r in recs if r["callouts_over_budget"]),
        "files_over_5_callouts": sum(1 for r in recs if r["callouts"] > 5),
        "files_reading_map_required": sum(1 for r in recs if r["reading_map_required"]),
        "files_with_reading_map": sum(1 for r in recs if r["reading_map"]),
    })
    return agg


def composite_index(recs) -> None:
    """Attach `clarity_index` to every record. Ranking only; see the module docstring."""
    denom = {}
    for key in INDEX_WEIGHTS:
        vals = [r[key] for r in recs]
        med = median(vals)
        if not med:
            mean = sum(vals) / len(vals) if vals else 0
            med = mean or 1
        denom[key] = med
    wsum = sum(INDEX_WEIGHTS.values())
    for r in recs:
        r["clarity_index"] = round(
            sum(w * r[k] / denom[k] for k, w in INDEX_WEIGHTS.items()) / wsum, 3)
    return denom


# ==============================================================================
# Cross-check: SKILL.md's own published figures, recomputed from this tokenizer
# ==============================================================================
#
# Every threshold in SKILL.md was derived from SOME measurement. If this script cannot
# reproduce those figures, either the standard's number came from a different tokenizer
# (which is the whole problem this track exists to end) or this script has a bug. Either
# way the reader needs to see it, so the table is recomputed on every run.

# Each row: (rule, claim, stated value, kind, recompute). `kind` is
#   measured  a number SKILL.md asserts about today's corpus -> must reproduce
#   target    a number SKILL.md REQUIRES of a rewritten file -> today's value is the
#             starting distance, not a discrepancy
#   approx    SKILL.md states it approximately ("about 13%", "~50 lines") or from a
#             definition it never gives -> agreement within 10% is corroboration
#   n/a       stated from a measurement whose code no longer exists -> cannot reproduce,
#             and the row exists to say so out loud rather than quietly matching nothing

CROSS_CHECKS = [
    ("C6", "sentences mean 14.9 words", 14.9, "measured",
     lambda a, f: a["sentence_mean"]),
    ("C6", "~1,290 monsters over 45 words", 1290, "measured",
     lambda a, f: a["sentences_over_45"]),
    ("C7", "nominalization density 35.97 /1k", 35.97, "measured",
     lambda a, f: a["nominalizations_per_1k"]),
    ("C8", "corpus runs 39.83 bold spans /1k", 39.83, "measured",
     lambda a, f: a["bold_per_1k"]),
    # 22.3 reproduces under NO paragraph definition available here. Median per-file:
    # 13.3 (prose paragraphs = block, not a list item, not a callout body), 18.6
    # (blank-line-separated runs), 32.1 (all non-callout blocks), 39.9 (all blocks).
    # The rule that consumes it (C8's "expect one bold every third or fourth paragraph")
    # is unaffected: at 13.3 paragraphs/1k, one bold per 3.5 paragraphs is 3.8/1k, well
    # inside the 12/1k cap, which is the point the standard was making.
    ("C8", "median 22.3 paragraphs /1k prose words", 22.3, "n/a",
     lambda a, f: round(median([r["paragraphs_per_1k"] for r in f]), 1)),
    ("C8", "  same, all blocks incl. list items /1k", 22.3, "n/a",
     lambda a, f: round(median([per_k(r["blocks"], r["prose_words"]) for r in f]), 1)),
    ("C5", "2,780 sentences open on a bare demonstrative", 2780, "measured",
     lambda a, f: a["c5_demonstrative_verb_openers"]),
    ("C5", "  demonstrative openers WITHOUT the verb list", 2780, "n/a",
     lambda a, f: a["c5_demonstrative_openers"]),
    # SKILL.md's C5 states TWO numbers for one phenomenon: 2,780 in the Why paragraph and
    # 2,398 in the Check line. This tokenizer reproduces the first to 0.1% and therefore
    # cannot also produce the second. The rule text wins, per SKILL.md's own tie-break.
    ("C5", "sentence-initial regex catches 2,398", 2398, "n/a",
     lambda a, f: a["c5_demonstrative_verb_openers"]),
    ("C10", "shape regex finds 15,771 slot labels", 15771, "measured",
     lambda a, f: a["slot_labels"]),
    ("C10", "median 22 slot labels per file", 22, "measured",
     lambda a, f: median([r["slot_labels"] for r in f])),
    ("C10", "14 files have no slot label", 14, "measured",
     lambda a, f: sum(1 for r in f if r["slot_labels"] == 0)),
    ("C10", "86 files under eight slot labels", 86, "measured",
     lambda a, f: sum(1 for r in f if r["slot_labels"] < 8)),
    # SKILL.md gives no regex for the audience triple, so this is a shape reconstruction:
    # bold `**Beginner.**` / `**Advanced — ...**` plus an audience-named heading.
    ("C10/S1", "778 audience-tier labels", 778, "approx",
     lambda a, f: a["audience_labels"]),
    ("C10/S1", "audience labels live in 46 files", 46, "approx",
     lambda a, f: sum(1 for r in f if r["audience_labels"])),
    # 435 + 126 counts TWO of the C11 regex's ten alternatives, so it cannot equal the full
    # regex's total. The 126 half reproduces exactly. The 435 half does not reproduce under
    # any verb subset of the standard's own regex: `probe|want|expect` gives 345 (352 here,
    # because this scan tolerates a line wrap between the noun and the verb and grep does
    # not), `+ask` gives 389, and all seven verbs give 557.
    ("C11", "435 'Interviewers probe/want/expect'", 435, "n/a",
     lambda a, f: a["c11_probe_want_expect"]),
    ("C11", "126 'in an interview'", 126, "measured",
     lambda a, f: a["c11_in_an_interview"]),
    ("C11", "  full regex, outside [!INTERVIEW] blocks", 561, "n/a",
     lambda a, f: a["c11_hits"]),
    ("S2", "exact opener grep returns 80 hits", 80, "measured",
     lambda a, f: a["s2_opener_hits"]),
    ("S2", "exact opener grep hits 80 files", 80, "measured",
     lambda a, f: sum(1 for r in f if r["s2_opener_hits"])),
    ("S2", "loose opener grep returns 185 hits", 185, "measured",
     lambda a, f: a["s2_opener_hits_loose"]),
    ("S2", "loose opener grep hits 181 files", 181, "measured",
     lambda a, f: sum(1 for r in f if r["s2_opener_hits_loose"])),
    ("S1", "7,903 H2 sections", 7903, "measured", lambda a, f: a["h2"]),
    # "~50 lines" is approximate in the rule, and the span definition (does the H2's own
    # line count? do its H3s?) is unstated. Mine: heading line through the line before the
    # next heading of ANY level. 13.8% vs 15% and 37.5 vs 36.1 is that ambiguity.
    ("S1", "15% of H2s exceed 50 lines", 15.0, "approx",
     lambda a, f: round(100 * a["h2_over_50_lines"] / max(a["h2"], 1), 1)),
    ("S1", "mean H2 span 36.1 lines", 36.1, "approx",
     lambda a, f: round(sum(r["lines"] for r in f) / max(a["h2"], 1), 1)),
    # 12.3% vs 26.1%: same paragraph-definition problem as the 22.3 row. Under "any prose
    # block", the figure drops to the standard's neighbourhood; under "paragraph, not a
    # list item", a section built entirely of bullets counts as having no paragraphs. The
    # REGISTER SWAP precondition means "too short to have a register gradient", so the
    # stricter reading is the useful one and the looser one is reported beside it.
    ("SWAP", "12.3% of H2s have <2 body paragraphs", 12.3, "n/a",
     lambda a, f: round(100 * a["h2_under_2_paragraphs"] / max(a["h2"], 1), 1)),
    # 387 is the whole-file word count; 386 is the site basis (H1 stripped), which is what
    # S6 says to use ("the site's own count, the one that drives readingMinutes"). One file
    # sits between the two. Implemented per the DEFINITION, so this row reads 386.
    ("S6", "387 files exceed 3,500 raw words", 387, "measured",
     lambda a, f: a["files_reading_map_required"]),
    ("S6", "  same on the whole file incl. the H1 line", 387, "measured",
     lambda a, f: sum(1 for r in f if r["raw_words_with_h1"] > READING_MAP_RAW_WORDS)),
    # Not one file in the corpus contains the string "reading map", and none of the 5 files
    # that open with a `[!TIP]` is one. So "exactly one exists" is unverifiable; 0 is the
    # honest count and every one of the 386 qualifying files needs a map written.
    ("S6", "exactly one reading map exists today", 1, "n/a",
     lambda a, f: a["files_with_reading_map"]),
    ("S9", "276 files exceed the 1.2/1k callout budget", 276, "measured",
     lambda a, f: a["files_over_callout_budget"]),
    ("S9", "193 files: WARNING+INTERVIEW alone exceeds it", 193, "measured",
     lambda a, f: sum(1 for r in f
                      if r["callout_types"].get("WARNING", 0)
                      + r["callout_types"].get("INTERVIEW", 0) > r["callout_budget"])),
    ("S9", "corpus runs 1.79 callouts /1k prose words", 1.79, "measured",
     lambda a, f: a["callouts_per_1k"]),
    ("S9", "256 files exceed 5 callouts", 256, "measured",
     lambda a, f: a["files_over_5_callouts"]),
    ("S9", "densest file has 27 callouts", 27, "measured",
     lambda a, f: max(r["callouts"] for r in f)),
    ("S8", "zero '## What breaks next' headings", 0, "target",
     lambda a, f: a["s8_headings"]),
    # The teaser grep AS WRITTEN is unusable as a gate: `read on` with no trailing
    # boundary matches "read only" and "read on demand", and "coming up" is ordinary
    # English. All 37 hits sampled by hand were false positives; the corrected variant
    # returns 0, which is the real state of the corpus.
    ("S7", "zero teaser strings (grep as written)", 0, "target",
     lambda a, f: a["teaser_hits"]),
    ("S7", "  same grep with word boundaries fixed", 0, "target",
     lambda a, f: a["teaser_hits_strict"]),
    # The old C4 detector's SOURCE is not in this repo (it lived in the deleted /tmp
    # design docs), so 38.2% cannot be reproduced. The marker-only reconstruction is a
    # strict LOWER bound on what any discourse-marker detector finds. What does reproduce
    # is the shape of the finding: ~2/3 of those hits carry an identifier or a number.
    ("C4", "old detector: 38.2% of sections lack an instance", 38.2, "n/a",
     lambda a, f: a["c4_marker_only_miss_rate"]),
    ("C4", "67% of those carry a backticked id or a number", 67.0, "approx",
     lambda a, f: a["c4_marker_only_rescued_pct"]),
    ("C4", "corrected detector: about 13%", 13.0, "approx",
     lambda a, f: a["c4_miss_rate"]),
]


# ==============================================================================
# Flags — only where SKILL.md states arithmetic or zero tolerance
# ==============================================================================

BOLD_CAP_MIN_WORDS = 400
"""Below this many prose words the C8 per-file cap is reported N/A, not FLAG.

C8's 12-per-1,000 is a per-FILE budget. On a 70-word excerpt one legitimate bold — the
term's teaching site, which the standard explicitly endorses — already scores 14 per
1,000, so applying the cap to a passage would flag the standard's own GOOD prose. The
corpus's smallest concepts.md carries 1,464 prose words, so this floor never suppresses a
real file; it only stops the cap being misapplied to an excerpt.
"""


def flags(rec: dict) -> list:
    """Every SKILL.md rule this file breaks by arithmetic or zero tolerance."""
    out = []
    if rec["prose_words"] >= BOLD_CAP_MIN_WORDS and rec["bold_over_cap"]:
        out.append("C8 bold %.1f/1k > %d" % (rec["bold_per_1k"], BOLD_PER_1K_CAP))
    if rec["paragraphs_over_bold_cap"]:
        out.append("C8 %d paragraph(s) with >1 bold" % rec["paragraphs_over_bold_cap"])
    if rec["bold_terms_repeated"]:
        out.append("C8 %d term(s) bolded twice" % rec["bold_terms_repeated"])
    if rec["callouts_over_budget"]:
        out.append("S9 callouts %d > budget %d"
                   % (rec["callouts"], rec["callout_budget"]))
    if rec["h2_over_callout_cap"]:
        out.append("S9 %d H2(s) with >1 callout" % rec["h2_over_callout_cap"])
    if rec["audience_labels"]:
        out.append("C10 %d audience-tier label(s)" % rec["audience_labels"])
    if rec["c11_hits"]:
        out.append("C11 %d interviewer-substitution hit(s)" % rec["c11_hits"])
    if rec["c12_punt_hits"]:
        # Not a failure on its own — each hit is settled by asking whether the sentence
        # is about the subject matter or about the document. Surfaced so it cannot be
        # settled by never looking.
        out.append("C12 %d punt-shape hit(s) to judge" % rec["c12_punt_hits"])
    if rec["s2_opener_hits"]:
        out.append("S2 %d 'This topic covers' opener(s)" % rec["s2_opener_hits"])
    if rec["teaser_hits"]:
        out.append("S7 %d teaser string(s)" % rec["teaser_hits"])
    if rec["s8_headings"]:
        out.append("S8 %d deleted-heading hit(s)" % rec["s8_headings"])
    if rec["unsupported_callouts"]:
        out.append("callout types not in the four: %s"
                   % ", ".join(sorted(rec["unsupported_callouts"])))
    if rec["reading_map_required"] and not rec["reading_map"]:
        out.append("S6 no reading map (%d raw words)" % rec["raw_words"])
    return out


# ==============================================================================
# Calibration fixtures — SKILL.md's own GOOD and BAD passages, verbatim
# ==============================================================================
#
# Each fixture is prefixed with a synthetic `## H2` so it forms one section (C4 measures
# the 60 words after a heading, and an excerpt has no heading of its own). That prefix is
# the only edit; the prose is verbatim from SKILL.md, abridged only where the standard
# itself elides with an ellipsis.

GOOD_FIXTURES = {
    "C1 good (JMM out-of-thin-air)": """## Out-of-thin-air values
A race can hand you a stale value, but never an invented one. The JMM forbids
**out-of-thin-air values**: a racy read may return any value some thread actually wrote,
and nothing else. That matters most for references — if a race could fabricate one, a
`String` field could come back pointing at arbitrary memory and Java would not be
memory-safe.
""",
    "C2 good (database at 90% CPU)": """## Replication
Your one database is at 90% CPU at 3pm every day, and the graph is still going up. You
have exactly three moves. Buy a bigger machine. Keep a full copy of the same data on more
machines, so reads can go anywhere. Or split *different* data across machines, so writes
can go anywhere too. The second move is called **replication**: every node holds the same
rows.
""",
    "C3 good (outbox / dual-write)": """## The outbox pattern
Write the event into an `outbox` table in the same database transaction as the state
change, then let a relay read that table and publish. Otherwise you are doing a
**dual-write** — one write to the database, one to the broker, no transaction across them
— and either can fail and leave the two disagreeing.
""",
    "C4 good (BankAccount encapsulation)": """## Encapsulation
Give any caller direct access to a `BankAccount`'s `balance` field and someone will
eventually write `balance = -100`. The account is now in a state your business rules say
cannot exist. Bundling the data with the methods that operate on it, and letting nothing
outside touch the data directly, is called **encapsulation**.
""",
    "C5 good (@Service on a base class)": """## Component scanning and superclasses
Put `@Service` on a base class, extend it, and the subclass never becomes a bean. Nothing
is registered, nothing is logged, and injection fails at startup with a missing-bean error
that names the interface rather than the cause. The reason is that component scanning
looks for the stereotype on the class itself. It does follow meta-annotations, which is why
`@Service` works at all — but it does not walk up the superclass chain, because the filter
scanning installs by default is built with `considerInterfaces=false` and no superclass
traversal.
""",
    "C6 good (autoscaler deadband)": """## Stopping the flap
Three things stop an autoscaler flapping. First, hold steady inside a band around the
target — say 45% to 55% CPU — so a metric hovering near it does not ping-pong. That band
is a **deadband**. Second, after you act, ignore the metric for a fixed window.
""",
    "C7 good (Nygard's twelve patterns)": """## Where to put the wall
Nygard's twelve stability patterns are twelve answers to one question: where do you put the
wall that stops a failure spreading? There are only three places to put it.
""",
    "C9 good (replica read latency)": """## What a replica read costs
Reads served from a local replica return in under 1 ms; a cross-region read costs 60-100
ms. Cache-aside with a 60-second TTL covers it until your write rate passes the single
leader's disk throughput — above that, the cache hides a database that is already falling
behind.
""",
    "C10 good (queue hop trade-off)": """## What a queue hop buys
You pay one queue hop per message — a context switch, usually a data copy, plus the memory
the queue holds — and in exchange every worker gets to be written as ordinary blocking
code. That is the whole deal, and it is a good one whenever the people writing handlers
outnumber the people who understand the event loop. Take it unless microseconds matter.
""",
    "C11 good (TLS between TCP and HTTP)": """## Where TLS sits
TLS sits between TCP and HTTP, and that position is the whole design. It needs TCP
underneath because it assumes bytes arrive in order and none are lost — a handshake message
that arrives second breaks the key schedule. That is why HTTP/1.1, HTTP/2, IMAP and SMTP
all get TLS for free, and why the same protocol had to be redesigned as DTLS the moment
anyone wanted it over UDP.
""",
    "AFTER (the shipped rewrite, abridged)": """## Visibility, reordering, and atomicity
Three different things can go wrong with a shared field, and each one needs a different
fix. The smallest case is one `boolean`:

```java
boolean stop = false;
while (!stop) { /* spin */ }
```

Main sets `stop = true` and exits. Thread T spins on, pinning a core. No exception, no log
line, and the flag was set long ago. The write was not slow. The JIT is allowed to read
`stop` once before the loop and reuse that copy, because with no happens-before edge
nothing in the program obliges T to look again. Declare `stop` volatile and the edge
exists, so T has to re-read. This is a legal compiler optimisation, not a cache that
failed to flush.

That loop is a **visibility** failure: a write by one thread never becomes observable to
another. Two more failures can happen to the same field, and neither one is visibility.

**Ordering** is whether operations appear to run in the order the program wrote them.
Write `data = 42` and then `ready = true`, both of them plain fields, and another thread
can see `ready` set while `data` is still 0.

**Atomicity** is whether a compound operation runs as one indivisible step. `stop = true`
is a single write, so it has nothing to divide; `count++` is a read, an add and a write.

### Why the simple version is wrong: three machines reorder, not one

Between the order you wrote and the order another core observes, an access passes three
stages, and each one may move it.

```mermaid
flowchart LR
    P["program order<br/>you wrote"] --> J["compiler / JIT<br/>reorders while generating code"]
    J --> C["processor<br/>out-of-order execution"]
    C --> M["memory hierarchy<br/>store buffers, invalidate queues"]
    M --> O["order another core observes"]
```

The hoist in the loop above happened at the first stage, in generated code, which is why
no amount of cache-flushing would have fixed it. At the last stage a write can be delayed
after it has already executed: a store waits in the core's store buffer, and on many
designs an invalidate queue also delays the moment another core learns its copy of the
line has gone stale.

Which moves another core can observe depends on the chip, and the compiler targets that
chip too. x86 behaves as **total store order (TSO)**: for ordinary field accesses,
store-load is the only reordering it exposes to another core.

`volatile` fixes visibility, ordering and the tearing case with one keyword. It cannot fix
`count++`. That keyword is the next section.
""",
}

BAD_FIXTURES = {
    "C1 bad (spec as the actor)": ("C4/C1", """## Causality
The JMM is also careful to forbid *out-of-thin-air* values via a causality model, so that
data races (while unspecified in ordering) still cannot fabricate arbitrary values for
references (which would break memory safety).
"""),
    "C5 bad (opens on the API surface)": ("C5", """## Component scanning
the default `AnnotationTypeFilter(Component.class)` used by scanning is created with
`considerMetaAnnotations=true` but `considerInterfaces=false` and does **not** traverse
superclasses. So a concrete subclass that merely *extends* an `@Component`-annotated base
is **not** auto-registered.
"""),
    "C10 bad (audience-tier labels)": ("C10", """## Visibility, reordering, and atomicity
**Beginner.** Three distinct concerns are often conflated:

- **Visibility** — whether a write by one thread is observable by another.
- **Ordering / reordering** — whether operations appear to execute in program order.
- **Atomicity** — whether a compound operation executes as one indivisible step.

They are independent. `volatile` gives visibility and ordering but *not* atomicity of
compound actions.

**Intermediate — the classic infinite loop.** A missing visibility guarantee.

**Advanced — reordering sources.** Reordering can come from (1) the compiler / JIT, (2)
the processor's out-of-order execution, and (3) the memory hierarchy (store buffers,
invalidate queues). x86 is a relatively strong TSO model (only store-load reordering is
visible); ARM/POWER are weakly ordered and expose far more.
"""),
    "C11 bad (interviewers want to know)": ("C11", """## Why it matters
**Why it matters.** Interviewers want to know that TLS is a distinct layer that sits
**between the reliable transport (TCP) and the application (HTTP)**.
"""),
    "S2 bad (This topic covers)": ("S2", """## Overview
This topic covers the trade-offs, the failure modes, and the operational concerns of the
approach in a distributed context.
"""),
}


# ==============================================================================
# Collection and rendering
# ==============================================================================


def collect(topics_dir: Path, domain=None):
    """Measure every concepts.md under `topics_dir`, optionally one domain only."""
    recs = []
    for qpath in sorted(topics_dir.rglob("questions.yaml")):
        cpath = qpath.parent / "concepts.md"
        if not cpath.exists():
            continue
        rel = cpath.relative_to(topics_dir).parts
        dom = rel[0] if len(rel) > 1 else "?"
        if domain and dom != domain:
            continue
        rec = measure_file(cpath, cpath.read_text(encoding="utf-8"))
        rec["domain"] = dom
        rec["slug"] = cpath.parent.name
        rec["key"] = "%s/%s" % (dom, cpath.parent.name)
        recs.append(rec)
    return recs


def _table(rows, headers, aligns=None):
    aligns = aligns or ["<"] * len(headers)
    cols = [max(len(str(h)), *(len(str(r[i])) for r in rows)) if rows else len(str(h))
            for i, h in enumerate(headers)]
    out = ["  ".join(("%-*s" if a == "<" else "%*s") % (c, h)
                     for h, c, a in zip(headers, cols, aligns))]
    out.append("  ".join("-" * c for c in cols))
    for r in rows:
        out.append("  ".join(("%-*s" if a == "<" else "%*s") % (c, v)
                             for v, c, a in zip(r, cols, aligns)))
    return "\n".join(out)


def render(recs, agg, per_domain, denom, top: int) -> str:
    L = []

    def w(s=""):
        L.append(s)

    w("clarity report — %d files, %s" % (agg["files"], date.today().isoformat()))
    w("tokenizer: scripts/prose.py (the only one) | WORDS_PER_MINUTE = %d "
      "(web/scripts/sync-content.mjs, via scripts/prose.py)" % WORDS_PER_MINUTE)
    w("EXIT CODE IS ALWAYS 0 — this is a report, not a gate.")
    w()

    # --- 1. sentence shape ----------------------------------------------------
    w("## Sentence length (REPORT-ONLY in SKILL.md — never flagged here)")
    w()
    rows = []
    for d, a in per_domain:
        rows.append([d, "%d" % a["sentences"], "%.1f" % a["sentence_mean"],
                     "%d" % a["sentence_p90_median_of_files"],
                     "%d" % a["sentences_over_30"], "%.1f%%" % a["pct_sentences_over_30"],
                     "%d" % a["sentences_over_45"],
                     "%.1f" % a["passive_per_100_sentences"]])
    w(_table(rows, ["domain", "sentences", "mean", "p90*", ">%d" % LONG_SENTENCE,
                    "%>30", ">%d" % VERY_LONG_SENTENCE, "passive/100"],
             ["<", ">", ">", ">", ">", ">", ">", ">"]))
    w()
    w("* p90 column is the MEDIAN of the per-file p90s (a corpus-wide p90 would hide the")
    w("  per-file spread the wave actually works against). `passive/100` is the proxy in")
    w("  the module docstring: measured 10% false positives, and it under-counts elided")
    w("  passives. SKILL.md does not ban the passive — watch it for CHANGE, not for level.")
    w()

    # --- 2. prose density -----------------------------------------------------
    w("## Prose density per 1,000 prose words")
    w()
    rows = []
    for d, a in per_domain:
        rows.append([d, "%d" % a["prose_words"], "%.1f" % a["bold_per_1k"],
                     "%.1f" % a["open_parens_per_1k"],
                     "%.1f" % a["nominalizations_per_1k"], "%.1f" % a["hedges_per_1k"],
                     "%.1f" % a["metaconcepts_per_1k"],
                     "%.1f" % a["metadiscourse_per_1k"],
                     "%.1f" % a["slot_labels_per_1k"], "%.1f" % a["paragraphs_per_1k"]])
    w(_table(rows, ["domain", "prose words", "bold", "parens", "nominal", "hedge",
                    "metaconcept", "metadisc", "slot label", "paragraph"],
             ["<"] + [">"] * 9))
    w()
    w("C8's cap is 12 bold/1k (BINDING). C9's hedge and metaconcept densities are")
    w("REPORT-ONLY by rule, so they carry no verdict — the binding half of C9 is per-hit")
    w("(the condition or the magnitude in the same sentence), which no script can see.")
    w()

    # --- 3. C8 / S9 arithmetic ------------------------------------------------
    w("## The two BINDING arithmetic rules, per domain")
    w()
    rows = []
    for d, a in per_domain:
        rows.append([d, "%d" % a["files"],
                     "%d" % a["files_over_bold_cap"],
                     "%d" % a["paragraphs_over_bold_cap"],
                     "%d" % a["bold_terms_repeated"],
                     "%d" % a["callouts"], "%.2f" % a["callouts_per_1k"],
                     "%d" % a["files_over_callout_budget"],
                     "%d" % a["callouts_over_budget"]])
    w(_table(rows, ["domain", "files", "files>12 bold/1k", "paras>1 bold",
                    "terms bolded 2x", "callouts", "callout/1k", "files>budget",
                    "surplus callouts"], ["<"] + [">"] * 8))
    w()

    # --- 4. C4 ----------------------------------------------------------------
    w("## C4 — concrete instance inside the first 60 words")
    w()
    rows = []
    for d, a in per_domain:
        rows.append([d, "%d" % a["c4_sections"], "%d" % a["c4_missing"],
                     "%.1f%%" % a["c4_miss_rate"], "%d" % a["c4_weak_only"],
                     "%.1f%%" % a["c4_miss_rate_h2"],
                     "%.1f%%" % a["c4_miss_rate_all"],
                     "%.1f%%" % a["c4_marker_only_miss_rate"]])
    w(_table(rows, ["domain", "sections", "no instance", "miss rate", "marker-only sig",
                    "H2-only rate", "incl. tails", "marker-only detector"],
             ["<"] + [">"] * 7))
    w()
    w("`sections` counts every H2 and H3 with a body, excluding `## References` and the")
    w("follow-up-questions tail (the last column puts them back). `legacy miss rate` is")
    w("the OLD discourse-marker-only detector, reproduced here from the same pass so the")
    w("two are comparable. `marker-only` sections satisfy nothing but a discourse marker")
    w("and are the ones to read by hand — SKILL.md says \"for example, in a distributed")
    w("system\" does not count.")
    w()

    # --- 5. zero-tolerance greps ---------------------------------------------
    w("## Zero-tolerance rules (FLAGGED)")
    w()
    rows = []
    for d, a in per_domain:
        rows.append([d, "%d" % a["audience_labels"], "%d" % a["c11_hits"],
                     "%d" % a["s2_opener_hits"], "%d" % a["teaser_hits"],
                     "%d" % a["s8_headings"], "%d" % a["unsupported_callout_total"],
                     "%d/%d" % (a["files_with_reading_map"],
                                a["files_reading_map_required"]),
                     "%d" % a["s3_slab_hits"]])
    w(_table(rows, ["domain", "C10 audience", "C11 interviewer", "S2 opener",
                    "S7 teaser", "S8 heading", "bad callout", "S6 map/needed",
                    "S3 slab"], ["<"] + [">"] * 8))
    w()

    # --- 6. structure ---------------------------------------------------------
    w("## Structure (S1 seams, register-swap preconditions, reading load)")
    w()
    rows = []
    for d, a in per_domain:
        rows.append([d, "%d" % a["h2"], "%d" % a["h2_over_50_lines"],
                     "%d" % a["h2_over_50_lines_without_seam"],
                     "%d" % a["h2_under_2_paragraphs"],
                     "%d" % a["mermaid_blocks"], "%d" % a["reading_minutes"],
                     "%d" % a["c3_multi_gloss_sentences"],
                     "%d" % a["c5_demonstrative_verb_openers"]])
    w(_table(rows, ["domain", "H2s", "H2>50 lines", "…without seam", "H2<2 paras",
                    "mermaid", "read min", "C3 candidates", "C5 openers"],
             ["<"] + [">"] * 8))
    w()

    # --- 7. cross-check -------------------------------------------------------
    if agg["files"] > 400:  # only meaningful on the whole corpus
        w("## Cross-check: SKILL.md's published figures, recomputed by this tokenizer")
        w()
        rows = []
        differ = 0
        for rule, claim, quoted, kind, fn in CROSS_CHECKS:
            got = fn(agg, recs)
            gap = abs(float(got) - float(quoted))
            rel = gap / abs(float(quoted)) if quoted else (0 if gap == 0 else 1)
            if gap == 0:
                verdict = "ok"
            elif kind == "target":
                verdict = "distance to target"
            elif kind == "n/a":
                verdict = "NOT REPRODUCIBLE"
            elif kind == "approx":
                verdict = ("corroborated (%.0f%%)" % (100 * rel) if rel <= 0.10
                           else "DIFFERS")
                differ += 0 if rel <= 0.10 else 1
            elif rel <= 0.02:
                verdict = "close (%.1f%%)" % (100 * rel)
            else:
                verdict = "DIFFERS"
                differ += 1
            rows.append([rule, claim, "%g" % quoted, "%g" % got, kind, verdict])
        w(_table(rows, ["rule", "SKILL.md says", "stated", "measured", "kind",
                        "verdict"], ["<", "<", ">", ">", "<", "<"]))
        w()
        w("%d of %d rows DIFFER by more than 2%% while claiming to measure today's corpus."
          % (differ, len(CROSS_CHECKS)))
        w("`ok` = exact. `close` = within 2%, i.e. the same phenomenon with a slightly")
        w("different boundary. `distance to target` = SKILL.md states a value a REWRITTEN")
        w("file must have; today's number is the work remaining, not a discrepancy.")
        w("`NOT REPRODUCIBLE` = the stated figure came from code that no longer exists or")
        w("from a definition the standard does not give; the comment above each such row in")
        w("CROSS_CHECKS says which, and gives every variant that was tried.")
        w()

    # --- 8. worst / best ------------------------------------------------------
    ranked = [r for r in recs if r["prose_words"] >= RANK_MIN_PROSE_WORDS]
    ranked.sort(key=lambda r: -r["clarity_index"])
    w("## Composite clarity index — worst %d and best %d of %d ranked files"
      % (top, top, len(ranked)))
    w()
    w("index = weighted mean of %d burden metrics, each over its corpus median."
      % len(INDEX_WEIGHTS))
    w("1.00 = median burden on every axis. Ranking only; it judges nothing.")
    w("Divisors: " + ", ".join("%s %.4g" % (k, v) for k, v in denom.items()))
    w()

    def block(title, rows_in):
        w(title)
        w()
        rows = [["%.2f" % r["clarity_index"], r["key"], "%d" % r["prose_words"],
                 "%.1f" % r["bold_per_1k"], "%.1f" % r["nominalizations_per_1k"],
                 "%.1f" % r["slot_labels_per_1k"], "%.1f%%" % r["c4_miss_rate"],
                 "%.1f%%" % r["pct_sentences_over_30"], "%.1f" % r["hedges_per_1k"],
                 "%d" % r["reading_minutes"]] for r in rows_in]
        w(_table(rows, ["index", "topic", "prose w", "bold", "nominal", "slot",
                        "C4 miss", "%>30w", "hedge", "min"],
                 [">", "<", ">", ">", ">", ">", ">", ">", ">", ">"]))
        w()

    block("### Worst (rewrite these first)", ranked[:top])
    block("### Best (the corpus's own least-burdened prose)", ranked[-top:][::-1])

    # --- 9. flags on the best files (the false-positive test) ------------------
    w("### Do the FLAGGED rules fire on the best files?")
    w()
    for r in ranked[-top:][::-1]:
        f = flags(r)
        w("  %-58s %s" % (r["key"], "; ".join(f) if f else "no flags"))
    w()
    w("Any flag here is a calibration problem, not a defect in the file — with one known")
    w("exception: C8 and S9 are the rewrite's TARGETS, so a pre-rewrite file breaking them")
    w("is expected and is not a false positive. Read the list with that in mind.")
    w()

    # --- 9b. does the ranking agree with what the repo already believes? -------
    w("### Sanity-check: domain median index vs what docs/corpus-stats.md implies")
    w()
    dom_med = sorted((median([r["clarity_index"] for r in rs]), d)
                     for d, rs in
                     {k: [r for r in recs if r["domain"] == k]
                      for k in {r["domain"] for r in recs}}.items())
    w(_table([["%.2f" % m, d] for m, d in dom_med], ["index", "domain"], [">", "<"]))
    w()
    w("`docs/corpus-stats.md` names no best-written FILES, but its prose table implies a")
    w("ranking: `interview-craft` has the corpus's lowest bold density (25.3/1k vs 39.8) and")
    w("its lowest open-paren density (16.5 vs 28.8), and `docker` the lowest nominalization")
    w("density (17.0 vs 36.0). The index agrees about docker — 4 of the best 10 files and the")
    w("leanest domain — and DISAGREES about interview-craft, which lands second worst. The")
    w("disagreement is legible and is not a bug: interview-craft is typographically calm and")
    w("conceptually abstract. 45.7% of its sections open with no concrete instance (the")
    w("corpus's worst C4 rate) and it carries the highest metaconcept density at 7.1/1k. A")
    w("bold-and-paren reading of corpus-stats would have ranked it best in the corpus.")
    w()

    # --- 10. metadiscourse detail --------------------------------------------
    phrases = Counter()
    for r in recs:
        for p, n in r["metadiscourse_phrases"].items():
            phrases[p] += n
    w("## Metadiscourse, by phrase (corpus-wide)")
    w()
    w(_table([[p, "%d" % n] for p, n in phrases.most_common(15)],
             ["pattern", "hits"], ["<", ">"]))
    w()
    return "\n".join(L) + "\n"


def render_file(rec: dict, sections: bool) -> str:
    L = ["%s — %d raw words, %d prose words, %d rendered minutes"
         % (rec["key"], rec["raw_words"], rec["prose_words"], rec["reading_minutes"]),
         ""]
    order = ("sentences", "sentence_mean", "sentence_p90", "sentences_over_30",
             "sentences_over_45", "passive_per_100_sentences", "bold_per_1k",
             "paragraphs_over_bold_cap", "bold_terms_repeated", "bold_naked_first_use",
    "teaser_hits_strict", "c11_probe_want_expect", "c11_in_an_interview",
    "c12_punt_hits",
    "blocks", "blocks_non_quote",
             "open_parens_per_1k", "nominalizations_per_1k", "hedges_per_1k",
             "metaconcepts_per_1k", "metadiscourse_per_1k", "c3_multi_gloss_sentences",
             "c5_demonstrative_verb_openers", "slot_labels", "audience_labels",
             "c11_hits", "callouts", "callout_budget", "h2_over_callout_cap",
             "h2", "h2_over_50_lines", "h2_over_50_lines_without_seam",
             "h2_under_2_paragraphs", "c4_sections", "c4_missing", "c4_miss_rate",
             # Print the legacy-detector control WITH its rescued pair. Alone,
             # `c4_marker_only_missing 12` beside `c4_missing 1` reads as twelve C4
             # failures; it is the count the OLD marker-only detector would have missed,
             # and `c4_marker_only_rescued` is how many of those this detector recovered.
             "c4_weak_only", "c4_marker_only_missing", "c4_marker_only_rescued",
             "c4_offset_median",
             "mermaid_blocks",
             "reading_map", "reading_map_required")
    for k in order:
        L.append("  %-34s %s" % (k, rec[k]))
    f = flags(rec)
    L += ["", "  FLAGS: " + ("; ".join(f) if f else "none"), ""]
    if sections:
        rows = [[r["anchor"][:52], "H%d" % r["level"], "%d" % r["lines"],
                 "%d" % r["words"],
                 str(r["offset"]) if r["offset"] else "NONE",
                 ",".join(r["signals"]) or "-", "tail" if r["tail"] else ""]
                for r in rec["c4_rows"]]
        L.append(_table(rows, ["anchor", "lvl", "lines", "words", "C4 offset",
                               "signals", ""],
                        ["<", "<", ">", ">", ">", "<", "<"]))
        L.append("")
    return "\n".join(L)


def self_test() -> str:
    """Run every flag over SKILL.md's own GOOD and BAD passages. See the docstring."""
    L = ["calibration self-test — SKILL.md's own exemplars", ""]
    L.append("GOOD passages: a flag here means the threshold is wrong.")
    L.append("")
    fails = 0
    for name, text in GOOD_FIXTURES.items():
        rec = measure_file(Path(name), text)
        f = flags(rec)
        fails += 1 if f else 0
        L.append("  %-42s %-9s bold %5.1f/1k  C4 %s  %s"
                 % (name, "FLAGGED" if f else "clean", rec["bold_per_1k"],
                    ("+%d" % rec["c4_rows"][0]["offset"]) if rec["c4_rows"]
                    and rec["c4_rows"][0]["offset"] else "MISS",
                    "; ".join(f)))
    L += ["", "  %d of %d GOOD passages flagged." % (fails, len(GOOD_FIXTURES)), ""]
    L.append("BAD passages: the rule each one illustrates must catch it.")
    L.append("")
    caught = 0
    for name, (rule, text) in BAD_FIXTURES.items():
        rec = measure_file(Path(name), text)
        f = flags(rec)
        c4_miss = rec["c4_rows"] and rec["c4_rows"][0]["offset"] is None
        hit = bool(f) or c4_miss
        caught += 1 if hit else 0
        L.append("  %-42s %-8s %s"
                 % (name, "caught" if hit else "MISSED",
                    "; ".join(f) + (" | C4 no instance in 60 words" if c4_miss else "")))
    L += ["", "  %d of %d BAD passages caught." % (caught, len(BAD_FIXTURES)), ""]
    L.append("Note on the C8 per-file cap: it is N/A below %d prose words (see"
             % BOLD_CAP_MIN_WORDS)
    L.append("BOLD_CAP_MIN_WORDS). Applied to a 70-word excerpt, one legitimate bold —")
    L.append("the teaching site SKILL.md explicitly endorses — already scores ~14/1k.")
    return "\n".join(L) + "\n"


def baseline(recs, agg, per_domain) -> dict:
    """docs/clarity-baseline.json — per-file metrics, so a later wave can prove
    NON-REGRESSION rather than chase an absolute target."""
    def strip(r):
        # `key`, `domain` and `slug` are dropped: the dict key already carries them, and
        # 460 copies of each is 40 KB of noise in a file whose job is to diff cleanly.
        out = {k: v for k, v in r.items()
               if k not in ("c4_rows", "metadiscourse_phrases", "path",
                            "key", "domain", "slug")}
        out["c4_offsets"] = {row["anchor"]: (row["offset"] if row["offset"] else 0)
                             for row in r["c4_rows"]}
        out["flags"] = flags(r)
        return out

    return {
        "generated": date.today().isoformat(),
        "tokenizer": "scripts/prose.py",
        "words_per_minute": WORDS_PER_MINUTE,
        "note": "Per-file clarity metrics BEFORE the clarity wave. Compare a rewritten "
                "file against its own row; the corpus aggregate is not a target.",
        "thresholds": {
            "c4_window_words": C4_WINDOW, "bold_per_1k_cap": BOLD_PER_1K_CAP,
            "bold_per_paragraph": BOLD_PER_PARAGRAPH,
            "callout_per_1k": CALLOUT_PER_1K, "callouts_per_h2": CALLOUTS_PER_H2,
            "reading_map_raw_words": READING_MAP_RAW_WORDS, "seam_lines": SEAM_LINES,
            "bold_cap_min_prose_words": BOLD_CAP_MIN_WORDS,
        },
        "index_weights": INDEX_WEIGHTS,
        "corpus": {k: v for k, v in agg.items()},
        "domains": {d: a for d, a in per_domain if d != "CORPUS"},
        "files": {r["key"]: strip(r) for r in recs},
    }


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("topics_dir", nargs="?", default=str(root / "topics"))
    ap.add_argument("--domain", default=None, help="restrict to one domain slug")
    ap.add_argument("--file", default=None, help="measure one concepts.md and stop")
    ap.add_argument("--sections", action="store_true",
                    help="with --file: per-H2/H3 C4 offsets")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--write-baseline", nargs="?", const=str(root / "docs"
                                                            / "clarity-baseline.json"),
                    default=None, metavar="PATH")
    ap.add_argument("--self-test", action="store_true",
                    help="run the flags over SKILL.md's own GOOD/BAD passages")
    ap.add_argument("--top", type=int, default=10)
    args = ap.parse_args()

    if args.self_test:
        print(self_test())
        return 0

    if args.file:
        p = Path(args.file)
        rec = measure_file(p, p.read_text(encoding="utf-8"))
        rec["key"] = p.parent.name if p.name == "concepts.md" else p.name
        if args.json:
            print(json.dumps(rec, indent=2))
        else:
            print(render_file(rec, args.sections))
        return 0

    topics_dir = Path(args.topics_dir)
    if not topics_dir.is_dir():
        print("No such topics dir: %s" % topics_dir)
        return 0
    recs = collect(topics_dir, args.domain)
    if not recs:
        print("No concepts.md found under %s" % topics_dir)
        return 0

    denom = composite_index(recs)
    agg = aggregate(recs)
    by_domain = {}
    for r in recs:
        by_domain.setdefault(r["domain"], []).append(r)
    per_domain = [(d, aggregate(rs)) for d, rs in sorted(by_domain.items())]
    if len(by_domain) > 1:  # a single-domain run would print the same row twice
        per_domain.append(("CORPUS", agg))

    if args.write_baseline:
        out = Path(args.write_baseline)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(baseline(recs, agg, per_domain), indent=1) + "\n",
                       encoding="utf-8")
        print("wrote %s (%d files, %.0f KB)"
              % (out, len(recs), out.stat().st_size / 1024))
        return 0

    if args.json:
        print(json.dumps({"corpus": agg,
                          "domains": {d: a for d, a in per_domain if d != "CORPUS"},
                          "files": {r["key"]: {k: v for k, v in r.items()
                                               if k != "c4_rows"} for r in recs}},
                         indent=1))
        return 0

    print(render(recs, agg, per_domain, denom, args.top))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
