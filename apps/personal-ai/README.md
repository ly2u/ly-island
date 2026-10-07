# 个人 AI：Codex 订阅转接

上线默认模型 `gpt-6-luna`，思考深度 `medium`。网站使用既有管理员账号，公众无法调用。模型与深度从 Codex `model/list` 获取；目录展示不等于逐一验证访问权限。目前实际验证了 Luna，未逐一调用其他模型。

- 主站入口：`https://rqly.com/admin?view=ai`。
- 七嘴入口：`https://7zui.com/` 右上角站主登录，使用同一管理员账号。两个域名各自保存登录 cookie。
- 默认设置首次进入生效；用户的模型/深度选择保存在各域名的浏览器 localStorage。
- 聊天暂存在当前标签页 sessionStorage；最多保留最近 20 条，单条历史上下文最多 8,000 字符，总上下文最多 30,000 字符。可下载 Markdown，退出登录清除此标签页的聊天暂存。
- 七嘴稿件不写入文章或草稿数据，输出只保留在页面，用户可复制或下载。
- 两类调用共享并发 2、每 IP 每小时 30 次、全站每天 120 次的本地上限。订阅本身还有限额。本地计数包含已经提交的失败/取消请求；不是订阅额度计量器。
- 使用 ChatGPT 订阅登录，没有 API key 配置，也不自动回退到单独计费 API。

## 额度与站点操作

两个站点登录后显示账号实时 5 小时 / 周剩余百分比和重置时间，采用 app-server `account/rateLimits/read`，每分钟刷新、调用结束刷新，也可手动刷新。额度由账号共享，包含其他 Codex / Work 使用。它不是本站的请求计数，也不是保证还能调用多少次；接口未返回时明确显示未知，不显示伪造的零。

主站默认开启「允许站点工具」。可自然语言检索笔记/博客/项目、读取完整内容（长文分页）、查询内容/草稿/图片/成长统计、创建私人草稿，以及准备发布或已有内容修改。七嘴只审阅稿件，站点操作请到主站。

- 「查找我写过的桥梁文章，列出标题和摘要。」
- 「把下面这段文字整理为笔记并保存到草稿箱……」
- 「把这篇草稿准备发布。」
- 「将某篇文章的标题和正文改成……，先让我预览。」

私人草稿可由助手直接保存，不直接覆盖已有文章。发布与更新会出现正文预览卡，点击「确认发布 / 确认更新」才生效；预览保留 24 小时，只属于创建它的登录会话。确认时再次检查文章版本，其他页面已经修改就拒绝覆盖。取消或模型失败不会撤销先前已保存的私人草稿。文章草稿和待确认操作存放于 VPS 持久数据目录，包含在本地备份。

## 服务与安全边界

宿主机 `ly-ai.service` 以 `ly-ai` 系统用户运行，只提供 `/run/ly-ai/bridge.sock` Unix socket。该目录只挂载到 sites 容器，不发布任何额外公网端口。网站服务的管理员 session、Origin、CSRF 在转发前校验；模型和思考深度由服务端目录校验。

Codex app-server 采用独立 CODEX_HOME `/var/lib/ly-ai/codex`，使用本次已授权的订阅登录初始化。该凭据与网站密码无关，不向网页返回。根目录 CLI 的配置没有修改。专用配置关闭 shell、unified_exec、模型 code-mode、插件、apps、网络搜索和代理协作，专用目录未配置 MCP；线程无环境访问、使用只读沙箱、临时会话，所有客户端工具审批拒绝。服务另有无 root 权限、ProtectHome、ProtectSystem、敏感目录不可访问和内存上限。同版本官方 codex-code-mode-host 二进制用于转送限定的动态工具，模型 code-mode 功能仍关闭。客户端工具只执行本站定义的六个内容接口，不提供任意命令、服务器文件访问或 Civil 请求。

不记录提示词、回答、OAuth token 或原始 provider stderr 到服务日志。浏览器取消和三分钟等待上限会中断对应 Codex turn。用户提供的聊天内容仍会发送到订阅模型服务。

## 维护

查看服务：`systemctl status ly-ai --no-pager`。

重新安装已备份运行文件：`bash /opt/ly-stack/scripts/install-personal-ai.sh`。脚本保留已有登录凭据，只复制应用代码、固定版本二进制及专用配置。

如页面提示订阅登录需要更新，在服务器自己的终端执行：

```bash
runuser -u ly-ai -- env CODEX_HOME=/var/lib/ly-ai/codex /usr/local/lib/ly-ai/codex login --device-auth
systemctl restart ly-ai.service
```

完成官方登录页面的授权。不要将验证码、token、auth.json、密码或私钥贴进聊天或公开报告。网站 service 用户维护自己的凭据；之后仅在 root CLI 登录不会自动更新这份专用凭据。

代码更新后运行安装脚本并重建 sites：`docker compose -f /opt/ly-stack/compose.yaml up -d --build --no-deps sites`。专用 Codex 固定为 `0.160.1`；未来升级先验证本地生成的 app-server schema、模型目录及一条 Luna 请求。

## 备份与恢复

每日原有备份 timer 继续工作。备份新增主站 AI 源码、七嘴源码、桥接服务、systemd、固定 Codex 与配套工具宿主二进制和个人 AI 登录/配置文件。备份含敏感信息，存放在 `/srv/ly-backups`，目录 0700、压缩包 0600，不传异地。

备份会短暂停止 sites、Caddy 与个人 AI 服务，并在成功/失败路径恢复原先运行状态，不重启 VPS，不停止 CivilFlow。恢复验证只解包到临时目录。恢复备份中的 auth.json 时保留 0600，并确保 `/var/lib/ly-ai` 属于 ly-ai；先运行安装脚本，再启动统一 Compose。如果恢复的 OAuth 凭据已过期或撤销，重新进行上面的官方登录。

## 回滚

当前镜像 `ly-sites:personal-ai-v2-20261006`。前一 AI 对话版 `ly-sites:personal-ai-v1-20261006` 已从完整源码快照重建保存（原镜像标签被构建替换，原运行容器的镜像没有被切换）；其源码快照为 `/opt/ly-stack/rollback/personal-ai-v1/source-before.tar.gz`。恢复该版源码、Compose 和服务配置后重装服务并切换 v1 镜像，保留持久文章/密码。更早的 `ly-sites:product-v1-20261006` 也保留。此次源码/Compose 的回滚包为 `/opt/ly-stack/rollback/personal-ai-before/source-before.tar.gz`，只包含源码与部署配置。将其解包到临时目录，检查后恢复网站源码和 compose.yaml，然后 `docker compose -f /opt/ly-stack/compose.yaml up -d --no-deps --force-recreate sites`。最后 `systemctl stop ly-ai.service`。保持现有 `/srv/ly-data/sites`、网站环境文件、Caddy 与 CivilFlow 不变，不使用 down -v。

参考：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[订阅额度归属](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)。
