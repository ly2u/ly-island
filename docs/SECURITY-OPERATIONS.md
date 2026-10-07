# 基础安全配置与验收

## 当前范围

本批增加 HSTS 配置、依赖版本更新 PR 和 PR 模板，并把已撤回照片的 Caddy 拒绝规则放入优先匹配的 handle，确保不会被通用反向代理提前接走。现在线上该照片仍由应用拒绝访问，没有发现已公开。它不改变文章/信箱数据、密码、AI 调用或 Civil 执行方式；不配置异地服务。SSH 在 VPS 实际配置中独立完成：21445，仅公钥登录，22 已关闭。此状态不代表其他部署机器也已配置。

## HSTS 安装

`Caddyfile` 给五个已验收 HTTPS 主机增加`Strict-Transport-Security: max-age=604800`（立即设置覆盖静态错误，再延迟设置覆盖上游返回值），覆盖普通页面、跳转、404 和 CivilFlow 的 401。暂不添加 includeSubDomains / preload：通配 DNS 不代表所有子域均提供 HTTPS。

合并到 main 并打标签后，按 [RELEASE.md 第 6 节](RELEASE.md#6-不由脚本处理的改动) 安装配置，先 validate，再 reload；不需要重启 VPS 或重新设置密码。检查五个主机及文章/API/404/401 的 HTTPS 响应头，再运行标签发布预检查。失败时恢复旧 Caddyfile 并 validate/reload。已经收到 HSTS 的浏览器会保留最长一周，撤回头不会立即清除该缓存。

本地可在隔离 Caddy 容器中验证配置，采用测试邮箱与测试认证哈希；不要运行输出完整环境的 compose config。

## GitHub 一次性设置

当前 Git SSH 身份可以推送分支，但不等于有仓库设置 API 凭据。若自动化连接没有管理接口，站主在仓库 Settings 手动设置，未设置前不可写成已完成。

- Branches / Rules：保护 main，要求 PR；required checks 为 sites、island、release、bridge，要求分支与目标最新；禁止强制推送和删除，对管理员也适用。
- 单人维护先不要求另一人的批准，也不自动合并；不要修改其他 PR 的合并状态。
- Security：分别核实 Dependabot alerts / security updates、secret scanning 与 push protection 已启用。
- 合并本批后，Dependabot 每周检查两个 npm 目录、GitHub Actions 和两个 Dockerfile 目录；仅创建 PR，仍需 CI、审查和标签发布。第一轮计划任务成功及首个更新 PR 尚待 GitHub 实际运行验证。

基础镜像摘要固定属于后续独立更新；本批仍保留已有基础镜像，不能声称已经完全可复现。Compose 的 Caddy 与 release.py 内 Node 镜像常量仍需单独跟进，Dockerfile 更新 PR 不会自动更新这些位置。

## 邮件与域名

VPS 实测 TCP 25 出站可连 Google 两个 MX，取得 220 后 QUIT，未发送邮件。没有部署监听 25 的邮件服务，未验收入站收信，也不表示发信信誉/投递成功。

rqly 的 Cloudflare 邮件路由 SPF include 必须保留；合法发送服务、7zui 邮件用途和报告邮箱确认后再制定 DMARC。当前不修改邮件 DNS。

## 本批验证（2026-10-07）

- 原始 HTTPS Caddyfile 在隔离 Caddy 容器中 validate 通过，生产入口和证书未修改。
- 临时回环 HTTP 测试配置保留五个 Host 的路由语义：10 项检查通过，覆盖 200、www 的 301、撤回照片和缺失静态文件的 404、CivilFlow 的 401；伪上游返回不同 HSTS 仍被正确覆盖。该测试不代表新头已经在线上 HTTPS 生效。
- Dependabot YAML 解析和五个清单目录存在性检查通过；GitHub 定时任务待合并后的实际运行。
- 发布流程的 16 组隔离检查通过；应用代码未改变。

配置参考：[Caddy header](https://caddyserver.com/docs/caddyfile/directives/header)、[Dependabot 配置选项](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)。
