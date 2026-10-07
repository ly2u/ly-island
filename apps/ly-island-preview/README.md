# LY 浮空岛 1.1.1：个人小岛内容平台

公众首页：https://rqly.com/。旧 /island/ 和 /island 地址 308 转到首页，保留查询参数和阅读 hash。原文章 /notes/:slug、目录、RSS、站点地图、关于页与后台继续使用；原主页保留在 /classic。正式入口移除预览 noindex，并提供首页 canonical、描述和 Open Graph 元信息。

## 浏览与阅读

- 三种程序化 Three.js 建筑：书屋圆塔/书本/书架、展馆钢拱/桁架/概念结构、工坊锯齿屋顶/齿轮/吊臂。点击建筑或快捷入口进入各自阅读空间，全为代码几何，不加载外部照片/模型/字体。
- 书屋提供笔记/博客、栏目筛选和纸本式全文；展馆提供项目档案/工程手记及图纸式阅读；工坊提供 CivilFlow、七嘴工具入口和研发手记。工具在新标签打开，未发送真实 Civil 命令。
- 正文来自只读公开 API，草稿/不存在内容 404；客户端 HTML 白名单只接受本站 /media/ 的已处理图片，移除其他图片、脚本和事件属性并检查链接。目录、字号、分享 hash、阅读书签、刷新恢复、浏览器返回与 Esc 关闭保留。
- 加载场景不遮住导航，可先阅读。右上角「阅读模式」提供四个入口，首次该模式不下载 Three/场景代码；记住当前浏览器选择，系统省流量默认阅读模式。可随时回到 3D 小岛，切换时停止 GPU 渲染。
- WebGL 不可用/上下文丢失/场景加载超时进入阅读模式；正文仍可阅读。公开列表或正文加载失败可重试。禁用 JavaScript 时提供真实服务端文字目录、工程手记、工具和关于链接。
- 午后/暮色、漂浮暂停、减少动态效果、隐藏页面停止绘制、最高 30fps、限制像素比；手机阴影尺寸 1024，桌面 2048。手机竖屏/小屏与横屏可滚动，长介绍不会盖住阅读入口。

## 主人维护与边界

管理 https://rqly.com/admin；岛屿布置 /admin?view=island；密码设置 /admin?view=account。后台维护笔记/博客/项目、草稿/回收站以及岛屿布局/名称/介绍/默认光照；无需重建应用。账号和密码存档保持现状，CivilFlow 独立认证。

共享岛屿保存在 /srv/ly-data/sites/island.json，两个阶段布局分别保存；公开 /api/island、私有版本检查及内容 If-Match 冲突保护沿用。浏览器书签/字号不属于服务端备份，CivilFlow 工作流需另行导出。

成长按真实公开内容计算：笔记 1 点、博客 3 点、项目 5 点、已完成项目另加 10 点；默认 30 点解锁第二阶段，目标可调整，主人确认并保存后扩岛，不自动移动布局。撤回后积分减少，已解锁外观保留。共两个正式阶段，不再展示虚构积分。后台支持封面、图片引用管理/安全删除、自动私有编辑草稿、图片上传/拖放/粘贴/复用、内容 JSON 导出和六处岸边装饰。当前定位为个人三功能建筑平台；任意新增建筑、多用户与模型调用未实现。原能滩吊桥照片不得重新公开，Caddy 原图片 404 拦截始终保留；结构插画均为代码概念图，不代表实际工程。

## 构建与发布

依赖锁定 Three.js 0.186.1 / Vite 8.3.3，构建用 Node.js 24。先保留版本前快照，再构建到暂存目录，不能清空线上 dist：

```bash
cd /opt/ly-stack/apps/ly-island-preview
docker run --rm -v "$PWD:/app" -w /app node:24-alpine npm ci
docker run --rm -v "$PWD:/app" -w /app node:24-alpine npm run build -- --outDir dist-next
```

本轮阅读 JS 30.33 kB / gzip 11.64 kB，CSS 39.17 kB / gzip 9.45 kB；Three/场景延迟 chunk 607.40 kB / gzip 155.14 kB。Vite 大 chunk 提示仍存在，阅读模式不加载该 chunk；这不是实际手机加载速度实测。

先复制新的 hashed assets 和 admin-scene.js，再原子替换 index；旧 assets 保留给已有页面。Caddy 挂载的 dist 目录 inode 必须保持：

```bash
cp -- dist-next/assets/* dist/assets/
install -m 0644 dist-next/admin-scene.js dist/admin-scene.js.next
mv -- dist/admin-scene.js.next dist/admin-scene.js
install -m 0644 dist-next/index.html dist/index.html.next
mv -- dist/index.html.next dist/index.html
python3 /opt/ly-stack/scripts/record-island-source.py
```

公众脚本的动态 import 和 admin-scene.js 共用场景 chunk，后台仍直接渲染 Three 画布，无 iframe。首页 Caddy 只匹配 / 提供 index，/island/* 继续提供静态文件；其他路径仍由 sites 响应，禁止用兜底 SPA rewrite 吞掉文章/API/后台路由。root 改动需 validate 后 reload Caddy，不重启 VPS。

## 备份、回滚与验收

每日本机归档包含 island 源码/锁文件/dist/清单、账号/文章/岛屿数据及配置，排除 node_modules、暂存产物和活动会话；哈希及恢复检查沿用。保留最近 14 份，含敏感内容的归档 0600、目录 0700。

0.5.0 前源码/旧 dist/Caddy/Compose 快照在 /opt/ly-stack/rollback/island-home-before/source-before.tar.gz。0.5.0 当时未改 sites 镜像或任何密码，该历史版本回滚仅恢复岛屿静态文件与 Caddy 入口，保持 dist 目录 inode；保留新文章、布局、账号存档和现有镜像。不得恢复快照中的 Compose 来降级旧认证镜像，也不得撤销原照片拦截。

浏览器报告/截图 validation/island-home/：正式根路径、三个空间、全文及根路径分享链接/刷新、旧 hash/query 跳转、阅读模式无场景下载/停止渲染、手机/横屏/长介绍、慢场景取消/重新启动、省流量、无 WebGL/上下文丢失、公开记录重试、无 JavaScript 真实目录、原路由及认证拦截、后台共用场景。Chromium 使用 SwiftShader；用户实际手机 GPU 性能未实测。历史 0.4.0 / 0.3.0 / 0.2.0 报告分别保留在 unified-admin、owner-cms、island-v2。

参考配置语义：[Caddy handle](https://caddyserver.com/docs/caddyfile/directives/handle)、[Caddy redirect](https://caddyserver.com/docs/caddyfile/directives/redir)、[query 占位符](https://caddyserver.com/docs/caddyfile/concepts#placeholders)。实际行为以本机容器与浏览器验收为准。

## 0.6.0 写作与图片

后台自动保存到私有 editor-drafts.json，已发布文章的编辑不会直接公开；确认「更新发布」后才替换公众内容。图片存在 /srv/ly-data/sites/media，登录上传，原图处理为去元数据的 WebP；当前已发布正文引用的图片才向访客开放，撤回后恢复私有。图片与服务器草稿纳入本机备份。浏览器离线暂存未同步前只能留在原浏览器，需等待保存状态确认。完整操作与限额见 /opt/ly-stack/README.md。

1.0.0 同步部署网站镜像 ly-sites:product-v1-20261006，保留上一账号设置镜像。版前快照在 rollback/autosave-before/；旧镜像不支持新草稿/图片，应优先修复当前版本，不覆盖数据、现有密码或原照片拦截。新验证报告位于 validation/authoring/。

## 1.0.0 产品验收

封面选择自动保存且只在发布后公开，书架/项目档案/完整阅读和旧文章地址一致展示。书屋/工程手记/研发手记按标题与摘要搜索，阅读可继续上一篇/下一篇。公众成长足迹解释真实点数与确认机制，最近更新来自真实公开列表。访客无法改变岛屿或保存装饰。

后台「图片管理」提供容量、全部/未使用筛选、每页 60 张继续加载、引用记录跳转和安全删除。正文/封面/私有编辑缓冲/回收站任一引用存在均拒绝删除；先移除引用并保存。树/长椅/路灯各可放到六个固定岸边地点，建筑附近自动留白；与布局一起保存。

无秘密验收报告 validation/product-v1/，认证写操作均使用隔离账号/目录，生产仅只读回归。实际手机 GPU 和用户本人完整操作留待用户测试；不宣称平台永无缺陷或 Civil/模型自动执行已实现。上一稳定产品为 0.6.0 / ly-sites:authoring-media-20261006，快照 rollback/product-v1-before/source-before.tar.gz。降级会缺少新封面/成长/图片管理，须保留所有新数据/密码并优先修复当前版。

## 1.1.0 岛主雕塑与个人介绍

岛上新增「岛主 · LY」抽象工程师雕塑：手持图纸、浅石底座与 LY 铭牌，全由代码几何和 Canvas 绘制。没有真实人像或外部素材。雕塑位置从岛上预设点选择，给现有建筑留出空间；初生与繁盛阶段均显示。雕塑是固定个人介绍地标，后台仍维护三个功能建筑，布局接口不增加第四个键。

点击雕塑本体、岛主标签、右上角关于、快捷入口或阅读模式入口，在首页 #room=about 打开专属人物卡片与纸本介绍。内容只读取现有 /about 的标题和 .about-content，用已有 DOM 白名单处理，保留原介绍作为唯一来源。刷新/分享/返回/Esc/空间切换可用；读取失败可重试或打开原文字页。

本次仅静态 1.1.0 更新，网站镜像仍 ly-sites:product-v1-20261006；无需重建或重启任何容器。发布仍保留 dist 目录 inode 与旧资源。版前快照 rollback/about-landmark-before/source-before.tar.gz；回滚只恢复静态文件，不恢复文章/岛屿/密码或旧容器配置。隔离与线上只读报告见 validation/about-landmark/；后台认证/交互只使用隔离账号。

## 1.1.1 岛主的位置与造型调整

用户反馈原人物雕塑挡住书屋。改为低矮石台上的打开笔记本、笔与书签，人物几何及介绍页人物插画同步移除，介绍页改为对应的笔记本插画。岛上标签、阅读入口和空间名称简化为「岛主」；个人介绍正文保持原来源。

优先放在前侧岸边 [2.2, 3.95]，以实际建筑包围盒选择有净距的候选位置，不再用靠近书屋的旧露台点。装饰槽位接近岛主时留白。初生/繁盛、默认桌面/手机的书屋入口和立面已从截图检查，岛主几何点击与三建筑后台布局接口继续可用。

仅静态发布，不需要容器重启或 VPS 重启。回滚快照 rollback/keeper-nook-before/source-before.tar.gz（0600）保存原 1.1.0；报告 validation/keeper-nook/。实际手机 GPU 性能仍未实测。

## 岛上邮局（1.2.0）

岛边的信箱和阅读模式的邮局入口打开同一个岛内空间。公开留言须经管理员审核，私信与回信邮箱仅管理员可见；不发送外部邮件。后台“邮局信箱”支持阅读、审核、公开回复、隐藏和归档。文章编辑器支持实时分栏预览，手机可切换编辑与预览。来信由网站服务保存在 DATA_DIR/mailbox.json，纳入本地每日备份。

### 信箱尺寸调整（1.2.1）

信箱模型整体缩至原尺寸65%，选中圆环同比缩小，标签和点击坐标随模型变换。岛上标签、入口、阅读空间及管理导航名称统一为“信箱”。

### 岛面与间距调整（1.3.0）

岛面平面尺寸放大25%（面积增加约56%），建筑中心、树木、地标和装饰位置同步拉开，建筑模型保持原比例。小路连接实际门前位置，扩展岛的副岛/连接桥同步调整，桌面/手机/后台取景更新。服务器继续保存原逻辑坐标；绘制乘1.25、拖动与getLayout反向换算，兼容已有布局和边界/间距校验。

### 建筑与景物布置（1.4.0）

管理员可拖动三个功能建筑、信箱、原有树木及岸边添加的树木。初始岛/扩展岛分别保存 scenery.postoffice 与 scenery.trees 坐标覆盖；旧存档缺省这些字段，读取不重写，首次保存才写入。拖动时校验岛内范围和碰撞，点击“保存并展示”后公众可见。恢复默认布局只重置当前阶段的建筑和景物。道路按当前位置实时重建，绕开建筑/树干并连接实际门前；扩展岛连接桥两侧道路也会重建。公众点击信箱仍打开留言空间，树木不增加公众入口。


1.5.0: public unified full-text search at #room=search, scoped bookshelf/gallery/workshop body search, relevance/type/topic/order controls, paging and highlighted reading jumps. Shared search helper is apps/rqly-sites/public/rqly/search-core.mjs. Public API returns only live published metadata/snippets; original covers, scene/paths/mailbox and owner arrangement remain available.
