#!/usr/bin/env python3
# 只解包到新的 0700 临时目录，绝不覆盖生产数据，不输出秘密内容。
import json
import hashlib
import os
import sys
import tarfile
import tempfile
import re
from pathlib import Path, PurePosixPath

archive = Path(sys.argv[1])
os.umask(0o077)
required = ['opt/ly-stack/compose.yaml', 'opt/ly-stack/Caddyfile',
            'opt/ly-stack/.env', 'opt/ly-stack/env/sites.env',
            'srv/ly-data/sites/posts.json']
with tempfile.TemporaryDirectory(prefix='ly-restore-check-') as directory:
    os.chmod(directory, 0o700)
    with tarfile.open(archive, 'r:gz') as source:
        members = source.getmembers()
        for entry in members:
            path = PurePosixPath(entry.name)
            if path.is_absolute() or '..' in path.parts or not (entry.isfile() or entry.isdir()):
                raise SystemExit('备份含不安全路径或链接。')
            if not (entry.name.startswith('opt/ly-stack/') or entry.name.startswith('srv/ly-data/') or entry.name in ['var/lib/ly-ai/codex/auth.json','var/lib/ly-ai/codex/config.toml']):
                raise SystemExit('备份含范围外路径。')
        names = {entry.name: entry for entry in members}
        if 'opt/ly-stack/apps/rqly-sites/admin-auth.mjs' in names and 'srv/ly-data/sites/admin-sessions.json' in names:
            raise SystemExit('新备份不应保存活动登录会话。')
        if 'opt/ly-stack/apps/rqly-sites/island-store.mjs' in names:
            required.append('srv/ly-data/sites/island.json')
        for name in required:
            if name not in names or not names[name].isfile():
                raise SystemExit('备份缺少必需文件：' + name)
        for name in ['opt/ly-stack/.env', 'opt/ly-stack/env/sites.env']:
            if names[name].mode & 0o077:
                raise SystemExit('备份中的环境文件权限过宽。')
        source.extractall(directory, filter='data')
    posts = json.loads((Path(directory) / 'srv/ly-data/sites/posts.json').read_text())
    if not isinstance(posts, list):
        raise SystemExit('恢复后的 posts.json 不是数组。')
    if any(not isinstance(post, dict) or not isinstance(post.get('slug'), str) for post in posts):
        raise SystemExit('恢复后的文章数据格式无效。')
    history_dir = Path(directory) / 'srv/ly-data/sites/content-history'
    if history_dir.exists():
        if names['srv/ly-data/sites/content-history'].mode & 0o077:
            raise SystemExit('备份中的历史目录权限过宽。')
        for file in history_dir.iterdir():
            if not file.is_file() or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*\.json', file.name):
                raise SystemExit('恢复后的历史文件名无效。')
            history=json.loads(file.read_text());versions=history.get('versions')
            if history.get('schemaVersion')!=1 or not isinstance(versions,list) or len(versions)>30:
                raise SystemExit('恢复后的历史存档无效。')
            seen=set()
            for version in versions:
                post=version.get('post',{});ident=version.get('id','')
                digest=hashlib.sha256(json.dumps(post,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
                if post.get('slug')!=file.stem or ident!=digest or ident in seen or not isinstance(post.get('body'),str) or len(post['body'])>100000 or not isinstance(version.get('savedAt'),str):
                    raise SystemExit('恢复后的历史内容或摘要无效。')
                seen.add(ident)
                cover=post.get('cover','')
                media={url for url in re.findall(r'/media/[a-f0-9]{32}\.webp',post['body']) if 'srv/ly-data/sites'+url+'.json' in names};media.update([cover] if cover else [])
                if any('srv/ly-data/sites'+url not in names for url in media):
                    raise SystemExit('恢复后的历史图片缺失。')
            relative='srv/ly-data/sites/content-history/'+file.name
            if names[relative].mode & 0o077:
                raise SystemExit('备份中的历史文件权限过宽。')
    state_path = Path(directory) / 'srv/ly-data/sites/island.json'
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if state.get('schemaVersion') != 1 or not isinstance(state.get('revision'), int) or state['revision'] < 0:
            raise SystemExit('恢复后的岛屿版本无效。')
        if state.get('phase') not in ['initial', 'grown'] or state.get('lighting') not in ['afternoon', 'dusk']:
            raise SystemExit('恢复后的岛屿阶段或光照无效。')
        for phase in ['initial', 'grown']:
            for building in ['library', 'projects', 'workshop']:
                point = state.get('layouts', {}).get(phase, {}).get(building)
                if not isinstance(point, list) or len(point) != 2 or any(type(v) not in [int, float] for v in point):
                    raise SystemExit('恢复后的建筑坐标无效。')
        growth=state.get('growth',{'threshold':30,'unlocked':state['phase']=='grown'})
        if type(growth.get('threshold')) is not int or not 5 <= growth['threshold'] <= 10000 or type(growth.get('unlocked')) is not bool:
            raise SystemExit('恢复后的成长配置无效。')
        decorations=state.get('decorations',[])
        if not isinstance(decorations,list) or len(decorations)>6 or len({d.get('slot') for d in decorations})!=len(decorations) or any(d.get('slot') not in ['west','northwest','northeast','east','southwest','south'] or d.get('type') not in ['tree','bench','lamp'] for d in decorations):
            raise SystemExit('恢复后的岛屿装饰无效。')
        scenery=state.get('scenery',{})
        if not isinstance(scenery,dict):raise SystemExit('恢复后的景物布置无效。')
        for phase in ['initial','grown']:
            scene=scenery.get(phase,{})
            if not isinstance(scene,dict) or not isinstance(scene.get('trees',{}),dict):raise SystemExit('恢复后的树木布置无效。')
            points=[]
            if scene.get('postoffice') is not None:points.append(scene['postoffice'])
            for tree,point in scene.get('trees',{}).items():
                if tree not in ['tree-'+str(i) for i in range(10 if phase=='initial' else 14)] and not re.fullmatch(r'decoration-(west|northwest|northeast|east|southwest|south)',tree):raise SystemExit('恢复后的树木编号无效。')
                points.append(point)
            for point in points:
                if not isinstance(point,list) or len(point)!=2 or any(type(v) not in [int,float] or not __import__('math').isfinite(v) for v in point):raise SystemExit('恢复后的景物坐标无效。')
                x,z=point;radius=5.8 if phase=='initial' else 6.8
                if (x/radius)**2+(z/(radius*.83))**2>1 and not (phase=='grown' and ((x-9)/2.2)**2+((z-.5)/2.1)**2<=1):raise SystemExit('恢复后的景物不在岛内。')
        if names['srv/ly-data/sites/island.json'].mode & 0o077:
            raise SystemExit('备份中的岛屿文件权限过宽。')
    for name in ['opt/ly-stack/.env', 'opt/ly-stack/env/sites.env']:
        if not (Path(directory) / name).read_bytes():
            raise SystemExit('恢复后的环境文件为空。')
    ai_auth = 'var/lib/ly-ai/codex/auth.json'
    if ai_auth in names:
        if names[ai_auth].mode & 0o077 or not isinstance(json.loads((Path(directory) / ai_auth).read_text()), dict):
            raise SystemExit('AI 登录凭据权限或格式无效。')
    account_name = 'srv/ly-data/sites/admin-account.json'
    if account_name in names:
        account = json.loads((Path(directory) / account_name).read_text())
        if (account.get('schemaVersion') != 1 or not isinstance(account.get('username'), str)
                or not re.fullmatch(r'scrypt:[a-f0-9]{32}:[a-f0-9]{128}', account.get('passwordHash', ''))
                or not re.fullmatch(r'[a-f0-9]{64}', account.get('bootstrapFingerprint', ''))):
            raise SystemExit('恢复后的管理员密码存档无效。')
        if names[account_name].mode & 0o077:
            raise SystemExit('备份中的管理员密码存档权限过宽。')
    ai_root = Path(directory) / 'opt/ly-stack/apps/personal-ai'
    if (ai_root / 'SOURCE-MANIFEST.json').exists():
        ai_manifest=json.loads((ai_root / 'SOURCE-MANIFEST.json').read_text())
        for name,expected in ai_manifest['files'].items():
            if Path(name).is_absolute() or '..' in Path(name).parts or hashlib.sha256((ai_root / name).read_bytes()).hexdigest()!=expected:
                raise SystemExit('个人 AI 源码恢复校验不一致。')
        binaries=Path(directory) / 'opt/ly-stack/bin'
        for field,name in [('binarySHA256','codex-0.160.1'),('hostBinarySHA256','codex-code-mode-host-0.160.1')]:
            if field in ai_manifest and hashlib.sha256((binaries / name).read_bytes()).hexdigest()!=ai_manifest[field]:
                raise SystemExit('个人 AI 二进制恢复校验不一致。')
    organization_name = 'srv/ly-data/sites/organization.json'
    if organization_name in names:
        if names[organization_name].mode & 0o077:
            raise ValueError('内容目录权限过宽')
        organization=json.loads((Path(directory)/organization_name).read_text())
        assert organization['schemaVersion']==1 and isinstance(organization['revision'],int) and organization['revision']>=0
        items=organization['items']
        assert isinstance(items,list) and len(items)<=300
        assert len({i['id'] for i in items})==len(items)
        for item in items:
            assert re.fullmatch(r'org-[a-f0-9]{16}',item['id']) and item['type'] in ['tag','topic','series']
            assert isinstance(item['name'],str) and 0<len(item['name'].strip())<=60
            assert isinstance(item['description'],str) and len(item['description'])<=200 and isinstance(item['archived'],bool)
    drafts_name = 'srv/ly-data/sites/editor-drafts.json'
    if drafts_name in names:
        drafts = json.loads((Path(directory) / drafts_name).read_text())
        if drafts.get('schemaVersion') != 1 or not isinstance(drafts.get('drafts'), list) or len(drafts['drafts']) > 100:
            raise SystemExit('恢复后的自动编辑草稿存档无效。')
        seen = set()
        for draft in drafts['drafts']:
            if not isinstance(draft, dict) or not isinstance(draft.get('id'), str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,119}', draft['id']) or draft['id'] in seen or type(draft.get('revision')) is not int or draft['revision'] < 1:
                raise SystemExit('恢复后的编辑草稿版本或地址无效。')
            seen.add(draft['id'])
            cover=draft.get('content',{}).get('cover','')
            if not isinstance(cover,str) or (cover and not re.fullmatch(r'/media/[a-f0-9]{32}\.webp',cover)):
                raise SystemExit('恢复后的编辑草稿封面无效。')
            content = draft.get('content', {})
            if content.get('kind') not in ['note', 'blog', 'project'] or content.get('topic') not in ['记录', '工程', '探索']:
                raise SystemExit('恢复后的编辑草稿类型无效。')
            for field, limit in [('title', 100), ('slug', 80), ('body', 100000), ('summary', 250), ('date', 10)]:
                if not isinstance(content.get(field), str) or len(content[field]) > limit:
                    raise SystemExit('恢复后的编辑草稿内容无效。')
            if draft.get('sourceSlug') is not None and (not isinstance(draft['sourceSlug'], str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', draft['sourceSlug']) or not isinstance(draft.get('sourceRevision'), str) or not re.fullmatch(r'[a-f0-9]{64}', draft['sourceRevision'])):
                raise SystemExit('恢复后的编辑草稿来源无效。')
        if names[drafts_name].mode & 0o077:
            raise SystemExit('备份中的自动编辑草稿权限过宽。')
    mailbox_name = 'srv/ly-data/sites/mailbox.json'
    if mailbox_name in names:
        mailbox = json.loads((Path(directory) / mailbox_name).read_text())
        if mailbox.get('schemaVersion') != 1 or not isinstance(mailbox.get('messages'), list) or len(mailbox['messages']) > 5000 or names[mailbox_name].mode & 0o077:
            raise SystemExit('恢复后的邮局格式或权限无效。')
        seen_mail = set()
        for message in mailbox['messages']:
            if not isinstance(message, dict) or not re.fullmatch(r'[a-f0-9]{32}', message.get('id', '')) or message['id'] in seen_mail or type(message.get('revision')) is not int or message['revision'] < 1:
                raise SystemExit('恢复后的信件地址或版本无效。')
            seen_mail.add(message['id'])
            if message.get('kind') not in ['guestbook', 'letter'] or message.get('status') not in ['pending', 'private', 'published', 'hidden'] or (message['kind'] == 'letter' and message['status'] != 'private') or any(type(message.get(field)) is not bool for field in ['read', 'archived']):
                raise SystemExit('恢复后的信件隐私状态无效。')
            for field, limit in [('name', 32), ('title', 80), ('body', 3000), ('contact', 150), ('reply', 2000)]:
                if not isinstance(message.get(field), str) or len(message[field]) > limit:
                    raise SystemExit('恢复后的信件内容无效。')
            if not message['body'] or not re.fullmatch(r'[a-f0-9]{64}', message.get('submissionKey', '')):
                raise SystemExit('恢复后的信件正文或重试标识无效。')
        if not isinstance(mailbox.get('limits'), dict) or any(not re.fullmatch(r'[a-f0-9]{64}', key) or not isinstance(value, list) or any(type(stamp) not in [int, float] for stamp in value) for key, value in mailbox['limits'].items()):
            raise SystemExit('恢复后的邮局限流记录无效。')
    actions_name = 'srv/ly-data/sites/ai-actions.json'
    if actions_name in names:
        actions = json.loads((Path(directory) / actions_name).read_text())
        if actions.get('schemaVersion') != 1 or not isinstance(actions.get('actions'),list) or len(actions['actions']) > 50 or names[actions_name].mode & 0o077:
            raise SystemExit('恢复后的 AI 待确认操作格式或权限无效。')
        for action in actions['actions']:
            if not isinstance(action,dict) or not re.fullmatch(r'[a-f0-9]{36}',action.get('id','')) or action.get('type') not in ['publish','update'] or action.get('status') not in ['pending','done'] or not re.fullmatch(r'[a-f0-9]{64}',action.get('owner','')) or not re.fullmatch(r'[a-f0-9]{64}',action.get('sourceRevision','')) or type(action.get('expiresAt')) is not int or not isinstance(action.get('content'),dict):
                raise SystemExit('恢复后的 AI 待确认操作内容无效。')
    media_directory = Path(directory) / 'srv/ly-data/sites/media'
    if media_directory.exists():
        for picture in media_directory.glob('*.webp'):
            if not re.fullmatch(r'[a-f0-9]{32}\.webp', picture.name):
                raise SystemExit('恢复后的图片地址无效。')
            relative = 'srv/ly-data/sites/media/' + picture.name
            metadata_name = relative + '.json'
            if metadata_name not in names:
                raise SystemExit('恢复后的图片缺少元信息。')
            metadata = json.loads((Path(directory) / metadata_name).read_text())
            if metadata.get('filename') != picture.name or metadata.get('url') != '/media/' + picture.name or metadata.get('bytes') != picture.stat().st_size or any(type(metadata.get(field)) is not int or not 1 <= metadata[field] <= 2400 for field in ['width', 'height']):
                raise SystemExit('恢复后的图片元信息无效。')
            with picture.open('rb') as stream:
                signature = stream.read(12)
            if signature[:4] != b'RIFF' or signature[8:12] != b'WEBP':
                raise SystemExit('恢复后的图片不是 WebP。')
            if names[relative].mode & 0o077 or names[metadata_name].mode & 0o077:
                raise SystemExit('备份中的图片权限过宽。')
    for post in posts:
        cover=post.get('cover','')
        if not isinstance(cover,str) or (cover and (not re.fullmatch(r'/media/[a-f0-9]{32}\.webp',cover) or 'srv/ly-data/sites'+cover not in names)):
            raise SystemExit('恢复后的内容封面不存在或地址无效。')
    website = Path(directory) / 'opt/ly-stack/apps/rqly-sites'
    if (website / 'server.mjs').exists():
        changes = json.loads((website / 'SOURCE-CHANGES.json').read_text())
        for name, expected in changes['changed_files_sha256'].items():
            candidate = website / name
            if candidate.is_file() and hashlib.sha256(candidate.read_bytes()).hexdigest() != expected:
                raise SystemExit('网站更新文件恢复校验不一致：' + name)
        for name in ['scripts/check-static-resilience.mjs', 'organization-store.mjs', 'scripts/check-organization.mjs', 'public/rqly/organization-core.mjs', 'content-history.mjs', 'scripts/import-content-history.mjs', 'scripts/check-content-tools.mjs', 'public/rqly/search-core.mjs', 'scripts/check-preview-map.mjs', 'public/rqly/preview-sync.js', 'scripts/check-island-scenery.mjs', 'mailbox-store.mjs', 'scripts/check-mailbox.mjs', 'public/rqly/admin-mailbox.js', 'ai-site-tools.mjs', 'personal-ai.mjs', 'scripts/check-ai-tools.mjs', 'public/rqly/quota.js', 'server.mjs', 'scripts/check.mjs', 'scripts/check-password.mjs', 'island-store.mjs', 'Dockerfile', 'public/rqly/admin.html', 'public/rqly/admin.js', 'public/rqly/admin.css', 'admin-auth.mjs', 'admin-account.mjs', 'public/rqly/login.html', 'public/rqly/login.js', 'public/rqly/session-nav.js']:
            expected = changes['changed_files_sha256'].get(name)
            if expected and hashlib.sha256((website / name).read_bytes()).hexdigest() != expected:
                raise SystemExit('网站更新文件恢复校验不一致：' + name)
    island = Path(directory) / 'opt/ly-stack/apps/ly-island-preview'
    if island.exists():
        manifest = json.loads((island / 'SOURCE-MANIFEST.json').read_text())
        for name, expected in manifest['files'].items():
            relative = PurePosixPath(name)
            if relative.is_absolute() or '..' in relative.parts:
                raise SystemExit('浮空岛源码清单路径无效。')
            actual = hashlib.sha256(island.joinpath(*relative.parts).read_bytes()).hexdigest()
            if actual != expected:
                raise SystemExit('浮空岛源码或构建产物校验不一致：' + name)
        if not (island / 'dist/index.html').is_file():
            raise SystemExit('备份缺少浮空岛构建入口。')
print('临时目录解包、posts.json / island.json 读取及源码哈希通过；未覆盖生产目录。')
