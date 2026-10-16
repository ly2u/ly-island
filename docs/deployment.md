# 部署

- **状态：** 静态部分已实现（第 1 阶段，`site/`）；岛务 Worker 已实现，待审查（第 2 阶段，`packages/worker/`、`site/worker/`）
- **日期：** 2026-10-13，2026-10-15、2026-10-16 更新

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
   - **进度存在 D1，中途停下不丢：** 每座邻居记下名片和各分页的 `ETag`、目标快照摘要、已验证的活动版本、待扫分页、下次该读的时间和连续失败次数。
   - **平时和首次同步的成本不同：**
     - 平时：名片缓存 24 小时，一座邻居通常只要 1 个请求，大多数返回 `304`；
     - 首次同步或缓存过期时：要读名片和动态，可能还有下一页，一座邻居最多 3 个请求。所以首次同步可能分几轮才完成。
   - 动态是可修改快照。首页摘要变化后重验分页缓存，每座邻居每轮最多再读 1 页；只对未见或已更新的活动版本验签。遇到旧 `id` 不能停。扫描跨轮续跑，结束时重验首页，再登记完成，详见[动态快照约定](protocol-v0.md#动态outbox)。
   - 很久没更新的邻居查得更少，规则见[协议的频率与批次](protocol-v0.md#频率与批次)。两跳外的漂流瓶抽样每天最多 40 座，也从同一个预算里扣。
   - 定时任务的分钟由 `hash(本岛 origin)` 决定，部署时生成，不用模板里写死的整点，避免所有岛同时抓取。
   - **第 2 阶段的验收：** 准备 40 座首次同步的邻居，同时带分页、重定向和通知。每次运行都不超过 50 个外部请求，几轮之后全部同步完成，CPU 用量在免费额度内。另用 120 篇记录验证修改最旧文章、撤回、补发旧日期文章，以及扫描中途构建新版本：旧内容都能更新，不漏项，也不把未完成扫描当作完成。
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
- **岛务服务是一个 Web 标准的处理函数** `{ fetch, scheduled }`，不依赖任何框架和平台（`packages/worker/`）。原计划用 Hono，实现时改成了不用框架，这是对[决定 F4](decisions.md#f4-部署目标已定) 的修改提议，等站主确认。
- **平台相关的部分只留在适配层：**

  | 能力 | Cloudflare | 自托管 |
  |---|---|---|
  | 数据库 | D1（`store-d1.js`） | SQLite，Node 自带的 `node:sqlite`（`store-node.js`） |
  | 定时任务 | Cron Triggers | 进程内定时器或 systemd timer |
  | 凭据 | Worker secrets | 环境变量文件 |
  | 站主登录 | Cloudflare Access | 反向代理层的访问控制或通行密钥 |
  | 出站地址检查 | 平台的网络 | 先解析域名，拒绝内网地址，再连接（`resolver` 参数） |

- **两种数据库适配层用同一套接口**（`all`、`first`、`run`、`batch`）。Node 里的测试用 SQLite 跑完整的多岛场景；CI 另外在 workerd 里（`wrangler dev`，本地 D1）跑一遍冒烟测试。

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
- 第二座测试岛 dev2.rqly.com 用来测试邻居、投递和漂流瓶，见下文第 2 阶段的清单。
- 岛务的站主路径用 Cloudflare Access 保护，只允许站主。
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

### 第 2 阶段：岛务 Worker

第 2 阶段的模块 PR 合并进 `framework` 之后做，在第 1 阶段的 Worker 上继续。同样只在 Cloudflare 控制台操作。

**1. 改部署命令：** Worker → Settings → Build：

| 设置 | 值 |
|---|---|
| 构建命令 | `npm run build`（不变） |
| 部署命令 | `npm run deploy` |

`npm run deploy` 先按本岛地址生成 `wrangler.generated.json`，再部署。生成的配置里有：

- 定时任务：每小时 4 次，分钟由 `hash(本岛 origin)` 决定。dev.rqly.com 是 `8,23,38,53 * * * *`；
- D1 数据库 `island-data`：第一次部署时自动创建并绑定，不用手动建，也不用填 ID。服务第一次运行时自己建表；
- 变量 `ISLAND_TIME_ZONE`：取自设置里的时区，用于通知的免打扰时段和摘要时间。

**2. 运行时密钥：** Worker → Settings → **Variables and secrets**。这是运行时的设置，和第 1 阶段的构建密钥是两处，都要填。

| 名称 | 类型 | 值 |
|---|---|---|
| `ISLAND_SIGNING_KEY` | Secret | 和构建密钥相同的 64 位十六进制。没有它，岛能收信但不能寄信 |
| `ACCESS_TEAM_DOMAIN` | Text | 第 3 步的团队域名，例如 `myteam.cloudflareaccess.com` |
| `ACCESS_AUD` | Text | 第 3 步应用的 AUD 标签。分在几个应用里时，用逗号隔开 |
| `NTFY_TOPIC` | Secret | 可选，见第 4 步 |

`wrangler.jsonc` 设了 `keep_vars: true`，部署不会清掉在控制台里加的变量。

**3. 用 Cloudflare Access 保护站主路径：** Zero Trust → Access → Applications → Add an application → Self-hosted。

- **要保护的路径**（Path 末尾的 `*` 覆盖下面的所有路径）：
  - `dev.rqly.com/island/admin*`
  - `dev.rqly.com/island/api*`
  - `dev.rqly.com/island/compose*`
- 一个应用里能加几个地址，就都加进同一个应用；不能的话分成几个应用，把各自的 AUD 标签都填进 `ACCESS_AUD`。
- **策略：** Allow，Include → Emails → 只填站主自己的邮箱。
- **不要保护这些路径，**它们本来就是公开的，或者有自己的凭据：`/island/inbox`（别的岛投递）、`/island/go`（访客的回信入口）、`/island/ai/*`（AI 令牌）、所有静态页面。不要开"保护整个 Worker"，那会把收件箱也挡住。
- 应用的 AUD 标签在应用的概览里；团队域名在 Zero Trust → Settings → Custom pages 里。
- 服务自己会再验证一次 Access 的令牌（签名、`iss`、`aud`、时间）。Access 漏配时，站主路径只会拒绝所有人，不会放人进来。

**4. 通知（可选）：** `site/island/notify.json` 里没有列渠道时，设了密钥的渠道都会用上，不用改仓库。

- **ntfy：** 想一个别人猜不到的长主题名，设成 `NTFY_TOPIC`，在手机的 ntfy 应用里订阅它。
- **Telegram：** `TELEGRAM_BOT_TOKEN`（Secret）和 `TELEGRAM_CHAT_ID`。
- **webhook：** `WEBHOOK_URL`（Secret），会收到 `{ title, text, events }`。

**5. 部署并检查：** 在 Deployments 里重试，或者等下一次合并。然后：

- 打开 https://dev.rqly.com/island/admin/，应先跳到 Access 登录页。登录后到"设置"：
  - 显示"可以寄信"，说明运行时密钥和名片一致；
  - 点"发一条测试通知"，手机应该收到。
- 在任意电脑上：

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' https://dev.rqly.com/island/inbox   # 400
  curl -s -o /dev/null -w '%{http_code}\n' https://dev.rqly.com/island/ai/inbox                                                      # 401
  ```

- Worker → Logs：每 15 分钟一行 `island cron {...}`，其中 `used` 是这次用掉的外部请求数，应当不超过 45。

**6. 第二座测试岛 dev2.rqly.com：** 同一个仓库再建一个 Worker，按第 1 阶段的第 2 到 6 步和本节的第 1 到 5 步做，不同的地方：

| 设置 | 值 |
|---|---|
| Worker 名称 | `island-dev2` |
| 构建变量 `ISLAND_CONFIG` | `examples/second-island.config.json`（英文界面、纯文字主题、柏林时区） |
| 构建变量 `ISLAND_ORIGIN` | `https://dev2.rqly.com` |
| 构建变量 `ISLAND_WORKER_NAME` | `island-dev2`（数据库随之叫 `island-dev2-data`，两座岛的数据不会混） |
| 构建密钥和运行时密钥 `ISLAND_SIGNING_KEY` | 另跑一次 `npm run keygen` 得到的新钥匙，不和 dev.rqly.com 共用 |
| Access | 把 `dev2.rqly.com/island/admin*` 等三个路径加进第 3 步的应用，或另建一个 |
| 自定义域名 | `dev2.rqly.com` |

**7. 两座岛之间的验收：**

| 做什么 | 预期 |
|---|---|
| 在 dev2 的岛务"岛屿"里关注 `https://dev.rqly.com` | dev 还没关注 dev2，所以这条关注在 dev 的"陌生来信"里；当天的摘要只说陌生来信有几封 |
| 在 dev 的岛务里回关 dev2 | 两边互为邻居；之后 dev2 的来信进 dev 的收件箱，留言即时通知 |
| 打开 dev 的一篇记录，在"从你的岛回信"里填 `dev2.rqly.com`，点"写留言" | 跳到 dev2 的写信页（先登录 Access），收件人和"关于"已填好；寄出后回到原来的记录页，显示"已经寄到了"；dev 的手机马上收到留言通知 |
| 同一页点"浇水"，以及在 dev2 的收件箱里点"回访" | dev 收到浇水和拜访，按默认策略进摘要 |
| 互相关注后，先在两边的"邻居动态"里点"现在同步"（第一次同步只记下已有的记录，不发通知）；再在 `framework` 合并一篇新的示例记录，等两座岛重新部署后再点一次 | 两边的"邻居动态"里都有对方的这篇记录，并进入当天的摘要。不点的话，定时任务按对方的活跃程度在 1 到 24 小时内读到 |
| 在 dev 的"岛屿"里屏蔽 dev2，再从 dev2 寄一条 | dev2 显示已送达，dev 不显示也不通知 |
| 一周后看两个 Worker 的用量 | 请求、CPU、D1 读写都在免费额度内 |

**出了问题：**

- 代码可以在 Deployments 里回滚。数据库的表只增不减，旧代码也能读；
- 数据先在岛务"设置"里点"导出全部互动数据"留一份 JSON；
- D1 自带按时间点恢复（Time Travel），可保留的天数以控制台为准。

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

2026-10-16 按 Cloudflare 官方文档核对（第 2 阶段用到的）：

- **免费档的运行限制：** 每次 HTTP 请求和每次定时运行都是 10 ms CPU；每次最多 50 个外部请求，D1 的查询也算在内。服务按每次 45 个的预算计数（`BUDGET`）。
- **只让服务路径进 Worker：** `assets.run_worker_first` 可以写成路径列表，其余请求直接走静态资源，不计 Worker 请求。
- **D1 自动创建：** Wrangler 4.45 起，配置里只写数据库名、不写 ID 时，第一次部署自动创建并绑定。
- **Access 令牌：** 请求头 `Cf-Access-Jwt-Assertion`，RS256 签名；公钥在 `https://<团队>.cloudflareaccess.com/cdn-cgi/access/certs`，按 `kid` 匹配；`iss` 是团队域名，`aud` 是应用的 AUD 标签。
- **Access 的路径：** Path 末尾的通配符覆盖下面的所有路径；更具体的规则优先。"保护整个 Worker"会连同 `workers.dev` 和预览地址一起保护，但也会挡住公开的收件箱，所以这里按路径保护。
- **本地测试定时任务：** `wrangler dev --test-scheduled` 打开 `/cdn-cgi/local/scheduled` 路径，CI 的冒烟测试就用它。

## 待核实

- Cloudflare Access 免费档的人数和功能。第三方资料显示 2026 年仍是 50 人以内免费，部署第 2 阶段之前在控制台的套餐页确认；
- 一个 Access 应用能不能同时保护几个路径（控制台里叫"public hostname"或"destination"）。不能就按清单分成几个应用；
- **Worker 能不能连到内网地址。** 文档没有写。服务在 Worker 上没有自己的 DNS 解析，只检查地址本身，靠平台挡住内网。部署后实测：在岛务里关注 `https://localtest.me`（公共 DNS 解析到 `127.0.0.1`），"已寄出"里应显示失败而不是送达，把结果记到这里；
- Workers 上 Ed25519 验签的实际 CPU 耗时。定时任务每轮最多验 40 个签名，部署后看 Worker 的 CPU 用量，按实际值调整 `POLL.verifyLimit`；
- Worker 在免费档发送邮件的条件（只能发给已验证地址，还是可以发给任意地址）；
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
- [静态资源：`run_worker_first`](https://developers.cloudflare.com/workers/static-assets/binding/#run_worker_first)
- [Access 的应用路径](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
- [用 Access 保护 Worker](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [定时任务的本地测试](https://developers.cloudflare.com/workers/examples/cron-trigger/)
