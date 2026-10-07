#!/usr/bin/env python3
"""Validate a private portable ZIP against its stopped-service data snapshot."""
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

def validate(package, data_dir):
    data_dir = Path(data_dir)
    with zipfile.ZipFile(package) as source:
        entries = source.infolist()
        names = [item.filename for item in entries]
        allowed = re.compile(r'(?:manifest\.json|README\.md|organization\.json|island\.json|posts/[a-z0-9-]{1,80}\.md|drafts/draft-\d+\.md|history/[a-z0-9-]+-[a-f0-9]{64}\.md|media/[a-f0-9]{32}\.webp)')
        if len(names) > 50000 or len(set(names)) != len(names) or any(not allowed.fullmatch(name) for name in names):
            raise ValueError('内容包包含无效或重复路径。')
        total = 0
        text = 0
        for item in entries:
            mode = (item.external_attr >> 16) & 0o170000
            total += item.file_size
            if not item.filename.startswith('media/'):
                text += item.file_size
            if mode not in [0, 0o100000] or item.flag_bits & 1 or total > 2200*1024**2 or text > 64*1024**2:
                raise ValueError('内容包包含链接、加密或超限内容。')
        manifest = json.loads(source.read('manifest.json'))
        if manifest.get('format') != 'ly-content' or manifest.get('version') != 1 or not isinstance(manifest.get('files'), dict) or set(manifest['files']) != set(names)-{'manifest.json'}:
            raise ValueError('内容包清单无效。')
        for name, info in manifest['files'].items():
            digest = hashlib.sha256()
            size = 0
            with source.open(name) as stream:
                while chunk := stream.read(1024*1024):
                    size += len(chunk)
                    digest.update(chunk)
            if size != info['bytes'] or digest.hexdigest() != info['sha256']:
                raise ValueError('内容包文件校验失败。')
        def record(entry):
            value = source.read(entry['path']).decode('utf-8')
            match = re.fullmatch(r'---\n([\s\S]*?)\n---\n\n([\s\S]*)', value)
            if not match:
                raise ValueError('内容包 Markdown 格式无效。')
            metadata = {}
            for line in match[1].split('\n'):
                key, raw = line.split(': ', 1)
                if key in metadata:
                    raise ValueError('重复元数据。')
                metadata[key] = json.loads(raw)
            # JS offsets are UTF-16 code units, not Python code points.
            body = match[2].encode('utf-16-le', errors='surrogatepass')
            for offset in reversed(entry.get('mediaOffsets', [])):
                start = offset*2
                if body[start:start+6] != '../'.encode('utf-16-le'):
                    raise ValueError('图片相对路径清单无效。')
                body = body[:start]+body[start+4:]
            metadata['body'] = body.decode('utf-16-le', errors='surrogatepass')
            if metadata.get('cover', '').startswith('../media/'):
                metadata['cover'] = metadata['cover'][2:]
            return metadata
        actual_posts = {item['slug']: item for item in json.loads((data_dir/'posts.json').read_text())}
        packed_posts = {item['slug']: item for item in [record(entry) for entry in manifest['records'] if entry['type']=='post']}
        if packed_posts != actual_posts:
            raise ValueError('内容包文章与备份快照不一致。')
        draft_file = data_dir/'editor-drafts.json'
        drafts = json.loads(draft_file.read_text())['drafts'] if draft_file.exists() else []
        packed_drafts = [record(entry) for entry in manifest['records'] if entry['type']=='editorDraft']
        if packed_drafts != [item['content'] for item in drafts]:
            raise ValueError('内容包编辑草稿与快照不一致。')
        history = {}
        for file in (data_dir/'content-history').glob('*.json'):
            for version in json.loads(file.read_text())['versions']:
                history['history/'+file.stem+'-'+version['id']+'.md'] = version['post']
        if {entry['path']: record(entry) for entry in manifest['records'] if entry['type']=='history'} != history:
            raise ValueError('内容包历史与快照不一致。')
        organization = data_dir/'organization.json'
        catalog = json.loads(organization.read_text()) if organization.exists() else {'schemaVersion':1,'revision':0,'items':[]}
        if json.loads(source.read('organization.json')) != catalog:
            raise ValueError('内容包目录与快照不一致。')
        island = data_dir/'island.json'
        if island.exists() and json.loads(source.read('island.json')) != json.loads(island.read_text()):
            raise ValueError('内容包岛屿配置与快照不一致。')
        expected_media = {file.name for file in (data_dir/'media').glob('*.webp')}
        if {item['filename'] for item in manifest['media']} != expected_media:
            raise ValueError('内容包图片清单与快照不一致。')
        for image in manifest['media']:
            file = data_dir/'media'/image['filename']
            if json.loads(file.with_suffix('.webp.json').read_text()) != image:
                raise ValueError('内容包图片信息与快照不一致。')
            with file.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            if digest != manifest['files']['media/'+image['filename']]['sha256']:
                raise ValueError('内容包图片与快照不一致。')

if __name__ == '__main__':
    try:
        validate(Path(sys.argv[1]), Path(sys.argv[2]))
        print('可移植内容包与备份数据、图片逐项校验通过。')
    except Exception:
        raise SystemExit('可移植内容包校验失败；没有输出正文或个人信息。')
