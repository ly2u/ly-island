# 在服务器上使用 Claude Code

用途：在 VPS 上让 Claude 协助**运维**，包括一次性迁移、发布、回滚、查看日志和排查问题。代码仍然在 GitHub 上通过 PR 修改，服务器上不改代码。

## 限制分两层

| 文件 | 生效范围 | 内容 |
|---|---|---|
| `.claude/settings.json`（仓库内） | 任何在本仓库启动的 Claude 会话，包括你自己电脑上的开发会话 | 只放在哪里都无害的规则：禁止读取服务器的密钥和数据目录；`docker inspect`、`docker compose config`、`printenv` 等可能打印环境变量的命令必须先问 |
| `ops/claude/server-settings.json` → 服务器上的 `/root/.claude/settings.json` | 服务器上 root 启动的所有会话 | 每条命令逐一确认（Manual 模式），禁用 auto 和 bypass 模式；禁止编辑仓库代码、数据和凭据；禁止 `git commit/push`、`docker compose down`、`docker system prune`、重启关机 |

为什么分开：仓库里的设置会作用于所有使用这个仓库的会话。如果在那里关闭 auto 模式或禁止编辑代码，开发时也会受影响，所以严格的规则只装在服务器上。

**这些是防护栏，不是沙箱。** 按 Claude Code 文档，禁止读取的规则只对它自带的读写工具，以及它能识别的命令（`cat`、`head`、`sed`、重定向等）生效。同一个程序换一种写法（例如 `sh -c '...'`、用 Python 读文件）不会被这些规则拦住。真正的保护是 Manual 模式下**每条命令都由你确认**，所以批准之前请看清楚命令。

## 安装（只做一次）

**1. 用官方 apt 源安装 stable 渠道。** 它有签名，不会在后台自动更新；升级跟随系统的 `apt upgrade`。

```bash
apt install -y curl gnupg
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://downloads.claude.ai/keys/claude-code.asc -o /etc/apt/keyrings/claude-code.asc
gpg --show-keys /etc/apt/keyrings/claude-code.asc   # 指纹应为 31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE
echo "deb [signed-by=/etc/apt/keyrings/claude-code.asc] https://downloads.claude.ai/claude-code/apt/stable stable main" \
  > /etc/apt/sources.list.d/claude-code.list
apt update && apt install -y claude-code
claude --version
```

**2. 安装服务器设置。** 如果 `/root/.claude/settings.json` 已经存在，先看内容，再决定是合并还是替换。

```bash
R=/opt/ly-stack/repository
git -C $R pull --ff-only
ls -l /root/.claude/settings.json 2>/dev/null && cat /root/.claude/settings.json
install -D -m 0600 $R/ops/claude/server-settings.json /root/.claude/settings.json
claude doctor   # 不应出现 "Invalid settings"
```

**3. 登录。** 运行 `claude`。服务器上没有浏览器：按 `c` 复制登录链接，在你自己电脑的浏览器里打开并登录。如果浏览器显示一个代码，把它粘贴到终端的 `Paste code here if prompted` 处。

登录凭据保存在 `/root/.claude/.credentials.json`，权限 0600。它不在 `backup.sh` 的备份范围内，丢失了重新登录即可。

## 使用

```bash
cd /opt/ly-stack/repository
claude
```

一定要在这个目录启动：仓库的 `CLAUDE.md`（运维规则）和 `.claude/settings.json` 只在这里加载。

**启动后先做一次自检：** 让它读取 `/opt/ly-stack/.env`，应当被拒绝；运行 `/permissions` 应当能看到上面的规则；状态栏显示的模式应当是 Manual。任何一项不符合，就先退出排查。

可以这样交代任务：

- "按 docs/RELEASE.md 第 2 节做一次性迁移，每一步先给我看命令和预期输出"；
- "预检查 v2026.10.08，把报告给我看"；
- "最近一次备份失败了，看看 `journalctl -u ly-stack-backup` 是什么原因"。

**批准命令时：** 看清楚命令再确认。尽量不要选"不再询问"，尤其是 `docker`、`cp`、`mv`、`rm` 和 `release.py deploy`。如果选了，规则会保存在 `.claude/settings.local.json`，它已加入 `.gitignore`，不会让仓库工作树变脏。

## 卸载

```bash
apt remove -y claude-code
rm /etc/apt/sources.list.d/claude-code.list /etc/apt/keyrings/claude-code.asc
rm -rf /root/.claude /root/.claude.json
```
