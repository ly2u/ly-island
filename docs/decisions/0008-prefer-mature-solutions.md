# 0008 通用能力优先用成熟方案，自研只用于差异化部分

- **状态：** 已采纳（原则）
- **日期：** 2026-10-07

## 背景

目前自己实现的通用能力有：

- CMS：草稿、历史、回收站、冲突处理；
- 登录、Markdown 渲染、搜索、图片处理、留言审核；
- 发布工具、备份校验。

真正独特、值得自研的只有三样：

1. 岛屿体验；
2. "AI 写入必须由人确认"的协作方式；
3. 研究工具。

站主一个人维护。每多一个自研的通用轮子，就多一份长期的维护和安全责任。

## 决定

1. **新的通用能力**（认证因素、Markdown、加密、备份、依赖更新、监控等）默认使用成熟的库或工具。确实需要自研时，PR 说明里必须写明理由。
2. **已有的自研通用部分不必立刻替换。** 在相关决策实施时顺带替换：
   - Markdown 渲染随 [0007](0007-portable-content-format.md)；
   - 第二个认证因素随 [0006](0006-trust-boundaries.md)；
   - 异地备份随 [0010](0010-backup-and-monitoring.md)。
3. **依赖与镜像（安全审查 S5）：**
   - 开启 Dependabot：两个 npm 目录、GitHub Actions、Dockerfile；
   - 基础镜像固定到摘要（`apps/rqly-sites/Dockerfile:1`、`compose.yaml:61`、`scripts/release.py:44`），升级通过 Dependabot 的 PR 走正常发布流程；
   - 镜像摘要记入发布记录；
   - 开启 GitHub secret scanning 的推送保护。

## 验收

- 仓库有 `.github/dependabot.yml`，依赖有更新时能收到 PR；
- 基础镜像以摘要引用；
- 新增的通用能力在 PR 中有选型说明。
