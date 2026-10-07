#!/usr/bin/env bash
# 在普通 SSH 终端执行；运行源码检查后构建并启动统一三服务。
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 && $(cat /proc/1/comm) == systemd ]] || {
  echo '请在宿主机 root SSH 终端运行。' >&2; exit 1;
}
cd /opt/ly-stack
python3 scripts/verify-sources.py /opt/ly-stack
python3 scripts/configure-secrets.py
docker compose config -q
if [[ $(docker compose ps -q caddy) == '' ]]; then
  python3 - <<'PY'
import subprocess
for flag in ['-ltnH', '-lunH']:
    result = subprocess.run(['ss', flag], capture_output=True, text=True, check=True)
    for line in result.stdout.splitlines():
        local = line.split()[3]
        if local.rsplit(':', 1)[-1] in {'80', '443'}:
            raise SystemExit('宿主机 80/443 已被占用，停止并保留现有服务。')
PY
fi
# tests 使用隔离容器；不加载生产环境，不向 Civil 执行端请求。
docker run --rm -v "$PWD/apps/rqly-sites:/app:ro" -w /app node:24-alpine node scripts/check.mjs
docker run --rm -v "$PWD/apps/midas_vueflow/civilflow_v2:/app" -w /app \
  node:24-alpine sh -eu -c 'npm ci; npm test; npm run build; npm run test:http'
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
if [[ -e /srv/ly-data/sites/posts.json ]]; then
  bash scripts/backup.sh
fi
previous_stamp=$(date -u +%Y%m%dT%H%M%SZ)
for image in ly-sites:initial-20261005-civilflow-link ly-civilflow:7a56c7a; do
  if docker image inspect "$image" >/dev/null 2>&1; then
    previous_tag="${image%%:*}:before-$previous_stamp"
    docker image tag "$image" "$previous_tag"
    printf '%s\n' "$previous_tag" >> PREVIOUS-IMAGES.txt
  fi
done
docker compose build sites civilflow
docker compose up -d --wait --wait-timeout 180 sites civilflow caddy
docker compose ps
docker compose exec -T civilflow node -e \
  "fetch('http://127.0.0.1:3102/api/catalog').then(r=>r.json()).then(d=>console.log({nodes:d.nodes.length,templates:d.templates.length})).catch(()=>process.exit(1))"
{
  for image in node:24-alpine caddy:2-alpine ly-sites:initial-20261005-civilflow-link ly-civilflow:7a56c7a; do
    docker image inspect "$image" --format '{{.Id}} {{json .RepoTags}} {{json .RepoDigests}}'
  done
} > IMAGE-RECORD.txt
bash scripts/backup.sh
install -m 0644 systemd/ly-stack-backup.service /etc/systemd/system/ly-stack-backup.service
install -m 0644 systemd/ly-stack-backup.timer /etc/systemd/system/ly-stack-backup.timer
systemctl daemon-reload
systemctl enable --now ly-stack-backup.timer
date -u '+%Y-%m-%d %H:%M:%S UTC' > HOST-DEPLOY-FINISHED.txt
printf '\n容器、源码测试和首次备份已完成；DNS、HTTPS、浏览器功能和重启验收仍须实测。\n'
printf '请将本次非敏感执行结果交给 Codex，更新 DEPLOYMENT-STATUS.md。\n'
