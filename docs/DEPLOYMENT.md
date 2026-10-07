# 复现与部署说明

## 隔离审查环境

根目录 `compose.review.yaml` 只使用 `sites`、静态 island 构建与 Caddy HTTP 转发，不需要真实域名、证书、CivilFlow 或 Codex 登录。端口只绑定 `127.0.0.1:4173`；数据在 `ly-review-data` Docker volume，AI socket 为空。它是新环境，不能与生产 Compose 共用目录或卷。

首次先在自己终端生成本地口令，初始化输出包含本地后台口令，不应贴在审查意见中：

```bash
cd apps/rqly-sites
npm ci
npm run setup
cd ../..
mkdir -p env
cp apps/rqly-sites/.env env/review.env
chmod 600 env/review.env
docker compose -f compose.review.yaml up --build --wait
```

打开 http://localhost:4173/admin 登录。临时卷会存放仅供审查的账号、测试文章和编辑数据。删除审查环境应明确只操作 `compose.review.yaml`；它不挂载服务器 `/srv/ly-data`。默认关闭真实 API 和 Codex 桥接，审查可用基础规则检查及工具模拟测试。

## 生产配置的边界

根目录 `compose.yaml` 与 `Caddyfile` 是源码快照中的统一生产配置。它们依赖未纳入仓库的 `.env`、`env/sites.env`、CivilFlow checkout 和已安装的宿主机 AI 服务。网站内自带的 Compose/Caddy 是早期双站包，不要同时启动两套入口。

- 文章/目录/图片/来信：`/srv/ly-data/sites`，运行用户 node UID/GID 需匹配。
- 证书与 Caddy 状态：`/srv/ly-data/caddy/{data,config}`。
- 本机备份：`/srv/ly-backups`；按站主决定暂时不传异地。
- AI Unix socket：`/run/ly-ai/bridge.sock`；没有这个服务时保持 AI 未配置，不能承诺在线生成。
- 岛屿源码需要 `npm ci && npm run build` 生成 `dist/`，Caddy 与后台场景加载这个目录。

本仓库没有真实 env、数据、订阅登录或固定 Codex 二进制。`scripts/install-personal-ai.sh` 需要 `bin/codex-0.160.1` 与 `bin/codex-code-mode-host-0.160.1`：应通过已授权官方分发取得，不能将其他主机的个人凭据混入仓库。

## CivilFlow 的独立源码

```bash
git clone --branch codex/civilflow-v2-api-completion \
  git@github.com:ly2u/midas_vueflow.git apps/midas_vueflow
git -C apps/midas_vueflow log -1 --oneline
```

VPS 当前部署提交为 `7a56c7a08b72ece3f8e921a8746939ec14718c84`。分支如果追加提交，需要核对差异，不强制 reset，不覆盖已有修改。需要复现该版本时可使用独立 clone 并 checkout 此提交，Docker 构建上下文只使用 `civilflow_v2`。

## 运维脚本适用范围

仓库 `scripts/` 保留了 VPS 已使用的脚本，作为审查材料；它们不是全新 clone 可无条件执行的一键安装流程。

- `verify-sources.py` 依赖原始网站 ZIP 和 CivilFlow 的 VPS 清单；这两类材料不在新仓库中。仓库快照使用 `docs/provenance/source-snapshot.json` 查看原始来源摘要，Git commit 记录后续修改。
- `bootstrap-host.sh` 是初装 Debian13 的流程，会拒绝已有 `/opt/ly-stack`。不要在现有服务器执行来“重新部署”。
- `deploy-host.sh` 包含历史镜像标签和原始材料检查，不能代替当前网站的发布步骤。
- `backup.sh`、`verify-backup.py` 假定完整生产目录存在（包括部署记录、AI 二进制与已授权的订阅凭据）；备份只能存入权限受限的本机目录，不提交 GitHub。审查环境不运行这些生产备份脚本。
- `.env.example` 只说明字段。真实 `CIVIL_PASSWORD_HASH` 用完整 bcrypt 哈希与 dotenv 单引号保存，不能把明文放入配置，也不要把展开后的 `docker compose config` 上传。

## 当前 VPS 后续更新

**已改为按 Git 标签发布，见 [发布与回滚](RELEASE.md)。** 首次使用前需要完成那份文档第 2 节的一次性迁移。迁移后：

- `sites` 镜像只由 `scripts/release.py` 从标签源码构建，`compose.yaml` 不再从 `apps/rqly-sites` 构建；
- 岛屿静态资源由发布脚本更新，不再手工复制；
- 每次发布前自动备份，健康检查失败自动回滚，发布记录在 `/opt/ly-stack/releases/`。

审核或合并 PR 仍然不会自动部署。

迁移之前沿用的手工步骤（仅供参考）：

1. 保存一致性数据备份、当前镜像和静态快照。
2. 在独立工作目录检出提交，运行源码测试与静态构建；按需进行隔离浏览器检查。
3. 将审查通过的源码复制到生产构建目录，给新镜像使用新标签。注意：被复制的文件如果列在 `apps/rqly-sites/SOURCE-CHANGES.json` 中，需要同步更新其中的哈希，否则 `verify-backup.py` 会校验失败。
4. `docker compose config -q`，只 recreate 需要更新的服务并等待健康；不重启 VPS，不发送 Civil 写入。
5. 静态资源先复制新 hash 资源，最后原子替换 index；保留上一版资源及镜像。
6. HTTPS 和现有内容只读复查，更新来源清单、部署记录与本机备份。
