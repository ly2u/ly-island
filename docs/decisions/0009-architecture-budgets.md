# 0009 用可执行的约束守住架构

- **状态：** 已采纳，待实施。分支保护和 PR 模板可以立刻做。
- **日期：** 2026-10-07

## 背景

这个仓库主要由 AI 编写，之后也会如此。AI 擅长把局部改对，但不会自己守住整体结构，复杂度会逐渐叠加。

已有的基础：

- `docs/REVIEW.md` 写明了约束；
- `apps/rqly-sites/scripts/` 下有 13 个检查脚本；
- `scripts/check-release.py`；
- CI（`.github/workflows/check.yml`）。

缺少的是架构层面的约束：结构上的规则目前只写在文档里，没有自动检查。

## 决定

### 立刻做（几分钟）

1. **开启 `main` 的分支保护：** 要求 CI 的 `sites`、`island`、`release`、`bridge` 四项全部通过才能合并；禁止直接推送和强制推送。
2. **增加 `.github/pull_request_template.md`，固定这几栏：**
   - 涉及哪一层：资产层、体验层、工具层、运维（见 [0003](0003-layering-by-lifespan.md)）；
   - 是否改变数据格式、回滚是否安全（见 [0004](0004-single-source-data-schema.md)）；
   - 是否影响备份或备份校验；
   - 是否需要人工修改 `compose.yaml`、`Caddyfile`、运维脚本或 systemd 单元；
   - 对应的决策编号。

### 随各决策实施逐步加入 CI

| 预算或约束 | 当前值 | 建议的初始上限 |
|---|---|---|
| 公开接口每次请求读取 `posts.json` 的次数 | 已由 `check-scale.mjs` 约束 | 保持 |
| 岛屿阅读入口 JS 体积 | 30 KB（`apps/ly-island-preview/README.md:34`） | 40 KB |
| 岛屿 3D 场景延迟加载包体积 | 607 KB（gzip 后 155 KB） | 650 KB，超出需在 PR 中说明 |
| 分类、类型、建筑等枚举的定义位置 | 8 个以上文件 | 只在模式目录（[0004](0004-single-source-data-schema.md)） |
| 资产层引用体验层概念 | 有（[0003](0003-layering-by-lifespan.md)） | 不允许 |
| 静态产物中出现草稿或回收站内容 | 尚未静态化 | 不允许（[0005](0005-static-public-reads.md)） |

## 角色约定

- **站主是架构负责人：** 确认决策、审批越界的改动，不需要逐行审查代码。
- **实施者（人或 AI）：**
  - 每个 PR 对应一个或多个决策编号；
  - 完成后更新对应决策的"状态"；
  - 需要偏离决策时，先在 PR 里提出，由站主确认后修改决策记录。

## 验收

- `main` 已受保护；
- PR 模板生效；
- 表中的约束逐项进入 CI，任何一项超出都会使 CI 失败。
