#!/usr/bin/env python3
import hashlib
import json
import sys
import zipfile
from pathlib import Path

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'apps/midas_vueflow/SOURCE-MANIFEST.json').read_text())
if manifest['commit'] != '7a56c7a08b72ece3f8e921a8746939ec14718c84':
    raise SystemExit('CivilFlow source version differs; inspect before deploying.')
for entry in manifest['files']:
    content = (root / 'apps/midas_vueflow' / entry['path']).read_bytes()
    digest = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
    if digest != entry['sha']:
        raise SystemExit('CivilFlow source mismatch: ' + entry['path'])
archive = root / 'incoming/rqly-7zui-vps.zip'
expected = '7fc6be6d0853fdba130179db6d83057596d7b4155193dbf091673cf2c76f253a'
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise SystemExit('Website ZIP SHA-256 mismatch.')
app = root / 'apps/rqly-sites'
changes_path = app / 'SOURCE-CHANGES.json'
changes = json.loads(changes_path.read_text()) if changes_path.exists() else None
if changes and changes['baseline_zip_sha256'] != expected:
    raise SystemExit('Website change manifest baseline differs.')
approved = changes['changed_files_sha256'] if changes else {}
removed = set(changes['removed_files']) if changes else set()
for name, digest in approved.items():
    target = app / name
    if not target.is_relative_to(app) or '..' in Path(name).parts:
        raise SystemExit('Unsafe website change manifest path.')
    if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        raise SystemExit('Approved website change mismatch: ' + name)
for name in removed:
    if '..' in Path(name).parts or Path(name).is_absolute() or (app / name).exists():
        raise SystemExit('Withdrawn website asset is present or path is unsafe: ' + name)
with zipfile.ZipFile(archive) as source:
    for entry in source.infolist():
        if entry.is_dir():
            continue
        relative = entry.filename.removeprefix('rqly-sites/')
        if relative in removed or relative in approved:
            continue
        content = (root / 'apps' / entry.filename).read_bytes()
        original = source.read(entry.filename)
        if entry.filename == 'rqly-sites/public/rqly/index.html':
            original = original.replace(
                b'<a href="/about">',
                b'<a href="https://midas.rqly.com">CivilFlow</a><a href="/about">', 1)
        if content != original:
            raise SystemExit('Website source mismatch: ' + entry.filename)
print('Sources verified: CivilFlow V2 139 Git blobs; original website ZIP plus recorded authorized changes and withdrawals.')
