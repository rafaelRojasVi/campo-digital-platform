from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]

result = subprocess.run(
    [
        "git",
        "ls-files",
        "-co",
        "--exclude-standard",
        "-z",
        "--",
        "*.md",
    ],
    cwd=ROOT,
    check=True,
    capture_output=True,
)

MARKDOWN_FILES = sorted(
    ROOT / relative_path
    for raw_path in result.stdout.decode("utf-8").split("\0")
    if raw_path
    for relative_path in [Path(raw_path)]
)

LINK_RE = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")

errors: list[str] = []

for markdown_file in MARKDOWN_FILES:
    text = markdown_file.read_text(encoding="utf-8")

    for raw_target in LINK_RE.findall(text):
        target = raw_target.strip()

        if not target:
            continue

        if target.startswith(("#", "http://", "https://", "mailto:")):
            continue

        # Ignore an optional Markdown title after a path.
        if ' "' in target:
            target = target.split(' "', 1)[0]

        target = unquote(target)

        # Remove an anchor before checking the filesystem path.
        path_part = target.split("#", 1)[0]

        if not path_part:
            continue

        resolved = (markdown_file.parent / path_part).resolve()

        try:
            resolved.relative_to(ROOT.resolve())
        except ValueError:
            errors.append(f"{markdown_file.relative_to(ROOT)} -> {target}: escapes repository root")
            continue

        if not resolved.exists():
            errors.append(f"{markdown_file.relative_to(ROOT)} -> {target}: target does not exist")

if errors:
    print("Broken local documentation links:")
    for error in errors:
        print(f"  - {error}")
    sys.exit(1)

print(f"Documentation links OK ({len(MARKDOWN_FILES)} Markdown files checked).")
