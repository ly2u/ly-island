#!/usr/bin/env python3
"""按 Git 标签发布 rqly.com 的 sites 镜像与岛屿静态资源。

用法（在 VPS 上以 root 运行，见 docs/RELEASE.md）：

    python3 scripts/release.py check  <标签>      预检查：导出源码、跑全部检查、构建镜像和岛屿，不改线上
    python3 scripts/release.py deploy <发布编号>  发布：先备份，再切换镜像和岛屿，健康检查失败自动回滚
    python3 scripts/release.py rollback          手动撤销当前发布，回到它之前的状态
    python3 scripts/release.py status            查看当前发布与历史记录

发布编号由 check 打印，格式为 "<标签>-<提交前 12 位>"。

范围：只管理 sites 容器镜像和岛屿静态资源。compose.yaml、Caddyfile、运维脚本、
systemd 单元、CivilFlow 和个人 AI 桥接不由本脚本修改；compose.yaml 或 Caddyfile
与标签版本不一致时，deploy 会拒绝执行。

所有路径和外部命令都可以用环境变量覆盖，供 scripts/check-release.py 在模拟环境中测试。
"""
import argparse
import datetime
import fcntl
import hashlib
import http.client
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tarfile
import time
import urllib.parse
from pathlib import Path, PurePosixPath

# ---------------------------------------------------------------- 配置

ROOT = Path(os.environ.get('LY_ROOT', '/opt/ly-stack'))
DATA_DIR = Path(os.environ.get('LY_DATA_DIR', '/srv/ly-data/sites'))
REPO = Path(os.environ.get('LY_REPO', str(ROOT / 'repository')))
RELEASES = ROOT / 'releases'
ISLAND = ROOT / 'apps' / 'ly-island-preview'
DOCKER = os.environ.get('LY_DOCKER', 'docker')
NODE_IMAGE = os.environ.get('LY_NODE_IMAGE', 'node:24-alpine')
IMAGE_REPO = 'ly-sites'
CURRENT_TAG = IMAGE_REPO + ':current'
SITE_HOST = os.environ.get('LY_SITE_HOST', 'rqly.com')
TOOL_HOST = os.environ.get('LY_TOOL_HOST', '7zui.com')
HTTP_BASE = os.environ.get('LY_HTTP_BASE', '')  # 仅测试使用；生产走 127.0.0.1:443 并带正确的 SNI
BACKUP_CMD = os.environ.get('LY_BACKUP_CMD', 'bash ' + str(ROOT / 'scripts' / 'backup.sh'))
BACKUP_LOCK = Path(os.environ.get('LY_BACKUP_LOCK', '/srv/ly-backups/.backup.lock'))
REQUIRE_ROOT = os.environ.get('LY_REQUIRE_ROOT', '1') == '1'
KEEP_RELEASES = int(os.environ.get('LY_KEEP_RELEASES', '5'))
CHECK_RETRIES = int(os.environ.get('LY_CHECK_RETRIES', '5'))
CHECK_DELAY = float(os.environ.get('LY_CHECK_DELAY', '3'))

TAG_PATTERN = re.compile(r'^v[0-9][0-9A-Za-z._-]{0,40}$')
ID_PATTERN = re.compile(r'^v[0-9][0-9A-Za-z._-]{0,40}-[0-9a-f]{12}$')
# 与运行时相关、版本不一致时禁止发布的文件
RUNTIME_CONFIG = ['compose.yaml', 'Caddyfile']
# 由人工安装的运维文件；不一致时只提示
OPS_FILES = ['scripts/backup.sh', 'scripts/verify-backup.py', 'scripts/verify-portable-content.py', 'scripts/record-island-source.py',
             'systemd/ly-stack-backup.service', 'systemd/ly-stack-backup.timer', 'systemd/ly-ai.service']
# 岛屿目录中随源码同步的文件；dist/ 单独处理，node_modules 等不动
ISLAND_SOURCE_FILES = ['package.json', 'package-lock.json', 'vite.config.js', 'index.html', 'README.md']


class ReleaseError(Exception):
    """可预期的失败：打印原因后以非零状态退出，不打印堆栈。"""


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def say(message):
    print(message, flush=True)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1 << 16), b''):
            digest.update(block)
    return digest.hexdigest()


def tree_hashes(base):
    """返回目录下全部普通文件的 {相对路径: sha256}；遇到符号链接直接失败（备份校验不接受链接）。"""
    base = Path(base)
    result = {}
    for path in sorted(base.rglob('*')):
        if path.is_symlink():
            raise ReleaseError('发布内容中不允许符号链接：' + str(path.relative_to(base)))
        if path.is_file():
            result[path.relative_to(base).as_posix()] = sha256_file(path)
    return result


def write_json(path, value):
    """原子写 JSON：先写临时文件再 rename。"""
    path = Path(path)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temp, path)


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def append_history(event):
    event = {'at': now(), **event}
    with open(RELEASES / 'history.jsonl', 'a', encoding='utf-8') as stream:
        stream.write(json.dumps(event, ensure_ascii=False) + '\n')


# ---------------------------------------------------------------- 外部命令

def run(command, log=None, capture=False, check=True, cwd=None, timeout=3600):
    """运行命令。log 为文件对象时把输出追加进去；capture=True 时返回 stdout 文本。"""
    if log is not None:
        log.write('\n$ ' + ' '.join(command) + '\n')
        log.flush()
    result = subprocess.run(command, cwd=cwd, timeout=timeout, text=True,
                            stdout=subprocess.PIPE if capture or log is not None else None,
                            stderr=subprocess.STDOUT if log is not None else None)
    if log is not None and result.stdout:
        log.write(result.stdout)
        log.flush()
    if check and result.returncode != 0:
        raise ReleaseError('命令失败（退出码 %d）：%s' % (result.returncode, ' '.join(command)))
    return result.stdout if capture else result.returncode


def git(*args, capture=True, check=True):
    return run(['git', '-c', 'safe.directory=' + str(REPO), '-C', str(REPO), *args],
               capture=capture, check=check)


def docker(*args, **kwargs):
    return run([DOCKER, *args], **kwargs)


def image_id(reference):
    """返回镜像 ID；不存在时返回 None。"""
    result = subprocess.run([DOCKER, 'image', 'inspect', '--format', '{{.Id}}', reference],
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    return result.stdout.strip() if result.returncode == 0 and result.stdout.strip() else None


def compose_up_sites(log):
    """只重建 sites 容器，不动 caddy 和 civilflow；--wait 会等到容器健康检查通过。"""
    docker('compose', '--project-directory', str(ROOT), '-f', str(ROOT / 'compose.yaml'),
           'up', '-d', '--no-build', '--no-deps', '--force-recreate',
           '--wait', '--wait-timeout', '120', 'sites', log=log, timeout=300)


# ---------------------------------------------------------------- HTTP 检查

class PinnedHTTPSConnection(http.client.HTTPSConnection):
    """连接本机 127.0.0.1:443，但用真实域名做 SNI 和证书校验，相当于 curl --resolve。"""

    def __init__(self, hostname, timeout=10):
        super().__init__(hostname, 443, timeout=timeout, context=ssl.create_default_context())

    def connect(self):
        sock = socket.create_connection(('127.0.0.1', self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def http_get(path, host=SITE_HOST):
    """返回 (状态码, 正文字节)。网络错误时返回 (0, b'')。"""
    try:
        if HTTP_BASE:
            parsed = urllib.parse.urlsplit(HTTP_BASE)
            connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=10)
            connection.request('GET', path, headers={'Host': host})
        else:
            connection = PinnedHTTPSConnection(host)
            connection.request('GET', path)
        response = connection.getresponse()
        body = response.read()
        connection.close()
        return response.status, body
    except (OSError, http.client.HTTPException):
        return 0, b''


def wait_for(description, predicate):
    """重试若干次，全部失败时抛出 ReleaseError。"""
    last = ''
    for attempt in range(CHECK_RETRIES):
        ok, detail = predicate()
        if ok:
            say('  通过：' + description)
            return
        last = detail
        if attempt + 1 < CHECK_RETRIES:
            time.sleep(CHECK_DELAY)
    raise ReleaseError('健康检查失败：%s（%s）' % (description, last))


def check_sites():
    def status_is(path, host=SITE_HOST):
        def predicate():
            status, _ = http_get(path, host)
            return status == 200, 'HTTP %d' % status
        return predicate

    def posts_json():
        status, body = http_get('/api/posts')
        if status != 200:
            return False, 'HTTP %d' % status
        try:
            return isinstance(json.loads(body).get('posts'), list), '返回内容不是文章列表'
        except ValueError:
            return False, '返回内容不是 JSON'

    wait_for('https://%s/healthz' % SITE_HOST, status_is('/healthz'))
    wait_for('https://%s/api/posts 返回文章列表' % SITE_HOST, posts_json)
    wait_for('https://%s/notes' % SITE_HOST, status_is('/notes'))
    if TOOL_HOST:
        wait_for('https://%s/' % TOOL_HOST, status_is('/', TOOL_HOST))


ASSET_REFERENCE = re.compile(r'(?:src|href)="(/island/[^"?#]+)"')


def check_island(expected_top):
    """expected_top：岛屿 dist 顶层文件 {文件名: sha256}。逐个确认线上实际返回的内容，再确认首页引用的资源都能访问。"""
    for name, digest in sorted(expected_top.items()):
        path = '/' if name == 'index.html' else '/island/' + name

        def content_matches(path=path, digest=digest):
            status, body = http_get(path)
            if status != 200:
                return False, 'HTTP %d' % status
            return hashlib.sha256(body).hexdigest() == digest, '内容与预期版本不一致'
        wait_for('https://%s%s 返回预期版本' % (SITE_HOST, path), content_matches)
    _, body = http_get('/')
    references = sorted(set(ASSET_REFERENCE.findall(body.decode('utf-8', 'replace'))))
    for reference in references:
        def asset_ok(reference=reference):
            status, _ = http_get(reference)
            return status == 200, 'HTTP %d' % status
        wait_for('岛屿资源 ' + reference, asset_ok)


# ---------------------------------------------------------------- 前置条件

def require_root():
    if REQUIRE_ROOT and os.geteuid() != 0:
        raise ReleaseError('请在 VPS 上以 root 运行。')


class Lock:
    """独占锁；同一时间只允许一个 check/deploy/rollback。"""

    def __init__(self, path, message):
        self.path, self.message, self.handle = Path(path), message, None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = open(self.path, 'a')
        try:
            fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.handle.close()
            raise ReleaseError(self.message)
        return self

    def __exit__(self, *exc):
        fcntl.flock(self.handle, fcntl.LOCK_UN)
        self.handle.close()


def config_drift(source):
    """比较标签中的配置文件与线上文件。返回 (阻止发布的差异, 仅提示的差异)。"""
    blocking, advisory = [], []
    for name in RUNTIME_CONFIG + OPS_FILES:
        tagged, live = source / name, ROOT / name
        if not tagged.exists():
            continue
        if not live.exists() or sha256_file(tagged) != sha256_file(live):
            (blocking if name in RUNTIME_CONFIG else advisory).append(name)
    return blocking, advisory


def probe_live():
    """只读探测线上：发布后要检查的地址，现在就必须正常，否则发布必然以回滚告终。"""
    problems = []
    targets = [(SITE_HOST, '/healthz'), (SITE_HOST, '/api/posts'), (SITE_HOST, '/notes'), (SITE_HOST, '/')]
    if TOOL_HOST:
        targets.append((TOOL_HOST, '/'))
    for host, path in targets:
        status, _ = http_get(path, host)
        if status != 200:
            hint = '；如果 %s 已停用，可设置环境变量 LY_TOOL_HOST= 跳过它' % TOOL_HOST if host == TOOL_HOST else ''
            problems.append('线上 https://%s%s 现在就%s，发布后的健康检查会失败。请先排查%s'
                            % (host, path, '无法连接' if status == 0 else '返回 HTTP %d' % status, hint))
    return problems


def require_mfa_compatible(source):
    """Refuse an older image that would silently ignore an enabled administrator factor."""
    if (DATA_DIR / 'content-import-transaction' / 'journal.json').exists():
        raise ReleaseError('存在未完成的内容导入，停止发布或回滚；先用当前支持导入的版本启动并核对恢复结果。')
    state_file = DATA_DIR / 'admin-mfa.json'
    if not state_file.exists():
        return
    try:
        state = read_json(state_file)
        if state.get('schemaVersion') != 1 or type(state.get('enabled')) is not bool:
            raise ValueError()
    except (ValueError, OSError, TypeError, AttributeError):
        raise ReleaseError('无法确认两步验证状态，停止发布或回滚；请先恢复配置。')
    if state['enabled']:
        module = Path(source) / 'apps/rqly-sites/admin-mfa.mjs' if source else None
        auth = Path(source) / 'apps/rqly-sites/server.mjs' if source else None
        if not module or not module.is_file() or not auth.is_file() or 'mfa:adminMFA' not in auth.read_text():
            raise ReleaseError('两步验证已开启，目标版本不支持它，禁止发布或回滚。请使用支持两步验证的版本。')


def deploy_blockers(record):
    """deploy 之前必须全部满足的条件；返回问题列表，空列表表示可以发布。"""
    problems = probe_live()
    try:
        require_mfa_compatible(RELEASES / record['id'] / 'src')
    except ReleaseError as error:
        problems.append(str(error))
    blocking, _ = config_drift(RELEASES / record['id'] / 'src')
    for name in blocking:
        problems.append('线上 %s 与标签版本不一致，需要先人工核对并安装（见 docs/RELEASE.md）' % name)
    if image_id(CURRENT_TAG) is None:
        problems.append('尚未完成一次性迁移：镜像标签 %s 不存在（见 docs/RELEASE.md 的"首次迁移"）' % CURRENT_TAG)
    if image_id(record['image']['tag']) != record['image']['id']:
        problems.append('预检查构建的镜像已不存在或被替换，请重新运行 check')
    return problems


def load_release(release_id):
    if not ID_PATTERN.match(release_id):
        raise ReleaseError('发布编号格式无效：%s（应为 check 打印的 "<标签>-<提交前 12 位>"）' % release_id)
    path = RELEASES / release_id / 'release.json'
    if not path.exists():
        raise ReleaseError('找不到发布 %s，请先运行 check。' % release_id)
    return read_json(path)


def save_release(record):
    write_json(RELEASES / record['id'] / 'release.json', record)


def current_pointer():
    path = RELEASES / 'current.json'
    return read_json(path) if path.exists() else None


# ---------------------------------------------------------------- check

def command_check(tag):
    require_root()
    if not TAG_PATTERN.match(tag):
        raise ReleaseError('标签格式无效：%s（应以 v 加数字开头，例如 v2026.10.07 或 v1.2.0）' % tag)
    RELEASES.mkdir(mode=0o700, parents=True, exist_ok=True)
    with Lock(RELEASES / '.lock', '另一个发布操作正在进行。'):
        if not (REPO / '.git').exists():
            raise ReleaseError('找不到 Git 仓库 %s。' % REPO)
        say('获取 origin 的 main 与标签……')
        git('fetch', '--force', '--tags', 'origin', '+refs/heads/main:refs/remotes/origin/main')
        if git('rev-parse', '--is-shallow-repository').strip() == 'true':
            raise ReleaseError('%s 是浅克隆，无法确认标签是否已合并到 main。请运行：git -C %s fetch --unshallow' % (REPO, REPO))
        commit = git('rev-parse', '--verify', 'refs/tags/%s^{commit}' % tag, check=False).strip()
        if not re.fullmatch(r'[0-9a-f]{40}', commit or ''):
            raise ReleaseError('标签 %s 不存在。' % tag)
        if run(['git', '-c', 'safe.directory=' + str(REPO), '-C', str(REPO), 'merge-base', '--is-ancestor',
                commit, 'refs/remotes/origin/main'], check=False) != 0:
            raise ReleaseError('标签 %s 指向的提交不在 origin/main 上；只发布已合并的代码。' % tag)

        release_id = '%s-%s' % (tag, commit[:12])
        folder = RELEASES / release_id
        if (folder / 'release.json').exists():
            state = read_json(folder / 'release.json').get('state')
            if state in ('deployed', 'deploying', 'rollback-failed'):
                raise ReleaseError('发布 %s 的状态是 %s，不能重新预检查。' % (release_id, state))
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(mode=0o700)
        try:
            _check_into(folder, tag, commit, release_id)
        except Exception as error:
            if (folder / 'work').exists():
                shutil.rmtree(folder / 'work')
            write_json(folder / 'release.json', {'schemaVersion': 1, 'id': release_id, 'tag': tag, 'commit': commit,
                                                 'state': 'check-failed', 'checkedAt': now(), 'failure': str(error)})
            append_history({'event': 'check-failed', 'release': release_id, 'reason': str(error)})
            say('预检查未通过，线上没有任何改动。日志：%s' % (folder / 'check.log'))
            raise


def _check_into(folder, tag, commit, release_id):
    """预检查主体：导出、检查、构建、写记录。任何异常由 command_check 记录为 check-failed。"""
    source, work = folder / 'src', folder / 'work'
    log_path = folder / 'check.log'
    subject = git('log', '-1', '--format=%s', commit).strip()
    say('发布编号：%s\n提交：%s %s' % (release_id, commit[:12], subject))

    with open(log_path, 'w', encoding='utf-8') as log:
        say('导出标签源码……')
        source.mkdir()
        archive = subprocess.run(['git', '-c', 'safe.directory=' + str(REPO), '-C', str(REPO),
                                  'archive', '--format=tar', commit], stdout=subprocess.PIPE, check=True)
        archive_path = folder / 'source.tar'
        archive_path.write_bytes(archive.stdout)
        with tarfile.open(archive_path) as bundle:
            for member in bundle.getmembers():
                if member.issym() or member.islnk():
                    raise ReleaseError('标签源码中不允许链接：' + member.name)
            bundle.extractall(source, filter='data')
        archive_path.unlink()
        source_files = tree_hashes(source)

        say('运行 sites 全部检查（隔离容器，不挂载生产数据）……')
        shutil.copytree(source, work)
        docker('run', '--rm', '-v', '%s:/w' % work, '-w', '/w/apps/rqly-sites', NODE_IMAGE, 'sh', '-euc',
               'npm ci --no-audit --no-fund && test ! -f .env && for c in scripts/check*.mjs; do node "$c"; done',
               log=log)
        say('构建岛屿静态资源……')
        docker('run', '--rm', '-v', '%s:/w' % work, '-w', '/w/apps/ly-island-preview', NODE_IMAGE, 'sh', '-euc',
               'npm ci --no-audit --no-fund && npm run build', log=log)
        built = work / 'apps' / 'ly-island-preview' / 'dist'
        for required in ('index.html', 'admin-scene.js'):
            if not (built / required).is_file():
                raise ReleaseError('岛屿构建结果缺少 ' + required)
        index_text = (built / 'index.html').read_text(encoding='utf-8')
        for reference in set(ASSET_REFERENCE.findall(index_text)):
            if not (built / reference[len('/island/'):]).is_file():
                raise ReleaseError('岛屿首页引用的资源不在构建结果中：' + reference)
        shutil.copytree(built, folder / 'island-dist')
        island_files = tree_hashes(folder / 'island-dist')

        say('构建 sites 镜像……')
        image_tag = '%s:%s' % (IMAGE_REPO, release_id)
        docker('build', '-t', image_tag, str(source / 'apps' / 'rqly-sites'), log=log)
        built_id = image_id(image_tag)
        if not built_id:
            raise ReleaseError('镜像构建后无法读取 ID。')
        shutil.rmtree(work)

    blocking, advisory = config_drift(source)
    current = current_pointer()
    record = {
        'schemaVersion': 1, 'id': release_id, 'tag': tag, 'commit': commit, 'subject': subject,
        'state': 'checked', 'checkedAt': now(),
        'image': {'tag': image_tag, 'id': built_id},
        'islandIndexSha256': island_files['index.html'],
        'sourceFiles': source_files, 'islandFiles': island_files,
    }
    save_release(record)
    append_history({'event': 'checked', 'release': release_id, 'commit': commit})

    live_image = image_id(CURRENT_TAG)
    differences = island_differences(record)
    lines = [
        '预检查通过：%s' % release_id,
        '  标签 %s → 提交 %s' % (tag, commit),
        '  说明：%s' % subject,
        '  sites 镜像：%s（%s）' % (image_tag, built_id[:19]),
        '  岛屿：%d 个文件，首页 sha256 %s' % (len(island_files), island_files['index.html'][:16]),
        '',
        '与线上的差别：',
        '  当前发布：%s' % (current.get('releaseId') if current else '（尚无，迁移前状态）'),
        '  sites 镜像：%s' % ('不变' if live_image == built_id else '将切换（%s → %s）' % ((live_image or '无')[:19], built_id[:19])),
        '  岛屿：%s' % ('不变' if not differences else '将更新（%d 个文件不同，例如 %s）' % (len(differences), '、'.join(differences[:3]))),
    ]
    if current and current.get('commit'):
        stat = git('diff', '--stat', current['commit'], commit, check=False)
        lines += ['', '自当前发布以来的源码改动：'] + ['  ' + line for line in stat.rstrip().splitlines()[-15:]]
    for name in advisory:
        lines.append('  提示：线上 %s 与标签版本不一致（本脚本不安装运维文件，请人工核对）' % name)
    problems = deploy_blockers(record)
    lines.append('')
    if problems:
        lines.append('现在还不能发布：')
        lines += ['  - ' + problem for problem in problems]
    else:
        lines += ['可以发布。确认后运行：', '  python3 %s deploy %s' % (Path(sys.argv[0]), release_id)]
    lines += ['', '预检查没有修改线上容器、岛屿文件或配置。完整日志：%s' % log_path]
    report = '\n'.join(lines)
    (folder / 'check-report.txt').write_text(report + '\n', encoding='utf-8')
    say('\n' + report)


# ---------------------------------------------------------------- deploy 与回滚

def snapshot_island(rollback_dir):
    """保存岛屿当前状态：dist 顶层文件（index.html 等）和源码文件（不含 dist、node_modules）。"""
    top = rollback_dir / 'island-top'
    top.mkdir(parents=True)
    dist = ISLAND / 'dist'
    for path in dist.iterdir() if dist.exists() else []:
        if path.is_file():
            shutil.copy2(path, top / path.name)
    with tarfile.open(rollback_dir / 'island-source.tar', 'w') as bundle:
        for name in ISLAND_SOURCE_FILES + ['SOURCE-MANIFEST.json']:
            if (ISLAND / name).is_file():
                bundle.add(ISLAND / name, arcname=name)
        if (ISLAND / 'src').is_dir():
            bundle.add(ISLAND / 'src', arcname='src')


def top_hashes(folder):
    """目录顶层普通文件的 {文件名: sha256}，例如岛屿 dist 的 index.html、admin-scene.js。"""
    folder = Path(folder)
    return {path.name: sha256_file(path) for path in sorted(folder.iterdir()) if path.is_file()} if folder.is_dir() else {}


def release_top_hashes(record):
    return {name: digest for name, digest in record['islandFiles'].items() if '/' not in name}


def island_differences(record):
    """线上岛屿与发布版本不一致的文件：比较全部构建产物，以及随产物同步的岛屿源码。空列表表示无需更新。"""
    differences = []
    for name, digest in sorted(record['islandFiles'].items()):
        live = ISLAND / 'dist' / name
        if not live.is_file() or sha256_file(live) != digest:
            differences.append('dist/' + name)

    def source_files(base):
        files = {name: sha256_file(base / name) for name in ISLAND_SOURCE_FILES if (base / name).is_file()}
        if (base / 'src').is_dir():
            files.update({'src/' + name: digest for name, digest in tree_hashes(base / 'src').items()})
        return files
    expected = source_files(RELEASES / record['id'] / 'src' / 'apps' / 'ly-island-preview')
    actual = source_files(ISLAND)
    differences += sorted(name for name in set(expected) | set(actual) if expected.get(name) != actual.get(name))
    return differences


def _fault(name):
    """仅供 scripts/check-release.py 在指定位置模拟失败；生产环境不设置 LY_TEST_FAULT。"""
    if os.environ.get('LY_TEST_FAULT') == name:
        raise ReleaseError('测试注入的故障：' + name)


def atomic_install(source_file, target, mode=0o644):
    temp = target.with_name(target.name + '.next')
    shutil.copyfile(source_file, temp)
    os.chmod(temp, mode)
    os.replace(temp, target)


def record_island_manifest(source_root):
    """用标签版本的 record-island-source.py 重新生成岛屿清单，备份校验依赖这份清单。"""
    script = source_root / 'scripts' / 'record-island-source.py'
    run([sys.executable, str(script), str(ISLAND)], capture=True)


def install_island(record):
    """把发布的岛屿资源装到线上 dist：新资源只增不删，顶层文件原子替换，index.html 最后替换。"""
    folder = RELEASES / record['id']
    built, dist = folder / 'island-dist', ISLAND / 'dist'
    (dist / 'assets').mkdir(parents=True, exist_ok=True)
    for asset in sorted((built / 'assets').rglob('*')):
        if not asset.is_file():
            continue
        target = dist / asset.relative_to(built)
        if target.exists():
            if sha256_file(target) != sha256_file(asset):
                raise ReleaseError('线上已有同名但内容不同的岛屿资源：' + str(target.relative_to(ISLAND)))
            continue
        if not target.parent.exists():
            target.parent.mkdir(parents=True)
            os.chmod(target.parent, 0o755)
        atomic_install(asset, target)
    # 岛屿源码与发布版本保持一致，SOURCE-MANIFEST.json 才能如实记录"源码 + 线上产物"
    source = folder / 'src' / 'apps' / 'ly-island-preview'
    for name in ISLAND_SOURCE_FILES:
        if (source / name).is_file():
            atomic_install(source / name, ISLAND / name)
    if (ISLAND / 'src').exists():
        shutil.rmtree(ISLAND / 'src')
    shutil.copytree(source / 'src', ISLAND / 'src')
    for path in sorted(built.iterdir()):
        if path.is_file() and path.name != 'index.html':
            atomic_install(path, dist / path.name)
    _fault('island-before-index')
    atomic_install(built / 'index.html', dist / 'index.html')
    record_island_manifest(folder / 'src')


def restore_island(rollback_dir, source_root):
    """恢复发布前的岛屿。assets/ 里新增的带哈希资源保留（旧页面可能还在引用），其余恢复原样。"""
    top = rollback_dir / 'island-top'
    dist = ISLAND / 'dist'
    saved = {path.name for path in top.iterdir()}
    for path in sorted(top.iterdir()):
        if path.name != 'index.html':
            atomic_install(path, dist / path.name)
    if 'index.html' in saved:
        atomic_install(top / 'index.html', dist / 'index.html')
    for path in dist.iterdir():
        if path.is_file() and path.name not in saved:
            path.unlink()  # 本次发布新增的顶层文件
    with tarfile.open(rollback_dir / 'island-source.tar') as bundle:
        names = {PurePosixPath(member.name).parts[0] for member in bundle.getmembers()}
        for name in ISLAND_SOURCE_FILES:
            if name not in names and (ISLAND / name).is_file():
                (ISLAND / name).unlink()
        if (ISLAND / 'src').exists():
            shutil.rmtree(ISLAND / 'src')
        bundle.extractall(ISLAND, filter='data')
    # 快照里的 SOURCE-MANIFEST.json 已原样恢复：它列出的文件都已恢复为发布前的内容，备份校验仍然成立。
    # 只有快照里没有清单时才重新生成。
    if 'SOURCE-MANIFEST.json' not in names:
        record_island_manifest(source_root)


def switch_sites(target_image, log):
    docker('tag', target_image, CURRENT_TAG, log=log)
    compose_up_sites(log)


def run_backup():
    say('发布前备份（scripts/backup.sh，会短暂停止 sites 和 caddy）……')
    if subprocess.run(BACKUP_CMD, shell=True).returncode != 0:
        raise ReleaseError('发布前备份失败，未做任何修改。')


def undo(release_folder, previous_image, island_started, log):
    """回到发布前的状态，然后再做健康检查。

    island_started：岛屿更新是否已经开始。一旦开始，不论进行到哪一步，都完整恢复快照
    （顶层文件、岛屿源码、SOURCE-MANIFEST.json），不靠比较某个文件的哈希来猜测是否需要恢复。
    """
    previous_id = (read_json(release_folder / 'release.json').get('previous') or {}).get('releaseId')
    require_mfa_compatible(RELEASES / previous_id / 'src' if previous_id else None)
    rollback_dir = release_folder / 'rollback'
    if island_started:
        restore_island(rollback_dir, release_folder / 'src')
    if image_id(CURRENT_TAG) != previous_image:
        switch_sites(previous_image, log)
    check_sites()
    expected = top_hashes(rollback_dir / 'island-top')
    if 'index.html' in expected:
        check_island(expected)


def command_deploy(release_id, skip_backup):
    require_root()
    with Lock(RELEASES / '.lock', '另一个发布操作正在进行。'):
        record = load_release(release_id)
        if record['state'] != 'checked':
            raise ReleaseError('发布 %s 的状态是 %s；只能发布刚通过预检查的版本，请重新运行 check。' % (release_id, record['state']))
        folder = RELEASES / release_id
        say('核对预检查产物……')
        if tree_hashes(folder / 'src') != record['sourceFiles'] or tree_hashes(folder / 'island-dist') != record['islandFiles']:
            raise ReleaseError('预检查之后发布目录被改动，请重新运行 check。')
        problems = deploy_blockers(record)
        if problems:
            raise ReleaseError('不能发布：\n  - ' + '\n  - '.join(problems))

        if skip_backup:
            say('已按 --skip-backup 跳过发布前备份。')
        else:
            run_backup()

        with Lock(BACKUP_LOCK, '备份正在运行，请等它结束后再发布。'), \
                open(folder / 'deploy.log', 'a', encoding='utf-8') as log:
            previous = current_pointer()
            previous_image = image_id(CURRENT_TAG)
            live_index = ISLAND / 'dist' / 'index.html'
            previous_index_sha = sha256_file(live_index) if live_index.exists() else None
            rollback_dir = folder / 'rollback'
            if rollback_dir.exists():
                shutil.rmtree(rollback_dir)
            snapshot_island(rollback_dir)
            record['previous'] = {
                'releaseId': previous.get('releaseId') if previous else None,
                'commit': previous.get('commit') if previous else None,
                'imageId': previous_image, 'islandIndexSha256': previous_index_sha,
            }
            record['state'] = 'deploying'
            save_release(record)
            append_history({'event': 'deploy-started', 'release': release_id, 'previousImage': previous_image})

            island_started = False
            try:
                if previous_image != record['image']['id']:
                    say('切换 sites 镜像并等待容器健康……')
                    switch_sites(record['image']['tag'], log)
                else:
                    say('sites 镜像未变化，不重建容器。')
                check_sites()
                differences = island_differences(record)
                if differences:
                    say('更新岛屿（%d 个文件与发布版本不同，例如 %s）……' % (len(differences), '、'.join(differences[:3])))
                    island_started = True
                    install_island(record)
                else:
                    say('岛屿产物和源码都与发布版本一致，不更新。')
                check_island(release_top_hashes(record))
            except (Exception, KeyboardInterrupt) as error:  # 任何失败（包括中途按 Ctrl-C）都回滚
                say('\n发布失败：%s\n开始自动回滚……' % error)
                try:
                    undo(folder, previous_image, island_started, log)
                except Exception as rollback_error:
                    record['state'] = 'rollback-failed'
                    record['failure'] = '%s；回滚失败：%s' % (error, rollback_error)
                    save_release(record)
                    append_history({'event': 'rollback-failed', 'release': release_id, 'reason': record['failure']})
                    say('\n自动回滚失败：%s\n请立即按 docs/RELEASE.md 的"自动回滚失败"一节人工处理。' % rollback_error)
                    return 2
                record['state'] = 'rolled-back'
                record['failure'] = str(error)
                save_release(record)
                append_history({'event': 'rolled-back', 'release': release_id, 'reason': str(error)})
                say('已自动回滚到发布前的状态，健康检查通过。线上仍是：%s' % (record['previous']['releaseId'] or '迁移前版本'))
                return 130 if isinstance(error, KeyboardInterrupt) else 1

            record['state'] = 'deployed'
            record['deployedAt'] = now()
            save_release(record)
            write_json(RELEASES / 'current.json', {
                'releaseId': release_id, 'tag': record['tag'], 'commit': record['commit'],
                'imageId': record['image']['id'], 'islandIndexSha256': record['islandIndexSha256'],
                'deployedAt': record['deployedAt'],
            })
            append_history({'event': 'deployed', 'release': release_id, 'commit': record['commit'],
                            'image': record['image']['id']})
        prune_releases()
        say('\n发布完成：%s（提交 %s，镜像 %s）' % (release_id, record['commit'][:12], record['image']['id'][:19]))
        say('如需撤销：python3 %s rollback' % Path(sys.argv[0]))
        return 0


def command_rollback():
    """撤销当前发布：恢复它发布前保存的岛屿文件和镜像。可以连续执行，逐个往前撤销。"""
    require_root()
    with Lock(RELEASES / '.lock', '另一个发布操作正在进行。'):
        current = current_pointer()
        if not current or not current.get('releaseId'):
            raise ReleaseError('当前没有可撤销的发布（已经是迁移前的状态）。')
        record = load_release(current['releaseId'])
        previous = record.get('previous') or {}
        folder = RELEASES / record['id']
        require_mfa_compatible(RELEASES / previous['releaseId'] / 'src' if previous.get('releaseId') else None)
        if not previous.get('imageId') or not (folder / 'rollback' / 'island-top').exists():
            raise ReleaseError('发布 %s 缺少回滚快照，无法自动撤销。' % record['id'])
        if image_id(previous['imageId']) is None:
            raise ReleaseError('之前的镜像 %s 已被删除，无法撤销；可以重新 check 并 deploy 旧标签。' % previous['imageId'][:19])
        with Lock(BACKUP_LOCK, '备份正在运行，请等它结束后再回滚。'), \
                open(folder / 'deploy.log', 'a', encoding='utf-8') as log:
            say('撤销 %s，回到 %s……' % (record['id'], previous.get('releaseId') or '迁移前版本'))
            undo(folder, previous['imageId'], True, log)
        record['state'] = 'rolled-back'
        record['failure'] = '手动撤销'
        save_release(record)
        if previous.get('releaseId'):
            earlier = load_release(previous['releaseId'])
            write_json(RELEASES / 'current.json', {
                'releaseId': earlier['id'], 'tag': earlier['tag'], 'commit': earlier['commit'],
                'imageId': earlier['image']['id'], 'islandIndexSha256': earlier['islandIndexSha256'],
                'deployedAt': earlier.get('deployedAt'),
            })
        else:
            write_json(RELEASES / 'current.json', {'releaseId': None, 'imageId': previous['imageId'],
                                                    'islandIndexSha256': previous.get('islandIndexSha256')})
        append_history({'event': 'manual-rollback', 'release': record['id'], 'to': previous.get('releaseId')})
        say('撤销完成，健康检查通过。')
        return 0


def prune_releases():
    """保留最近 KEEP_RELEASES 个发布目录，以及当前发布和它的上一个；删除更旧的目录和镜像标签。"""
    records = []
    for path in RELEASES.iterdir():
        if path.is_dir() and (path / 'release.json').exists():
            records.append(read_json(path / 'release.json'))
    current = current_pointer() or {}
    keep = {current.get('releaseId')}
    if current.get('releaseId'):
        keep.add((load_release(current['releaseId']).get('previous') or {}).get('releaseId'))
    records.sort(key=lambda r: r.get('checkedAt', ''), reverse=True)
    keep.update(r['id'] for r in records[:KEEP_RELEASES])
    keep.update(r['id'] for r in records if r.get('state') in ('deploying', 'rollback-failed'))
    for record in records:
        if record['id'] not in keep:
            shutil.rmtree(RELEASES / record['id'])
            if record.get('image'):
                subprocess.run([DOCKER, 'rmi', record['image']['tag']], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL)
            append_history({'event': 'pruned', 'release': record['id']})


def command_status():
    current = current_pointer()
    say('当前发布：%s' % (json.dumps(current, ensure_ascii=False) if current else '（尚无）'))
    say('镜像 %s：%s' % (CURRENT_TAG, image_id(CURRENT_TAG) or '不存在'))
    if RELEASES.exists():
        for path in sorted(RELEASES.iterdir()):
            if (path / 'release.json').exists():
                record = read_json(path / 'release.json')
                say('  %-40s %-16s %s' % (record['id'], record['state'], record.get('subject') or record.get('failure', '')))
        history = RELEASES / 'history.jsonl'
        if history.exists():
            say('最近记录：')
            for line in history.read_text(encoding='utf-8').splitlines()[-10:]:
                say('  ' + line)
    return 0


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description='按 Git 标签发布 sites 镜像与岛屿静态资源。')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('check', help='预检查一个标签，不改线上').add_argument('tag')
    deploy = commands.add_parser('deploy', help='发布一个已通过预检查的版本')
    deploy.add_argument('release_id')
    deploy.add_argument('--skip-backup', action='store_true', help='跳过发布前备份（仅限紧急情况）')
    commands.add_parser('rollback', help='撤销当前发布')
    commands.add_parser('status', help='查看发布状态')
    args = parser.parse_args()
    try:
        if args.command == 'check':
            command_check(args.tag)
            return 0
        if args.command == 'deploy':
            return command_deploy(args.release_id, args.skip_backup)
        if args.command == 'rollback':
            return command_rollback()
        return command_status()
    except (ReleaseError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        say('错误：%s' % error)
        return 1


if __name__ == '__main__':
    sys.exit(main())
