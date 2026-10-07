#!/usr/bin/env python3
"""Verify isolated mailbox recovery archives; never reads production data or credentials."""
import copy
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

VERIFY = Path(__file__).with_name('verify-backup.py')
KEY = 'ab' * 32
legacy = {'schemaVersion': 1, 'messages': [{'id': 'a' * 32, 'revision': 1, 'kind': 'letter',
          'status': 'private', 'read': False, 'archived': False, 'name': 'fixture', 'title': '',
          'body': 'isolated recovery fixture', 'contact': '', 'reply': '',
          'createdAt': '2026-10-07T00:00:00.000Z', 'submissionKey': 'b' * 64}],
          'meter': {'day': '2026-10-07', 'count': 1}, 'limits': {'c' * 64: [123]}}
current = copy.deepcopy(legacy)
current['messages'][0]['submissionKeyVersion'] = 'hmac-v1'
current['limits'] = {'hmac:' + 'd' * 64: [123]}

with tempfile.TemporaryDirectory(prefix='ly-mailbox-backup-check-') as folder:
    archive = Path(folder) / 'fixture.tar.gz'
    def verify(mailbox, include_key=False, key_mode=0o600, key_data=None):
        files = {'opt/ly-stack/compose.yaml': b'fixture', 'opt/ly-stack/Caddyfile': b'fixture',
                 'opt/ly-stack/.env': b'FIXTURE=1\n', 'opt/ly-stack/env/sites.env': b'FIXTURE=1\n',
                 'srv/ly-data/sites/posts.json': b'[]',
                 'srv/ly-data/sites/mailbox.json': json.dumps(mailbox).encode()}
        if include_key:
            files['srv/ly-data/sites/mailbox-key.json'] = json.dumps(key_data or {'schemaVersion': 1, 'key': KEY}).encode()
        with tarfile.open(archive, 'w:gz') as target:
            for name, contents in files.items():
                entry = tarfile.TarInfo(name)
                entry.size = len(contents)
                entry.mode = key_mode if name.endswith('/mailbox-key.json') else 0o600
                target.addfile(entry, io.BytesIO(contents))
        result = subprocess.run([sys.executable, str(VERIFY), str(archive)], stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True)
        assert KEY not in result.stdout, 'Verifier disclosed key'
        return result

    legacy_result = verify(legacy)
    assert legacy_result.returncode == 0, 'Legacy archives must remain recoverable: ' + legacy_result.stdout
    assert verify(current, include_key=True).returncode == 0, 'HMAC archive with key must restore'
    assert verify(current).returncode != 0, 'HMAC archive missing key must fail'
    assert verify(current, include_key=True, key_mode=0o644).returncode != 0, 'Broad key permissions must fail'
    assert verify(current, include_key=True, key_data={'schemaVersion': 1, 'key': 'invalid'}).returncode != 0
    wrong = copy.deepcopy(current)
    wrong['limits'] = {'unrecognized:' + 'd' * 64: [123]}
    assert verify(wrong, include_key=True).returncode != 0
    retry_only = copy.deepcopy(current)
    retry_only['limits'] = {}
    assert verify(retry_only).returncode != 0, 'Retry receipts also require original key'
    print('Mailbox backup passed (7 cases): legacy/current restore, required key, restrictive permissions, malformed key/limits and no secret disclosure.')
