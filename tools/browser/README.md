# 隔离浏览器检查

从没有 `apps/rqly-sites/.env` 的干净检出运行，使用 Node.js 24。不要挂载生产数据、
AI socket 或任何真实账号凭据。本工具会登录并写入合成数据，**只能针对本工具的
临时 fixture**，不能用于线上站点。

```bash
(cd apps/rqly-sites && npm ci)
(cd apps/ly-island-preview && npm ci && npm run build)
npm install --prefix /tmp/ly-browser-tools --no-save --package-lock=false playwright@1.63.0
node /tmp/ly-browser-tools/node_modules/playwright/cli.js install --with-deps chromium firefox webkit
REVIEW_PORT=4187 node tools/browser/fixture.mjs
```

最后一条在前台启动服务，只监听 127.0.0.1。另开终端执行：

```bash
BASE_URL=http://127.0.0.1:4187 \
PLAYWRIGHT_MODULE=file:///tmp/ly-browser-tools/node_modules/playwright/index.mjs \
CHROMIUM_PATH=/tmp/ly-browser-tools/chromium \
QA_OUTPUT=/tmp/ly-browser-results \
node tools/browser/check-polish.mjs
```

`CHROMIUM_PATH` 必须指向真实的 Chromium 可执行文件；如果已通过 Playwright 安装，
可用下面的命令取出路径，再替换上面的值：

```bash
node --input-type=module -e "import {chromium} from '/tmp/ly-browser-tools/node_modules/playwright/index.mjs'; console.log(chromium.executablePath())"
```

也可以指定系统 Chromium，例如 `/usr/bin/chromium`。浏览器依赖请安装在测试容器
或专用测试机里。无需在生产宿主机安装浏览器；不将 Playwright 加入应用依赖。

fixture 用合成账号和记录，数据保存在操作系统临时目录。向 fixture 发送 SIGTERM
后自动清理。所有响应附带测试标识；runner 必须检查标识和 loopback 高端口才能
开始任何写操作。fixture 仅在响应中暴露测试场景引用，不修改正式源码或构建产物。
报告和截图保存在 `QA_OUTPUT`，不要提交真实站点的数据或截图。

覆盖三种浏览器引擎下的阅读、窄屏、速记、自动保存、私密图片和完整预览；
有 WebGL 时检查保存前对照，Chromium 还通过真实鼠标拖动验证位置撤销和重做。
无 WebGL 的 Firefox 环境记录降级结果。WebKit 引擎不是实际 Safari 应用，
桌面窄视口也不代表已验收真机触摸、输入法、GPU 或耗电。
