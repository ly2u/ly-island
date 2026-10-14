#!/usr/bin/env python3
"""Checks the Markdown documents: JSON code blocks parse, and relative links
and #anchors point at files and headings that exist (GitHub's anchor rules)."""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FENCE = re.compile(r"```.*?```", re.S)


def slug(heading: str) -> str:
    kept = [
        ch
        for ch in heading.strip().lower()
        if unicodedata.category(ch)[0] in "LMN" or unicodedata.category(ch) == "Pc" or ch in " -"
    ]
    return "".join(kept).replace(" ", "-")


def anchors(text: str) -> set[str]:
    found: set[str] = set()
    counts: dict[str, int] = {}
    for match in re.finditer(r"^#{1,6}\s+(.+)$", FENCE.sub("", text), flags=re.M):
        base = slug(match.group(1))
        n = counts.get(base, 0)
        counts[base] = n + 1
        found.add(base if n == 0 else f"{base}-{n}")
    return found


def main() -> int:
    # Records under site/content are web pages: their links are site URLs, not repository paths.
    content = ROOT / "site" / "content"
    files = sorted(
        p for p in ROOT.rglob("*.md")
        if "node_modules" not in p.parts and content not in p.parents
    )
    texts = {p: p.read_text(encoding="utf-8") for p in files}
    errors: list[str] = []
    for path, text in texts.items():
        rel = path.relative_to(ROOT)
        for i, block in enumerate(re.findall(r"```json\n(.*?)```", text, flags=re.S)):
            try:
                json.loads(block)
            except json.JSONDecodeError as error:
                errors.append(f"{rel}: JSON block {i + 1}: {error}")
        for link in re.findall(r"\]\(([^)\s]+)\)", FENCE.sub("", text)):
            if re.match(r"^[a-z]+:", link):
                continue
            target_part, _, fragment = link.partition("#")
            target = (path.parent / target_part).resolve() if target_part else path
            if not target.exists():
                errors.append(f"{rel}: missing file {link}")
                continue
            if fragment and target.suffix == ".md":
                if fragment not in anchors(texts.get(target) or target.read_text(encoding="utf-8")):
                    errors.append(f"{rel}: missing anchor {link}")
    for error in errors:
        print(f"FAIL {error}")
    print(f"docs: {len(files)} files, {len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
