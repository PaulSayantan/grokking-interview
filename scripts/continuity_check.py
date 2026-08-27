#!/usr/bin/env python3
"""continuity_check.py — validate the clarity wave's carry-forward ledgers.

Contract: `docs/continuity/README.md` (format) and the `clarity-standard` skill
(rules K1-K7). The ledger is `docs/continuity/<domain>.yaml`, committed, and it is the
ONLY thing a fresh session needs in order to resume a domain mid-wave — which is why it
is checked like code and why `--resume` exists.

Usage:
    python3 scripts/continuity_check.py                      # check every ledger
    python3 scripts/continuity_check.py --domain docker       # one domain (or shard)
    python3 scripts/continuity_check.py --domain docker --resume   # the resume brief
    python3 scripts/continuity_check.py --json               # machine-readable findings

Exit code: 1 when an ERROR was found, 0 otherwise. WARNINGS never fail, on purpose —
see "Gate model" below.

=============================================================================
GATE MODEL
=============================================================================
ERROR (fails):   the ledger does not parse; a required field is missing or badly typed;
                 `domain` disagrees with the filename; `plan[]` names a topic that does
                 not exist, or names one twice; `position` is out of range. These are
                 mechanical and cannot be a matter of taste.

WARNING (never fails):
  * README DRIFT. `plan[]` is written once at Pass 0 and never edited, so a README
    edited later legitimately disagrees with it. Commit 62afa14 inserted 7 topics into
    the middle of a 94-topic domain; hard-failing that would fail two files nobody
    touched. Every drift finding therefore names `topics/<domain>/README.md` and the
    remediation, and lets the build pass (rule K7).
  * PROSE GREPS. Banned term variants (K2) and the K1 key-noun payoff check read
    English. `replica` vs `node`, `latency` vs `response time` are real distinctions in
    places, so over-enforcing them is itself a failure mode the standard warns about.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required: pip install pyyaml")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_content import (  # noqa: E402  (path shim above must run first)
    FENCE_RE,
    anchors_of,
    next_topic,
    read_headings,
    reading_order,
    sd_group_key,
)

REQUIRED_KEYS = ("domain", "schema", "pass", "reading_order_source", "position", "plan")
ALLOWED_KEYS = set(REQUIRED_KEYS) | {
    "group",
    "wave_start_position",
    "canonical_terms",
    "assumed_prior_knowledge",
    # Written by the rolling compaction (every 5 topics) so a reader can tell what was
    # folded into a domain-level claim and what was deliberately dropped. Nothing reads
    # it; losing the record of a compaction is how a later topic contradicts a claim
    # nobody can find any more.
    "claims_compaction_log",
    "running_example",
    "claims_established",
    "approximations_open",
    "known_defects",
    "owed",
    "exemptions",
    "open_cliffhanger",
    "topics",
}
# Ledger filename: "<domain>.yaml", or "<domain>.<group>.yaml" for a domain sharded by
# catalog group key (the standard shards anything over ~25 topics).
LEDGER_RE = re.compile(r"^([a-z0-9][a-z0-9-]*?)(?:\.([a-z0-9-]+))?\.yaml$")
K1_OPENER_WORDS = 200  # how much of topic N counts as "the opener" for the K1 grep


class Findings:
    """Errors and warnings, each carrying the ledger they came from."""

    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, where: str, msg: str) -> None:
        self.errors.append(f"{where}: {msg}")

    def warn(self, where: str, msg: str) -> None:
        self.warnings.append(f"{where}: {msg}")


# ======================================================================================
# Prose scanning — fence-aware, so a banned variant inside a code sample is not a hit
# ======================================================================================


def prose_lines(path: Path) -> list[tuple[int, str]]:
    """(1-based line number, text) for every prose line: no fences, no inline code."""
    out: list[tuple[int, str]] = []
    fence_char, fence_len = "", 0
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
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
            continue
        out.append((lineno, re.sub(r"`[^`]*`", " ", line)))
    return out


def opener_text(path: Path) -> str:
    """The first K1_OPENER_WORDS words of body prose after the `# H1`."""
    headings = read_headings(path)
    h1_line = next((h.line for h in headings if h.level == 1), 0)
    words: list[str] = []
    for lineno, text in prose_lines(path):
        if lineno <= h1_line:
            continue
        words.extend(text.split())
        if len(words) >= K1_OPENER_WORDS:
            break
    return " ".join(words[:K1_OPENER_WORDS])


def section_text(path: Path, anchor: str) -> str:
    """The prose of one section, from its heading to the next heading of the same depth."""
    headings = read_headings(path)
    target = next((h for h in headings if h.slug == anchor), None)
    if target is None:
        return ""
    end = min(
        (h.line for h in headings if h.line > target.line and h.level <= target.level),
        default=10**9,
    )
    return " ".join(t for n, t in prose_lines(path) if target.line < n < end)


# ======================================================================================
# Checks
# ======================================================================================


def check_shape(led: dict, where: str, domain: str, group: str | None, f: Findings) -> None:
    for key in REQUIRED_KEYS:
        if key not in led:
            f.error(where, f"missing required key '{key}'")
    unknown = sorted(set(led) - ALLOWED_KEYS)
    if unknown:
        f.warn(where, f"unknown key(s) {unknown} (typo? nothing reads them)")
    if led.get("domain") and str(led["domain"]) != domain:
        f.error(where, f"domain '{led['domain']}' != filename domain '{domain}'")
    if group and str(led.get("group") or "") != group:
        f.error(
            where,
            f"filename says this is the '{group}' shard, but 'group' is "
            f"{led.get('group')!r} — a shard must declare its group key",
        )
    if "schema" in led and not isinstance(led["schema"], int):
        f.error(where, f"'schema' must be an integer (got {led['schema']!r})")
    src = str(led.get("reading_order_source") or "")
    expected = f"topics/{domain}/README.md"
    if src and src != expected:
        f.warn(where, f"reading_order_source is '{src}'; the row order lives in '{expected}'")
    for name in ("canonical_terms", "running_example", "open_cliffhanger"):
        if name in led and led[name] is not None and not isinstance(led[name], dict):
            f.error(where, f"'{name}' must be a mapping")
    for name in ("plan", "claims_established", "approximations_open", "known_defects",
                 "owed", "exemptions", "topics"):
        if name in led and led[name] is not None and not isinstance(led[name], list):
            f.error(where, f"'{name}' must be a list")
    for term, body in (led.get("canonical_terms") or {}).items():
        if not isinstance(body, dict):
            f.error(where, f"canonical_terms['{term}'] must be a mapping")
            continue
        for key in ("canonical", "defined_in", "gloss"):
            if not str(body.get(key) or "").strip():
                f.error(where, f"canonical_terms['{term}'] has no '{key}'")
        if body.get("banned_variants") is not None and not isinstance(
            body["banned_variants"], list
        ):
            f.error(where, f"canonical_terms['{term}'].banned_variants must be a list")


def plan_slugs(led: dict, where: str, f: Findings) -> list[str]:
    """The ledger's ordered topic list, with shape errors reported."""
    slugs: list[str] = []
    for i, row in enumerate(led.get("plan") or []):
        if not isinstance(row, dict) or not str(row.get("slug") or "").strip():
            f.error(where, f"plan[{i}] must be a mapping with a 'slug'")
            continue
        if not str(row.get("covers") or "").strip():
            f.warn(where, f"plan[{i}] ('{row['slug']}') has no 'covers' summary")
        slugs.append(str(row["slug"]))
    return slugs


def check_plan_against_readme(
    slugs: list[str], scope: list[str], where: str, domain: str, f: Findings
) -> None:
    """`plan[]` must be the domain's (or shard's) reading order — with drift tolerated."""
    seen: set[str] = set()
    for s in slugs:
        if s in seen:
            f.error(where, f"plan lists '{s}' twice")
        seen.add(s)
        if s not in scope:
            f.error(
                where,
                f"plan names '{domain}/{s}', which is not a topic in this scope "
                f"(no topics/{domain}/{s}/questions.yaml, or it belongs to another shard)",
            )
    missing = [s for s in scope if s not in seen]
    if missing:
        f.warn(
            where,
            f"{len(missing)} topic(s) in reading order are absent from plan[] "
            f"({missing[:5]}) — topics/{domain}/README.md gained rows after Pass 0. "
            f"plan[] is append-only-by-design: add them at their row position rather "
            f"than re-sorting it",
        )
    ordered = [s for s in scope if s in seen]
    listed = [s for s in slugs if s in scope]
    if listed != ordered:
        f.warn(
            where,
            f"plan[] order disagrees with topics/{domain}/README.md row order "
            f"(first divergence: plan has "
            f"'{next((a for a, b in zip(listed, ordered) if a != b), '?')}', README has "
            f"'{next((b for a, b in zip(listed, ordered) if a != b), '?')}'). Re-derive "
            f"the order from the README; never hand-sort the ledger",
        )


def check_position(led: dict, slugs: list[str], where: str, f: Findings) -> None:
    pos = led.get("position")
    if not isinstance(pos, int):
        f.error(where, f"'position' must be an integer (got {pos!r})")
        return
    if not (1 <= pos <= len(slugs) + 1):
        f.error(where, f"position {pos} is out of range for a {len(slugs)}-topic plan")
    done = [t for t in (led.get("topics") or []) if isinstance(t, dict)]
    ahead = [
        t.get("slug")
        for t in done
        if isinstance(t.get("position"), int) and t["position"] >= pos
    ]
    if ahead:
        f.warn(where, f"topics[] records {ahead} at or after position {pos} — bump 'position'")

    # A landed topic must leave a topics[] row. `position` is bumped by the same merge, so
    # the two numbers move together and any gap means a row was never written.
    #
    # This is not hypothetical: topic 7's ledger-append.yaml omitted `topics` entirely. The
    # merge caught it only because it happened to assert; without that, `position` would have
    # advanced to 8 while topics[] held 6 rows, and the domain would have reported "6/16
    # rewritten" forever with every other gate green. topics[] is the durable per-file
    # completion marker and the thing a resumed session trusts, so a silent gap is the one
    # ledger defect that cannot be recovered from the ledger itself.
    # A wave need not start at position 1: a standalone rewrite (or a domain worked out of
    # order) sets `wave_start_position` to the first README index it covers, so only landed
    # positions from there up to `position` must carry a completion marker. Defaults to 1,
    # so a full sequential domain (docker) is unaffected.
    wave_start = led.get("wave_start_position", 1)
    recorded = {t["position"] for t in done if isinstance(t.get("position"), int)}
    gaps = sorted(set(range(wave_start, pos)) - recorded)
    if gaps:
        f.error(
            where,
            f"position is {pos} but topics[] has no row for position(s) {gaps} — a landed topic "
            f"left no completion marker. Rebuild the row from that run's reports; do not just "
            f"bump 'position'.",
        )


def check_terminology(
    led: dict, topics_root: Path, domain: str, done: list[str], where: str, f: Findings
) -> int:
    """K2: one canonical term per concept per domain. REPORT-ONLY, and deliberately so."""
    terms = led.get("canonical_terms") or {}
    exempt = {
        str(e.get("file"))
        for e in (led.get("exemptions") or [])
        if isinstance(e, dict) and str(e.get("rule") or "") == "K2"
    }
    hits = 0
    for slug in done:
        if slug in exempt:
            continue
        path = topics_root / domain / slug / "concepts.md"
        if not path.exists():
            continue
        lines = prose_lines(path)
        for term, body in terms.items():
            if not isinstance(body, dict):
                continue
            for variant in body.get("banned_variants") or []:
                pat = re.compile(rf"\b{re.escape(str(variant))}s?\b", re.IGNORECASE)
                for lineno, text in lines:
                    if pat.search(text):
                        hits += 1
                        f.warn(
                            where,
                            f"K2: topics/{domain}/{slug}/concepts.md:{lineno} uses "
                            f"'{variant}', a banned variant of '{body.get('canonical', term)}' "
                            f"— or it is a real distinction, in which case add a K2 exemption",
                        )
                        break  # one hit per (file, variant) is enough to act on
    return hits


def check_cliffhangers(
    led: dict, topics_root: Path, domain: str, done: list[str], where: str, f: Findings
) -> None:
    """K7 + the paid-off-by-N+1 check, for every topic the ledger records as rewritten."""
    domain_dir = topics_root / domain
    for slug in done:
        sidecar = domain_dir / slug / "prompts.yaml"
        if not sidecar.exists():
            f.warn(where, f"topics[] records '{slug}' as rewritten but it has no prompts.yaml")
            continue
        try:
            data = yaml.safe_load(sidecar.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as e:
            f.error(where, f"topics/{domain}/{slug}/prompts.yaml does not parse: {e}")
            continue
        cliff = data.get("cliffhanger")
        if not isinstance(cliff, dict):
            continue  # a domain-final or partial pass may legitimately have none
        anchor = str((cliff.get("payoff") or {}).get("anchor") or "").strip()
        nxt = next_topic(domain_dir, slug)
        if not anchor or nxt is None:
            continue

        # Does the payoff land in the topic reading order says is next? validate_content.py
        # is the gate for "does it resolve at all"; here we check WHICH topic it lands in.
        if anchor.startswith("concepts.md#"):
            target_slug, target_anchor = nxt, anchor.split("#", 1)[1]
        else:
            m = re.match(r"^/?(?:study/)?([a-z0-9][a-z0-9-]*)/([a-z0-9][a-z0-9-]*)#(.+)$", anchor)
            if not m:
                continue
            target_slug, target_anchor = m.group(2), m.group(3)
            if m.group(1) != domain or target_slug != nxt:
                f.warn(
                    where,
                    f"K7: '{slug}' pays off into '{m.group(1)}/{target_slug}', but reading "
                    f"order says the next topic is '{domain}/{nxt}'. If topics/{domain}/"
                    f"README.md was reordered after this topic shipped, re-point the payoff; "
                    f"if the pivot is deliberate, note it in the ledger",
                )
        dest = domain_dir / target_slug / "concepts.md"
        if target_anchor not in (anchors_of(dest) or set()):
            f.warn(
                where,
                f"K7: '{slug}' pays off at '#{target_anchor}', which no longer exists in "
                f"'{domain}/{target_slug}' — check topics/{domain}/README.md row order and "
                f"re-point the payoff",
            )
            continue

        # The promise is only checkable once the destination is itself migrated (K1).
        if target_slug not in done:
            continue
        noun = k1_noun(led, slug)
        if not noun:
            continue
        dest_opener = opener_text(dest)
        if noun.lower() not in dest_opener.lower():
            f.warn(
                where,
                f"K1: '{target_slug}' is rewritten but its opener never names "
                f"'{noun}', the loop '{slug}' left open. The opener must name the loop and "
                f"say where in the topic it settles",
            )
        if noun.lower() not in section_text(dest, target_anchor).lower():
            f.warn(
                where,
                f"K1: section '#{target_anchor}' of '{target_slug}' does not mention "
                f"'{noun}' — a payoff must answer the loop, not merely exist",
            )


def check_open_cliffhanger(
    led: dict, topics_root: Path, domain: str, slugs: list[str], done: list[str],
    where: str, f: Findings
) -> None:
    """Validate the ledger's `open_cliffhanger` block itself.

    `check_cliffhangers()` above validates the anchor that ships in `prompts.yaml`. Nothing
    validated the ledger's own copy of it, so the two could silently disagree — and the
    ledger's copy is what the next topic's operator reads at `--resume`, so a stale one
    sends them at the wrong section. Four things are checkable while holding only the
    ledger: that `from` is the topic the ledger says was rewritten last, that `to_position`
    matches `position`, that `payoff_anchor` resolves in the destination, and that it agrees
    with the shipped sidecar.

    All warnings, never errors. K7 already establishes that a mid-wave README reorder must
    not hard-fail two untouched files, and the same reasoning applies here.
    """
    oc = led.get("open_cliffhanger")
    if not isinstance(oc, dict) or not oc:
        return
    pos = led.get("position") if isinstance(led.get("position"), int) else None
    src = str(oc.get("from") or "").strip()

    if not src:
        f.warn(where, "open_cliffhanger has no 'from' — name the topic that left the loop")
    elif done and src != done[-1]:
        f.warn(where, f"open_cliffhanger.from is '{src}' but the last topics[] entry is "
                      f"'{done[-1]}'. Exactly one cliffhanger is live and it is overwritten "
                      f"every topic, so this one is stale")
    elif src not in slugs:
        f.warn(where, f"open_cliffhanger.from '{src}' is not a topic in plan[]/README order")

    if isinstance(oc.get("to_position"), int) and pos and oc["to_position"] != pos:
        f.warn(where, f"open_cliffhanger.to_position is {oc['to_position']} but 'position' is "
                      f"{pos} — the open loop must point at the topic you are about to write")

    anchor = str(oc.get("payoff_anchor") or "").strip()
    if not anchor:
        f.warn(where, "open_cliffhanger has no 'payoff_anchor' — the payoff is unverifiable")
        return

    dest_slug = slugs[pos - 1] if pos and 1 <= pos <= len(slugs) else None
    if anchor.startswith("concepts.md#"):
        target_slug, target_anchor = dest_slug, anchor.split("#", 1)[1]
    else:
        m = re.match(r"^/?(?:study/)?([a-z0-9][a-z0-9-]*)/([a-z0-9][a-z0-9-]*)#(.+)$", anchor)
        if not m:
            f.warn(where, f"open_cliffhanger.payoff_anchor '{anchor}' is neither "
                          f"'concepts.md#a' nor '<domain>/<slug>#a'")
            return
        target_slug, target_anchor = m.group(2), m.group(3)
        if m.group(1) != domain:
            target_slug = None  # a cross-domain finale: nothing to check in this ledger
    if not target_slug:
        return

    dest = topics_root / domain / target_slug / "concepts.md"
    if target_anchor not in (anchors_of(dest) or set()):
        f.warn(where, f"open_cliffhanger.payoff_anchor '#{target_anchor}' does not resolve in "
                      f"'{domain}/{target_slug}'. A payoff is verified against the "
                      f"UN-rewritten destination, whose headings are frozen, so this should "
                      f"never drift — re-read the destination's H2 list")
    elif oc.get("verified_present") is not True:
        f.warn(where, f"open_cliffhanger.verified_present is {oc.get('verified_present')!r} — "
                      f"set it to true only after opening '{domain}/{target_slug}' at "
                      f"'#{target_anchor}' and reading the promised mechanism")

    # The ledger and the shipped sidecar must name the same anchor, or --resume lies.
    if src:
        sidecar = topics_root / domain / src / "prompts.yaml"
        if sidecar.exists():
            try:
                data = yaml.safe_load(sidecar.read_text(encoding="utf-8")) or {}
            except yaml.YAMLError:
                return  # check_cliffhangers() already reported the parse failure
            shipped = str(
                ((data.get("cliffhanger") or {}).get("payoff") or {}).get("anchor") or ""
            ).strip()
            if shipped and shipped != anchor:
                f.warn(where, f"open_cliffhanger.payoff_anchor '{anchor}' disagrees with "
                              f"topics/{domain}/{src}/prompts.yaml's '{shipped}'. The sidecar "
                              f"is what readers follow; the ledger is what the next operator "
                              f"reads. Make them identical")


def k1_noun(led: dict, slug: str) -> str:
    """The key noun the ledger says topic `slug`'s cliffhanger promised."""
    oc = led.get("open_cliffhanger")
    if isinstance(oc, dict) and str(oc.get("from") or "") == slug:
        return str(oc.get("key_noun_for_K1_grep") or "").strip()
    return ""


# ======================================================================================
# --resume — everything a fresh session needs, and nothing it does not
# ======================================================================================


def resume_brief(led: dict, slugs: list[str], topics_root: Path, domain: str) -> str:
    """Print the four ledger slices the standard says to load, for the NEXT topic."""
    pos = led.get("position") if isinstance(led.get("position"), int) else 1
    nxt = slugs[pos - 1] if 1 <= pos <= len(slugs) else None
    lines = [
        f"RESUME {domain} — position {pos} of {len(slugs)}",
        f"  next topic:      {domain}/{nxt}" if nxt else "  next topic:      (domain complete)",
    ]
    plan = {str(r.get("slug")): r for r in (led.get("plan") or []) if isinstance(r, dict)}
    for label, idx in (("previous", pos - 2), ("NEXT", pos - 1), ("after", pos)):
        if 0 <= idx < len(slugs):
            row = plan.get(slugs[idx], {})
            covers = str(row.get("covers") or "?")[:90]
            lines.append(f"  plan[{label}]:  {slugs[idx]} — {covers}")

    terms = led.get("canonical_terms") or {}
    lines.append(f"  canonical terms: {len(terms)} ({', '.join(sorted(terms)[:8])}"
                 f"{', …' if len(terms) > 8 else ''})")
    ex = led.get("running_example")
    if isinstance(ex, dict):
        lines.append(f"  running example: {ex.get('name')} (from {ex.get('established_in')})")

    for name in ("owed", "known_defects", "exemptions"):
        mine = [e for e in (led.get(name) or []) if isinstance(e, dict) and e.get("file") == nxt]
        if mine:
            lines.append(f"  {name} to you ({len(mine)}):")
            lines.extend(f"      - {json.dumps(e, default=str)[:160]}" for e in mine)

    recent = [t for t in (led.get("topics") or []) if isinstance(t, dict)][-3:]
    if recent:
        lines.append("  last 3 rewritten:")
        lines.extend(
            f"      - {t.get('position')} {t.get('slug')}: {str(t.get('one_liner') or '')[:80]}"
            for t in recent
        )
    claims = led.get("claims_established") or []
    lines.append(f"  claims established: {len(claims)} live (read them in the ledger)")

    oc = led.get("open_cliffhanger")
    if isinstance(oc, dict):
        lines.append(
            f"  LOOP TO SETTLE:  from '{oc.get('from')}' (pattern {oc.get('pattern')}), "
            f"key noun '{oc.get('key_noun_for_K1_grep')}' → {oc.get('payoff_anchor')}"
        )
        lines.append(f"      gap: {str(oc.get('gap') or '')[:160]}")
    if nxt:
        lines.append(f"  read next:       topics/{domain}/{nxt}/concepts.md (full)")
        after = slugs[pos] if pos < len(slugs) else None
        if after:
            hs = [
                f"#{h.slug}"
                for h in read_headings(topics_root / domain / after / "concepts.md")
                if h.level == 2
            ] if (topics_root / domain / after / "concepts.md").exists() else []
            lines.append(
                f"      + H2 LIST ONLY of '{after}' ({len(hs)} H2s) for the payoff anchor"
            )
    return "\n".join(lines)


# ======================================================================================
# Main
# ======================================================================================


def check_ledger(path: Path, topics_root: Path, f: Findings, resume: bool) -> dict | None:
    m = LEDGER_RE.match(path.name)
    if not m:
        f.error(str(path), "filename must be '<domain>.yaml' or '<domain>.<group>.yaml'")
        return None
    domain, group = m.group(1), m.group(2)
    where = str(path)
    try:
        led = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        f.error(where, f"YAML parse error: {e}")
        return None
    if not isinstance(led, dict):
        f.error(where, "top-level must be a mapping")
        return None

    domain_dir = topics_root / domain
    if not domain_dir.is_dir():
        f.error(where, f"no such domain: {domain_dir}")
        return None

    check_shape(led, where, domain, group, f)
    scope = reading_order(domain_dir)
    if group:
        # A shard covers exactly its catalog group, in the same reading order. Only
        # system-design is grouped today; a shard key on any other domain is a mistake.
        if domain == "system-design":
            scope = [s for s in scope if sd_group_key(s) == group]
        else:
            f.warn(where, f"'{domain}' has no catalog groups, so a '.{group}' shard covers "
                          f"the whole domain — use '{domain}.yaml'")
    slugs = plan_slugs(led, where, f)
    check_plan_against_readme(slugs, scope, where, domain, f)
    check_position(led, slugs, where, f)

    done = [
        str(t.get("slug"))
        for t in (led.get("topics") or [])
        if isinstance(t, dict) and t.get("slug")
    ]
    for slug in done:
        if slug not in scope:
            f.error(where, f"topics[] records '{slug}', which is not a topic in this scope")
    done = [s for s in done if s in scope]
    check_terminology(led, topics_root, domain, done, where, f)
    check_cliffhangers(led, topics_root, domain, done, where, f)
    check_open_cliffhanger(led, topics_root, domain, slugs or scope, done, where, f)

    if resume:
        print(resume_brief(led, slugs or scope, topics_root, domain))
        print()
    return {"domain": domain, "group": group, "plan": len(slugs), "rewritten": len(done),
            "position": led.get("position")}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ledgers", default=None, help="default: docs/continuity")
    ap.add_argument("--topics", default=None, help="default: topics")
    ap.add_argument("--domain", default=None, help="only ledgers for this domain")
    ap.add_argument("--resume", action="store_true", help="print the resume brief per ledger")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    repo = Path(__file__).resolve().parent.parent
    ledger_dir = Path(args.ledgers) if args.ledgers else repo / "docs" / "continuity"
    topics_root = Path(args.topics) if args.topics else repo / "topics"

    if not ledger_dir.is_dir():
        print(f"No ledger directory at {ledger_dir} — nothing to check yet.")
        return 0
    files = sorted(
        p for p in ledger_dir.glob("*.yaml")
        if not args.domain or p.name.split(".")[0] == args.domain
    )
    if not files:
        scope = f" for domain '{args.domain}'" if args.domain else ""
        print(f"No ledger{scope} in {ledger_dir} — nothing to check yet "
              f"(the pilot writes the first one at Pass 0).")
        return 0

    f = Findings()
    summaries = [s for s in (check_ledger(p, topics_root, f, args.resume) for p in files) if s]

    if args.json:
        print(json.dumps({"ledgers": summaries, "errors": f.errors, "warnings": f.warnings},
                         indent=2))
    else:
        if f.warnings:
            print(f"⚠️  {len(f.warnings)} warning(s) — none of these fails the build:\n")
            for w in f.warnings:
                print(f"  - {w}")
            print()
        if f.errors:
            print(f"❌ {len(f.errors)} continuity error(s):\n")
            for e in f.errors:
                print(f"  - {e}")
        else:
            for s in summaries:
                name = f"{s['domain']}{'.' + s['group'] if s['group'] else ''}"
                print(f"✅ {name}: {s['rewritten']}/{s['plan']} topic(s) rewritten, "
                      f"position {s['position']}.")
    return 1 if f.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
