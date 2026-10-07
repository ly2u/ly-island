#!/usr/bin/env bash
# 在 VPS 的普通 SSH 终端执行；安装 Docker，并将已核验材料放入正式目录。
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo '请使用 root 执行。' >&2; exit 1; }
[[ $(cat /proc/1/comm) == systemd ]] || {
  echo '当前会话无法管理宿主机；请在 VPS 的普通 SSH 终端执行本脚本。' >&2
  exit 1
}
source /etc/os-release
[[ $ID == debian && $VERSION_ID == 13 ]] || { echo '本脚本适用于 Debian 13。' >&2; exit 1; }
stage=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
target=/opt/ly-stack
[[ ! -e $target ]] || {
  echo '/opt/ly-stack 已存在，停止以避免覆盖；请先检查和备份。' >&2
  exit 1
}
python3 "$stage/scripts/verify-sources.py" "$stage"

if ! command -v docker >/dev/null; then
  for package in docker.io docker-compose docker-doc docker-buildx podman-docker containerd runc; do
    if [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true) == 'install ok installed' ]]; then
      echo "已安装冲突软件包 $package，停止并保留现状。" >&2
      exit 1
    fi
  done
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl --fail --silent --show-error --location --retry 3 \
    https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod 0644 /etc/apt/keyrings/docker.asc
  architecture=$(dpkg --print-architecture)
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: trixie
Components: stable
Architectures: $architecture
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  chmod 0644 /etc/apt/sources.list.d/docker.sources
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
docker compose version
systemctl enable --now docker
docker run --rm hello-world
docker pull node:24-alpine
docker pull caddy:2-alpine

cp -a -- "$stage" "$target"
install -d -m 0700 /srv/ly-backups
install -d -m 0750 /srv/ly-data /srv/ly-data/sites /srv/ly-data/caddy \
  /srv/ly-data/caddy/data /srv/ly-data/caddy/config
node_uid=$(docker run --rm node:24-alpine id -u node)
node_gid=$(docker run --rm node:24-alpine id -g node)
chown "$node_uid:$node_gid" /srv/ly-data/sites
chmod 0750 /srv/ly-data/sites
chmod 0700 "$target/env" "$target/incoming"
docker version --format '{{.Server.Version}}' > "$target/DOCKER-VERSION.txt"
docker compose version >> "$target/DOCKER-VERSION.txt"
printf '\nDocker 已安装并通过 hello-world；正式材料已放入 /opt/ly-stack。\n'
printf '下一步在本终端执行：bash /opt/ly-stack/scripts/deploy-host.sh\n'
