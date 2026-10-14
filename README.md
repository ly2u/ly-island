# 群岛框架（暂名）

每个人在自己的域名上搭一座会长大的小岛，岛与岛之间可以拜访、留言、互扔漂流瓶。目标是让人愿意坚持记录。

> **这个分支是一个独立的新项目，和 rqly.com 正在运行的代码无关。**

## 这个分支是什么

- `framework` 是孤立分支：与 `main` 没有共同历史，**不合并进 `main`**。
- 以后转成独立的开源仓库时，把这个分支直接推成新仓库的 `main`。新仓库的历史里只有框架本身，没有 rqly.com 的内容。
- rqly.com 的线上代码、发布脚本和服务器都不受影响：`scripts/release.py` 只发布 `main` 上的标签。
- 测试站点是 dev.rqly.com，部署在 Cloudflare，不经过 VPS。

## 规则

- **按开源项目的标准写：** 不放凭据，不放个人内容，不写死 rqly.com。
- **不引用 `main` 上的代码：** 需要复用 rqly.com 的部分（例如 3D 岛屿场景）时，复制过来，并在提交说明里写明来源。
- **改动走 PR：** 目标分支是 `framework`。

## 分工

| 角色 | 谁 | 负责 |
|---|---|---|
| 编写 | Claude | 设计文档和代码，以 PR 的形式提交 |
| 审查和测试 | VPS 上的审查者 | 对照 `docs/` 审查每个 PR，在独立环境里运行测试和构建 |
| 决定和合并 | 站主 | 确认决定，合并 PR，操作 Cloudflare 账号 |

审查按模块集中进行：一个模块做完提交一个 PR，审查一次。详见[决定 F15](docs/decisions.md#f15-分工已定)。

## 代码

第 1 阶段进行中。

| 目录 | 内容 |
|---|---|
| [`packages/protocol`](packages/protocol/README.md) | 协议核心：格式校验、签名、密钥历史、撤回归属、出站校验、收件箱预检查。没有依赖 |
| `spikes/ssg-compare` | Astro 与 Eleventy 的对比实验，结果见[静态生成器对比](docs/ssg-comparison.md) |

在仓库根目录运行检查：

```bash
node --test
python3 packages/protocol/scripts/check_schemas.py   # 需要 jsonschema 和 cryptography
python3 scripts/check_docs.py
```

## 文档

| 文档 | 内容 |
|---|---|
| [概念与定位](docs/concept.md) | 解决什么问题，和现有平台比，核心循环，原则，不做什么，成功标准 |
| [协议 v0](docs/protocol-v0.md) | 身份、名片、动态、签名、收件箱、漂流瓶、灯塔、隐私 |
| [扩展接口](docs/extensions.md) | 主题、成长规则、通知、AI 管家 |
| [部署](docs/deployment.md) | Cloudflare 免费档、自托管、测试环境 dev.rqly.com |
| [路线](docs/roadmap.md) | 各阶段的内容和验收，拆成独立仓库的步骤 |
| [决定记录](docs/decisions.md) | 已定和待定的事项 |
| [静态生成器对比](docs/ssg-comparison.md) | Astro 与 Eleventy 的实测对比和建议 |

## 许可证

MIT，与 ly-island 相同。
