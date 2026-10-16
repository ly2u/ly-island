"""Prove the browser gate rejects indirect payloads the HTML-only scan misses.

Run with a built isometric dist. Uses only disposable copies and the same
check.py command as CI. No external server or network access is needed.
"""
from __future__ import annotations

import base64
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> None:
    source = Path(sys.argv[1]).resolve()
    checker = Path(__file__).with_name("check.py")
    payload = base64.b64encode(random.Random(17).randbytes(300_000)).decode("ascii")
    cases = {
        "module-import": {
            "probe.js": 'import "./large.js";',
            "large.js": f'export const payload = "{payload}";',
        },
        "css-import": {
            "probe.css": '@import "./large.css";',
            "large.css": f"/*{payload}*/",
        },
        "runtime-data": {
            "probe.js": 'fetch("/_astro/large.json").then(r => r.json());',
            "large.json": f'{{"payload":"{payload}"}}',
        },
    }
    with tempfile.TemporaryDirectory(prefix="island-budget-") as temporary:
        for name, files in cases.items():
            dist = Path(temporary) / name
            shutil.copytree(source, dist)
            for file, body in files.items():
                (dist / "_astro" / file).write_text(body, encoding="utf-8")
            home = dist / "index.html"
            tag = ('<link rel="stylesheet" href="/_astro/probe.css">' if "probe.css" in files
                   else '<script type="module" src="/_astro/probe.js"></script>')
            home.write_text(home.read_text(encoding="utf-8").replace("</head>", tag + "</head>"), encoding="utf-8")
            result = subprocess.run([sys.executable, str(checker), str(dist), "--theme", "isometric"],
                                    capture_output=True, text=True, timeout=60)
            if result.returncode != 1 or "over the 204800 budget" not in result.stdout:
                raise AssertionError(f"{name}: expected a measured budget rejection\n{result.stdout}\n{result.stderr}")
            print(f"{name}: measured budget rejection passed")


if __name__ == "__main__":
    main()
