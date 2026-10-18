# 扩展接口：主题、成长规则、通知、AI 管家

- **状态：** 主题和成长规则已在第 1 阶段实现；通知和 AI 令牌接口已在第 2 阶段实现，待审查；AI 管家的 MCP 服务在第 4 阶段
- **日期：** 2026-10-13，2026-10-15、2026-10-16 更新

这四样都是每座岛自己的事，换掉它们不需要任何人同意，也不影响和别的岛互通。协议只规定岛与岛之间交换的数据，见[协议](protocol-v0.md)。

下面的接口用 TypeScript 写，只是为了说清楚形状，第 1 阶段实现时可能调整。

## 主题

### 主题管什么

主题只负责"世界视图"，包括：

- 首页的岛；
- 邻居地图；
- 海滩上的瓶子。

文章、短记录、项目页都是普通 HTML，**必须**在没有 JavaScript 时也能完整阅读。主题坏了，内容照样能看。

### 世界观：云海群岛

所有岛都浮在同一片云海上：

| 概念 | 对应的功能 |
|---|---|
| 云海 | 岛与岛之间的空间 |
| 漂流瓶 | 在云海里漂 |
| 海滩 | 瓶子被冲上来的地方 |
| 灯塔 | 立在云海边，用来发现更多的岛 |
| 飞艇、小船 | 拜访邻居的交通工具 |
| 浇水 | 送给邻居的心意 |

主题可以把岛换成小屋、星球或者像素小镇。协议里的名字（`bottle`、`visit`、`water`）不变，界面上的叫法随主题。

### 接口

```ts
interface Theme {
  id: string;                         // 例如 "isometric"
  version: string;
  needs: { webgl?: boolean };         // 不满足时自动降级
  mount(el: HTMLElement, view: IslandView, on: ThemeEvents): Promise<ThemeHandle>;
}

interface ThemeHandle {
  update(view: IslandView): void;     // 数据变了，例如新的瓶子冲上岸
  destroy(): void;                    // 必须停止绘制、释放 GPU 资源
}

interface IslandView {
  self: Manifest;                     // 本岛名片，包含 appearance 和 stats
  growth: GrowthView;                 // 成长规则算出的结果，见下文
  recent: Activity[];                 // 最近的公开记录
  neighbors: NeighborView[];          // 邻居的名字、外观、统计和最近更新
  beach?: Activity[];                 // 今天冲上岸的瓶子，只有岛主能看到
  live?: { visitsToday: number; wateredToday: number }; // 由岛务 Worker 提供，可能缺失
  viewer: "visitor" | "owner";
  prefs: { reducedMotion: boolean; saveData: boolean; colorScheme: "light" | "dark" };
}

interface ThemeEvents {
  open(url: string): void;            // 打开一篇记录
  visit(origin: string): void;        // 去拜访邻居
  pickup(bottleId: string): void;     // 捡起瓶子（岛主）
}
```

### 规则

1. **不加载第三方资源。** 字体、模型、贴图要么随主题打包，要么用代码生成。
2. **邻居只按数据来画。** 用的是邻居的名字、`appearance` 种子和统计，**绝不**加载邻居的主题或脚本。同一个种子在任何主题里都应当画出认得出来的岛。
3. **必须能降级。** WebGL 不可用、开了省流量、开了减少动态效果时，回到静态画面或文字模式；页面隐藏时停止绘制。
4. **一切可点的东西都有文字等价物。** 可以用列表视图代替，方便读屏软件。
5. **遵守预算。** 下表的预算由 CI 检查，超出就失败。

| 预算 | 上限 |
|---|---|
| 首屏传输（HTML、CSS、JS、数据，gzip 后，不含正文图片） | 200 KB |
| 3D 主题延迟加载的部分（gzip 后） | 200 KB |
| 绘制帧率上限 | 30 fps |

rqly.com 的现状可以作参照：阅读模式的 JS 和 CSS 合计 gzip 后约 21 KB，Three.js 场景包 gzip 后约 155 KB。

### 官方主题

| 主题 | 定位 | 技术 |
|---|---|---|
| `isometric` | 默认。2.5D 等距视角的小岛，轻 | SVG 或 Canvas 2D |
| `floating-island` | 旗舰。3D 浮空岛，点"登岛"后才加载 | Three.js，从 rqly.com 的场景移植 |
| `text` | 纯文字。给读屏软件、慢网络和喜欢简洁的人 | 只有 HTML 和 CSS |

### 第 1 阶段的实现

- **位置：** 每个主题是 `site/src/themes/<id>/World.astro`，构建时渲染首页的世界视图。构建只引入选中的那个主题。
- **`isometric`：**
  - `packages/core/src/scene.js` 把公开数据变成 SVG 基本图形（多边形、椭圆、圆、矩形），本身不产生标记。用到的数据是外观种子、主色、各类记录数和已解锁项。
  - 同样的数据在哪里都画出同一座岛。以后画邻居的岛也用它，满足规则 2。
  - 没有 JavaScript 时，就是一张完整的图。有 JavaScript 时，一个约 5 KB 的脚本按今天的日期调用 `present()`，加上雾和连续周数。
  - 画法：文章是房子（最多 12 座），短记录是树（最多 30 棵），项目是塔（最多 6 座，完成的插旗）。岛的大小随解锁的阶段变大，装饰按解锁出现。
- **`text`：** 没有图，也没有脚本。
- **CI 检查：** 规则 1 和规则 5 由 CI 检查，包括不加载第三方资源、首屏预算，以及页面里没有会被 Content-Security-Policy 拦下的内联脚本和样式。
- **浏览器接口：** 上面的 `Theme.mount()` 留给第 3 阶段需要在浏览器里绘制的主题，例如 3D 浮空岛和邻居地图。

## 成长规则

### 原则

- **只看自己的记录。** 别人的拜访和浇水只带来当天的装饰效果（例如开花），不加分。否则会变成比人气，新岛没人来就永远长不大。
- **按周算连续。** 每天打卡容易让人焦虑，然后放弃。默认算"连续有记录的周数"，本周还没写不算断。
- **不惩罚。** 很久没写，岛会起雾、长草，但积分不扣，已解锁的外观不收回。写一篇就放晴。
- **没有全局排行。** 没有排行就没有刷分的动机，所以规则可以放心地开源、随便改。
- **规则有版本。** 改规则不能收回已经解锁的外观。

### 接口

成长规则拆成两个纯函数：不联网、不读时钟、没有随机数。

```ts
interface GrowthRules {
  id: string;   // 例如 "default@0"

  // 构建时运行：输入只来自仓库，结果写进名片的 stats.growth
  accumulate(input: GrowthInput, config: GrowthConfig): GrowthState;

  // 浏览器里运行：依赖"今天"，所以不能在构建时算死
  present(stats: Stats, today: string, config: GrowthConfig): GrowthView;
}

interface GrowthInput {
  records: RecordFact[];   // 全部记录，包括已撤回的
  ledger: UnlockLedger;    // 解锁台账，见下文；没有台账时传空台账
}

interface RecordFact {
  kind: string;
  date: string;            // 记录的当地日期 YYYY-MM-DD，按岛的时区换算
  done?: string;           // 项目完成的日期
  withdrawn?: string;      // 撤回的日期。撤回的记录留在仓库里，只是不再公开
}

interface UnlockLedger {
  unlocked: { id: string; since: string; rules: string }[];
}

// 规则自己的参数，例如各阶段的阈值。有固定的 Schema，不用来藏历史状态
type GrowthConfig = Record<string, number | string | boolean>;

interface GrowthState {
  points: number;
  stage: string;          // 例如 "seed"、"growing"、"flourishing"
  unlocked: string[];     // 已解锁的外观，只增不减
  next?: { stage: string; points: number };
}

interface GrowthView extends GrowthState {
  streakWeeks: number;    // 连续有记录的周数
  longestWeeks: number;
  vitality: number;       // 0.1 到 1，主题用它画天气和植被，永远不到 0
}
```

**为什么拆成两半：** 静态站只在有新记录时才重新构建。如果"有多久没写了"也在构建时算，不写就不构建，岛就会一直停在"刚写完"的样子。所以和时间有关的部分放到浏览器里算，依据是名片里的 `lastRecord` 和 `activeWeeks`。

别人的岛在你的地图上怎么画：

- 积累部分用它自己名片里的 `stats.growth`；
- 时间部分用你这边的 `present` 计算。

如果它用了你不认识的规则，就退回默认规则。反正只是装饰。

### 已解锁的外观怎么保住

"不收回"需要记得过去，而纯函数只能看到输入。所以过去的状态必须是**显式的输入**，并且存在仓库里：

- **积分**只按当前没有撤回的记录计算。
- **已解锁**取两部分的并集：
  - **台账里记着的；**
  - **按记录历史曾经达到的：** 按日期累加积分，重建每个日期撤回前的峰值。同一天的发布、完成先计入历史峰值，再处理撤回；因此同日达到阈值后撤回也保留解锁，当前积分仍扣除撤回记录。
  - 成长事实只有当地日历日期，不是精确事件日志。同日无法恢复先后顺序，所以有意采用偏向保留外观的规则，可能保留当天理论上能达到的解锁；它不增加当前积分，也不用于排名。
- **撤回是标记，不是删除：** 在文件头里写 `withdrawn: <日期>`，文件留在仓库里，只是不再公开。
- **解锁台账**是仓库里的 `island/unlocks.json`，随仓库一起导出和迁移，清空构建缓存也不受影响。
  - 构建只读台账，不写台账。
  - 只有两种情况要写台账，都由岛主的工具（命令行或编辑器）显式完成，作为一次普通提交：
    1. 换成别的成长规则之前，把当前已解锁的写进去；
    2. 彻底删除一篇记录的文件之前，同样先写进去。
  - 如果跳过工具直接删了文件，这篇记录带来的解锁会在下次构建时消失。这是唯一的例外，编辑器要提示。
- 台账里有当前主题不认识的外观时，保留但不显示。

**验收：** 以下每种情况发生后，已解锁项都还在，积分始终只按当前记录计算：

- 达到阈值后撤回文章，再重新构建；
- 清空构建缓存；
- 换到别的主机；
- 用工具换规则。

### 默认规则 `default@0`

| 项目 | 规则 |
|---|---|
| 短记录 | 1 点，每天最多计 3 次 |
| 文章 | 3 点 |
| 项目 | 5 点；标记完成再加 10 点 |
| 阶段 | 0 点"初生"、30 点"成形"、100 点"繁盛"；之后每 100 点解锁一件小装饰 |
| 撤回 | 积分相应减少，已解锁的外观保留（见上一节） |
| 活力 | 本周或上周有记录为 1；两三周没写为 0.6；四到七周为 0.3；八周以上为 0.1 |

前三项和"撤回"沿用 rqly.com 现有的规则。

**实现**在 `packages/core/src/growth/default.js`：

- **解锁项的名字：**
  - 阶段：`stage-growing`、`stage-flourishing`；
  - 之后的装饰依次是 `lantern`、`windmill`、`lighthouse-small`、`bridge`、`observatory`，再往后是 `decoration-6`、`decoration-7`……
- **还没有记录时：** 活力是 0.6。
- **规则参数：** `growth.config` 可以改的只有这几个，都是正整数，写错了构建失败：
  - `notePoints`、`noteDailyLimit`；
  - `articlePoints`；
  - `projectPoints`、`projectDoneBonus`；
  - `growingAt`、`flourishingAt`、`decorationEvery`。
- **写台账的工具：** 先 `npm run build`，再 `npm run unlocks:save`，然后提交 `island/unlocks.json`。见 `site/README.md`。

## 通知

### 事件

岛务 Worker 产生本地事件，交给通知渠道发送。事件不在岛与岛之间传输，但格式固定，这样渠道插件可以互换。

```json
{
  "type": "message.received",
  "at": "2026-10-13T12:05:00Z",
  "actor": { "id": "https://neighbor.example", "name": "邻居的岛" },
  "summary": "邻居的岛给你留言：看了你那篇桥的照片……",
  "url": "https://example.org/island/admin#inbox"
}
```

| 事件 | 默认 | 说明 |
|---|---|---|
| `message.received` | 立即 | 收到邻居的留言或回复；朋友的朋友的只进摘要 |
| `bottle.picked` | 立即 | 你的瓶子被捡到了 |
| `stranger.pending` | 摘要 | "陌生来信"里有几封新信，只显示数量，见[协议](protocol-v0.md#签名不等于可信按关系分级) |
| `key.changed` | 立即 | 关注的岛密钥变了，需要你确认 |
| `visit.received` | 摘要 | 谁来拜访过 |
| `water.received` | 摘要 | 谁浇过水 |
| `follow.received` | 摘要 | 谁关注了你 |
| `neighbor.posted` | 摘要 | 关注的岛有新记录 |
| `bottle.arrived` | 摘要 | 今天海滩上有新瓶子 |
| `delivery.failed` | 摘要 | 你的投递最终失败了 |
| `reminder.record` | 关闭 | 温和的记录提醒：比如两周没写时提醒一次，不重复催 |

**延迟：**

- 投递到你收件箱的事件是即时的，因为 Worker 收到请求时就能发通知；
- `neighbor.posted` 和 `bottle.arrived` 取决于抓取间隔：活跃的邻居最多晚 1 小时，很久没更新的最多晚 1 天（见[协议的频率与批次](protocol-v0.md#频率与批次)）。

### 渠道

```ts
interface NotifyChannel {
  id: string;   // 例如 "telegram"
  send(events: NotifyEvent[], config: object, secrets: object): Promise<void>;
}
```

| 渠道 | 阶段 | 凭据（部署平台的密钥设置） | 说明 |
|---|---|---|---|
| Telegram 机器人 | 第 2 阶段，已实现 | `TELEGRAM_BOT_TOKEN`；聊天 ID 写在策略里，或设 `TELEGRAM_CHAT_ID` | 最简单，一次 HTTPS 请求 |
| ntfy | 第 2 阶段，已实现 | `NTFY_TOPIC`，可选 `NTFY_TOKEN`；自建服务器写在策略的 `server` 里，或设 `NTFY_SERVER` | 开源推送，可以自建 |
| 通用 webhook | 第 2 阶段，已实现 | `WEBHOOK_URL` | 收到 `{ title, text, events }`，用来接 Discord、Matrix、Server 酱、Bark 等 |
| 邮件 | 待核实 | | Cloudflare 免费档发邮件的条件还没核实，见[部署](deployment.md#待核实) |

**实现（`packages/worker/src/notify.js`）：**

- 事件先写进 D1，再由渠道发出。即时事件在收到投递后马上发；免打扰时段里先攒着，时段结束后的第一次定时任务再发。
- 摘要每天在 `digestAt` 之后的第一次定时任务里发一次。"陌生来信"在摘要里只有数量，不出现名字和内容。
- 发送失败的即时事件留着，下次再试；发出的事件 30 天后删除。
- 每次运行发通知用的外部请求，和抓取、投递共用同一个预算。
- 策略里没有列渠道时，设了凭据的渠道都会用上。这样从同一个仓库部署的测试岛不用改仓库，在控制台填密钥就行。

### 策略配置

```json
{
  "timezone": "Asia/Shanghai",
  "quietHours": ["23:00", "08:00"],
  "digestAt": "21:00",
  "rules": {
    "message.received": "now",
    "visit.received": "digest",
    "neighbor.posted": "digest",
    "reminder.record": "off"
  },
  "channels": [{ "type": "telegram", "chatId": "<你的 chat id>" }]
}
```

策略文件是 `site/island/notify.json`，写错时部署失败并列出问题。`timezone` 不写时用岛的时区。机器人令牌等凭据放在部署平台的密钥设置里，不写进这个配置。

## AI 管家

### 原则

- **AI 可以读、整理、提醒、起草。**
- **发布和一切对外的社交动作都必须由人确认。** 包括发布记录、留言、拜访、浇水、扔瓶子、捡瓶子回信。
- **自带模型。** 框架不内置模型，也不替用户付模型费用。
- **AI 不跑在 Worker 里。** 一来 Worker 的 CPU 时间不够，二来模型和费用都是岛主自己的。

### 接口：MCP 服务

框架提供一个 MCP 服务，运行在岛主自己的电脑上。它通过两条路径工作：

- 读写岛的 Git 仓库（内容）；
- 带着权限受限的令牌调用岛务 Worker（互动）。

| 工具 | 权限 | 说明 |
|---|---|---|
| `inbox.list` | 读 | 收到的留言、来访、浇水、捡瓶子 |
| `neighbors.digest` | 读 | 关注的岛最近更新了什么 |
| `beach.list` | 读 | 今天海滩上的瓶子 |
| `records.search` | 读 | 搜索自己的记录 |
| `growth.get` | 读 | 成长状态和记录节奏 |
| `draft.create` | 起草 | 起草一篇记录：在 Git 里新建分支并开 PR |
| `reply.draft` | 起草 | 给留言起草回复，放进待确认列表 |
| `bottle.draft` | 起草 | 起草一个漂流瓶，放进待确认列表 |

**这里没有"发布"或"发送"类工具。** 确认只能由岛主做：合并 PR，或在岛的后台点确认。

给 AI 的令牌只有"读"和"起草"两种权限，由岛务 Worker 强制执行。带这类令牌的请求，调用不了任何投递接口。

**"AI 起草、人确认"直接落在 Git 上：** AI 开 PR，人合并，发布记录就是 Git 历史。

### 已实现：岛务 Worker 的 AI 接口（第 2 阶段）

MCP 服务调用的就是这几个接口。令牌在岛务的"设置"里创建，只显示一次；Worker 只存它的 SHA-256，可以随时作废。

| 接口 | 权限 | 说明 |
|---|---|---|
| `GET /island/ai/inbox` | 读 | 收件箱，`?folder=strangers` 看陌生来信 |
| `GET /island/ai/feed` | 读 | 邻居动态 |
| `GET /island/ai/islands` | 读 | 关注和被关注的岛 |
| `POST /island/ai/drafts` | 起草 | 起草留言、拜访或浇水，进岛务的"草稿"，由岛主检查后寄出 |

请求带 `Authorization: Bearer isl_…`。其余路径一律拒绝，包括所有站主接口和投递接口；"读"权限的令牌写不了草稿。

### 帮人坚持记录

AI 不替你写，而是降低开始写的门槛：

- **周末回顾：** 起草一份"这周你做了什么"，你改两句就能发；
- **把零散的东西变成草稿：** 例如聊天里说过的想法、读过的链接；
- **提醒回信：** 例如"邻居的岛三天前给你留言，还没回"。

### 对外部 AI 的态度

名片里的 `ai.read` 和 `ai.train` 由岛主决定，实现会同时生成对应的 `robots.txt`。可以选择再提供一份 `llms.txt`，方便别人的 AI 读懂你的岛。
