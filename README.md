# LY Island：个人浮空岛、写作后台与七嘴

rqly.com 的当前网站源码快照：公众以三维浮空岛访问书屋、工程展馆、工坊、岛主与信箱；站主登录统一后台写作、整理内容与布置小岛。7zui.com 提供稿件规则检查与站主专用 AI 审阅。

此仓库公开开源，用于代码审查与后续版本管理。包含源代码、示例配置、测试及运维脚本，不包含真实密码、API key、订阅登录凭据、证书、SSH 私钥、线上文章存档、私信、上传图片、原能滩吊桥照片或运行备份。`apps/rqly-sites/content/posts.json` 是原始随源码交付的公开种子文章，不是从服务器用户数据目录导出的文章。

## 目录

| 路径 | 内容 |
|---|---|
| `apps/rqly-sites/` | Node.js HTTP 服务、主站/七嘴、管理员账号与会话、内容/目录/版本/图片/信箱、受控 AI 站点工具 |
| `apps/ly-island-preview/` | Three.js 场景、岛内阅读、检索、关联目录和管理员场景；名称保留开发时路径 |
| `apps/personal-ai/` | 站主专用 Unix socket AI 桥接服务与限制配置，默认 Luna / medium |
| `compose.yaml`、`Caddyfile` | 当前统一部署布局，无真实凭据 |
| `scripts/`、`systemd/` | 当前 VPS 运维脚本；部分依赖服务器独有材料，详见部署说明 |
| `docs/REVIEW.md` | 审查范围、入口、数据流、测试与已知限制 |
| `docs/DEPLOYMENT.md` | 本地复现、部署边界和 CivilFlow 获取方式 |
| `docs/RESEARCH-WRITING.md` | 表格、公式、预览定位与文章分享 |
| `docs/EMAIL-DNS.md` | 尚未发信时的 DNS 防冒用填写方式与日后认证步骤 |
| `docs/ADMIN-MFA.md` | 可自行开启的管理员两步验证、恢复码、备份与恢复 |
| `docs/RELEASE.md` | 按 Git 标签发布、预检查、自动回滚与手动撤销 |
| `docs/decisions/` | 架构决策记录：已定的方向、待实施的改动与实施顺序 |
| `docs/provenance/` | VPS 源码摘要与来源记录，旧静态/二进制清单只作为历史证据 |

## 本地开发

需要 Node.js 24。所有测试应使用新克隆的工作目录，保持 `.env` 不存在；测试脚本使用临时数据，不应挂载 `/srv/ly-data/sites`。

```bash
cd apps/rqly-sites
npm ci
npm run setup
npm run dev -- --port 4173
```

`setup` 在本机终端显示一次性生成的后台密码，请自行保管。网站端口默认 4173；开发预览的 `/qizui/` 路由可以检查七嘴。初始化产生的 `.env` 与数据目录受到 Git 忽略规则保护。

另开终端运行岛屿开发入口：

```bash
cd apps/ly-island-preview
npm ci
npm run dev
```

后端与岛屿联调使用根目录 `compose.review.yaml`：

```bash
docker compose -f compose.review.yaml up --build --wait
```

打开 http://localhost:4173/ 查看岛屿，http://localhost:4173/qizui/ 查看七嘴；默认不启用模型调用。审查环境只绑定宿主机 127.0.0.1，使用独立 Docker volume，不挂载生产数据或 AI socket。初始化本地账号的方法见 [部署说明](docs/DEPLOYMENT.md#隔离审查环境)。

## 验证

在没有 `.env` 的全新代码目录中执行：

```bash
cd apps/rqly-sites
npm ci
for check in scripts/check*.mjs; do node "$check"; done
cd ../ly-island-preview
npm ci
npm run build
```

检查涵盖公开/私有内容、会话/CSRF/版本冲突、图片隐私和删除保护、自动草稿、历史恢复、信箱、内容归属、岛屿布置及限定 AI 工具。规则与工具测试使用隔离数据/模拟服务，不调用真实模型或 Civil 执行端。GitHub Actions 运行同类检查与静态构建，无生产部署步骤；在线浏览器验收记录来自 VPS，不能等同于跨设备、压力或独立安全审计。

## CivilFlow

CivilFlow V2 继续保存在独立私有仓库 [ly2u/midas_vueflow](https://github.com/ly2u/midas_vueflow)，功能分支 `codex/civilflow-v2-api-completion`，当前部署提交 `7a56c7a08b72ece3f8e921a8746939ec14718c84`。本仓库保留统一 Compose 接入，其构建上下文是 `apps/midas_vueflow/civilflow_v2`。审查该项目需要单独仓库访问权限，不能在验收时发送真实 Civil 写入或分析命令。

## 当前边界

个人维护、单个 Node 服务实例和 JSON 持久化是当前目标。没有多人编辑账号系统、集群文件锁、完善的异地容灾或每座建筑独立成长机制。CivilFlow 项目仍在各浏览器 localStorage。AI 仅供登录站主使用，不是公众共享服务，账号额度与桥接运行文件不在 Git 中。

这不是“一键重装 VPS”的软件包。Git 是源码的唯一来源：线上通过 `scripts/release.py` 发布已合并到 `main` 并打了标签的提交（见 [发布与回滚](docs/RELEASE.md)）。Git 拉取或合并不会自动替换生产服务。

## 开源许可

原创应用代码使用 [MIT License](LICENSE)，版权署名 ly2u。npm 依赖与运行工具保留各自许可；不对 CivilFlow 独立仓库或用户内容另行授予许可。代码中的账号、域名、种子文章和个人品牌仅用于说明现有实例，部署自己的站点时应自行替换。
