# 岛屿模板

这个文件夹是一座完整的岛：Markdown 记录、设置、两个主题、站主后台，以及部署到 Cloudflare 的配置。

- 页面、订阅源、名片和动态是构建出来的静态文件，访问不经过任何服务器代码；
- 互动（收件箱、寄信、同步邻居、通知）由同一个 Worker 里的岛务服务处理（`worker/index.js`，代码在 [`packages/worker`](../packages/worker/README.md)），只有这些路径会运行 Worker 代码。

> 这里的示例内容都是虚构的。做自己的岛时，删掉 `content/records/` 里的示例，改 `island.config.json`。

**目录：**

- [本地预览](#本地预览)
- [写记录](#写记录)
- [设置](#设置)
- [签名密钥](#签名密钥)
- [互动和站主后台](#互动和站主后台)
- [部署到 Cloudflare](#部署到-cloudflare)
- [成长和解锁台账](#成长和解锁台账)
- [检查](#检查)

## 本地预览

需要 Node.js 22.12 或更高版本。在这个文件夹里运行：

```bash
npm ci
npm run dev
```

本地预览自动使用公开的测试密钥，不需要设置任何东西。

## 写记录

每条记录是 `content/records/` 下的一个 Markdown 文件。**文件名就是网址：**

- 只能用小写字母、数字和 `-`，例如 `first-bridge.md`；
- 对应的网址是 `/records/first-bridge/`。

文件开头的设置：

```yaml
---
title: 第一座桥的点云
date: 2026-09-14
kind: article
summary: 一两句话的摘要，会出现在列表、订阅源和动态里。
tags: [点云, BIM]
---
```

| 字段 | 必须 | 说明 |
|---|---|---|
| `title` | 短记录以外必须 | 最多 200 字。短记录可以不写，列表里显示摘要或正文开头 |
| `date` | 是 | 写日期即可，例如 `2026-09-14`。写了时间的，按设置里的时区换算成当地日期 |
| `kind` | 是 | `article`（文章）、`note`（短记录）或 `project`（项目） |
| `summary` | 否 | 最多 1,000 字 |
| `tags` | 否 | 最多 32 个，每个最多 64 字 |
| `done` | 否 | 项目完成的日期，只有项目能写 |
| `updated` | 否 | 修改文章时必须填写，并晚于前一版本；否则接收方不能用相同编号替换旧动态 |
| `language` | 否 | 这条记录的语言，缺省用设置里的第一种语言 |
| `withdrawn` | 否 | 撤回的日期，见下文 |
| `draft` | 否 | `true` 表示草稿：不构建，也不计入成长 |

**撤回一条记录：** 加上 `withdrawn: <日期>`，文件留在仓库里。构建后：

- 这条记录的页面、列表项和订阅条目都消失；
- 动态里多一条撤回活动，关注你的岛会据此删除它；
- 积分随之减少，但已经解锁的外观保留。

写错的地方会让构建失败，并一次列出所有问题。

日期只接受真实的 `YYYY-MM-DD` 或带明确时区的 RFC 3339 时间（如 `2026-10-05T08:00:00+08:00`）；不接受 `null`、数字、布尔值、溢出日期和没有时区的时间。日期本身不换日；时间一律按岛的时区换算，包括 UTC 零点。`done`、`withdrawn`、`updated` 也用这条规则。

只写日期，表示岛所在时区的那一整天。所以和带时间的值比较时按日期比：同一天的 `withdrawn: 2026-10-05` 不算早于 `date: 2026-10-05T20:00:00+08:00`。`updated` 必须晚于 `date`，同一天修改时请写上时间，否则构建会提示。

## 设置

`island.config.json`：

| 字段 | 说明 |
|---|---|
| `origin` | 岛的地址，例如 `https://example.org`。也可以在构建时用环境变量 `ISLAND_ORIGIN` 覆盖 |
| `name`、`summary` | 名字（最多 100 字）和简介 |
| `language` | 语言列表，例如 `["zh-CN", "en"]`。第一种决定界面语言 |
| `timeZone` | 时区，例如 `Asia/Shanghai`，用来换算记录的日期 |
| `theme` | `isometric`（默认，2.5D 小岛）或 `text`（纯文字，没有图和脚本）。也可以用 `ISLAND_THEME` 覆盖 |
| `appearance` | `seed` 决定小岛的形状，`colors` 是主色。别人的岛会按它们把你的岛画出来 |
| `growth` | 成长规则，默认 `default@0`，见[扩展接口](../docs/extensions.md#成长规则) |
| `discoverable` | 是否允许灯塔收录，默认 `false` |
| `ai` | `read`：是否允许 AI 读取来回答问题；`train`：是否允许用于训练。`robots.txt` 随之生成 |
| `keyName` | 钥匙的名字，默认 `k1` |
| `interactions` | `enabled`：是否接收别的岛的投递，默认 `true`。`accepts`：各类活动收谁的，`signed`（任何签了名的岛）、`friends`（只收邻居）或 `none`，默认都是 `signed`；捡瓶子 `pickup` 在第 3 阶段之前固定为 `none` |

设置文件也可以换一个：构建时设 `ISLAND_CONFIG=examples/second-island.config.json`，用来从同一个仓库再部署一座测试岛（见[部署文档](../docs/deployment.md#第-2-阶段岛务-worker)）。

关注的岛写在 `island/friends.json` 里：

```json
[{ "id": "https://neighbor.example", "name": "邻居的岛", "since": "2026-09-01" }]
```

普通博客加上 `feed` 字段，指向它的 RSS 或 Atom 地址。

## 签名密钥

公开的记录在构建时签名。别的岛用名片里的公钥验证，确认记录真的是你发的。

**生成一次：**

```bash
npm run keygen
```

它会打印一行 `ISLAND_SIGNING_KEY=…`：

- 把这一行设成部署平台的**构建密钥**，同一个值再设成 Worker 的**运行时密钥**（见下文）：构建时用它签公开的动态，运行时用它签寄出的信；
- 同时存进密码管理器；
- **不要**提交到仓库，也不要发给任何人。

**没有密钥时：**

- 构建会失败；
- 只有地址是 `https://example.org` 并且设置了 `ISLAND_ALLOW_TEST_KEY=1` 时，才会改用公开的测试密钥，这只给 CI 用；
- 测试密钥谁都能用，所以不能用在真实的岛上。

## 互动和站主后台

`interactions.enabled` 为 `true` 时，名片里会写上收件箱和写信页的地址，别的岛就能给你寄信。

- **站主后台：** `/island/admin/`，用 Cloudflare Access 挡在外面，服务自己也会再验证一次。里面有收件箱、陌生来信、邻居动态、关注的岛、写信、已寄出、AI 起草的草稿，以及 AI 令牌和测试通知；
- **从你的岛回信：** 每篇记录下面有一个小表单，不需要 JavaScript。访客填自己的岛的地址，就会跳到他自己岛上的写信页，在那里签名寄出，再回到这篇记录；
- **通知：** 规则在 `island/notify.json`：哪些事即时发、哪些进每天的摘要、免打扰时段。渠道的凭据放在部署平台的密钥设置里，不写进仓库，见[扩展接口](../docs/extensions.md#通知)。

在本地连同 Worker 一起试：

```bash
cp .dev.vars.example .dev.vars   # 填上要用的值；.dev.vars 不进 Git
npm run dev:worker
```

## 部署到 Cloudflare

岛部署成一个 Worker：静态页面的访问不计入 Worker 的请求额度，只有互动路径和定时任务运行 Worker 代码，免费档就够用。以下是 2026 年 10 月的界面，名称可能会变。

1. **导入仓库：** 在 Cloudflare 控制台创建一个 Worker，选择从 Git 仓库导入，连接你的 GitHub 仓库。
2. **构建设置：**

   | 设置 | 值 |
   |---|---|
   | Worker 名称 | 和 `wrangler.jsonc` 里的 `name` 一致（默认 `island`） |
   | 生产分支 | 你写记录的分支 |
   | 根目录（Root directory） | 这个文件夹，例如 `site` |
   | 构建命令 | `npm run build` |
   | 部署命令 | `npm run deploy` |

   依赖由 Cloudflare 按 `package-lock.json` 自动安装。`npm run deploy` 先生成 `wrangler.generated.json`：定时任务的分钟按岛的地址错开，D1 数据库第一次部署时自动创建。

3. **构建变量和密钥：** 在 Worker 的 Settings → Build → Variables and secrets 里：
   - 添加 `ISLAND_SIGNING_KEY`，类型选 **Secret**；
   - 如果 `island.config.json` 里的 `origin` 不是你的域名，再添加 `ISLAND_ORIGIN`，例如 `https://example.org`。
4. **运行时的设置：** Worker → Settings → Variables and secrets（和上一步的构建设置是两处）。按 `.dev.vars.example` 填：
   - `ISLAND_SIGNING_KEY`：和构建密钥相同，没有它就不能寄信；
   - `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`：Cloudflare Access 的团队域名和应用的 AUD 标签。Access 只保护 `/island/admin*`、`/island/api*`、`/island/compose*`，别的路径不要保护，详见[部署文档](../docs/deployment.md#第-2-阶段岛务-worker)；
   - 通知渠道的凭据，可选。
5. **绑定域名：** Worker → Settings → Domains & Routes → 添加 Custom domain。`wrangler.jsonc` 关掉了 `workers.dev` 和预览地址，所以岛只能通过你自己的域名访问。不绑定的话，即使域名有一条通配记录能解析，请求也到不了 Worker。
6. **部署后检查：**
   - 打开 `https://<你的域名>/.well-known/island.json`，`id` 应该是你的地址，`keys` 里的公钥和 `npm run keygen` 打印的一致；
   - 打开 `/feed.xml` 和 `/island/outbox.json`，能看到内容；
   - 打开 `/island/admin/`，先要求登录；登录后"设置"里显示可以寄信。

之后每次推送到生产分支，Cloudflare 都会自动构建和部署。

## 成长和解锁台账

积分和阶段在构建时算出来，写进名片的 `stats.growth`。"有多久没写"在访客的浏览器里算，所以很久不写，小岛会起雾；写一篇就放晴。

**已解锁的外观不会收回。** 有两种情况，要先把当前的解锁存进台账 `island/unlocks.json`：

- 换成别的成长规则之前；
- 彻底删除一篇记录的文件之前。撤回不需要这样做。

存的方法：

```bash
npm run build
npm run unlocks:save
```

然后提交 `island/unlocks.json`。

## 检查

仓库的 CI 会构建这个模板的两个主题，并检查：

- 协议文件：通过校验；每一条动态都能验签，并由 Python 实现再验一次；
- 订阅源：严格解析的 XML；
- 关掉 JavaScript：从首页出发能读到每一条记录；
- 回信表单：关掉 JavaScript 时也在，寄出后的感谢语只在 `#island-sent` 时显示；
- 首屏：真实浏览器首次加载到 `networkidle`，所有实际请求的唯一 URL 内容按 gzip level 9 合计，不超过 200 KiB。包含间接 JS/CSS 导入和运行时数据；HTML 静态检查给出的只是直接资源下界；
- 安全：
  - 不加载第三方资源；
  - 页面里没有会被 Content-Security-Policy 拦下的内联脚本和样式；
  - 构建产物里没有签名密钥；
- 可重复：同样的源文件，两次构建出的协议文件逐字节一致。

在本地检查自己的构建：

```bash
npm run build
node ../tools/site-check/cli.mjs dist
python3 -m pip install -r ../tools/browser-check/requirements.txt
python3 -m playwright install chromium
python3 ../tools/browser-check/check.py dist
```

岛务服务在 workerd 里的冒烟测试（需要先用测试密钥构建）：

```bash
ISLAND_ALLOW_TEST_KEY=1 npm run build
npm run smoke:worker
```

完整验收需要这些检查都通过。浏览器检查还会用一个替身接口打开站主后台，故意塞进带 HTML 的"别人的文字"，确认它们只作为文字显示。CI 还用大模块、嵌套 CSS 导入和运行时 JSON 请求三个负例证明浏览器能拦住超预算资源。原始文件名和日期的负例由 `node scripts/check-record-loader.mjs` 在临时副本中运行实际 Astro 构建。
