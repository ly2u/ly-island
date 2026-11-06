#!/usr/bin/env python3
"""Export a bounded, credential-free maintenance receipt to the existing data volume."""
import argparse
import datetime
import json
import os
import re
import tempfile
from pathlib import Path


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='microseconds')


def read_json(path):
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 65536:
        return {}
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (ValueError, OSError):
        return {}


def date(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        return value if datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo else None
    except ValueError:
        return None


def atomic(path, value, owner=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name+'.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.chmod(name, 0o600)
        if owner and os.geteuid() == 0:
            os.chown(name, owner.st_uid, owner.st_gid)
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def refresh(root, data):
    current = read_json(root/'releases/current.json')
    receipt = read_json(root/'status/backup-receipt.json')
    release = {}
    if re.fullmatch(r'v[0-9][0-9A-Za-z._-]{0,40}-[0-9a-f]{12}', str(current.get('releaseId', ''))):
        release['id'] = current['releaseId']
    if re.fullmatch(r'[0-9a-f]{40}', str(current.get('commit', ''))):
        release['commit'] = current['commit']
    if date(current.get('deployedAt')):
        release['deployedAt'] = current['deployedAt']
    backup = {key: receipt[key] for key in ['lastSucceededAt', 'lastRestoreVerifiedAt', 'lastFailureAt'] if date(receipt.get(key))}
    if re.fullmatch(r'ly-stack-\d{8}T\d{6}Z\.tar\.gz', str(receipt.get('archive', ''))):
        backup['archive'] = receipt['archive']
    if type(receipt.get('lastExitCode')) is int and 0 < receipt['lastExitCode'] < 256:
        backup['lastExitCode'] = receipt['lastExitCode']
    data.mkdir(parents=True, exist_ok=True)
    atomic(data/'site-status.json', {'schemaVersion': 1, 'generatedAt': timestamp(), 'release': release, 'backup': backup}, data.stat())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('/opt/ly-stack'))
    parser.add_argument('--data-dir', type=Path, default=Path('/srv/ly-data/sites'))
    parser.add_argument('action', choices=['refresh', 'success', 'failure'])
    parser.add_argument('--archive')
    parser.add_argument('--exit-code', type=int, default=1)
    args = parser.parse_args()
    if args.action != 'refresh':
        path = args.root/'status/backup-receipt.json'
        path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        receipt = read_json(path)
        if args.action == 'success':
            name = Path(args.archive or '').name
            if not re.fullmatch(r'ly-stack-\d{8}T\d{6}Z\.tar\.gz', name):
                raise SystemExit('Invalid backup archive name')
            receipt.update(lastSucceededAt=timestamp(), lastRestoreVerifiedAt=timestamp(), archive=name)
        else:
            receipt.update(lastFailureAt=timestamp(), lastExitCode=max(1, min(255, args.exit_code)))
        atomic(path, receipt)
    refresh(args.root, args.data_dir)


if __name__ == '__main__':
    main()
