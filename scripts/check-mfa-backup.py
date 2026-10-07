#!/usr/bin/env python3
"""MFA restore fixtures; no production paths, secrets or network."""
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

verify_script = Path(__file__).with_name('verify-backup.py')
key = 'cd' * 32
state = {'schemaVersion': 1, 'enabled': True, 'authVersion': 'a' * 32,
         'secret': {'iv': 'b' * 24, 'tag': 'c' * 32, 'ciphertext': 'd' * 64},
         'recoveryHashes': ['e' * 64], 'pending': None}
with tempfile.TemporaryDirectory(prefix='ly-mfa-restore-check-') as folder:
    archive = Path(folder) / 'fixture.tar.gz'
    def run(mfa=None, include_key=False, mode=0o600, key_value=key):
        files = {'opt/ly-stack/compose.yaml': b'fixture', 'opt/ly-stack/Caddyfile': b'fixture',
                 'opt/ly-stack/.env': b'FIXTURE=1', 'opt/ly-stack/env/sites.env': b'FIXTURE=1',
                 'srv/ly-data/sites/posts.json': b'[]'}
        if mfa is not None:
            files['srv/ly-data/sites/admin-mfa.json'] = json.dumps(mfa).encode()
        if include_key:
            files['srv/ly-data/sites/admin-mfa-key.json'] = json.dumps({'schemaVersion': 1, 'key': key_value}).encode()
        with tarfile.open(archive, 'w:gz') as target:
            for name, content in files.items():
                entry = tarfile.TarInfo(name); entry.size = len(content)
                entry.mode = mode if '/admin-mfa' in name else 0o600
                target.addfile(entry, io.BytesIO(content))
        result = subprocess.run([sys.executable, str(verify_script), str(archive)], capture_output=True, text=True)
        assert key not in result.stdout + result.stderr
        return result.returncode
    assert run() == 0
    assert run(state, True) == 0
    assert run(state) != 0
    assert run(state, True, mode=0o644) != 0
    assert run(state, True, key_value='invalid') != 0
    assert run({**state, 'secret': 'plaintext'}, True) != 0
    disabled = {**state, 'enabled': False, 'secret': None, 'recoveryHashes': []}
    assert run(disabled) == 0
    pending = {**disabled, 'pending': {'secret': state['secret']}}
    assert run(pending) != 0
    assert run(pending, True) == 0
    print('MFA backup passed (9 cases): legacy, enabled, disabled and pending recovery; required key, private permissions, malformed encrypted secret/key and no secret disclosure.')
