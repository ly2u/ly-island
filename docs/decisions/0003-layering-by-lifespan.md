# 0003 按寿命分层：资产层、体验层、工具层

- **状态：** 提议，具体实现待站主确认
- **日期：** 2026-10-07
- **与 [0004](0004-single-source-data-schema.md) 一起实施**

## 背景

系统是按功能一层层长出来的，寿命最长的东西和最容易变的东西缠在了一起：

| 层 | 内容 | 预期寿命 |
|---|---|---|
| 资产层 | 文章、图片、目录、研究数据 | 十年以上 |
| 体验层 | 岛屿、经典页面、后台界面 | 几年可能重做 |
| 工具层 | 七嘴、CivilFlow | 各自独立 |

目前内容层"认识"体验层的概念：

- `apps/rqly-sites/server.mjs:71`：搜索接口的 `scope` 参数只接受 `library`、`projects`、`workshop`，也就是三座建筑。
- `apps/rqly-sites/public/rqly/search-core.mjs:20`：内容检索里写死了"哪座建筑显示哪类内容"。
- `apps/rqly-sites/island-store.mjs:69`：文章的校验函数 `validateRecord` 放在"岛屿存储"模块里。
- "记录/工程/探索"这套分类同时充当内容分类和房间划分（`apps/ly-island-preview/src/rooms.js:95`）。

后果：重做首页、增加第四座建筑、或者换一种展示方式，都要修改内容层和它的校验。

## 决定

1. **依赖只能从体验层指向资产层。** 资产层（内容存储、校验、公开接口、搜索核心）不得出现建筑、房间等体验层概念。
2. **内容只描述"它是什么"：** 类型（笔记、博客、项目）、主题、所属系列或研究方向（沿用现有的目录系统）。
3. **"它放在哪里"是体验层的映射表：** 哪座建筑、哪个房间、展示哪些内容，在岛屿代码中单独定义一次。
4. **文章校验从 `island-store.mjs` 移到独立的内容模块。** 岛屿存储只负责岛屿布局和成长。
5. **工具层通过公开接口或链接接入，** 不直接读写内容存储。七嘴现在已经满足，保持即可。

## 涉及位置

- `apps/rqly-sites/server.mjs:71`（`searchOptions` 的 `scope`）、`:81`
- `apps/rqly-sites/public/rqly/search-core.mjs:20`
- `apps/rqly-sites/island-store.mjs:8`（`BUILDINGS`）、`:69` 到 `:81`（`validateRecord`）
- `apps/ly-island-preview/src/rooms.js`、`search.js`、`scene.js:347`

## 不在范围内

不改变岛屿的外观和交互（见 [0002](0002-product-direction.md)）。

## 验收

- 在 `apps/rqly-sites/` 中除岛屿存储与后台的岛屿编辑部分外，搜不到 `library`、`projects`、`workshop` 这些建筑标识；
- 文章校验不再位于 `island-store.mjs`；
- 增加一座建筑的演练只需要改体验层，不需要改内容存储、内容校验或公开接口；
- 现有全部检查脚本和发布流程测试通过，线上展示与改动前一致。
