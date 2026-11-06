#!/usr/bin/env python3
import datetime
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

script = Path(__file__).with_name('site-status.py')
with tempfile.TemporaryDirectory(prefix='ly-status-') as tmp:
    root, data = Path(tmp)/'stack', Path(tmp)/'data'
    (root/'releases').mkdir(parents=True)
    data.mkdir()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (root/'releases/current.json').write_text(json.dumps({'releaseId': 'v2026.11.06-123456abcdef', 'commit': 'a'*40, 'deployedAt': now, 'password': 'DO NOT EXPOSE'}))
    def run(*args):
        subprocess.run([sys.executable, str(script), '--root', str(root), '--data-dir', str(data), *args], check=True)
        return json.loads((data/'site-status.json').read_text())
    value = run('refresh')
    assert value['backup'] == {} and 'DO NOT EXPOSE' not in json.dumps(value)
    assert (data/'site-status.json').stat().st_mode & 0o777 == 0o600
    value = run('success', '--archive', '/private/ly-stack-20261106T120000Z.tar.gz')
    assert value['backup']['lastRestoreVerifiedAt'] and value['backup']['archive'] == 'ly-stack-20261106T120000Z.tar.gz'
    assert '/private/' not in json.dumps(value)
    succeeded = value['backup']['lastSucceededAt']
    value = run('failure', '--exit-code', '2')
    assert value['backup']['lastSucceededAt'] == succeeded and value['backup']['lastExitCode'] == 2
    (root/'releases/current.json').write_text(json.dumps({'releaseId': 'v2026.11.07-abcdef123456', 'commit': 'b'*40, 'deployedAt': now}))
    value = run('refresh')
    assert value['release']['commit'] == 'b'*40 and value['backup']['lastSucceededAt'] == succeeded
    receipt = root/'status/backup-receipt.json'
    assert receipt.stat().st_mode & 0o777 == 0o600
    receipt.write_text(json.dumps({'lastSucceededAt': 'SECRET', 'lastFailureAt': now, 'archive': '../../SECRET', 'token': 'DO NOT EXPOSE'}))
    value = run('refresh')
    assert 'SECRET' not in json.dumps(value) and 'DO NOT EXPOSE' not in json.dumps(value)
    if os.geteuid() == 0:
        os.chown(data, 1000, 1000)
        run('refresh')
        assert (data/'site-status.json').stat().st_uid == 1000
print('Maintenance receipt passed: unknown state, filtered release, success/restore receipt, failure retention, refresh, private permissions and data-volume ownership.')
