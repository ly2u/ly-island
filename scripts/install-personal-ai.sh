#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
cd /opt/ly-stack
getent group ly-sites-socket >/dev/null || groupadd --gid 1000 ly-sites-socket
id ly-ai >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/ly-ai --shell /usr/sbin/nologin ly-ai
install -d -m 0755 /usr/local/lib/ly-ai
install -m 0755 bin/codex-0.160.1 /usr/local/lib/ly-ai/codex
install -m 0755 bin/codex-code-mode-host-0.160.1 /usr/local/lib/ly-ai/codex-code-mode-host
install -m 0644 apps/personal-ai/bridge.py /usr/local/lib/ly-ai/bridge.py
install -d -o ly-ai -g ly-ai -m 0700 /var/lib/ly-ai /var/lib/ly-ai/codex /var/lib/ly-ai/work
install -o ly-ai -g ly-ai -m 0600 apps/personal-ai/config.toml /var/lib/ly-ai/codex/config.toml
if [[ ! -s /var/lib/ly-ai/codex/auth.json ]]; then
  echo 'AI 服务需要订阅登录；请在本机终端执行文档中的个人 AI 登录命令。' >&2
fi
install -m 0644 systemd/ly-ai.service /etc/systemd/system/ly-ai.service
systemctl daemon-reload
systemctl enable ly-ai.service
systemctl restart ly-ai.service
echo '个人 AI 服务已安装，已有登录凭据已保留。'
