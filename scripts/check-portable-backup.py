#!/usr/bin/env python3
"""Synthetic restore fixtures: no production paths or private content."""
import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('portable', Path(__file__).with_name('verify-portable-content.py'))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
def serialized(value):
    return json.dumps(value, ensure_ascii=False)

with tempfile.TemporaryDirectory(prefix='ly-portable-backup-') as folder:
    root = Path(folder)
    body = '😀 原文\n![图](/media/'+('a'*32)+'.webp)\n$L=30$'
    post = {'slug':'fixture','title':'复核','body':body,'published':False}
    (root/'posts.json').write_text(serialized([post]))
    catalog = {'schemaVersion':1,'revision':0,'items':[]}
    name = 'a'*32+'.webp'
    media = root/'media'
    media.mkdir()
    image = b'RIFFfixtureWEBP'  # Byte snapshot validation; real decode belongs to Node import checks.
    (media/name).write_bytes(image)
    info = {'filename':name,'url':'/media/'+name,'width':1,'height':1,'bytes':len(image),'createdAt':'2026-10-07T00:00:00Z'}
    (media/(name+'.json')).write_text(serialized(info))
    prefix = body[:body.index('/media/')]
    offset = len(prefix.encode('utf-16-le'))//2
    markdown = '---\n'+ '\n'.join(key+': '+serialized(value) for key,value in post.items() if key!='body')+'\n---\n\n'+body.replace('/media/','../media/')
    files = {'posts/fixture.md':markdown.encode(),'organization.json':serialized(catalog).encode(),'media/'+name:image,'README.md':b'fixture'}
    def make(values,manifest_update=None):
        manifest = {'format':'ly-content','version':1,'records':[{'type':'post','path':'posts/fixture.md','mediaOffsets':[offset]}],'media':[info], 'files':{key:{'bytes':len(value),'sha256':hashlib.sha256(value).hexdigest()} for key,value in values.items()}}
        if manifest_update:
            manifest_update(manifest)
        target = root/'test.zip'
        with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as output:
            for key,value in {**values,'manifest.json':serialized(manifest).encode()}.items():
                output.writestr(key,value)
        return target
    def rejects(package):
        try:
            checker.validate(package,root)
        except Exception:
            return
        raise AssertionError('Invalid fixture was accepted')
    checker.validate(make(files),root)
    rejects(make(files,lambda m:m['files']['posts/fixture.md'].update(sha256='0'*64)))
    rejects(make({**files,'../outside.txt':b'bad'}))
    rejects(make(files,lambda m:m['media'].clear()))
    rejects(make(files,lambda m:m['records'][0].update(mediaOffsets=[0])))
    (root/'posts.json').write_text(serialized([{**post,'title':'different snapshot'}]))
    rejects(make(files))
    (root/'posts.json').write_text(serialized([post]))
    (media/name).write_bytes(b'changed image')
    rejects(make(files))
# Execute the real shell recovery trap with synthetic paths and fake services.
with tempfile.TemporaryDirectory(prefix='ly-backup-trap-') as folder:
    root = Path(folder)
    stack = root/'stack'
    data = root/'sites'
    backups = root/'backups'
    binaries = root/'bin'
    for directory in [stack/'env', data, backups, binaries]:
        directory.mkdir(parents=True)
    (stack/'.env').write_text('fixture')
    (stack/'env/sites.env').write_text('fixture')
    (data/'posts.json').write_text('[]')
    log = root/'calls.log'
    (binaries/'docker').write_text("""#!/usr/bin/env python3
import os,sys
from pathlib import Path
args=sys.argv[1:]
with open(os.environ['LY_TEST_LOG'],'a') as file: file.write('docker '+' '.join(args)+'\\n')
if args[:2]==['compose','ps']:
 print('sites\\ncaddy' if '--services' in args else 'fixture-container');sys.exit(0)
if args[0]=='inspect':print('fixture-image');sys.exit(0)
if args[0]=='run':
 if '-e' in args:sys.exit({'probe-failure':13,'old-image':42}.get(os.environ['LY_TEST_CASE'],0))
 sys.exit(13)
""")
    (binaries/'systemctl').write_text("""#!/usr/bin/env python3
import os,sys
with open(os.environ['LY_TEST_LOG'],'a') as file:file.write('systemctl '+' '.join(sys.argv[1:])+'\\n')
sys.exit(0)
""")
    (binaries/'tar').write_text('#!/bin/sh\nexit 13\n')
    for executable in binaries.iterdir():
        executable.chmod(0o700)
    source = Path(__file__).with_name('backup.sh').read_text()
    source = source.replace('/opt/ly-stack', str(stack)).replace('/srv/ly-data/sites', str(data)).replace('/srv/ly-backups', str(backups))
    script = root/'backup.sh'
    script.write_text(source)
    for case in ['probe-failure','export-failure','old-image']:
        log.write_text('')
        (data/'content-export.zip').write_bytes(b'stale-fixture')
        result = subprocess.run(['bash', str(script)], env={**os.environ,'PATH':str(binaries)+':'+os.environ['PATH'],'LY_TEST_LOG':str(log),'LY_TEST_CASE':case}, capture_output=True, text=True)
        assert result.returncode != 0, case
        calls = log.read_text()
        assert 'docker compose stop --timeout 20 sites caddy' in calls and 'docker compose start sites caddy' in calls, case
        assert 'systemctl stop ly-ai.service' in calls and 'systemctl start ly-ai.service' in calls, case
        if case=='old-image':
            assert not (data/'content-export.zip').exists(), 'Old images must not keep stale portable packages'
print('Portable backup passed (10 cases): UTF-16/emoji roundtrip, ZIP integrity and snapshot mismatch rejection; probe/export/tar failures resume sites, caddy and AI, and old images omit stale content packages.')
