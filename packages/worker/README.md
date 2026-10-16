# 岛务服务 `@islands/worker`

岛与岛之间的互动：收件箱、投递、邻居同步、通知，以及站主和 AI 的接口。对应[路线的第 2 阶段](../../docs/roadmap.md#第-2-阶段岛务-worker)。

- **一个 Web 标准的处理函数：** `createIsland(...)` 返回 `{ fetch, scheduled }`，不依赖框架。数据库、静态资源、`fetch` 和时钟都从外面传进来，所以同一份代码跑在 Cloudflare Workers 上，也跑在 Node.js 的测试里。为什么不用 Hono，见[决定 F4 的修改提议](../../docs/decisions.md#f4-部署目标已定)。
- **除了协议核心，没有依赖。** `src/psl-data.js` 是公共后缀列表的 ASCII 部分，用于按可注册域名限速，许可证是 MPL-2.0，用 `scripts/update-psl.mjs` 更新。
- **每次运行最多 45 个外部请求**（免费档上限是 50），D1 的查询也计入。预算用完就停下，剩下的留到下一轮。

## 模块

| 文件 | 内容 |
|---|---|
| `src/index.js` | 入口：路由、每次运行的上下文和预算、读本岛的名片、运行时签名钥匙 |
| `src/inbox.js` | 收件箱第 1 到 7 步：大小、格式、时间窗口、去重、签名、`accepts`、限速、按关系分到收件箱或陌生来信 |
| `src/deliver.js` | 寄出关注、拜访、留言、浇水：签名、存下、投递，按协议重试 |
| `src/poll.js` | 定时同步邻居的动态：分页续读、快照摘要、只验新版本、首次同步不发通知 |
| `src/remote.js` | 读别的岛的名片，首次信任和密钥日志，密钥对不上时暂停 |
| `src/net.js` | 出站请求：地址检查、同源重定向、大小和时间上限、计入预算 |
| `src/notify.js` | 通知事件、免打扰、摘要，Telegram、ntfy、webhook |
| `src/auth.js` | 站主（Cloudflare Access 令牌，服务自己再验一次）、AI 令牌、站主写操作的 CSRF 检查 |
| `src/api.js` | 站主接口 `/island/api/*` 和 AI 接口 `/island/ai/*` |
| `src/schema.js` | 表结构，服务自己按版本迁移 |
| `src/store-d1.js`、`src/store-node.js` | 数据库适配层：D1，以及 Node 自带的 `node:sqlite` |
| `src/budget.js`、`src/psl.js`、`src/strings.js`、`src/util.js` | 预算计数、可注册域名、通知文字、定时任务的分钟 |

## 测试

```bash
node --test packages/worker/test/
```

`test/harness.js` 在内存里搭一张假网络和几座完整的岛（真实构建的名片和动态、SQLite 数据库、假的 Access 团队），测试在它们之间互相投递和同步：

- 四种定向活动和通知（`flow.test.js`）；
- 收件箱的拒绝：错误签名、重放、超大、超频、新岛减半、陌生人分级（`inbox.test.js`）；
- 站主认证的负例：没有令牌、伪造的身份头、错误的 `aud`、过期、AI 令牌（`auth.test.js`）；
- 投递和重试：内网地址、恶意重定向、DNS 重绑定、429、5xx（`deliver.test.js`）；
- 子请求预算：40 座首次同步的邻居，加上分页、重定向和通知，每次运行不超过 45 个（`poll.test.js`）；
- 免打扰、摘要、渠道（`notify.test.js`）。

在 workerd 里的冒烟测试见 `site/scripts/smoke-worker.mjs`，需要先构建站点。
