# 架构决策记录

这里记录影响整体结构的决定：为什么这样定，改哪里，做到什么程度算完成。实施者（人或 AI）以这里为准；需要偏离时，先在 PR 里提出，由站主确认后修改对应记录。

**状态说明：**

- **已采纳：** 已决定；
- **待实施：** 已决定但未完成；
- **已实施：** 已完成；
- **提议：** 等站主确认。

| 编号 | 决定 | 状态 |
|---|---|---|
| [0001](0001-git-as-source-of-truth.md) | Git 是源码的唯一来源，按标签发布 | 已实施；分支保护待做；PR 模板已增加 |
| [0002](0002-product-direction.md) | 岛屿为首页，浏览器后台写作，功能暂不删减 | 已采纳 |
| [0003](0003-layering-by-lifespan.md) | 按寿命分层：资产层、体验层、工具层 | 提议 |
| [0004](0004-single-source-data-schema.md) | 数据模式只有一个来源，前后版本兼容 | 提议 |
| [0005](0005-static-public-reads.md) | 公开阅读静态化（读写分离） | 提议 |
| [0006](0006-trust-boundaries.md) | 后台加第二道门；公开写入与后台、AI 分开 | 提议，认证方案待确认 |
| [0007](0007-portable-content-format.md) | 内容使用标准格式，并能导出 | 提议 |
| [0008](0008-prefer-mature-solutions.md) | 通用能力优先用成熟方案 | 提议；更新提醒已实施 |
| [0009](0009-architecture-budgets.md) | 用可执行的约束守住架构 | 基础配置已授权推进；架构预算提议 |
| [0010](0010-backup-and-monitoring.md) | 异地加密备份与应用层监控 | 提议 |

安全问题的详细依据见 [`docs/reviews/2026-10-07-security.md`](../reviews/2026-10-07-security.md)。

## 实施顺序

**第一批：已授权推进的基础配置，以及需要实际权限或邮件用途确认的项目。**

1. [0009](0009-architecture-budgets.md)：开启 `main` 分支保护，增加 PR 模板。
2. 安全 S2：先确认合法收发信用途和 DNS 控制权限，再制定 SPF/DMARC；保留 Cloudflare 邮件路由所需 SPF。
3. 安全 S4：在 Cloudflare 控制台核对三个域名是否开了代理。如果开了，按审查中的建议处理。
4. 安全 S3：在 `Caddyfile` 中加 HSTS。`Caddyfile` 的修改需要按 `docs/RELEASE.md` 第 6 节人工安装，发布脚本不会自动应用。
5. [0008](0008-prefer-mature-solutions.md)：开启 Dependabot 和 secret scanning 推送保护；基础镜像固定到摘要。

**第二批提议：先选择认证方案和访问方式。**

6. [0006](0006-trust-boundaries.md) 第一步：后台加第二道门。

**第三批提议：分别确认范围后再实施。**

7. [0003](0003-layering-by-lifespan.md) 与 [0004](0004-single-source-data-schema.md)：一起实施。
8. [0005](0005-static-public-reads.md)：公开阅读静态化。
9. [0007](0007-portable-content-format.md)：标准 Markdown 与导出。
10. [0006](0006-trust-boundaries.md) 第二步：拆分进程。

**随时，或等站主确认后：**

- [0009](0009-architecture-budgets.md) 中的各项预算，随对应决策逐步加入 CI；
- 安全 P1、P2：已补隐私说明、HMAC 限流/重试键、定时清理、容量提示、归档后确认删除与私信预留额度；来信保留至管理员手动删除，不自动清除历史来信。详见 [信箱维护](../MAILBOX-PRIVACY.md)。
- [0010](0010-backup-and-monitoring.md)：站主确认后实施。

## 约定

- 每个 PR 在说明里写出对应的决策编号；完成后在同一个 PR 里更新决策的"状态"。
- 每一批改动都按 `docs/RELEASE.md` 发布：先预检查，再发布。
- 涉及数据格式的改动需单独确认范围并保证回滚安全；[0004](0004-single-source-data-schema.md) 是待确认的详细方案。
