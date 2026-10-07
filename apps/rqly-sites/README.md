# 记录与求索 · LY / 七嘴

这是一套可部署到 BERO VPS 的双站源码，域名分别为 rqly.com 与 7zui.com。使用 Node.js 运行网站，Docker Compose 管理应用，Caddy 提供反向代理与自动 HTTPS。运行不依赖第三方 npm 包。

## 已包含的内容

- rqly.com：个人首页、记录列表与分类、文章页、关于页、能滩吊桥专题、RSS 和站点地图。
- 写作后台：`https://rqly.com/admin`。可写 Markdown、预览、保存草稿、公开发布、编辑已有文章。后台使用账号与密码保护。
- 7zui.com：汇报稿输入、受众与时长设置、专业人员/普通听众/编辑三个视角、复制和 Markdown 下载。
- 基础检查：浏览器本地运行，根据句长、术语和表述特征提示问题，不调用模型，也不是事实核验。
- AI 审阅：通过服务端调用 OpenAI 兼容的 Chat Completions 接口。接口密钥不会进入浏览器。默认支持访问码、每 IP 每小时额度和全站每日额度。

首页和三篇开站文章是本次制作的初稿，不是对你已经发表的文章的转载。可在后台直接修改或改为草稿。能滩专题仅提供四问导读，并使用你之前提供的历史照片；人物分工按已有课题材料整理，没有添加未经核实的技术地位、桥跨参数或精确年代结论。

本版采用轻量写作后台，未安装 Halo。这便于把两站放在同一套部署里，直接通过浏览器更新文章。

## 先看预览

压缩包中的 `preview/rqly-preview.html` 与 `preview/qizui-preview.html` 可直接在浏览器打开，无需服务器。主站预览可切换文章与能滩专题；七嘴预览可输入稿件并执行基础检查。

预览文件不提供写作后台和在线 AI 功能。以下部署方式才是完整网站。

## 新 VPS：使用 Docker Compose 上线

适用：服务器已有 Docker Engine 与 Compose v2，且 80/443 端口尚未被其他网站占用。支持常见的 Debian、Ubuntu 等 Linux 系统。

1. 将文件夹上传到 VPS，例如 `/opt/rqly-sites`，进入该目录。
2. 检查 Docker 与端口：

   ```bash
   docker --version
   docker compose version
   ss -ltnp '( sport = :80 or sport = :443 )'
   ```

   如已有 1Panel、宝塔或其他网站占用端口，请使用下面的“现有面板”方式，保留现有服务。

3. 初始化配置：

   ```bash
   docker run --rm -v "$PWD:/app" -w /app node:24-alpine node scripts/setup.mjs
   ```

   终端会显示写作密码与七嘴 AI 访问码。保存好它们。该命令只创建不存在的 `.env`，不会覆盖现有配置。

4. 编辑 `.env`，填写 `ACME_EMAIL` 为自己的邮箱。想先上线基础检查，可以暂时保留 AI 配置为空。
5. 在域名管理处设置 DNS：

   | 类型 | 名称 | 内容 |
   |---|---|---|
   | A | rqly.com 的 `@` | VPS 公网 IPv4 |
   | CNAME | rqly.com 的 `www` | rqly.com |
   | A | 7zui.com 的 `@` | VPS 公网 IPv4 |
   | CNAME | 7zui.com 的 `www` | 7zui.com |

   若存在旧的 AAAA 记录，而 VPS 没有相应 IPv6 地址，需要同步调整。首次申请证书时，在 Cloudflare 将这些记录设为“仅 DNS”；两站 HTTPS 正常后，如启用代理，SSL/TLS 模式选择“完全（严格）”。

6. 确保 VPS 防火墙和服务商安全组允许入站 TCP 80 与 443。然后启动：

   ```bash
   docker compose up -d --build
   docker compose ps
   docker compose logs --tail=80 app caddy
   ```

7. 打开 `https://rqly.com`、`https://7zui.com`。`www` 会跳转到根域名。进入 `https://rqly.com/admin`，使用账号 `ly` 和初始化时生成的密码写文章。

## 已有 1Panel 或其他网站面板

初始化 `.env` 的步骤相同。随后只启动应用：

```bash
docker compose -f compose.panel.yaml up -d --build
```

在面板中创建 rqly.com 与 7zui.com 两个反向代理网站，目标均为 `http://127.0.0.1:8080`。保留原请求的 `Host`，并将 `X-Real-IP` 覆盖为访客地址。由面板申请和管理两个域名的 HTTPS 证书。

如果面板的反向代理本身运行在隔离的容器中，`127.0.0.1` 指向代理容器，而不是宿主机；此时按面板的容器网络方式连接本应用，将两者加入同一网络，使用 `app:8080` 或面板提供的宿主机访问地址。

该方式不启动本包里的 Caddy，因此不会占用或改动现有网站的 80/443 端口。后续操作继续使用 `docker compose -f compose.panel.yaml ...`。

## 启用 AI 审阅

编辑 `.env`：

```dotenv
AI_BASE_URL=https://你的模型服务域名/v1
AI_API_KEY=你的接口密钥
AI_MODEL=服务商提供的模型标识
AI_JSON_MODE=true
AI_TOKEN_PARAMETER=max_tokens
REVIEW_ACCESS_TOKEN=初始化时生成的访问码
AI_HOURLY_PER_IP=5
AI_DAILY_LIMIT=40
```

`AI_BASE_URL` 填到 `/v1` 为止；应用会追加 `/chat/completions`。接口服务需支持对应的 Chat Completions 请求，并返回 `choices[0].message.content` 中的 JSON。

如模型不支持 `response_format: json_object`，将 `AI_JSON_MODE=false`。如服务要求 `max_completion_tokens`，修改 `AI_TOKEN_PARAMETER=max_completion_tokens`。`AI_TEMPERATURE` 默认留空，兼容不接受该参数的模型。

更新环境变量后必须重建应用容器，单纯 restart 不会重新加载 Compose 的 env_file：

```bash
docker compose up -d --force-recreate app
```

七嘴页面随后会提供 AI 审阅，访客需输入访问码。默认一次请求生成三个视角，不同时调用三个模型。审阅并发上限为 2，超时约 85 秒；每次尝试占用一个每日额度，模型请求失败也会计入。每日额度以 UTC 日期切换，计数保存在数据卷中；单 IP 每小时额度在应用内维护，重启后重置。

站主可清空访问码开放 AI，但需自行决定可接受的接口用量。稿件不会写入应用数据库或日志；使用 AI 时正文会发送给配置的模型服务，其保存规则由该服务决定。模型意见应作为修改建议，不能代替原始资料核对或工程验算。

## 更新文章与专题

- 后台可新增或修改三类文章：记录、工程、探索。
- 草稿不会出现在首页、文章列表、RSS 或公开文章地址。
- 已存在文章的地址标识固定，避免文章链接失效。可以修改标题、正文、分类、摘要、日期与发布状态。
- 能滩专题的导读在 `public/rqly/nantan.html`；换图时替换 `public/rqly/bridge.jpg`。专题文字目前按静态页面维护。
- 网站品牌和个人介绍分别位于 `public/rqly/index.html` 与 `public/rqly/about.html`。

修改源码后执行：

```bash
docker compose up -d --build
```

现有数据卷中的文章不会被 `content/posts.json` 重新覆盖。它只用于第一次初始化。

## 数据与备份

文章和 AI 额度计数保存在 `site_data` 数据卷。每次后台保存文章前，应用自动保留一份旧版本，最多 10 份；这不等同于异地备份。

定期把应用数据复制到服务器上的备份目录，再复制到自己的另一台设备：

```bash
backup_dir="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
docker compose cp app:/app/data "$backup_dir/data"
cp .env "$backup_dir/.env"
chmod 600 "$backup_dir/.env"
```

恢复时先停止 app，再将备份目录里的文件复制回 `/app/data`，最后启动 app。保留原来的 `.env`。更新应用请用 `docker compose up -d --build`，需要暂停时使用 `docker compose stop`；不要使用 `down -v` 删除数据卷。

## 本地运行与验证

安装 Node.js 22 或更新版本即可。没有 npm 依赖，无需执行 npm install。

```bash
npm run setup
npm run dev
```

本地浏览器打开 `http://localhost:4173`，七嘴入口在 `/qizui/`。

```bash
npm run check
npm run preview-files
```

验证覆盖页面与静态资源、写作权限、草稿隔离、文章保存、HTML 转义、输入边界、请求来源、AI 访问码、模拟模型接口和用量限制。桌面与 390px 窄屏布局、独立预览的文章导航与基础审阅已在浏览器检查。下载按钮会生成 Markdown 文件，但本次测试浏览器未返回下载事件，因此实际下载仍需在本机浏览器复核。真实模型服务、Docker 镜像构建、域名 DNS 与证书，需要在你的 VPS 和实际接口配置上验证。

七嘴另提供浏览器 WebMCP 接口：读取当前意见、暂存稿件、执行基础检查。工具不会自动发起 AI 调用。支持该能力的浏览器可以使用；普通浏览器仍可正常操作网页。本次检查的浏览器尚未暴露这些网页工具，因此 WebMCP 调用验证不可用；常规网页交互已检查。

## 参考文档

- [Node.js HTTP 文档](https://nodejs.org/api/http.html)
- [Caddy 反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Caddy 环境变量](https://caddyserver.com/docs/caddyfile/concepts#environment-variables)
- [Docker Compose 环境变量](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/)
- [Chat Completions API 参考](https://developers.openai.com/api/reference/resources/chat)
