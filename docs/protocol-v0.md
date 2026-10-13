# 协议 v0

- **状态：** 第 0 阶段草案，待站主确认
- **日期：** 2026-10-13
- **版本标识：** `islands/0`

这份文档规定岛与岛之间怎么互相发现、读取和投递。只要遵守它，任何人都可以写自己的实现。

"必须"表示不遵守就无法互通；"应当"表示强烈建议；"可以"表示可选。

## 目录

1. [总览](#总览)
2. [身份](#身份)
3. [公开数据](#公开数据)
4. [活动与签名](#活动与签名)
5. [收件箱](#收件箱)
6. [从别人的岛上发起互动](#从别人的岛上发起互动)
7. [漂流瓶](#漂流瓶)
8. [灯塔（可选）](#灯塔可选)
9. [抓取规则](#抓取规则)
10. [隐私](#隐私)
11. [限制](#限制)
12. [版本与兼容](#版本与兼容)
13. [和现有协议的关系](#和现有协议的关系)
14. [未决问题](#未决问题)

## 总览

一座岛对外公开四样东西，都是静态 JSON 文件：

| 文件 | 内容 | 什么时候变 |
|---|---|---|
| 岛屿名片 `/.well-known/island.json` | 名字、公钥、各个地址、外观种子、统计 | 很少 |
| 动态 `outbox` | 公开记录、漂流瓶、搬家等活动，新的在前 | 每次记录 |
| 邻居 `friends` | 你关注的岛 | 加减邻居时 |
| 订阅 `feed` | 普通 RSS/Atom，给不认识这个协议的阅读器用 | 每次记录 |

有岛务 Worker 的岛（见[部署](deployment.md)）还有一个**收件箱** `inbox`，用来接收拜访、留言、浇水等定向活动。

**互动方式：**

- 读：主动去拉别人的动态，自己决定多久拉一次。
- 写：把签了名的活动投递到对方的收件箱。投递在两座岛的服务器之间进行，不经过访客的浏览器。

除了名片位置固定，其他地址都以名片里写的为准。下文的路径只是模板的默认值。

## 身份

**岛的地址**是一个 HTTPS origin，例如 `https://example.org`。v0 中一个 origin 只有一座岛，不支持把岛放在子路径下（见[未决问题](#未决问题)）。

**密钥**用 Ed25519：

- 公钥写在名片里；
- 私钥只放在部署平台的密钥设置里（例如 Cloudflare Worker 的 secret 或 CI 的 secret），**绝不进 Git 仓库**；
- 新人不需要理解密钥也能完成部署。生成方式在第 1 阶段确定。

**首次信任：**

- 第一次关注一座岛，或第一次收到它的投递时，通过 HTTPS 读取名片并记下它的公钥。
- 之后名片里的公钥如果变了：
  - 有旧密钥签名的 `key` 活动，自动接受；
  - 没有，就暂停接收，并通知岛主"某某的密钥变了，确认是本人再继续"。

**搬家：**

1. 旧岛在动态里发一条 `move` 活动，指向新地址；
2. 新岛名片的 `alsoKnownAs` 里写上旧地址；
3. 两边都对上了，关注者自动把邻居记录换成新地址，以前的互动记录保留。

只有一边声明的搬家无效。

## 公开数据

公开数据**必须**：

- 通过 HTTPS 提供；
- 带上 `Access-Control-Allow-Origin: *`，让浏览器里的主题和阅读器能直接读取；
- 支持 `ETag` 或 `Last-Modified`。静态托管通常自带。

### 岛屿名片

位置固定为 `/.well-known/island.json`。HTML 页面也**应当**加上 `<link rel="island" href="/.well-known/island.json">`。

```json
{
  "protocol": "islands/0",
  "id": "https://example.org",
  "name": "小林的岛",
  "summary": "桥梁、点云和一些日常。",
  "language": ["zh-CN", "en"],
  "icon": "https://example.org/icon.png",
  "keys": [
    {
      "id": "https://example.org#k1",
      "type": "Ed25519",
      "publicKey": "<32 字节公钥的 base64url>"
    }
  ],
  "links": {
    "home": "https://example.org/",
    "outbox": "https://example.org/island/outbox.json",
    "friends": "https://example.org/island/friends.json",
    "feed": "https://example.org/feed.xml",
    "inbox": "https://example.org/island/inbox",
    "compose": "https://example.org/island/compose"
  },
  "accepts": {
    "follow": "signed",
    "visit": "signed",
    "message": "signed",
    "water": "signed",
    "pickup": "signed"
  },
  "appearance": { "seed": "k7q2", "colors": ["#6fa8dc", "#f6b26b"] },
  "stats": {
    "records": { "article": 12, "note": 40, "project": 3 },
    "bottles": 5,
    "firstRecord": "2026-03-02",
    "lastRecord": "2026-10-13",
    "activeWeeks": ["2026-W40", "2026-W41", "2026-W42"],
    "growth": {
      "rules": "default@0",
      "points": 87,
      "stage": "growing",
      "unlocked": ["lighthouse-small"]
    }
  },
  "discoverable": true,
  "ai": { "read": true, "train": false },
  "updated": "2026-10-13T12:00:00Z"
}
```

| 字段 | 必须 | 说明 |
|---|---|---|
| `protocol` | 是 | `islands/0` |
| `id` | 是 | 岛的 origin。**必须**等于读取它的 origin，否则整张名片无效 |
| `name`、`summary`、`language`、`icon` | `name` 必须 | 展示用 |
| `keys` | 是 | 至少一把。`id` 必须在本岛 origin 下 |
| `links.outbox`、`links.friends`、`links.feed` | `outbox` 必须 | 公开数据的地址 |
| `links.inbox` | 否 | 没有就表示这座岛不收投递（纯静态岛） |
| `links.compose` | 否 | 从别人的岛上发起互动时跳转的地址，见[下文](#从别人的岛上发起互动) |
| `accepts` | 否 | 每种定向活动接受谁：`none`（不收）、`friends`（只收我关注的岛）、`signed`（任何签名有效的岛）。缺省为 `signed` |
| `appearance` | 否 | 外观种子和主色。别人的主题用它把你的岛画得认得出来，但**不会**加载你的主题代码 |
| `stats` | 否 | 记录统计和成长状态，见[扩展接口](extensions.md#成长规则)。是自报的数字，只用来装饰，不用来排名 |
| `discoverable` | 否 | 是否允许灯塔收录。缺省 `false` |
| `ai.read`、`ai.train` | 否 | 是否允许 AI 读取来回答问题，是否允许用于训练。实现**应当**同时生成对应的 `robots.txt` |
| `alsoKnownAs`、`movedTo` | 否 | 搬家用 |
| `updated` | 是 | 最后修改时间 |

### 动态（outbox）

```json
{
  "protocol": "islands/0",
  "id": "https://example.org/island/outbox.json",
  "owner": "https://example.org",
  "updated": "2026-10-13T12:00:00Z",
  "items": [],
  "next": "https://example.org/island/outbox-2026.json"
}
```

- `items` 是活动，新的在前，每页最多 50 条；
- `next` 指向更早的一页，没有就省略。静态站可以按年份分页。

### 邻居（friends）

```json
{
  "protocol": "islands/0",
  "id": "https://example.org/island/friends.json",
  "owner": "https://example.org",
  "updated": "2026-10-13T12:00:00Z",
  "items": [
    { "id": "https://neighbor.example", "name": "邻居的岛", "since": "2026-09-01" },
    { "id": "https://blog.example", "name": "一个普通博客", "feed": "https://blog.example/atom.xml" }
  ]
}
```

- 列表里是"我关注的岛"。双方互相在对方列表里，就是**邻居**。
- 带 `feed` 的条目是不认识这个协议的普通博客，通过 RSS/Atom 读取。这样冷启动时，现有的友链也能直接用。
- 不想公开的关注可以只存在自己的岛务 Worker 里，不写进这个文件。
- 取消关注不通知对方。

## 活动与签名

所有活动的外层格式相同：

```json
{
  "id": "https://example.org/notes/pointcloud-01",
  "type": "post",
  "actor": "https://example.org",
  "published": "2026-10-13T12:00:00Z",
  "updated": "2026-10-13T12:00:00Z",
  "to": "public",
  "object": {
    "url": "https://example.org/notes/pointcloud-01",
    "kind": "article",
    "title": "用小模型把点云变成构件",
    "summary": "第一次实验的记录：数据、流程和失败的地方。",
    "language": "zh-CN",
    "tags": ["点云", "BIM"]
  },
  "proof": {
    "key": "https://example.org#k1",
    "value": "<Ed25519 签名的 base64url>"
  }
}
```

| 字段 | 说明 |
|---|---|
| `id` | 全局唯一的 URL，**必须**在 `actor` 的 origin 下，不要求能访问。同一 `id` 再次出现且 `updated` 更新，就替换旧的 |
| `type` | 见下表。不认识的类型**必须**忽略，不能报错 |
| `actor` | 发出者的 origin |
| `published`、`updated` | RFC 3339 时间，带时区 |
| `to` | `"public"`，或者收件方 origin 的数组 |
| `object` | 随类型变化 |
| `proof` | 签名 |

### 签名

1. 去掉活动的 `proof` 字段；
2. 按 [RFC 8785（JSON 规范化）](https://www.rfc-editor.org/rfc/rfc8785) 处理，得到 UTF-8 字节；
3. 用 Ed25519 签名，结果用不带填充的 base64url 编码，放进 `proof.value`；
4. `proof.key` **必须**是 `actor` 名片里 `keys` 中某一把的 `id`。

所有活动都**必须**签名。公开活动在构建时签名，定向活动在岛务 Worker 里签名。

签名有两个用处：一是收件箱验证发送者；二是活动被转手时，比如漂流瓶经过灯塔或别的岛，收到的人仍然能确认它真的来自原作者。

### 活动类型

| 类型 | 用途 | 写进动态 | 投递到收件箱 | `object` 的主要字段 |
|---|---|---|---|---|
| `post` | 新记录 | 是 | 否 | `url`、`kind`（`article`、`note`、`project`、`album`）、`title`、`summary`、`language`、`tags`、`image` |
| `delete` | 撤回记录或瓶子 | 是 | 否 | `of`：被撤回活动的 `id` |
| `bottle` | 扔漂流瓶 | 是 | 否 | `text`、`url`（可选，指向一篇记录）、`language`、`expires` |
| `follow` | 告诉对方"我关注你了" | 否 | 是 | 无 |
| `visit` | 拜访 | 否 | 是 | 无 |
| `message` | 留言、回复 | 否 | 是 | `text`、`inReplyTo`（可选）、`public`（是否同意对方公开展示） |
| `water` | 浇水 | 否 | 是 | `target`（可选，一篇记录的 URL） |
| `pickup` | 捡到漂流瓶 | 否 | 是，发给扔瓶子的人 | `of`：瓶子的 `id`；`text`（可选，附一句话） |
| `move` | 搬家 | 是 | 否 | `to`：新 origin |
| `key` | 新增或吊销密钥 | 是 | 否 | `add`：新密钥；`revoke`：旧密钥 `id`。用旧密钥签名 |

一条定向活动的例子：

```json
{
  "id": "https://example.org/island/a/01JA0Z8X3K9V",
  "type": "message",
  "actor": "https://example.org",
  "published": "2026-10-13T12:05:00Z",
  "to": ["https://neighbor.example"],
  "object": {
    "text": "看了你那篇桥的照片，想问一下是在哪拍的？",
    "inReplyTo": "https://neighbor.example/notes/old-bridge",
    "public": true
  },
  "proof": { "key": "https://example.org#k1", "value": "<base64url>" }
}
```

## 收件箱

投递方式：`POST {inbox}`，`Content-Type: application/json`，正文是一条活动。

**收件方按顺序检查：**

1. 大小不超过 16 KB，格式正确，`type` 是定向类型；
2. `to` 包含本岛；
3. `published` 不早于 48 小时前、不晚于 10 分钟后；
4. `id` 在 `actor` 的 origin 下，而且 7 天内没见过（防重放）；
5. 读取 `actor` 的名片（可缓存 24 小时），用 `proof.key` 验证签名；
6. 按本岛的 `accepts` 策略、屏蔽名单和速率限制决定是否接受。默认同一个 `actor` 每小时最多 30 条。

**响应：**

| 状态码 | 含义 | 发送方怎么办 |
|---|---|---|
| `202` | 已接受。被屏蔽时也返回 `202`，静默丢弃，不告诉对方 | 完成 |
| `400` | 格式错误 | 不重试 |
| `401` | 签名无效 | 不重试 |
| `403` | 策略不接受，例如 `accepts` 为 `friends` 而你不在对方列表里 | 不重试 |
| `413` | 太大 | 不重试 |
| `429` | 太频繁，带 `Retry-After` | 按提示重试 |
| `5xx` 或网络错误 | 对方暂时不可用 | 24 小时内最多重试 3 次，之后放弃，并在本地记一条投递失败 |

## 从别人的岛上发起互动

访客在别人的岛上想留言或浇水时，不在对方网站登录，而是回到自己的岛上完成：

1. 对方岛的页面上有"从我的岛回复"按钮，第一次点击时问访客自己岛的地址；
2. 浏览器读取访客岛的名片，跳转到它的 `links.compose`，并带上参数：
   `?type=message&to=https://neighbor.example&inReplyTo=https://neighbor.example/notes/old-bridge`
3. 访客在自己的岛上登录、确认内容；
4. 访客的岛务 Worker 签名并投递。

"拜访"也一样：在自己的岛上点"去拜访"，先投递 `visit`，再跳转到对方的岛。

这样跨站登录根本不需要。没有岛的访客只能用对方岛提供的匿名留言（如果对方开了），那是对方岛的本地功能，不属于协议。

## 漂流瓶

**扔：** 在自己的动态里发一条 `bottle`，默认 30 天后过期。建议每天最多扔 1 个，次数由自己的规则决定。

**漂：** 每座岛的定时任务从这些地方收集候选瓶子：

- **两跳外的岛：** 邻居的邻居，排除自己和自己直接关注的岛。每天最多抽样 40 座，读取它们的动态；
- **灯塔：** 自己配置的灯塔（可选）。

**冲上岸：**

- 每天最多 3 个瓶子冲到自己的"海滩"，数量可以改；
- 选择的随机种子是 `hash(本岛 origin + 当天日期)`，同一天的结果固定；
- 过期的瓶子不选；同一个瓶子不会第二次冲到同一座岛；同一个扔瓶人一天最多一个；
- 每个瓶子都验证签名，用的是扔瓶人自己名片上的公钥，不管是从哪里转手来的。

**捡起：** 岛主捡起一个瓶子，就向扔瓶人投递 `pickup`，可以附一句话。扔瓶人会收到"你的瓶子被某某捡到了"。没捡的瓶子第二天漂走，不通知任何人。

## 灯塔（可选）

灯塔是一个可选的索引服务，用来扩大"海"的范围。任何人都可以运行，岛主自己决定用哪几个。

**灯塔只存索引和瓶子的签名副本，不托管内容。**

| 接口 | 说明 |
|---|---|
| `POST /submit`，正文 `{"id": "https://example.org"}` | 登记一座岛。灯塔自己去读名片，只收录 `discoverable` 为 `true` 的岛 |
| `GET /islands?language=zh-CN&limit=50` | 最近有记录的岛：`id`、`name`、`summary`、`language`、`lastRecord` |
| `GET /bottles?language=zh-CN&limit=3&seed=...` | 随机瓶子，返回带签名的原始活动 |

**灯塔必须：**

- 至少每天重新读取一次名片；
- 名片消失或 `discoverable` 变为 `false` 时，24 小时内删除对应的索引；
- 在动态里发现 `delete` 活动时，删除对应的瓶子。

## 抓取规则

读取别人公开数据的程序（岛务 Worker、灯塔）：

- **必须**只访问 `https://`，并拒绝内网和保留地址。在自托管环境里尤其要做，防止被用来探测内网；
- 重定向最多 3 次，只能在同一 origin 内；
- **应当**带 `If-None-Match` 或 `If-Modified-Since`，对方没更新就只拿到 `304`；
- **应当**在 User-Agent 里写明协议和自己的地址，例如 `islands/0 (+https://example.org)`；
- 同一个 origin 至多每 15 分钟读一次；超时 10 秒；超过[大小限制](#限制)的响应直接丢弃。

## 隐私

- **公开的：** 名片、动态（公开记录、漂流瓶、搬家、密钥）、邻居列表、统计。
- **只在双方之间的：** `follow`、`visit`、`message`、`water`、`pickup`，只存在发送方和收件方的岛务 Worker 里，不写进动态。
- **公开留言要双方同意：** 发送方在 `message` 里标了 `public: true`，收件方岛主也同意，才会出现在留言板上。
- **匿名访客：** 只计数，不保存 IP。
- **灯塔：** 只看得到公开数据。

## 限制

实现**可以**收得更严，但不应放得更宽。

| 项目 | 上限 |
|---|---|
| 名片 | 64 KB |
| 动态一页 | 50 条，256 KB |
| 一条活动 | 16 KB |
| `title` | 200 字 |
| `summary` | 1,000 字 |
| 瓶子 `text` | 500 字 |
| 留言 `text` | 2,000 字 |

## 版本与兼容

- v0（`islands/0`）阶段可以做不兼容的修改，每次修改都写进这份文档的修改记录。
- 进入 `islands/1` 之后，同一个大版本内只能新增，不能修改或删除已有字段的含义。
- 所有实现**必须**忽略不认识的字段和活动类型。

## 和现有协议的关系

| 协议 | 关系 |
|---|---|
| RSS、Atom、JSON Feed | 每座岛都输出普通订阅源，也能读取普通博客的订阅源 |
| Webmention（IndieWeb） | 后续阶段可以选择支持：接收时当作留言，发送时通知不认识本协议的博客 |
| ActivityPub（Mastodon 等） | 收件箱和动态的模型相似，但我们不用 JSON-LD 和 HTTP 签名，简单得多。以后可以通过桥接接入，例如 Bridgy Fed |
| AT Protocol（Bluesky） | 借鉴：域名就是身份、记录带签名、身份可以迁移 |
| Nostr | 借鉴：密钥就是身份、事件带签名、中继可以替换（对应这里的灯塔） |
| did:web | 名片的作用和它相近，以后可以做映射 |
| 区块链 | 不采用 |

## 未决问题

- 岛放在子路径下，例如 `user.github.io/repo`；
- 多人共用的岛，例如社团或实验室；
- 只给邻居看的私密记录，需要加密；
- 瓶子里带图片；
- 私钥丢失后怎么恢复身份；
- `/.well-known/island.json` 是否需要正式注册。

## 修改记录

- 2026-10-13：初稿。
