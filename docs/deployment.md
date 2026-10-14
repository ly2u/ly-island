# 部署

- **状态：** 第 1 阶段，静态部分已实现（`site/`）
- **日期：** 2026-10-13，2026-10-15 更新

**目标：** 普通人点一个按钮，就能在 Cloudflare 免费档上拥有一座岛；想自己托管的人，用同一套代码跑在自己的服务器上。

## 三种参与方式

| 方式 | 有什么 | 放在哪 | 维护 |
|---|---|---|---|
| 纯静态岛 | 页面、订阅源、名片、动态、邻居列表。别人能看、能关注，但收不到投递 | Cloudflare、GitHub Pages 或任何静态托管 | 不用维护 |
| 静态岛加岛务 Worker（默认） | 全部功能：收件箱、拜访、留言、漂流瓶、通知、邻居动态 | Cloudflare 免费档 | 几乎不用维护 |
| 自托管 | 和默认一样 | 自己的服务器，一个容器 | 自己负责 |

三种方式之间可以互相做邻居。普通博客也能出现在邻居列表里，通过 RSS 读取。

## Cloudflare 免费档

以下额度于 2026-10-13 按 Cloudflare 官方文档核对。每天的额度在 UTC 零点重置。

| 用途 | 服务 | 免费额度 | 一座岛够不够 |
|---|---|---|---|
| 页面、文章、图片、名片、动态 | Workers 静态资源 | 访问静态资源免费、不限次数，不计入 Worker 请求数；每个版本最多 2 万个文件，单个文件最大 25 MiB | 足够 |
| 推送后自动构建上线 | Workers Builds | 每月 3,000 分钟，同一时间 1 个构建，单次最长 20 分钟 | 足够 |
| 拉取邻居动态、收集漂流瓶、发摘要 | 定时触发的 Worker | 每个账号 5 个定时任务；每次运行 10 ms CPU，最多 50 个外部请求 | 够，但要分批，见下文 |
| 收件箱、来访计数、后台接口 | Worker | 每天 10 万次请求；每次 10 ms CPU；内存 128 MB | 足够 |
| 互动数据 | D1 数据库 | 每天写 10 万行、读 500 万行；总共 5 GB | 足够 |
| 大图片、相册（可选） | R2 存储 | 每月 10 GB；1,000 万次读、100 万次写；流出流量免费 | 一般用不到 |
| 很少变化的配置 | KV | 每天写 1,000 次、读 10 万次；总共 1 GB | **不用来存经常变化的数据** |

**一键部署：** Cloudflare 的 "Deploy to Cloudflare" 按钮会做三件事：

1. 把模板仓库复制到用户自己的 GitHub 或 GitLab；
2. 按配置自动创建 D1 数据库等资源，并绑定到 Worker；
3. 之后每次推送到生产分支，都自动构建和部署。

新人上手的流程是：点按钮，填名字，有岛。

## 结构

```
访客 ──► 静态资源（页面、文章、名片、动态）       免费、不限次数，不经过 Worker
           │
           └─ 只有互动才调用 ─► 岛务 Worker ── D1（收件箱、来访、海滩、投递队列）
                                  │  ▲
     定时：拉取邻居的动态 ◄───────┘  └── 别的岛投递来的签名活动
                                  │
                                  └─► Telegram、ntfy、webhook 通知
```

静态部分和岛务 Worker 放在同一个 Worker 项目里，一次部署。只有互动相关的路径（例如 `/island/inbox`、`/island/admin`）才进入 Worker 代码，其余路径直接走静态资源，不消耗请求额度。

## 免费档带来的设计约束

1. **定时任务放在 Cloudflare，不放在 GitHub Actions。**
   - GitHub 的规定是：公开仓库 60 天没有活动，定时工作流会被自动停用。
   - 停用恰好落在一段时间没写的人身上，他们最需要"邻居发新文章了"这样的提醒，而他们的岛会悄悄停止同步。
2. **Worker 里不做重活。** 每次只有 10 ms CPU（等待网络的时间不算）。
   - 图片在构建时或浏览器里处理；
   - 成长规则在构建时和浏览器里算（见[扩展接口](extensions.md#成长规则)）；
   - AI 不在 Worker 里跑（见[扩展接口](extensions.md#ai-管家)）；
   - 动态用 JSON 格式；抓取时带 `If-None-Match`，没更新的岛只返回 `304`。
3. **每次运行最多 50 个外部请求，重定向也算。按实际预算分批，而不是按固定岛数。**
   - **每次运行的预算（默认值）：**
     - 外部请求最多 40 个，留 10 个给通知和重试；
     - 最多验证 100 个签名。实际耗时在第 1 阶段实测后再调整；
     - 预算快用完就停下，剩下的任务留到下一轮。
   - **进度存在 D1，中途停下不丢：** 每座邻居记下名片和动态的 `ETag`、上次读到的最新活动、下次该读的时间、连续失败次数。
   - **平时和首次同步的成本不同：**
     - 平时：名片缓存 24 小时，一座邻居通常只要 1 个请求，大多数返回 `304`；
     - 首次同步或缓存过期时：要读名片和动态，可能还有下一页，一座邻居最多 3 个请求。所以首次同步可能分几轮才完成。
   - 每次只验证上次读到的那条之后的新活动；每座邻居每轮最多再读 1 页。
   - 很久没更新的邻居查得更少，规则见[协议的频率与批次](protocol-v0.md#频率与批次)。两跳外的漂流瓶抽样每天最多 40 座，也从同一个预算里扣。
   - 定时任务的分钟由 `hash(本岛 origin)` 决定，部署时生成，不用模板里写死的整点，避免所有岛同时抓取。
   - **第 2 阶段的验收：** 准备 40 座首次同步的邻居，同时带分页、重定向和通知。每次运行都不超过 50 个外部请求，几轮之后全部同步完成，CPU 用量在免费额度内。
4. **经常写的数据放 D1，不放 KV。** KV 每天只能写 1,000 次，记录来访、去重、轮询进度很快就会用完。
5. **"不审核"不等于"不防滥用"。**
   - 收件箱是公开的。有人刷满每天 10 万次的话，当天的互动功能会停到 UTC 零点，但岛本身是静态的，照样能看。
   - 防护手段都是岛主自己的工具：
     - 定向活动必须带签名；
     - 按关系分级：陌生人的来信进"陌生来信"，不发即时通知（见[协议](protocol-v0.md#签名不等于可信按关系分级)）；
     - `accepts` 接收策略和屏蔽名单；
     - 按发送者和可注册域名限速；
     - 匿名留言（如果开启）用 Cloudflare Turnstile 人机验证。
   - Worker 应当先做不花钱的检查（大小、格式、时间窗口、去重），再读名片、验签名。
6. **内容放在 Git 里。**
   - 文章是用户仓库里的标准 Markdown，D1 只存互动数据。
   - 想在浏览器里写，就接一个现成的、直接提交到 Git 的编辑器，例如 Sveltia CMS 或 Decap CMS，不自己写编辑器。
   - Git 历史本身就是内容的备份。

## 站主登录与凭据

**站主后台**（`/island/admin` 和所有站主接口）用 Cloudflare Access 挡在外面。登录流程交给 Access，应用不用自己实现。但应用自己**必须**再验证一次身份，不能只靠 Access 那一层。免费条件见[待核实](#待核实)。

**验证 Access 的身份令牌：**

- 每个站主请求都读取 `Cf-Access-Jwt-Assertion` 请求头，用成熟的库（例如 jose）检查：
  - **签名：** 公钥从团队域名下的 `/cdn-cgi/access/certs` 获取，按令牌的 `kid` 匹配，不把公钥写死；
  - **`iss`：** 等于团队域名；
  - **`aud`：** 等于这个应用的 AUD 标签；
  - **时间：** 没有过期，也没到生效时间之前。
- 缺少配置、没有令牌、任何一项不对，一律拒绝。

**关掉或保护所有备用入口：**

- 同一个 Worker 除了自定义域名，还可能通过 `workers.dev`、版本 URL、预览 URL 访问。关掉 `workers.dev` 并不会关掉预览 URL。
- 配置里显式写上 `workers_dev = false` 和 `preview_urls = false`。需要预览时，用 Access 保护这些入口。
- 上面的令牌验证在所有入口上都生效。万一某个入口漏配了，也拿不到站主权限。

**站主写操作防 CSRF：**

- 只接受 `POST`；
- `Content-Type` 必须是 `application/json`；
- `Origin` 必须等于本岛 origin；
- `GET` 不改变任何状态。

**三种身份分开：**

| 身份 | 凭什么 | 能做什么 |
|---|---|---|
| 站主 | Access 令牌 | 全部站主操作 |
| AI | 单独的令牌，只存哈希，随时可以吊销 | 只能"读"或"起草"，调用不了发布和投递接口 |
| 别的岛 | 签名活动 | 只能投递到收件箱 |

**自托管：** 同样要求应用自己验证身份。只有服务只监听本机或内网、外部无法直接访问时，才可以信任反向代理传来的身份头。

**凭据**（签名私钥、Telegram 令牌、给 AI 的令牌）只放在平台的密钥设置里：

- 运行时用 Worker 的 secret；公开活动在构建时签名，所以签名私钥还要作为构建时的 secret；
- 不进仓库，不进 D1，不出现在日志和构建产物里；
- 给 AI 的令牌只有"读"和"起草"权限（见[扩展接口](extensions.md#ai-管家)）。

**互动数据导出：** D1 里的互动数据要能一键导出成 JSON，搬家或换平台时带走。

## 不被平台绑死

免费条款是一家公司定的，随时可能变。所以：

- **协议和静态页面不依赖任何平台。**
- **岛务 Worker 用 Hono 编写。** Hono 是一个成熟的轻量框架，同一份代码能跑在 Cloudflare Workers 和 Node.js 上。
- **平台相关的部分只留在适配层：**

  | 能力 | Cloudflare | 自托管 |
  |---|---|---|
  | 数据库 | D1 | SQLite |
  | 定时任务 | Cron Triggers | 进程内定时器或 systemd timer |
  | 凭据 | Worker secrets | 环境变量文件 |
  | 站主登录 | Cloudflare Access | 反向代理层的访问控制或通行密钥 |

- **CI 同时测两种适配层。**

Cloudflare 是"推荐的一键部署"，不是"唯一能跑的地方"。

## 自托管

- 一个容器跑 Node.js 版的岛务服务和 SQLite，前面放 Caddy 等反向代理提供 HTTPS 和静态文件；
- 没有平台额度的限制，但同样遵守[协议的出站请求规则](protocol-v0.md#出站请求)；
- 自己的服务器能访问到内网，所以出站校验，特别是拦截内网地址和防 DNS 重绑定，在自托管适配层里必须有自动测试覆盖。

## 域名

- 默认的 `*.workers.dev` 子域名在一些地区访问不稳定，文档应当引导用户绑定自己的域名。
- 域名本来就是身份的一部分，搬家规则见[协议](protocol-v0.md#身份)。

## 测试环境：dev.rqly.com

- 一个独立的 Cloudflare Worker 项目，从 `framework` 分支构建部署，绑定自定义域名 dev.rqly.com。
- rqly.com 的 DNS 已经在 Cloudflare，加一个子域名不影响 rqly.com 本身，也不经过 VPS、Caddy 和 `scripts/release.py`。
- 第 2 阶段再部署第二座测试岛（例如 dev2.rqly.com），用来测试邻居、投递和漂流瓶。
- 后台路径（第 2 阶段才有）用 Cloudflare Access 保护，只允许站主。
- 测试数据只用合成内容，不用真实文章和私信，这和 ly-island 仓库现有的规则一致。dev.rqly.com 显示的就是 `site/content/` 里的示例记录。

### 站主操作清单

第 1 阶段的模块 PR 合并进 `framework` 之后做。全程只在 Cloudflare 控制台操作，不碰 VPS。界面名称以 2026 年 10 月为准。

**1. 生成 dev.rqly.com 专用的签名钥匙（一次）。** 在自己的电脑上（需要 Node.js 22.12 以上）：

```bash
git clone -b framework https://github.com/ly2u/ly-island.git
cd ly-island/site
npm ci
npm run keygen
```

记下打印的 `ISLAND_SIGNING_KEY=…` 和公钥。这把钥匙只给 dev.rqly.com 用，存进密码管理器，不要发到 issue、PR 或聊天里。

**2. 创建 Worker 并连接仓库：** Workers & Pages → Create → 从 Git 仓库导入 → 选 `ly2u/ly-island`。

| 设置 | 值 |
|---|---|
| Worker 名称 | `island`（必须和 `site/wrangler.jsonc` 的 `name` 一致） |
| 生产分支 | `framework` |
| 根目录 | `site` |
| 构建命令 | `npm run build` |
| 部署命令 | `npx wrangler deploy` |
| 非生产分支的构建 | 关闭 |
| 构建监视路径（如果有这个选项） | `site/**`、`packages/**` |

**3. 构建变量和密钥：** Worker → Settings → Build → Variables and secrets。

| 名称 | 类型 | 值 |
|---|---|---|
| `ISLAND_ORIGIN` | Text | `https://dev.rqly.com` |
| `ISLAND_SIGNING_KEY` | Secret | 第 1 步打印的 64 位十六进制 |

**4. 触发一次部署：** 在 Deployments 里重试，或者等下一次合并进 `framework`。

**5. 绑定域名：** Worker → Settings → Domains & Routes → Add → Custom domain → `dev.rqly.com`。DNS 记录由 Cloudflare 自动添加，不要改 rqly.com 的其他记录。

**6. 检查：**

- 打开 https://dev.rqly.com/，能看到示例岛。
- 打开 https://dev.rqly.com/.well-known/island.json：
  - `id` 是 `https://dev.rqly.com`；
  - `keys` 里的公钥和第 1 步打印的一致。
- 在任意电脑上：

  ```bash
  curl -sI https://dev.rqly.com/island/outbox.json   # 应有 access-control-allow-origin: * 和 etag
  curl -sI https://dev.rqly.com/                     # 应有 content-security-policy
  ```

- 下一次合并进 `framework`、自动部署之后，确认 dev.rqly.com 仍然绑定在这个 Worker 上。这一点在[待核实](#待核实)里。

**出了问题：** 在 Deployments 里回滚到上一个版本即可。静态岛没有数据库，回滚不丢东西。

## rqly.com 以后怎么迁移

这是以后单独做的决定，现在不动 rqly.com。可选的路径：

- **留在 VPS：** 用自托管适配层；
- **搬到 Cloudflare：** 7zui.com 和 CivilFlow 继续留在 VPS。

**内容迁移：** ly-island 已经有内容导出（`docs/CONTENT-PORTABILITY.md`）。导出的 ZIP 里是标准 Markdown 加 YAML 文件头，写一个导入脚本，转成框架的内容目录。

**要注意的差异：**

- rqly.com 是浏览器后台写作；框架默认以 Git 为内容源。迁移前要决定 rqly.com 是改用 Git 写作，还是接一个浏览器编辑器。
- rqly.com 现有的三座建筑和岛主雕塑，要做成 `floating-island` 主题的配置。

## 已核实

2026-10-15 按 Cloudflare 官方文档核对：

- **构建时的密钥：** Workers Builds 支持只在构建时可用的变量和密钥，运行时访问不到。签名私钥 `ISLAND_SIGNING_KEY` 就按构建密钥提供。
  - 文档没有说明构建日志会不会遮蔽密钥，所以构建代码从不打印它；
  - CI 检查构建产物里没有密钥。
- **依赖安装：** Workers Builds 会自动安装依赖（可以用 `SKIP_DEPENDENCY_INSTALL` 关闭）。
- **Node 版本：** 构建镜像预装 Node 22 和 24，默认 24，可以用 `NODE_VERSION` 或 `.node-version` 指定。模板要求 22.12 以上，两个版本都满足。
- **响应头：** 静态资源支持 `_headers` 文件（最多 100 条规则），用来加跨域头和 Content-Security-Policy。默认带 `ETag`。
- **Deploy to Cloudflare 按钮：**
  - 会提示用户填写 Worker 的密钥（从 `.dev.vars.example` 读取），但构建密钥不在其中；
  - 要求部署的子目录完全自包含，包括依赖。
  - 现在的 `site/` 引用了仓库里的 `packages/`，所以一键部署留到第 4 阶段的模板仓库解决：要么把依赖打包进模板，要么改成由 Worker 在请求时签名并缓存动态。

## 待核实

- Cloudflare Access 免费档的人数和功能。第三方资料显示 2026 年 8 月仍是 50 人以内免费，第 2 阶段依赖它之前要以官方页面为准；
- Worker 在免费档发送邮件的条件（只能发给已验证地址，还是可以发给任意地址）；
- Workers 的 WebCrypto 对 Ed25519 签名和验签的支持情况，以及在 10 ms CPU 内一次验签的实际耗时（第 2 阶段）；
- `wrangler deploy` 是否保留在控制台里添加的自定义域名。第一次部署 dev.rqly.com 后实测；如果不保留，改为在 `wrangler.jsonc` 里声明 `routes`，地址由部署方提供。

## 参考

- [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers 定价与各服务免费额度](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers 静态资源的计费](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Workers Builds 的额度](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)
- [Deploy to Cloudflare 按钮](https://developers.cloudflare.com/changelog/post/2025-04-08-deploy-to-cloudflare-button/)
- [GitHub：停用和启用工作流（60 天规则）](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)
- [Workers Builds 的配置：构建命令、根目录、构建变量和密钥](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Workers Builds 的构建镜像：Node 版本、自动安装依赖](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
- [静态资源的 `_headers`](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Deploy to Cloudflare 按钮：密钥和子目录](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
