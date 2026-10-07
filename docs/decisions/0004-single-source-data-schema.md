# 0004 数据模式只有一个来源，并遵守前后版本兼容

- **状态：** 提议，具体实现待站主确认
- **日期：** 2026-10-07
- **与 [0003](0003-layering-by-lifespan.md) 一起实施**

## 背景

同一份数据格式被多处各自实现。

**分类和类型：** "记录/工程/探索"出现在以下 8 个非测试文件中：

- `apps/rqly-sites/server.mjs`
- `apps/rqly-sites/island-store.mjs`
- `apps/rqly-sites/editor-drafts.mjs`
- `apps/rqly-sites/ai-site-tools.mjs`
- `apps/rqly-sites/public/rqly/admin.js`
- `apps/ly-island-preview/src/rooms.js`
- `apps/ly-island-preview/src/search.js`
- `scripts/verify-backup.py`

**校验规则：** 各数据文件的校验在 Node 存储模块里写一遍，又在 `scripts/verify-backup.py:68` 到 `:212` 用 Python 重写了一遍。重写的包括岛屿、目录、编辑草稿、信箱、AI 待确认操作、图片。

**后果：**

1. 改一个字段要同时改服务端、浏览器、Python。漏改备份校验，每晚的备份就会失败（2026-10-07 已发生过同类问题：`SOURCE-CHANGES.json`）。
2. 发布流程可以回滚代码，但回滚不了数据。新版本一旦写入旧版本不认识的格式，回滚后旧代码可能拒绝读取。

## 决定

1. **每个数据文件一份声明式模式，作为唯一来源。** 涉及的文件：`posts.json`、`editor-drafts.json`、`content-history/*.json`、`organization.json`、`island.json`、`mailbox.json`、`ai-actions.json`、图片元数据。模式统一放在仓库中的一个目录（例如 `schemas/`），推荐 JSON Schema。
2. **以下几处都从这份模式派生，不再各自定义：**
   - 服务端的写入校验；
   - 后台表单的选项与长度限制；
   - AI 站点工具的参数定义（`ai-site-tools.mjs`）；
   - 岛屿前端用到的分类列表；
   - `verify-backup.py` 的恢复校验。
   
   实现方式由实施者选择，例如 Python 侧通过 Node 容器调用同一份校验，或者使用一个只支持所需子集的校验器。但定义只能有一份。
3. **前后版本兼容规则：**
   - 每个版本都必须能读取上一个版本写入的数据；
   - 它写入的数据也必须能被上一个版本读取。
   
   需要改变格式时分两次发布：第一次让读写同时兼容新旧格式，第二次再去掉旧格式。
4. **数据迁移是显式步骤，** 由发布流程执行，迁移前有备份检查点。每个数据文件的 `schemaVersion` 记入发布记录（`releases/<发布编号>/release.json`）。
5. **PR 模板增加两栏：** "是否改变数据格式"和"回滚是否安全"（见 [0009](0009-architecture-budgets.md)）。

## 涉及位置

- `apps/rqly-sites/island-store.mjs:17` 到 `:49`（`validateIsland`）、`:69` 到 `:81`（`validateRecord`）
- `apps/rqly-sites/editor-drafts.mjs:11` 到 `:17`
- `apps/rqly-sites/public/rqly/organization-core.mjs:2` 到 `:9`
- `apps/rqly-sites/mailbox-store.mjs`、`content-history.mjs`、`media-store.mjs`、`ai-site-tools.mjs`
- `apps/rqly-sites/server.mjs:71`、`:81`
- `scripts/verify-backup.py:68` 到 `:212`
- `scripts/release.py`：在发布记录中写入各数据文件的 `schemaVersion`

## 验收

- 分类、类型、建筑等枚举值在模式目录之外（测试除外）各只出现在一个派生位置，或者不再出现；
- `verify-backup.py` 不再手写各数据文件的字段规则；
- CI 中有一项"兼容性"测试：用上一个发布版本写出的样例数据启动新版本，读取并保存，再用上一个版本读取，全部成功；
- PR 模板包含数据格式与回滚两栏。
