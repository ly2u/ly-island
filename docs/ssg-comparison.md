# 静态生成器对比：Astro 与 Eleventy

- **状态：** 建议采用 Astro，等站主确认（[决定 F13](decisions.md#f13-静态生成器建议-astro等确认)）
- **日期：** 2026-10-14，同日按审查意见修订

**结论：** 两者生成的网站几乎一样：

- 都不带 JavaScript，全部页面压缩后合计都约 2.9 KB；
- 订阅源都是合法的摘要模式 RSS；
- 协议文件逐字节一致，都通过校验和验签；
- 记录的文件头写错时，两边的构建都会失败。

差别不在能不能做到，而在要多少配置、装多少依赖：

- Astro 依赖重得多：`node_modules` 约 130 MB，是 Eleventy 的 7 倍多；
- Astro 把组件、默认作用域的样式、内容类型和打包放在同一套工具里。Eleventy 也有对应的办法（Nunjucks 默认转义、`eleventyDataSchema`、WebC、is-land），但要自己挑选和组合。

## 怎么比的

**同一座示例岛，分别用两个工具实现一遍：**

- 3 篇 Markdown 记录（文章、短记录、项目各一篇），其中一篇带表格；
- 首页：根据记录画一座小岛（SVG），加上记录列表；
- 文章页；
- RSS 订阅源，两边都只放摘要，字段相同；
- 名片、动态、邻居列表三个协议文件，由两边共用的模块 `spikes/ssg-compare/shared/island-data.mjs` 调用 `@islands/protocol` 生成并签名。这样两边只有生成器不同。

Eleventy 这次的页面用 JavaScript 模板写，订阅源用 Nunjucks 模板写（RSS 插件文档里的写法）。

**检查（任何一项不对，整次运行就失败）：**

- 页面：每篇记录都有页面，标题和表格都渲染出来了，首页有小岛图；
- 订阅源：
  - 用严格的 XML 解析器解析，包括命名空间检查；
  - 每篇记录正好一条，链接、guid、标题、摘要、日期都对；
  - 没有全文等多余字段；
- 协议文件：
  - 必须是 JSON 对象，并通过校验；
  - 名片和动态都合法时，才建立信任并逐条验签；
  - 两边生成的协议文件逐字节一致；
- 文件头：一篇 `kind` 写错的记录（`fixtures/bad-front-matter`）必须让构建失败，而且是被各自的 Schema 检查拦下的。

**检查本身也有测试：**

- `checks.test.mjs` 覆盖审查提出的负例：协议文件为 `null`、`false`、`0`，以及订阅源有三条但不是合法 XML。它还确认这些情况下命令的退出码是 1；
- XML 解析器 `xml.mjs` 没有依赖。`xml-oracle.py` 用 Python 自带的 expat 对照了 2 万个随机文档，结论一致。`xml.mjs` 有意更严的地方（不支持 DTD、只接受 ASCII 名字）单独计数。

**复现：**

- 完整运行：`node spikes/ssg-compare/measure.mjs`；
- 已有构建结果，只跑检查：`node spikes/ssg-compare/measure.mjs --check <dist 目录>`。

**版本与环境：**

- Astro 7.3.8 加 @astrojs/rss 4.0.19；
- Eleventy 3.1.6 加 @11ty/eleventy-plugin-rss 3.1.0；
- GitHub 的 Ubuntu 机器，Node 22.23.3，npm 10.9.9。

**这是滚动快照，不是冻结的实验：**

- 只固定了直接依赖的版本，间接依赖每次运行时重新解析；
- 两个工具各用一个空的 npm 缓存，安装顺序不影响结果；
- 报告记录了 npm 版本、平台、CPU，以及每次解析出的锁文件的哈希，可以用来判断两次运行是否装了同样的依赖；
- 安装时间受网络影响，只作参考，不作为工具优劣的证据。

第 1 阶段的正式构建会提交锁文件，并用 `npm ci` 安装。

## 结果

数据来自 CI 运行 [38586869079](https://github.com/ly2u/ly-island/actions/runs/38586869079)。

| 项目 | Astro | Eleventy |
|---|---|---|
| 安装的包 | 200 个 | 131 个 |
| `node_modules` 大小 | 130.1 MB | 17.6 MB |
| 安装时间（只作参考） | 15.4 秒 | 3.9 秒 |
| 第一次和第二次构建 | 2.6 秒，1.4 秒 | 0.5 秒，0.4 秒 |
| 输出文件 | 8 个 | 8 个 |
| 发给浏览器的 JavaScript | 0 | 0 |
| HTML、CSS、JS 压缩后合计 | 2.9 KB | 2.9 KB |
| 首页压缩后 | 0.88 KB | 0.88 KB |
| 文章页压缩后 | 0.84 KB | 0.86 KB |
| 订阅源（摘要模式，未压缩） | 1.10 KB | 1.26 KB |
| 文件头写错时构建失败 | 是 | 是 |
| 输出检查 | 通过 | 通过 |

- 两边的协议文件逐字节一致。
- 锁文件哈希：Astro 是 `2f8c4569426f6e9a`，Eleventy 是 `290a65a3fad3d727`。锁文件的条目（268 条和 132 条）比实际安装的包多，多出的主要是其他平台才装的可选包。
- 紧接着的第二次运行 [38587312979](https://github.com/ly2u/ly-island/actions/runs/38587312979) 换了一种 CPU：锁文件哈希相同，体积和输出不变；安装 18.8 秒和 4.9 秒，第一次构建 2.1 秒和 0.6 秒。
- 审查者在 Debian bookworm 上独立运行了修订前的版本（Node 22.23.3，npm 10.9.9）：包数、体积和输出大小都一致，安装时间是 23.0 秒和 8.4 秒。

在 Cloudflare 的构建额度下（每月 3,000 分钟，单次最长 20 分钟），两者的构建时间差别都可以忽略。

## 写起来的差别

| 方面 | Astro | Eleventy：这次的写法 | Eleventy：其他现成办法 |
|---|---|---|---|
| 组件 | `.astro` 组件，参数有类型 | 返回字符串的 JavaScript 函数 | Nunjucks 宏、WebC 组件 |
| 样式 | 组件里的样式默认只作用于本组件，`is:global` 除外 | 全局样式，靠命名避免冲突 | WebC 的 `webc:scoped`（这次没测） |
| 转义 | `{}` 表达式默认转义 | 手写的转义函数，每处都要调用 | Nunjucks 默认自动转义，Eleventy 自带。这次的订阅源就用了它 |
| 文件头校验 | 内容集合的 Schema，规则自己写 | `eleventyDataSchema` 钩子（3.0 起），规则自己写 | 钩子里可以用任何校验库 |
| 浏览器端 JavaScript | 自带打包，`import()` 的模块自动拆成单独的文件 | 这次没有 JavaScript | 浏览器原生的 `import()`、is-land，或者另配 esbuild |
| `/.well-known/island.json` 这类文件 | 用端点生成 | 用 JavaScript 模板加 `permalink` 生成 | 无 |
| 学习成本 | 要学 `.astro` 语法 | 几乎只要会写 JavaScript | 每种模板语言各有语法 |

**这次遇到的情况，都不是工具缺陷：**

- **Eleventy 默认跳过 `.gitignore` 列出的文件。** 实验先把记录复制进 Eleventy 的输入目录，又把复制出来的文件列进了 `.gitignore`，于是被跳过了。用 `setUseGitIgnore(false)` 关掉即可，`.eleventyignore` 照常生效。
- **Eleventy 目录数据里的 `tags` 会合并进每篇记录。** 这是它的数据级联规则，文档里有说明。
- **Eleventy RSS 插件 3.1.0 的现成模板，不是合法 XML。** 记录有摘要时，它会输出 `<content:encoded>`，但没有声明对应的命名空间。改用插件文档里的自写模板后就好了。这是插件模板的问题，不是 Eleventy 本身的问题。修订前的检查只数了条目数，没发现这一点。

### 默认转义管不到的地方

默认转义只把文本里的 `<`、`&`、引号换成实体。下面这些，两个工具都不会自动兜底：

- 原样输出的 HTML，包括 Astro 的 `set:html` 和 Nunjucks 的 `| safe`；
- 需要清洗的 HTML，比如带格式的邻居动态；
- 链接里的危险协议，比如 `javascript:`。

所以无论选哪个，邻居的数据都要先在协议层校验（已有：只接受 https 地址），显示富文本时还要另做 HTML 清洗。

### 点击后才加载 3D（这次没有验证）

两边都要自己写：在点击事件里用 `import()` 加载 Three.js。

- **Astro：** `client:visible` 是组件进入视口时加载，`client:only` 是页面加载时就运行，都不等于点击。Astro 的好处是 `import()` 的模块会被自动打包，拆成单独的文件。
- **Eleventy：** 可以用浏览器原生的 `import()`，但第三方包的路径要自己处理；也可以用 is-land 的 `on:interaction`。

下载时机和体积，等第 3 阶段做 3D 主题时实测。

## 风险与应对

| 风险 | 应对 |
|---|---|
| Astro 依赖多、体积大，供应链风险更高 | 正式构建提交锁文件，用 `npm ci` 安装；开启 Dependabot；只用官方集成包 |
| Astro 在 2026 年 1 月加入了 Cloudflare | [官方公告](https://astro.build/blog/joining-cloudflare/)承诺继续以 MIT 许可证开源，并继续支持各种部署目标。产物是普通静态文件，可以放在任何地方；协议文件由共享模块生成，这次实验已经证明换一个生成器也能直接用 |
| Astro 要求 Node 22.12 以上 | CI 已经在用 Node 22 和 24 |
| 把默认转义当成全面的防注入 | 见上文"默认转义管不到的地方"；主题的审查清单里列出 `set:html` 和链接协议 |

## 建议

**采用 Astro。** 理由是集成，而不是 Eleventy 做不到：

- 主题要写很多组件，每个组件都带样式。Astro 的组件、默认作用域的样式、内容类型和打包是同一套工具，不用另外挑选和配置；
- 3D 主题要按需加载很大的 JavaScript 包，Astro 的打包可以直接用。

代价是依赖重 7 倍多，还要学 `.astro` 语法。

生成器只负责把记录渲染成 HTML。协议文件、签名和成长规则都放在自己的包里，不依赖 Astro。以后要换生成器，只需要改渲染那一层。

如果站主更看重依赖少、上手简单，Eleventy 也完全可行：

- 页面用 Nunjucks，默认转义；
- 文件头用 `eleventyDataSchema` 校验；
- 组件和样式隔离用 WebC；
- 浏览器端脚本用原生 `import()` 或 is-land。

代价是这些都要自己挑选和组合。

对比用的代码保留在 `spikes/ssg-compare/`。第 1 阶段的第 3 个 PR 会在选定的生成器上正式搭建构建流程。

## 参考

- [Eleventy：Nunjucks](https://www.11ty.dev/docs/languages/nunjucks/)，以及 [Nunjucks 的默认选项](https://mozilla.github.io/nunjucks/api.html#configure)（`autoescape` 默认开启）
- [Eleventy：数据校验 `eleventyDataSchema`](https://www.11ty.dev/docs/data-validate/)
- [Eleventy：忽略文件](https://www.11ty.dev/docs/ignores/)
- [Eleventy：is-land](https://www.11ty.dev/docs/plugins/is-land/)
- [Astro：`set:html` 与 `client:*` 指令](https://docs.astro.build/en/reference/directives-reference/)
- [Astro 加入 Cloudflare](https://astro.build/blog/joining-cloudflare/)
