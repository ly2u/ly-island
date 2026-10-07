# 给 Claude 的仓库说明

## 通用

- 先读 `docs/REVIEW.md`（数据流与必须守住的约束），涉及上线时读 `docs/RELEASE.md`。
- 代码改动走分支加 PR；合并不会部署。
- 运行数据（`posts.json`、`editor-drafts.json`、`content-history/`、`media/` 等）、`.env`、凭据不进 Git。
- 新增或拆分 `apps/rqly-sites` 的顶层模块时，同步修改 `apps/rqly-sites/Dockerfile` 的 `COPY` 行，否则镜像缺文件。

检查（Node.js 24，在没有 `.env` 的目录运行）：

```bash
cd apps/rqly-sites && npm ci && for c in scripts/check*.mjs; do node "$c"; done
cd apps/ly-island-preview && npm ci && npm run build
python3 scripts/check-release.py   # 发布流程（模拟环境）
```

## 在生产服务器上

如果当前目录是 `/opt/ly-stack/repository`，你运行在线上服务器上，只做运维：发布、回滚、查看状态与日志、排查问题。

- **不改代码：** 不编辑仓库文件，不提交，不推送。发现需要修改的地方时，说明问题和建议，由站主在 GitHub 上提 PR。
- **发布只用 `scripts/release.py`**，按 `docs/RELEASE.md` 的顺序：先 `check`，把报告给站主看，得到确认后才 `deploy`。
- **不接触密钥和个人数据：** 不读取、不打印 `/opt/ly-stack/.env`、`/opt/ly-stack/env/`、`/srv/ly-data/`、`/srv/ly-backups/`、`/var/lib/ly-ai/`。不运行会展开环境变量的命令，例如 `docker inspect`、`docker compose config`（`-q` 除外）、`printenv`。
- **不做破坏性操作：** 不重启 VPS，不运行 `docker compose down` 或 `docker system prune`，不向 CivilFlow 发送写入或分析命令，不改动 Caddy 的证书目录。
- **出现预期之外的输出时停下来**，说明看到了什么、可能的原因和建议的下一步，不要自行修改线上文件来"修复"。

权限限制在 `.claude/settings.json` 和 `ops/claude/server-settings.json` 中，安装方法见 `docs/SERVER-CLAUDE.md`。这些限制只是防护栏，不是沙箱；每条命令仍需站主确认。
