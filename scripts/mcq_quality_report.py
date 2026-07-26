#!/usr/bin/env python3
"""mcq_quality_report.py — non-blocking MCQ assessment-quality metrics.

Reports test-integrity signals that the schema validator doesn't cover, chiefly
the *distractor-length giveaway*: if the correct option is consistently the
longest, a test-wise learner can score well above chance without knowing the
material. Also reports answer-position bias.

Usage:
    python scripts/mcq_quality_report.py [topics_dir] [--domain <slug>] [--json]

Exit code is always 0 (this is a report, not a gate) unless --fail-over is set.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required: pip install pyyaml")


def analyze(files: list[str]) -> dict:
    per_domain: dict[str, dict] = {}
    overall = {
        "n": 0,
        "uniq_longest_correct": 0,
        "shortest_correct": 0,
        "correct_len": 0,
        "distractor_len": 0,
        "distractor_n": 0,
        "answer_pos": {},
    }
    for f in files:
        parts = f.replace("\\", "/").split("/")
        dom = parts[parts.index("topics") + 1] if "topics" in parts else "?"
        try:
            data = yaml.safe_load(open(f, encoding="utf-8"))
        except Exception:
            continue
        d = per_domain.setdefault(
            dom,
            {"n": 0, "uniq_longest_correct": 0, "shortest_correct": 0,
             "correct_len": 0, "distractor_len": 0, "distractor_n": 0, "answer_pos": {}},
        )
        for q in (data.get("questions") or []):
            opts, ans = q.get("options"), q.get("answer")
            if not isinstance(opts, list) or not isinstance(ans, int):
                continue
            if not (0 <= ans < len(opts)):
                continue
            lens = [len(str(o)) for o in opts]
            c = lens[ans]
            mx, mn = max(lens), min(lens)
            for bucket in (overall, d):
                bucket["n"] += 1
                bucket["correct_len"] += c
                for i, ln in enumerate(lens):
                    if i != ans:
                        bucket["distractor_len"] += ln
                        bucket["distractor_n"] += 1
                if c == mx and lens.count(mx) == 1:
                    bucket["uniq_longest_correct"] += 1
                if c == mn and lens.count(mn) == 1:
                    bucket["shortest_correct"] += 1
                bucket["answer_pos"][ans] = bucket["answer_pos"].get(ans, 0) + 1
    return {"overall": overall, "per_domain": per_domain}


def summarize(b: dict) -> dict:
    n = max(b["n"], 1)
    dn = max(b["distractor_n"], 1)
    return {
        "questions": b["n"],
        "uniquely_longest_correct_pct": round(100 * b["uniq_longest_correct"] / n, 1),
        "shortest_correct_pct": round(100 * b["shortest_correct"] / n, 1),
        "avg_correct_len": round(b["correct_len"] / n, 1),
        "avg_distractor_len": round(b["distractor_len"] / dn, 1),
        "len_ratio": round((b["correct_len"] / n) / (b["distractor_len"] / dn), 2),
        "answer_position": {str(k): b["answer_pos"][k] for k in sorted(b["answer_pos"])},
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("topics_dir", nargs="?", default="topics")
    ap.add_argument("--domain", default=None)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--fail-over", type=float, default=None,
                    help="exit 1 if overall uniquely-longest-correct%% exceeds this")
    args = ap.parse_args()

    pat = os.path.join(args.topics_dir, args.domain or "*", "*", "questions.yaml")
    files = sorted(glob.glob(pat))
    if not files:
        print(f"No questions.yaml under {pat}")
        return 0

    res = analyze(files)
    ov = summarize(res["overall"])

    if args.json:
        print(json.dumps({"overall": ov,
                          "per_domain": {d: summarize(b) for d, b in res["per_domain"].items()}},
                         indent=2))
    else:
        print(f"MCQ quality — {ov['questions']} questions")
        print(f"  uniquely-longest-correct: {ov['uniquely_longest_correct_pct']}%  (random ~25-33%; lower is better)")
        print(f"  shortest-correct:         {ov['shortest_correct_pct']}%")
        print(f"  avg len correct/distractor: {ov['avg_correct_len']}/{ov['avg_distractor_len']} = {ov['len_ratio']}x")
        print(f"  answer-position spread:   {ov['answer_position']}")
        print("\n  worst domains by longest-correct%:")
        rows = sorted(((summarize(b)["uniquely_longest_correct_pct"], d, b["n"])
                       for d, b in res["per_domain"].items()), reverse=True)
        for pct, d, n in rows[:10]:
            print(f"    {pct:5.1f}%  {d} (n={n})")

    if args.fail_over is not None and ov["uniquely_longest_correct_pct"] > args.fail_over:
        print(f"\nFAIL: {ov['uniquely_longest_correct_pct']}% > threshold {args.fail_over}%")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
