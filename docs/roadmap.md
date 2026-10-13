# 路线

- **状态：** 第 0 阶段草案，待站主确认
- **日期：** 2026-10-13

每个阶段结束时都有一个能用的东西，并且有明确的验收标准。阶段之间不赶时间，验收没过就不进入下一阶段。

## 第 0 阶段：文档（当前）

- **内容：** 概念、协议 v0、扩展接口、部署、路线，以及[待确认的决定](decisions.md)。
- **验收：** 站主确认 `decisions.md` 中标为"建议"的各项，或者给出修改意见。

## 第 1 阶段：一座静态岛

**内容：**

- 选定静态生成器（[决定 F13](decisions.md)）；
- 内容目录和 Markdown 文件头规范：标题、日期、类型、标签、摘要、项目是否完成；
- 构建输出：页面、`feed.xml`、名片、动态、邻居列表，构建时签名；
- 默认主题 `isometric` 和纯文字主题 `text`；
- 成长规则 `default@0`；
- 用 JSON Schema 描述名片、动态、活动，成为协议数据格式的唯一来源；
- CI 检查：
  - 示例和构建产物符合 Schema；
  - 签名能往返验证；
  - 首屏预算；
  - 关掉 JavaScript 时页面可读；
- 部署到 dev.rqly.com。

**验收：**

- 从空的 Cloudflare 账号开始，按 README 部署一座岛，实测不超过 10 分钟；
- CI 全部通过；
- 在手机上关掉 JavaScript，所有记录都能读。

## 第 2 阶段：岛务 Worker

**内容：**

- 收件箱：处理 `follow`、`visit`、`message`、`water`，包括验签、时间窗口、去重、限速、`accepts` 策略、屏蔽名单；
- D1 表结构和迁移；互动数据导出；
- 站主后台（Cloudflare Access 保护）：收件箱、回复、拜访、关注；
- `compose` 页：从别人的岛上发起互动；
- 定时任务：拉取邻居动态，生成邻居动态页，产生 `neighbor.posted` 事件；
- 通知：Telegram、ntfy、通用 webhook；即时与摘要两种方式；
- 第二座测试岛。

**验收：**

- 两座测试岛之间，四种定向活动都能互相投递并收到通知；
- 签名错误、重放、超大、超频的请求都按协议被拒绝，并有自动测试覆盖；
- 定时任务连续跑一周，用量始终在免费额度内（看 Cloudflare 控制台的实际数字）。

## 第 3 阶段：漂流瓶、成长、旗舰主题

**内容：**

- `bottle`、`pickup`、海滩、两跳抽样；
- 3D 主题 `floating-island`：从 rqly.com 的 Three.js 场景复制移植，提交说明写明来源；
- 可选的灯塔：先在 Cloudflare 免费档上跑一个；
- 可选的匿名留言（Turnstile）。

**验收：**

- 三座测试岛 A、B、C 中，A 只关注 B，B 只关注 C，C 扔的瓶子能冲到 A 的海滩；A 捡起后 C 收到通知；
- 灯塔在名片改为 `discoverable: false` 后 24 小时内删除索引；
- 3D 主题在预算内，在不支持 WebGL 或开启减少动态效果时正确降级。

## 第 4 阶段：开放

**内容：**

- 拆成独立的开源仓库（步骤见下文）；
- 模板仓库和 Deploy to Cloudflare 按钮；
- 自托管适配层（Node.js 和 SQLite），CI 同时测试两种适配层；
- AI 管家的 MCP 服务；
- 英文文档。

**验收：** 一个没参与开发的人，只看 README 就用按钮部署出一座岛，并和测试岛成为邻居。

## 第 5 阶段：rqly.com 迁移评估

单独决定，见[部署](deployment.md#rqlycom-以后怎么迁移)。在此之前，rqly.com 保持不变。

## 拆成独立仓库的步骤

`framework` 是孤立分支，历史里只有框架本身，所以拆分很简单：

1. 把只和 rqly.com 有关的内容移回 ly-island 的文档：`deployment.md` 里的测试环境和迁移两节、本文第 5 阶段；
2. 在个人 GitHub 下新建一个空的公开仓库；
3. 把这个分支推成新仓库的 `main`：

   ```bash
   git push https://github.com/ly2u/<新仓库>.git framework:main
   ```

4. 在新仓库里开启 `main` 分支保护、Dependabot、secret scanning 推送保护；
5. 把 dev.rqly.com 的 Worker 项目改为从新仓库构建；
6. ly-island 里的 `framework` 分支保留一段时间后删除，并在 ly-island 的 README 里写上新仓库地址。
