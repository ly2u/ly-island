# 部署

- **状态：** 第 0 阶段草案，待站主确认
- **日期：** 2026-10-13

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
3. **每次运行最多 50 个外部请求，所以邻居要分批轮询。**
   - 例如每 15 分钟查 40 座，一小时可以查完 160 座，远超一般人的关注数。
   - 两跳外的漂流瓶抽样，每天最多 40 座。
   - 发通知也算外部请求，要留出余量。
4. **经常写的数据放 D1，不放 KV。** KV 每天只能写 1,000 次，记录来访、去重、轮询进度很快就会用完。
5. **"不审核"不等于"不防滥用"。**
   - 收件箱是公开的。有人刷满每天 10 万次的话，当天的互动功能会停到 UTC 零点，但岛本身是静态的，照样能看。
   - 防护手段都是岛主自己的工具：
     - 定向活动必须带签名；
     - `accepts` 接收策略和屏蔽名单；
     - 按发送者限速；
     - 匿名留言（如果开启）用 Cloudflare Turnstile 人机验证。
   - Worker 应当先做不花钱的检查（大小、格式、时间窗口、去重），再读名片、验签名。
6. **内容放在 Git 里。**
   - 文章是用户仓库里的标准 Markdown，D1 只存互动数据。
   - 想在浏览器里写，就接一个现成的、直接提交到 Git 的编辑器，例如 Sveltia CMS 或 Decap CMS，不自己写编辑器。
   - Git 历史本身就是内容的备份。

## 站主登录与凭据

**站主后台**（`/island/admin` 和站主接口）推荐用 Cloudflare Access 保护：

- 应用代码不需要自己实现登录；
- 即使应用有漏洞，这一层仍然有效。

免费条件见[待核实](#待核实)。自托管时用反向代理层的访问控制，或者应用内的通行密钥（passkey）。

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
- 没有平台额度的限制，同样遵守[协议](protocol-v0.md)中的抓取规则；
- **必须**拒绝访问内网和保留地址。Cloudflare 上天然做不到这类访问，自己的服务器上则可以，所以要显式拦截。

## 域名

- 默认的 `*.workers.dev` 子域名在一些地区访问不稳定，文档应当引导用户绑定自己的域名。
- 域名本来就是身份的一部分，搬家规则见[协议](protocol-v0.md#身份)。

## 测试环境：dev.rqly.com

- 一个独立的 Cloudflare Worker 项目，从 `framework` 分支构建部署，绑定自定义域名 dev.rqly.com。
- rqly.com 的 DNS 已经在 Cloudflare，加一个子域名不影响 rqly.com 本身，也不经过 VPS、Caddy 和 `scripts/release.py`。
- 再部署一座测试岛（例如 dev2.rqly.com 或一个 `workers.dev` 子域名），用来测试邻居、投递和漂流瓶。
- 后台路径用 Cloudflare Access 保护，只允许站主。
- 测试数据只用合成内容，不用真实文章和私信，这和 ly-island 仓库现有的规则一致。

## rqly.com 以后怎么迁移

这是以后单独做的决定，现在不动 rqly.com。可选的路径：

- **留在 VPS：** 用自托管适配层；
- **搬到 Cloudflare：** 7zui.com 和 CivilFlow 继续留在 VPS。

**内容迁移：** ly-island 已经有内容导出（`docs/CONTENT-PORTABILITY.md`）。导出的 ZIP 里是标准 Markdown 加 YAML 文件头，写一个导入脚本，转成框架的内容目录。

**要注意的差异：**

- rqly.com 是浏览器后台写作；框架默认以 Git 为内容源。迁移前要决定 rqly.com 是改用 Git 写作，还是接一个浏览器编辑器。
- rqly.com 现有的三座建筑和岛主雕塑，要做成 `floating-island` 主题的配置。

## 待核实

第 1 阶段开始前，用官方文档或实测确认：

- Cloudflare Access 免费档的人数和功能。第三方资料显示 2026 年 8 月仍是 50 人以内免费，正式依赖前要以官方页面为准；
- Worker 在免费档发送邮件的条件（只能发给已验证地址，还是可以发给任意地址）；
- Workers 的 WebCrypto 对 Ed25519 签名和验签的支持情况，以及在 10 ms CPU 内一次验签的实际耗时；
- Deploy to Cloudflare 按钮能否在部署时提示用户填写 secret（例如签名私钥），还是需要部署后单独设置；
- Workers Builds 怎么提供构建时的 secret，确保签名私钥不会进入构建日志和产物。如果做不到，改为由 Worker 在请求时签名并缓存动态。

## 参考

- [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers 定价与各服务免费额度](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers 静态资源的计费](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Workers Builds 的额度](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)
- [Deploy to Cloudflare 按钮](https://developers.cloudflare.com/changelog/post/2025-04-08-deploy-to-cloudflare-button/)
- [GitHub：停用和启用工作流（60 天规则）](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)
