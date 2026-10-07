#!/usr/bin/env python3
"""Record the authorized island source and live static files, excluding dependency/staging files."""
import datetime
import hashlib
import json
from pathlib import Path
root=Path('/opt/ly-stack/apps/ly-island-preview')
paths=[root/name for name in ['package.json','package-lock.json','vite.config.js','index.html','README.md']]
paths.extend(p for name in ['src','dist'] for p in (root/name).rglob('*') if p.is_file())
for p in paths:
    if p.is_symlink():
        raise SystemExit('Island source manifest does not accept symlinks.')
package=json.loads((root/'package.json').read_text())
manifest={'createdUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'version':package['version'],
          'type':'authorized floating-island public view and unified administration scene',
          'three':package['dependencies']['three'],'vite':package['devDependencies']['vite'],
          'files':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}}
(root/'SOURCE-MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('Recorded authorized island source and live build:',len(paths),'files, version',package['version'])
