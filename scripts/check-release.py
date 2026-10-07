#!/usr/bin/env python3
"""scripts/release.py 的端到端测试，在模拟环境中运行。

不需要 Docker 守护进程、网络或生产目录：
- 用一个假的 docker 命令（状态保存在 JSON 文件里）模拟镜像构建、打标签和容器切换；
- 用一个本地 HTTP 服务模拟 Caddy：健康检查结果取决于"当前运行的镜像"，首页和资源直接读岛屿 dist；
- 用本地 bare 仓库作为 origin。

覆盖：预检查不改线上、成功发布、未合并标签、检查失败、配置不一致、产物被改动、备份失败、
sites 镜像不健康时自动回滚、岛屿资源异常时自动回滚、连续手动撤销，以及备份校验能识别发布产物。
"""
import hashlib
import http.server
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
RELEASE = REPO_ROOT / 'scripts' / 'release.py'
GIT_ENV = {'GIT_AUTHOR_NAME': 'test', 'GIT_AUTHOR_EMAIL': 'test@example.invalid',
           'GIT_COMMITTER_NAME': 'test', 'GIT_COMMITTER_EMAIL': 'test@example.invalid'}

FAKE_DOCKER = r'''#!/usr/bin/env python3
import hashlib, json, os, sys
from pathlib import Path
state_path = Path(os.environ['FAKE_DOCKER_STATE'])
state = json.loads(state_path.read_text())
args = sys.argv[1:]
def save(): state_path.write_text(json.dumps(state))
def resolve(ref): return state['tags'].get(ref) or (ref if ref in state['images'] else None)
state.setdefault('calls', []).append(args); save()
if args[:2] == ['image', 'inspect']:
    found = resolve(args[-1])
    if not found: sys.exit(1)
    print(found); sys.exit(0)
if args[0] == 'tag':
    found = resolve(args[1])
    if not found: sys.exit(1)
    state['tags'][args[2]] = found; save(); sys.exit(0)
if args[0] == 'rmi':
    state['tags'].pop(args[1], None); save(); sys.exit(0)
if args[0] == 'build':
    tag, context = args[args.index('-t') + 1], Path(args[-1])
    digest = hashlib.sha256()
    for path in sorted(context.rglob('*')):
        if path.is_file():
            digest.update(path.relative_to(context).as_posix().encode()); digest.update(path.read_bytes())
    image = 'sha256:' + digest.hexdigest()
    state['images'][image] = {'bad': (context / 'BAD_RELEASE').exists()}
    state['tags'][tag] = image; save(); sys.exit(0)
if args[0] == 'compose':
    image = state['tags'].get('ly-sites:current')
    state['running'] = image; save()
    sys.exit(1 if state['images'].get(image, {}).get('bad') else 0)
if args[0] == 'run':
    rest, mounts, workdir = args[1:], {}, None
    while rest[0].startswith('-'):
        flag = rest.pop(0)
        if flag == '-v':
            host, container = rest.pop(0).split(':'); mounts[container] = host
        elif flag == '-w':
            workdir = rest.pop(0)
    command = ' '.join(rest[1:])
    root = Path(mounts['/w'])
    host_dir = root / workdir[len('/w/'):]
    if 'check' in command and (root / 'FAIL_CHECKS').exists():
        print('simulated check failure'); sys.exit(1)
    if 'npm run build' in command:
        digest = hashlib.sha256((host_dir / 'index.html').read_bytes())
        admin = hashlib.sha256()
        for path in sorted((host_dir / 'src').rglob('*')):
            (admin if path.name == 'admin-scene.js' else digest).update(path.read_bytes())
        h, a = digest.hexdigest()[:10], admin.hexdigest()[:10]
        dist = host_dir / 'dist'; (dist / 'assets').mkdir(parents=True)
        (dist / 'assets' / ('island-%s.js' % h)).write_text("console.log('%s')" % h)
        (dist / 'assets' / ('island-%s.css' % h)).write_text('/* %s */' % h)
        (dist / 'admin-scene.js').write_text('// admin %s' % a)
        broken = '<!-- BROKEN -->' if (root / 'BAD_ISLAND').exists() else ''
        (dist / 'index.html').write_text('<!doctype html>%s<script type="module" src="/island/assets/island-%s.js"></script>'
                                         '<link rel="stylesheet" href="/island/assets/island-%s.css">' % (broken, h, h))
    sys.exit(0)
print('fake docker: unsupported', args); sys.exit(2)
'''


class Failure(Exception):
    pass


def expect(condition, message):
    if not condition:
        raise Failure(message)


def sh(*command, cwd=None, env=None, check=True):
    result = subprocess.run(command, cwd=cwd, env={**os.environ, **GIT_ENV, **(env or {})},
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if check and result.returncode != 0:
        raise Failure('命令失败：%s\n%s' % (' '.join(map(str, command)), result.stdout))
    return result


def tree_digest(base, skip=()):
    digest = hashlib.sha256()
    for path in sorted(Path(base).rglob('*')):
        relative = path.relative_to(base).as_posix()
        if any(relative == s or relative.startswith(s + '/') for s in skip):
            continue
        if path.is_file():
            digest.update(relative.encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


def manifest_consistent(island):
    manifest = json.loads((island / 'SOURCE-MANIFEST.json').read_text())
    for name, expected in manifest['files'].items():
        if hashlib.sha256((island / name).read_bytes()).hexdigest() != expected:
            return False
    return True


def main():
    with tempfile.TemporaryDirectory(prefix='ly-release-check-') as temporary:
        base = Path(temporary)
        author, origin, root = base / 'author', base / 'origin.git', base / 'ly-stack'

        # ---- 用当前仓库的文件建一个 origin 仓库
        listed = sh('git', '-C', str(REPO_ROOT), 'ls-files', '-z', '--cached', '--others', '--exclude-standard').stdout
        author.mkdir()
        for name in filter(None, listed.split('\0')):
            source = REPO_ROOT / name
            if source.is_file():
                target = author / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        sh('git', 'init', '-q', '-b', 'main', str(author))
        sh('git', 'add', '-A', cwd=author)
        sh('git', 'commit', '-q', '-m', 'fixture', cwd=author)
        sh('git', 'init', '-q', '--bare', str(origin))
        sh('git', 'remote', 'add', 'origin', str(origin), cwd=author)

        def publish(tag, change=None, branch='main'):
            if change:
                change()
                sh('git', 'add', '-A', cwd=author)
                sh('git', 'commit', '-q', '-m', 'change for ' + tag, cwd=author)
            sh('git', 'tag', tag, cwd=author)
            sh('git', 'push', '-q', 'origin', 'HEAD:refs/heads/' + branch, 'refs/tags/' + tag, cwd=author)
            return sh('git', 'rev-parse', 'HEAD', cwd=author).stdout.strip()

        commit_1 = publish('v1.0.0')

        # ---- 模拟的生产目录（迁移完成后的状态：compose.yaml 已使用 ly-sites:current）
        root.mkdir()
        for name in ['compose.yaml', 'Caddyfile']:
            shutil.copy2(author / name, root / name)
        island = root / 'apps' / 'ly-island-preview'
        shutil.copytree(author / 'apps' / 'ly-island-preview', island)
        (island / 'dist' / 'assets').mkdir(parents=True)
        (island / 'dist' / 'assets' / 'island-original.js').write_text("console.log('original')")
        (island / 'dist' / 'admin-scene.js').write_text('// admin original')
        (island / 'dist' / 'index.html').write_text('<!doctype html><script type="module" src="/island/assets/island-original.js"></script>')
        sh(sys.executable, str(author / 'scripts' / 'record-island-source.py'), str(island))
        original_index = (island / 'dist' / 'index.html').read_bytes()
        sh('git', 'clone', '-q', str(origin), str(root / 'repository'))

        bin_dir = base / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'docker').write_text(FAKE_DOCKER)
        os.chmod(bin_dir / 'docker', 0o755)
        state_path = base / 'docker-state.json'
        state_path.write_text(json.dumps({'images': {'sha256:original': {'bad': False}},
                                          'tags': {'ly-sites:current': 'sha256:original'},
                                          'running': 'sha256:original'}))
        state = lambda: json.loads(state_path.read_text())

        # ---- 模拟 Caddy
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                running = state()['running']
                healthy = not state()['images'].get(running, {}).get('bad')
                status, body = 404, b''
                if self.path == '/notes' and (base / 'NOTES_DOWN').exists():
                    status = 500
                elif self.path in ('/healthz', '/notes'):
                    status, body = (200, b'ok') if healthy else (502, b'')
                elif self.path == '/api/posts':
                    status, body = (200, b'{"posts":[]}') if healthy else (502, b'')
                elif self.path == '/':
                    body = (island / 'dist' / 'index.html').read_bytes()
                    status = 500 if b'BROKEN' in body else 200
                elif self.path.startswith('/island/'):
                    target = island / 'dist' / self.path[len('/island/'):]
                    if target.is_file():
                        status, body = 200, target.read_bytes()
                        stale = base / 'STALE_CONTENT'
                        if stale.exists() and body == stale.read_bytes():
                            body = b'// stale copy served instead of the new file'
                self.send_response(status)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()

        backup_marker = base / 'backups.log'
        env = {'LY_DATA_DIR': str(root / 'test-data'), 'LY_ROOT': str(root), 'LY_DOCKER': str(bin_dir / 'docker'), 'FAKE_DOCKER_STATE': str(state_path),
               'LY_HTTP_BASE': 'http://127.0.0.1:%d' % server.server_address[1], 'LY_REQUIRE_ROOT': '0',
               'LY_BACKUP_CMD': 'echo backup >> %s' % backup_marker, 'LY_BACKUP_LOCK': str(base / 'backup.lock'),
               'LY_CHECK_RETRIES': '2', 'LY_CHECK_DELAY': '0.05', 'LY_KEEP_RELEASES': '20'}

        def release(*args, extra=None):
            return sh(sys.executable, str(RELEASE), *args, env={**env, **(extra or {})}, check=False)

        live = lambda: tree_digest(root, skip=('releases', 'repository'))
        release_id = lambda tag, commit: '%s-%s' % (tag, commit[:12])
        groups = 0

        # A. 预检查不改线上
        before = live()
        result = release('check', 'v1.0.0')
        expect(result.returncode == 0, 'check v1.0.0 应通过：\n' + result.stdout)
        expect('可以发布' in result.stdout, '预检查报告应说明可以发布')
        expect(live() == before, '预检查不应修改线上文件')
        expect(state()['running'] == 'sha256:original' and state()['tags']['ly-sites:current'] == 'sha256:original',
               '预检查不应切换容器或镜像标签')
        first = release_id('v1.0.0', commit_1)
        record = json.loads((root / 'releases' / first / 'release.json').read_text())
        expect(record['state'] == 'checked' and not (root / 'releases' / first / 'work').exists(), '预检查记录或清理不正确')
        groups += 1

        # B. 成功发布
        result = release('deploy', first)
        expect(result.returncode == 0, 'deploy v1.0.0 应成功：\n' + result.stdout)
        expect(backup_marker.read_text().count('backup') == 1, '发布前应运行一次备份')
        expect(state()['tags']['ly-sites:current'] == record['image']['id'] == state()['running'], '应切换到新镜像')
        index_1 = (root / 'releases' / first / 'island-dist' / 'index.html').read_bytes()
        expect((island / 'dist' / 'index.html').read_bytes() == index_1, '岛屿首页应更新为发布版本')
        expect((island / 'dist' / 'assets' / 'island-original.js').exists(), '旧的岛屿资源应保留')
        expect(manifest_consistent(island), '发布后岛屿清单应与文件一致')
        current = json.loads((root / 'releases' / 'current.json').read_text())
        expect(current['releaseId'] == first and current['commit'] == commit_1, 'current.json 应记录本次发布')
        groups += 1

        # C. 未合并到 main 的标签
        sh('git', 'checkout', '-q', '-b', 'side', cwd=author)
        publish('v9.0.0', lambda: (author / 'side.txt').write_text('side'), branch='side')
        sh('git', 'checkout', '-q', 'main', cwd=author)
        result = release('check', 'v9.0.0')
        expect(result.returncode == 1 and '不在 origin/main 上' in result.stdout, '未合并的标签应被拒绝：\n' + result.stdout)
        groups += 1

        # D. 检查失败：记录 check-failed，线上不变
        before = live()
        publish('v1.0.1', lambda: (author / 'FAIL_CHECKS').write_text('x'))
        result = release('check', 'v1.0.1')
        expect(result.returncode == 1 and '预检查未通过' in result.stdout, '检查失败时预检查应失败：\n' + result.stdout)
        failed = [p for p in (root / 'releases').iterdir() if p.name.startswith('v1.0.1-')][0]
        expect(json.loads((failed / 'release.json').read_text())['state'] == 'check-failed', '应记录 check-failed')
        expect(release('deploy', failed.name).returncode == 1, 'check-failed 的版本不能发布')
        expect(live() == before, '检查失败不应修改线上')
        groups += 1

        # E. sites 镜像不健康：自动回滚到 v1.0.0
        commit_2 = publish('v1.0.2', lambda: ((author / 'FAIL_CHECKS').unlink(),
                                              (author / 'apps' / 'rqly-sites' / 'BAD_RELEASE').write_text('x')))
        second = release_id('v1.0.2', commit_2)
        expect(release('check', 'v1.0.2').returncode == 0, 'check v1.0.2 应通过')
        result = release('deploy', second)
        expect(result.returncode == 1 and '已自动回滚' in result.stdout, '不健康的镜像应触发自动回滚：\n' + result.stdout)
        expect(state()['tags']['ly-sites:current'] == record['image']['id'] == state()['running'], '应回到 v1.0.0 的镜像')
        expect((island / 'dist' / 'index.html').read_bytes() == index_1, '岛屿应保持 v1.0.0')
        expect(json.loads((root / 'releases' / 'current.json').read_text())['releaseId'] == first, 'current.json 应仍为 v1.0.0')
        expect(json.loads((root / 'releases' / second / 'release.json').read_text())['state'] == 'rolled-back', '应记录 rolled-back')
        groups += 1

        # F. 岛屿首页异常：自动回滚，岛屿源码和清单恢复
        island_source_before = tree_digest(island, skip=('dist', 'SOURCE-MANIFEST.json'))
        commit_3 = publish('v1.0.3', lambda: ((author / 'apps' / 'rqly-sites' / 'BAD_RELEASE').unlink(),
                                              (author / 'BAD_ISLAND').write_text('x'),
                                              (author / 'apps' / 'ly-island-preview' / 'src' / 'main.js').open('a').write('\n// v1.0.3\n')))
        third = release_id('v1.0.3', commit_3)
        expect(release('check', 'v1.0.3').returncode == 0, 'check v1.0.3 应通过')
        result = release('deploy', third)
        expect(result.returncode == 1 and '已自动回滚' in result.stdout, '岛屿异常应触发自动回滚：\n' + result.stdout)
        expect((island / 'dist' / 'index.html').read_bytes() == index_1, '岛屿首页应恢复为 v1.0.0')
        expect(tree_digest(island, skip=('dist', 'SOURCE-MANIFEST.json')) == island_source_before, '岛屿源码应恢复为 v1.0.0')
        expect(manifest_consistent(island), '回滚后岛屿清单应与文件一致')
        expect(sorted(p.name for p in (island / 'dist').iterdir() if p.is_file()) == ['admin-scene.js', 'index.html'],
               '回滚后不应留下本次发布新增的顶层文件')
        expect(state()['running'] == record['image']['id'], 'sites 应仍为 v1.0.0')
        groups += 1

        # G. 第二次正常发布
        commit_4 = publish('v1.0.4', lambda: ((author / 'BAD_ISLAND').unlink(),
                                              (author / 'apps' / 'rqly-sites' / 'server.mjs').open('a').write('\n// v1.0.4\n')))
        fourth = release_id('v1.0.4', commit_4)
        expect(release('check', 'v1.0.4').returncode == 0, 'check v1.0.4 应通过')
        result = release('deploy', fourth)
        expect(result.returncode == 0, 'deploy v1.0.4 应成功：\n' + result.stdout)
        record_4 = json.loads((root / 'releases' / fourth / 'release.json').read_text())
        expect(record_4['previous']['releaseId'] == first and state()['running'] == record_4['image']['id'], '应记录上一个发布并切换镜像')
        expect(manifest_consistent(island), '发布后岛屿清单应与文件一致')
        groups += 1

        # H. 连续手动撤销：v1.0.4 → v1.0.0 → 迁移前
        expect(release('rollback').returncode == 0, '撤销 v1.0.4 应成功')
        expect(json.loads((root / 'releases' / 'current.json').read_text())['releaseId'] == first, '应回到 v1.0.0')
        expect(state()['running'] == record['image']['id'] and (island / 'dist' / 'index.html').read_bytes() == index_1, '镜像和岛屿应为 v1.0.0')
        expect(release('rollback').returncode == 0, '撤销 v1.0.0 应成功')
        expect(json.loads((root / 'releases' / 'current.json').read_text())['releaseId'] is None, '应回到迁移前')
        expect(state()['running'] == 'sha256:original' and (island / 'dist' / 'index.html').read_bytes() == original_index, '应恢复迁移前的镜像和岛屿')
        expect(manifest_consistent(island), '撤销后岛屿清单应与文件一致')
        result = release('rollback')
        expect(result.returncode == 1 and '没有可撤销的发布' in result.stdout, '迁移前状态不能再撤销')
        groups += 1

        # I. 线上配置与标签不一致：预检查报告说明原因，发布被拒绝
        commit_5 = publish('v1.0.5', lambda: (author / 'apps' / 'rqly-sites' / 'server.mjs').open('a').write('\n// v1.0.5\n'))
        fifth = release_id('v1.0.5', commit_5)
        caddy = (root / 'Caddyfile').read_text()
        (root / 'Caddyfile').write_text(caddy + '\n# local edit\n')
        result = release('check', 'v1.0.5')
        expect(result.returncode == 0 and '现在还不能发布' in result.stdout and 'Caddyfile' in result.stdout, '应报告配置差异：\n' + result.stdout)
        before = live()
        result = release('deploy', fifth)
        expect(result.returncode == 1 and 'Caddyfile' in result.stdout and live() == before, '配置不一致时应拒绝发布')
        (root / 'Caddyfile').write_text(caddy)
        groups += 1

        # J. 预检查产物被改动：拒绝发布
        tampered = root / 'releases' / fifth / 'island-dist' / 'admin-scene.js'
        original = tampered.read_text()
        tampered.write_text(original + '// tampered')
        result = release('deploy', fifth)
        expect(result.returncode == 1 and '发布目录被改动' in result.stdout, '产物被改动时应拒绝发布')
        tampered.write_text(original)
        groups += 1

        # K. 发布前备份失败：不做任何修改
        before, running = live(), state()['running']
        result = release('deploy', fifth, extra={'LY_BACKUP_CMD': 'false'})
        expect(result.returncode == 1 and '备份失败' in result.stdout, '备份失败时应停止')
        expect(live() == before and state()['running'] == running, '备份失败时线上应不变')
        expect(json.loads((root / 'releases' / fifth / 'release.json').read_text())['state'] == 'checked', '状态应保持 checked')
        groups += 1

        # M. 线上本来就有地址不通：预检查报告原因，发布在备份之前被拒绝
        (base / 'NOTES_DOWN').write_text('x')
        commit_6 = publish('v1.0.6', lambda: (author / 'apps' / 'rqly-sites' / 'server.mjs').open('a').write('\n// v1.0.6\n'))
        result = release('check', 'v1.0.6')
        expect(result.returncode == 0 and '现在还不能发布' in result.stdout and '/notes' in result.stdout, '应报告线上地址异常：\n' + result.stdout)
        backups_before, before = backup_marker.read_text(), live()
        result = release('deploy', release_id('v1.0.6', commit_6))
        expect(result.returncode == 1 and '/notes' in result.stdout, '线上地址异常时应拒绝发布')
        expect(backup_marker.read_text() == backups_before and live() == before, '拒绝发布时不应备份或修改线上')
        (base / 'NOTES_DOWN').unlink()
        groups += 1

        # L. 备份校验能识别发布产物（用 verify-backup.py 检查一个模拟归档）
        expect(release('deploy', fifth).returncode == 0, 'deploy v1.0.5 应成功')
        archive = base / 'backup.tar.gz'

        def build_archive(mutate=None):
            with tarfile.open(archive, 'w:gz') as bundle:
                def add_file(arcname, data, mode=0o600):
                    info = tarfile.TarInfo(arcname)
                    info.size, info.mode = len(data), mode
                    bundle.addfile(info, __import__('io').BytesIO(data))
                add_file('opt/ly-stack/.env', b'ACME_EMAIL=test@example.invalid\n')
                add_file('opt/ly-stack/env/sites.env', b'ADMIN_USERNAME=ly\n')
                add_file('srv/ly-data/sites/posts.json', b'[]\n')
                for name in ['compose.yaml', 'Caddyfile']:
                    bundle.add(root / name, arcname='opt/ly-stack/' + name)
                bundle.add(island, arcname='opt/ly-stack/apps/ly-island-preview')
                for path in sorted((root / 'releases').rglob('*')):
                    relative = path.relative_to(root).as_posix()
                    if path.name == '.lock' or '/work/' in relative:
                        continue
                    if mutate and relative == mutate:
                        data = path.read_bytes() + b'\n// changed'
                        add_file('opt/ly-stack/' + relative, data, 0o644)
                        continue
                    bundle.add(path, arcname='opt/ly-stack/' + relative, recursive=False)

        build_archive()
        result = sh(sys.executable, str(REPO_ROOT / 'scripts' / 'verify-backup.py'), str(archive), check=False)
        expect(result.returncode == 0, '包含发布目录的备份应通过校验：\n' + result.stdout)
        build_archive(mutate='releases/%s/src/apps/rqly-sites/server.mjs' % fifth)
        result = sh(sys.executable, str(REPO_ROOT / 'scripts' / 'verify-backup.py'), str(archive), check=False)
        expect(result.returncode != 0 and '恢复校验不一致' in result.stdout, '被改动的发布源码应使备份校验失败：\n' + result.stdout)
        groups += 1

        # N. 只改后台场景：首页哈希不变，但后台场景产物变了，也必须发布
        live_index_before = (island / 'dist' / 'index.html').read_bytes()
        commit_7 = publish('v1.0.7', lambda: (author / 'apps' / 'ly-island-preview' / 'src' / 'admin-scene.js').open('a').write('\n// v1.0.7\n'))
        seventh = release_id('v1.0.7', commit_7)
        result = release('check', 'v1.0.7')
        expect(result.returncode == 0, 'check v1.0.7 应通过：\n' + result.stdout)
        built_7 = root / 'releases' / seventh / 'island-dist'
        expect((built_7 / 'index.html').read_bytes() == live_index_before, '测试前提：只改后台场景时首页产物应不变')
        expect((built_7 / 'admin-scene.js').read_bytes() != (island / 'dist' / 'admin-scene.js').read_bytes(), '测试前提：后台场景产物应变化')
        result = release('deploy', seventh)
        expect(result.returncode == 0, 'deploy v1.0.7 应成功：\n' + result.stdout)
        expect((island / 'dist' / 'admin-scene.js').read_bytes() == (built_7 / 'admin-scene.js').read_bytes(), '后台场景应更新为发布版本')
        expect(tree_digest(island / 'src') == tree_digest(root / 'releases' / seventh / 'src' / 'apps' / 'ly-island-preview' / 'src'), '岛屿源码应与发布版本一致')
        expect(manifest_consistent(island), '发布后岛屿清单应与文件一致')
        groups += 1

        # O. 岛屿更新进行到一半失败（后台场景和源码已替换，首页和清单还没替换）：必须恢复完整快照
        dist_before = {p.name: p.read_bytes() for p in (island / 'dist').iterdir() if p.is_file()}
        source_before = tree_digest(island, skip=('dist', 'SOURCE-MANIFEST.json'))
        manifest_before = (island / 'SOURCE-MANIFEST.json').read_bytes()
        running_before = state()['running']
        commit_8 = publish('v1.0.8', lambda: ((author / 'apps' / 'ly-island-preview' / 'src' / 'admin-scene.js').open('a').write('\n// v1.0.8\n'),
                                              (author / 'apps' / 'ly-island-preview' / 'src' / 'main.js').open('a').write('\n// v1.0.8\n')))
        eighth = release_id('v1.0.8', commit_8)
        expect(release('check', 'v1.0.8').returncode == 0, 'check v1.0.8 应通过')
        result = release('deploy', eighth, extra={'LY_TEST_FAULT': 'island-before-index'})
        expect(result.returncode == 1 and '已自动回滚' in result.stdout, '中途失败应自动回滚：\n' + result.stdout)
        dist_after = {p.name: p.read_bytes() for p in (island / 'dist').iterdir() if p.is_file()}
        expect(dist_after == dist_before, '岛屿顶层文件（首页、后台场景）应全部恢复为发布前')
        expect(tree_digest(island, skip=('dist', 'SOURCE-MANIFEST.json')) == source_before, '岛屿源码应恢复为发布前')
        expect(manifest_consistent(island), '回滚后岛屿清单应与文件一致')
        expect(json.loads((island / 'SOURCE-MANIFEST.json').read_text())['files'] == json.loads(manifest_before)['files'], '回滚后清单记录的文件应与发布前相同')
        expect(state()['running'] == running_before, 'sites 应保持不变')
        expect(json.loads((root / 'releases' / 'current.json').read_text())['releaseId'] == seventh, 'current.json 应仍为 v1.0.7')
        groups += 1

        # P. 文件已写入磁盘，但线上返回的仍是旧内容（例如缓存或挂载问题）：必须发现并回滚
        dist_before = {p.name: p.read_bytes() for p in (island / 'dist').iterdir() if p.is_file()}
        commit_9 = publish('v1.0.9', lambda: (author / 'apps' / 'ly-island-preview' / 'src' / 'admin-scene.js').open('a').write('\n// v1.0.9\n'))
        ninth = release_id('v1.0.9', commit_9)
        expect(release('check', 'v1.0.9').returncode == 0, 'check v1.0.9 应通过')
        (base / 'STALE_CONTENT').write_bytes((root / 'releases' / ninth / 'island-dist' / 'admin-scene.js').read_bytes())
        result = release('deploy', ninth)
        expect(result.returncode == 1 and '已自动回滚' in result.stdout and 'admin-scene.js' in result.stdout,
               '线上返回的后台场景不是新版本时应回滚：\n' + result.stdout)
        expect({p.name: p.read_bytes() for p in (island / 'dist').iterdir() if p.is_file()} == dist_before, '岛屿顶层文件应恢复为发布前')
        (base / 'STALE_CONTENT').unlink()
        groups += 1

        unsupported_commit = publish('v1.0.10', lambda: (author / 'apps/rqly-sites/admin-mfa.mjs').unlink())
        unsupported = release_id('v1.0.10', unsupported_commit)
        expect(release('check', 'v1.0.10').returncode == 0, 'MFA fixture must start with a checked older source')
        previous_id = json.loads((root / 'releases' / seventh / 'release.json').read_text())['previous']['releaseId']
        (root / 'releases' / previous_id / 'src/apps/rqly-sites/admin-mfa.mjs').unlink()

        # Q. Enabled MFA must never disappear through either deployment or manual rollback.
        data_dir = root / 'test-data'
        data_dir.mkdir()
        factor = data_dir / 'admin-mfa.json'
        factor.write_text(json.dumps({'schemaVersion': 1, 'enabled': True}))
        running_before = state()['running']
        result = release('rollback')
        expect(result.returncode != 0 and '两步验证' in result.stdout, 'MFA must block rollback to unsupported source')
        expect(state()['running'] == running_before, 'Blocked rollback must not switch sites')
        result = release('deploy', unsupported)
        expect(result.returncode != 0 and '两步验证' in result.stdout, 'MFA must block deployment to unsupported source')
        expect(state()['running'] == running_before, 'Blocked deploy must not switch sites')
        factor.write_text('corrupt')
        expect(release('rollback').returncode != 0, 'Unreadable MFA must fail closed')
        factor.unlink()
        groups += 1

        pending = data_dir / 'content-import-transaction'
        pending.mkdir()
        (pending / 'journal.json').write_text('{}')
        for arguments in [('rollback',), ('deploy', unsupported)]:
            result = release(*arguments)
            expect(result.returncode != 0 and '未完成的内容导入' in result.stdout,
                   'Unfinished content import must block code changes')
            expect(state()['running'] == running_before, 'Import recovery guard must not switch sites')
        groups += 1

        server.shutdown()
        print('Release flow passed (%d groups): preflight leaves production untouched, tag must be merged, failed checks/'
              'config drift/tampered artifacts/failed backup block deploy, unhealthy sites or broken island roll back '
              'automatically, chained manual rollback, backup verification covers release artifacts, admin-scene-only '
              'changes are released, a failure midway through the island update restores the full snapshot, and stale served content is detected.' % groups)



if __name__ == '__main__':
    try:
        main()
    except Failure as error:
        print('FAILED: %s' % error)
        sys.exit(1)
