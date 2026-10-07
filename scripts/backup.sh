#!/usr/bin/env bash
# 对文章/用量和证书做一致性备份；所有退出路径恢复原先运行的服务。
set -Eeuo pipefail
umask 077
cd /opt/ly-stack
backup_dir=/srv/ly-backups
install -d -m 0700 "$backup_dir"
exec 9>"$backup_dir/.backup.lock"
flock -n 9 || { echo '另一个备份正在运行。' >&2; exit 1; }
[[ -s /srv/ly-data/sites/posts.json && -s .env && -s env/sites.env ]] || {
  echo '生产数据或配置尚未初始化，未执行备份。' >&2; exit 1;
}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$backup_dir/ly-stack-$stamp.tar.gz"
partial="$archive.partial"
[[ ! -e $archive && ! -e $partial ]] || { echo '同名备份已存在。' >&2; exit 1; }
resume=()
needs_resume=false
ai_resume=false
recover() {
  local rc=$?
  trap - EXIT INT TERM
  if [[ $ai_resume == true ]]; then
    systemctl start ly-ai.service || rc=1
  fi
  if [[ $needs_resume == true ]]; then
    if ! docker compose start "${resume[@]}"; then
      echo '备份恢复服务失败：立即检查 docker compose ps 并启动服务。' >&2
      rc=1
    fi
  fi
  if [[ -e $partial ]]; then rm -f -- "$partial"; fi
  exit "$rc"
}
trap recover EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
running=$(docker compose ps --status running --services)
for service in sites caddy; do
  if [[ $'\n'"$running"$'\n' == *$'\n'"$service"$'\n'* ]]; then
    resume+=("$service")
  fi
done
if ((${#resume[@]})); then
  # 先设恢复标记，确保 stop 部分失败也触发 start。
  needs_resume=true
  docker compose stop --timeout 20 "${resume[@]}"
fi
if systemctl is-active --quiet ly-ai.service; then
  ai_resume=true
  systemctl stop ly-ai.service
fi
# 用实际运行过的镜像导出一致的 Markdown/图片内容包；旧版镜像尚无此能力。
# sites 已停止，但 ps -aq 仍能找到容器，固定镜像 ID 避免标签切换。
sites_container=$(docker compose ps -aq sites)
if [[ -n "$sites_container" ]]; then
  sites_image=$(docker inspect --format '{{.Image}}' "$sites_container")
  if docker run --rm --network none --read-only --tmpfs /tmp "$sites_image" \
    node -e "process.exit(require('node:fs').existsSync('/app/export-content.mjs')?0:42)"; then
    docker run --rm --network none --read-only --tmpfs /tmp \
      -v /srv/ly-data/sites:/app/data "$sites_image" node /app/export-content.mjs
    python3 scripts/verify-portable-content.py /srv/ly-data/sites/content-export.zip /srv/ly-data/sites
  else
    export_check_rc=$?
    [[ $export_check_rc == 42 ]] || { echo '内容包导出预检查失败。' >&2; exit 1; }
    # 旧版本回退时不把之前产生的过期内容包当成当前快照。
    rm -f -- /srv/ly-data/sites/content-export.zip
    echo '当前镜像尚无可移植导出能力，原有完整备份继续执行。'
  fi
fi
# 发布目录（scripts/release.py）：每个发布的源码导出、岛屿产物和记录，用于恢复和回滚。
release_paths=()
if [[ -d /opt/ly-stack/releases ]]; then
  release_paths+=(opt/ly-stack/releases)
fi
tar --create --gzip --numeric-owner --exclude='*/node_modules' --exclude='srv/ly-data/sites/admin-sessions.json' --exclude='srv/ly-data/sites/.content-transfer' --exclude='srv/ly-data/sites/content-export.zip.next' \
  --exclude='opt/ly-stack/releases/*/work' --exclude='opt/ly-stack/releases/.lock' --file "$partial" -C / \
  opt/ly-stack/compose.yaml opt/ly-stack/Caddyfile opt/ly-stack/.env \
  opt/ly-stack/env/sites.env opt/ly-stack/DEPLOYMENT-STATUS.md \
  opt/ly-stack/apps/midas_vueflow/SOURCE-MANIFEST.json \
  opt/ly-stack/apps/rqly-sites/SOURCE-CHANGES.json \
  opt/ly-stack/apps/rqly-sites/server.mjs opt/ly-stack/apps/rqly-sites/organization-store.mjs opt/ly-stack/apps/rqly-sites/scripts/check-organization.mjs opt/ly-stack/apps/rqly-sites/scripts/check-static-resilience.mjs opt/ly-stack/apps/rqly-sites/content-history.mjs opt/ly-stack/apps/rqly-sites/personal-ai.mjs opt/ly-stack/apps/rqly-sites/ai-site-tools.mjs opt/ly-stack/apps/rqly-sites/scripts/check-ai-tools.mjs opt/ly-stack/apps/rqly-sites/scripts/check.mjs \
  opt/ly-stack/apps/rqly-sites/mailbox-store.mjs opt/ly-stack/apps/rqly-sites/scripts/check-mailbox.mjs \
  opt/ly-stack/apps/rqly-sites/island-store.mjs opt/ly-stack/apps/rqly-sites/admin-auth.mjs \
  opt/ly-stack/apps/rqly-sites/admin-account.mjs opt/ly-stack/apps/rqly-sites/scripts/check-password.mjs \
  opt/ly-stack/apps/rqly-sites/Dockerfile opt/ly-stack/apps/rqly-sites/package.json opt/ly-stack/apps/rqly-sites/package-lock.json \
  opt/ly-stack/apps/rqly-sites/editor-drafts.mjs opt/ly-stack/apps/rqly-sites/media-store.mjs opt/ly-stack/apps/rqly-sites/withdrawn-images.mjs \
  opt/ly-stack/apps/rqly-sites/scripts/check-editor-drafts.mjs opt/ly-stack/apps/rqly-sites/scripts/check-media.mjs opt/ly-stack/apps/rqly-sites/scripts/check-product.mjs opt/ly-stack/apps/rqly-sites/scripts/check-island-scenery.mjs opt/ly-stack/apps/rqly-sites/scripts/check-preview-map.mjs opt/ly-stack/apps/rqly-sites/scripts/check-content-tools.mjs opt/ly-stack/apps/rqly-sites/scripts/import-content-history.mjs \
  opt/ly-stack/apps/rqly-sites/public/rqly opt/ly-stack/apps/rqly-sites/public/qizui \
  opt/ly-stack/apps/ly-island-preview opt/ly-stack/rollback \
  opt/ly-stack/README.md opt/ly-stack/IMAGE-RECORD.txt \
  opt/ly-stack/PREVIOUS-IMAGES.txt opt/ly-stack/validation \
  opt/ly-stack/scripts opt/ly-stack/systemd \
  srv/ly-data/sites srv/ly-data/caddy \
  opt/ly-stack/apps/personal-ai opt/ly-stack/bin \
  var/lib/ly-ai/codex/auth.json var/lib/ly-ai/codex/config.toml \
  "${release_paths[@]}"
if [[ $ai_resume == true ]]; then
  systemctl start ly-ai.service
  ai_resume=false
fi
if [[ $needs_resume == true ]]; then
  docker compose start "${resume[@]}"
  needs_resume=false
fi
python3 scripts/verify-backup.py "$partial"
mv -- "$partial" "$archive"
sha256sum "$archive" > "$archive.sha256"
chmod 0600 "$archive" "$archive.sha256"
printf '备份和临时恢复检查通过：%s\n' "$archive"
# 只清理由本脚本命名的已完成备份，保留最近 14 份。
python3 - <<'PY'
from pathlib import Path
import re
root = Path('/srv/ly-backups')
archives = sorted(p for p in root.glob('ly-stack-*.tar.gz')
                  if re.fullmatch(r'ly-stack-\d{8}T\d{6}Z\.tar\.gz', p.name))
for old in archives[:-14]:
    old.unlink()
    old.with_name(old.name + '.sha256').unlink(missing_ok=True)
PY
