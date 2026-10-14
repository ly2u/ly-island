"""Opens a built island in a real browser the way visitors will.

The build is served with the headers from its _headers file, including the
Content-Security-Policy, the way Cloudflare's static assets serve it.

    python tools/browser-check/check.py site/dist [--theme isometric|text] [--screenshots DIR]

Checks, on a 360 px wide screen:
- with JavaScript off: the home page links to every record, and every record
  page shows its title and text;
- nothing scrolls sideways;
- with JavaScript on: no console errors, no blocked resources or
  Content-Security-Policy violations, and the isometric theme's script ran.

Requires: playwright (pip) and its Chromium.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from playwright.sync_api import sync_playwright

TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
         ".xml": "application/xml", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8"}


def header_rules(dist: Path) -> list[tuple[str, list[tuple[str, str]]]]:
    rules: list[tuple[str, list[tuple[str, str]]]] = []
    path = dist / "_headers"
    if not path.exists():
        return rules
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[0].isspace():
            rules.append((line.strip(), []))
        elif rules and ":" in line:
            name, value = line.strip().split(":", 1)
            rules[-1][1].append((name.strip(), value.strip()))
    return rules


class Handler(SimpleHTTPRequestHandler):
    """Serves dist like Cloudflare static assets: auto trailing slash, 404.html, _headers."""

    rules: list[tuple[str, list[tuple[str, str]]]] = []

    def log_message(self, *args: object) -> None:  # quiet
        pass

    def do_GET(self) -> None:  # noqa: N802
        root = Path(self.directory)
        path = unquote(urlsplit(self.path).path)
        target = root / path.lstrip("/")
        if path.endswith("/"):
            target = target / "index.html"
        elif target.is_dir():
            self.send_response(307)
            self.send_header("Location", path + "/")
            self.end_headers()
            return
        status = 200
        if not target.is_file() or root.resolve() not in target.resolve().parents:
            target, status = root / "404.html", 404
        body = target.read_bytes()
        self.send_response(status)
        headers = {"Content-Type": TYPES.get(target.suffix, "application/octet-stream")}
        for pattern, values in self.rules:
            if fnmatch.fnmatchcase(path, pattern):
                for name, value in values:
                    headers[name] = value
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dist", type=Path)
    parser.add_argument("--theme", choices=["isometric", "text"])
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    dist: Path = args.dist
    manifest = json.loads((dist / ".well-known" / "island.json").read_text(encoding="utf-8"))
    origin = manifest["id"]
    posts, url = [], manifest["links"]["outbox"]
    while url:
        page_doc = json.loads((dist / url[len(origin) + 1:]).read_text(encoding="utf-8"))
        posts += [item for item in page_doc["items"] if item["type"] == "post"]
        url = page_doc.get("next")
    paths = [post["object"]["url"][len(origin):] for post in posts]

    Handler.rules = header_rules(dist)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(dist)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    problems: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()

        # Without JavaScript, on a phone.
        context = browser.new_context(java_script_enabled=False, viewport={"width": 360, "height": 740})
        page = context.new_page()
        page.goto(base + "/")
        links = set(page.eval_on_selector_all("a[href]", "links => links.map(a => new URL(a.href).pathname)"))
        if args.screenshots:
            args.screenshots.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(args.screenshots / "home-mobile-nojs.png"), full_page=True)
        for path, post in zip(paths, posts):
            if path not in links and "/records/" not in links:
                problems.append(f"home page (no JavaScript) does not link to {path}")
            page.goto(base + path)
            text = page.inner_text("main")
            title = post["object"].get("title")
            if title and title not in text:
                problems.append(f"{path} (no JavaScript): title not shown")
            if len(text.strip()) < 20:
                problems.append(f"{path} (no JavaScript): almost no text")
        for path in ["/", "/records/", *paths]:
            page.goto(base + path)
            wide = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if wide > 0:
                problems.append(f"{path}: scrolls sideways by {wide}px at 360px wide")
        context.close()

        # With JavaScript, under the Content-Security-Policy.
        context = browser.new_context(viewport={"width": 360, "height": 740})
        page = context.new_page()
        errors: list[str] = []
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("requestfailed", lambda request: errors.append(f"request failed: {request.url}"))
        for path in ["/", "/records/", *paths]:
            errors.clear()
            page.goto(base + path)
            page.wait_for_load_state("networkidle")
            problems += [f"{path}: {error}" for error in errors]
        page.goto(base + "/")
        page.wait_for_load_state("networkidle")
        if args.theme == "isometric":
            vitality = page.get_attribute("[data-island-world]", "data-vitality")
            if vitality is None:
                problems.append("isometric theme: the script did not run (no data-vitality)")
        if args.screenshots:
            page.screenshot(path=str(args.screenshots / "home-mobile.png"), full_page=True)
            desktop = context.new_page()
            desktop.set_viewport_size({"width": 1280, "height": 900})
            desktop.goto(base + "/")
            desktop.screenshot(path=str(args.screenshots / "home-desktop.png"), full_page=True)
            if paths:
                desktop.goto(base + paths[-1])
                desktop.screenshot(path=str(args.screenshots / "record-desktop.png"), full_page=True)
        browser.close()
    server.shutdown()

    print(f"{dist}: {'pass' if not problems else f'{len(problems)} problems'} ({len(paths)} records, theme {args.theme})")
    for problem in problems:
        print(f"  {problem}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
