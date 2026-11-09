# 小岛与搜索引擎

3D 首页保留；公开记录以 `/notes/<slug>` 为稳定的独立文档地址，`/notes` 是服务端
输出的内容目录。首页到目录、目录到文章都有普通链接。岛内 hash 用于视图和筛选状态，
分享、复制链接、Ctrl/中键打开文章使用独立地址。

## 已有基础与本轮改动

已有基础：公开文章服务端输出正文、表格和 MathML；标题/description/canonical/OG；
站点地图；缺失、草稿和回收站文章返回真实 404；后台和登录页 noindex 与认证门禁。
首页原生入口和关闭 JavaScript 的文字入口也一直存在。

本轮补充：

- 保留入口原有 href，普通点击仍在岛内打开。书本、推荐、项目、目录内记录、相关
  阅读、搜索结果和成长足迹的文章入口改为 `<a href="/notes/...">`。中键、Ctrl/Meta、
  Shift 等修改键不被脚本拦截。过滤、字号和其他操作继续使用按钮。
- 首页标题说明桥梁工程与数字工具，增加 RSS 自动发现。没有追加悬浮内容框。
- 独立文章页增加可见的作者链接、真实更新时间与面包屑。Microdata 标记 Article /
  BlogPosting、作者 Person、日期、标题/摘要/正文、已有封面与 BreadcrumbList。
  没有封面时不制造默认文章图片；预览/私人草稿不输出这些文章标记。
- 使用原有 HTML 与 Microdata，未加入内联 JSON-LD 脚本，现有 CSP 不变。
- sitemap 的文章 lastmod 读取已有 updatedAt，旧记录可使用已有日期；无效或未来时间
  省略，不使用每次请求时的“今天”。静态页没有可靠更新时间时不填。GET 不写任何台账。
  发布日期是编辑选择的日历日期，更新时间是实际时间点，两者分别保留，不擅自将
  日历日期解释成 UTC 午夜再比较。
- robots 允许渲染所需的公开 `/api/island`、`/api/posts` 和公开文章 JSON；其他 API 与
  后台仍禁止抓取。JSON 响应添加 noindex，后台既有 noindex/nofollow 保持。认证与公开
  投影仍由服务器负责；robots 和 noindex 都不替代访问控制。没有根据 User-Agent 返回
  两套文章或给爬虫追加隐藏关键词。

原始首页仍由 Caddy 服务静态岛屿资源，公开目录和文章由 Node 服务端输出。不需要
为了文章抓取新增数据库、渲染服务、代理模板或宿主机挂载。

## 验证

`apps/rqly-sites` 执行 `node scripts/check-seo.mjs`，以及全部 `scripts/check*.mjs`。
检查公开/私有 sitemap、真实日期与跨时区表示、元数据转义、预览隔离、普通与 Googlebot
文章一致、canonical/SSR、robots 公开资源范围、JSON noindex、原有权限与原生修改键。
岛屿沿用场景测试与构建。

隔离浏览器验证：关闭 JavaScript 后，从首页走到目录再进入文章；独立解析 Microdata
的作者/日期/面包屑；普通点击留在岛内，Ctrl/中键在新页打开独立文章；搜索、成长入口
的真实链接；390/320px 的公式/表格、原有书籍排版和零 CSP 错误。没有向真实站点写测试
记录。线上验证只做 GET/HEAD。

本地结构检查不等同 Google Rich Results Test，也不等同搜索引擎已收录。

## 站长平台还需确认

本轮没有 Search Console / Bing Webmaster Tools 的授权，无法核验实际收录数量、
抓取错误或搜索表现，也未代替站主完成平台验证或提交。

在已有平台账号中确认域名所有权后，提交：

`https://rqly.com/sitemap.xml`

再检查首页、`/notes` 和几篇独立文章的 URL Inspection / 页面索引状态，确认搜索引擎
选择的规范地址。若尚未验证，使用平台生成的真实验证记录；不生成占位令牌。
不应只凭 `site:` 查询结果判断完整收录数量。持续发布有独立主题、过程与来源的真实
工程记录也很重要；技术调整不保证收录、排名、富媒体展示或抓取时间。

## 官方依据

- [JavaScript SEO 基础](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [可抓取链接](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
- [Article 与 Microdata](https://developers.google.com/search/docs/appearance/structured-data/article)
- [面包屑结构化数据](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)
- [站点地图与 lastmod](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
