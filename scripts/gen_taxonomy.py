#!/usr/bin/env python3
"""One-shot generator: turn the research JSON into TOPICS.md, per-domain README
index files, and the ROADMAP content-progress table.

Usage: python scripts/gen_taxonomy.py <research_json_file>
Idempotent-ish: overwrites TOPICS.md and topics/<d>/README.md; rewrites the block
between the CONTENT-PROGRESS markers in ROADMAP.md.
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

DOMAIN_SLUGS = {
    "System Design": "system-design",
    "Docker": "docker",
    "Kubernetes": "kubernetes",
    "DevOps & CI/CD": "devops-cicd",
    "Spring Boot": "spring-boot",
    "Spring Framework Core": "spring-core",
    "Hibernate & JPA": "hibernate-jpa",
    "Apache Tomcat": "apache-tomcat",
    "Java & JVM (framework-relevant)": "java-jvm",
    "Java & JVM": "java-jvm",
    "Messaging & Databases": "messaging-databases",
}


def clean(s: str) -> str:
    return html.unescape(str(s)).strip()


def dedupe_slugs(topics: list[dict]) -> None:
    seen: dict[str, int] = {}
    for t in topics:
        base = t["slug"]
        if base in seen:
            seen[base] += 1
            t["slug"] = f"{base}-{seen[base]}"
        else:
            seen[base] = 0


def load(path: Path) -> list[dict]:
    raw = json.loads(path.read_text())
    data = raw["result"] if isinstance(raw, dict) and "result" in raw else raw
    if isinstance(data, str):
        data = json.loads(data)
    return data


def domain_slug(name: str) -> str:
    return DOMAIN_SLUGS.get(clean(name), re.sub(r"[^\w]+", "-", clean(name).lower()).strip("-"))


def write_master(data: list[dict]) -> int:
    lines = [
        "# TOPICS — Master interview taxonomy",
        "",
        "The complete map of what this library documents: every domain → topics →",
        "subtopics, with representative interview questions. Generated from research;",
        "refine by editing this file (and keep slugs stable — they name folders).",
        "",
        "Frequency = how often the topic shows up in interviews (very-high → low).",
        "",
        "## Domains",
        "",
    ]
    total_topics = 0
    for d in data:
        dslug = domain_slug(d["domain"])
        lines.append(f"- [{clean(d['domain'])}](#{dslug}) — {len(d['topics'])} topics")
    lines.append("")

    for d in data:
        dslug = domain_slug(d["domain"])
        topics = d["topics"]
        dedupe_slugs(topics)
        total_topics += len(topics)
        lines.append(f'<a id="{dslug}"></a>')
        lines.append(f"## {clean(d['domain'])}")
        lines.append("")
        lines.append(f"Folder: `topics/{dslug}/` · {len(topics)} topics")
        lines.append("")
        for t in topics:
            freq = t.get("frequency", "")
            diff = t.get("difficulty", "")
            meta = " · ".join(x for x in [f"freq: {freq}" if freq else "", f"difficulty: {diff}" if diff else ""] if x)
            lines.append(f"### {clean(t['name'])}")
            lines.append("")
            lines.append(f"`{dslug}/{t['slug']}`" + (f" — {meta}" if meta else ""))
            lines.append("")
            lines.append(clean(t["description"]))
            lines.append("")
            subs = t.get("subtopics") or []
            if subs:
                lines.append("**Subtopics:**")
                lines.append("")
                for s in subs:
                    lines.append(f"- {clean(s)}")
                lines.append("")
            qs = t.get("sampleQuestions") or []
            if qs:
                lines.append("**Sample interview questions:**")
                lines.append("")
                for q in qs:
                    lines.append(f"- {clean(q)}")
                lines.append("")

    (REPO / "TOPICS.md").write_text("\n".join(lines) + "\n")
    return total_topics


def write_domain_readmes(data: list[dict]) -> None:
    for d in data:
        dslug = domain_slug(d["domain"])
        ddir = REPO / "topics" / dslug
        ddir.mkdir(parents=True, exist_ok=True)
        lines = [
            f"# {clean(d['domain'])}",
            "",
            f"{len(d['topics'])} topics. Study content and MCQs live in per-topic",
            "subfolders. See the master taxonomy in `../../TOPICS.md`.",
            "",
            "| Topic | Slug | Freq | Difficulty | Status |",
            "|---|---|---|---|---|",
        ]
        for t in d["topics"]:
            lines.append(
                f"| {clean(t['name'])} | `{t['slug']}` | {t.get('frequency','')} "
                f"| {t.get('difficulty','')} | ☐ |"
            )
        lines.append("")
        lines.append("Status: ☐ not started · ◐ concepts done · ● concepts+MCQs · ✅ validated")
        lines.append("")
        (ddir / "README.md").write_text("\n".join(lines) + "\n")


def update_roadmap(data: list[dict]) -> None:
    rm = REPO / "ROADMAP.md"
    text = rm.read_text()
    block = ["", "Per-topic status lives in each `topics/<domain>/README.md`. Domain rollup:", ""]
    block.append("| Domain | Topics | Authored |")
    block.append("|---|---|---|")
    for d in data:
        dslug = domain_slug(d["domain"])
        block.append(f"| [{clean(d['domain'])}](topics/{dslug}/README.md) | {len(d['topics'])} | 0 |")
    block.append("")
    new = re.sub(
        r"<!-- CONTENT-PROGRESS-START -->.*?<!-- CONTENT-PROGRESS-END -->",
        "<!-- CONTENT-PROGRESS-START -->\n" + "\n".join(block) + "\n<!-- CONTENT-PROGRESS-END -->",
        text,
        flags=re.DOTALL,
    )
    rm.write_text(new)


def main() -> int:
    src = Path(sys.argv[1])
    data = load(src)
    total = write_master(data)
    write_domain_readmes(data)
    update_roadmap(data)
    print(f"Generated TOPICS.md ({len(data)} domains, {total} topics), "
          f"{len(data)} domain READMEs, and updated ROADMAP.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
