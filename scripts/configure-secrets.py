#!/usr/bin/env python3
# 仅在用户普通终端交互运行，不将密码、访问码或哈希写入日志。
import getpass
import os
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
os.umask(0o077)
if not sys.stdin.isatty() or not sys.stdout.isatty():
    raise SystemExit('请在普通交互终端运行；不要重定向、tee 或记录此脚本的输出。')

env = root / '.env'
if not env.exists():
    email = input('证书通知邮箱：').strip()
    if not re.fullmatch(r"[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", email):
        raise SystemExit('邮箱格式无效。')
    password = getpass.getpass('CivilFlow 入口密码（不会回显）：')
    if len(password) < 12 or len(password.encode()) > 72:
        raise SystemExit('请使用至少 12 字符、最多 72 UTF-8 字节的密码。')
    if password != getpass.getpass('再次输入 CivilFlow 密码：'):
        raise SystemExit('两次密码不一致。')
    # Caddy 的非 TTY stdin 读取需要末尾换行，否则 ReadBytes 返回 EOF。
    result = subprocess.run(
        ['docker', 'run', '--rm', '-i', 'caddy:2-alpine', 'caddy',
         'hash-password', '--algorithm', 'bcrypt'],
        input=(password + '\n').encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    error = result.stderr.decode(errors='replace').replace(password, '[密码已隐藏]')
    del password
    if result.returncode != 0:
        raise SystemExit(f'Caddy 生成密码哈希失败（退出码 {result.returncode}）：\n'
                         + (error[:2000] or '没有错误详情。'))
    hashed = result.stdout.decode().strip()
    if not re.fullmatch(r'\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}', hashed):
        raise SystemExit('Caddy 未返回有效的 bcrypt 哈希；未保存。')
    with env.open('x') as out:
        out.write(f"ACME_EMAIL={email}\nCIVIL_USERNAME=ly\nCIVIL_PASSWORD_HASH='{hashed}'\n")
    env.chmod(0o600)
else:
    print('已有 Caddy .env，保留，不覆盖。')

site_root = root / 'apps/rqly-sites'
site_env = site_root / '.env'
site_destination = root / 'env/sites.env'
if not site_destination.exists():
    if not site_env.exists():
        # setup 生成的后台密码和访问码仅在当前用户终端显示。
        subprocess.run(['docker', 'run', '--rm', '-v', f'{site_root}:/app',
                        '-w', '/app', 'node:24-alpine', 'node', 'scripts/setup.mjs'], check=True)
        saved = input('已安全保存后台密码与 AI 访问码？输入 SAVED 继续：').strip()
        if saved != 'SAVED':
            raise SystemExit('停止。配置已生成，下次保留；后台密码不能从哈希中还原。')
    else:
        saved = input('主站 .env 已存在。确认你已保存该后台密码，输入 SAVED 继续：').strip()
        if saved != 'SAVED':
            raise SystemExit('停止，保留现有配置。')
    text = site_env.read_text()
    for key, value in [('RQLY_URL', 'https://rqly.com'), ('QIZUI_URL', 'https://7zui.com'),
                       ('AI_API_KEY', ''), ('AI_MODEL', '')]:
        pattern = rf'^{key}=.*$'
        if not re.search(pattern, text, flags=re.M):
            raise SystemExit('网站配置缺少必需字段：' + key)
        text = re.sub(pattern, key + '=' + value, text, flags=re.M)
    with site_destination.open('x') as out:
        out.write(text)
    site_destination.chmod(0o600)
    (root / 'PASSWORD-SAVED.txt').write_text('用户在初始化终端确认已安全保存后台密码和 AI 访问码。\n')
else:
    print('已有 sites.env，保留，不覆盖。')
print('配置已就绪；AI API key 和模型首次部署保持空白。')
