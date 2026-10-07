# 邮件 DNS 防冒用配置

2026-10-07 实测公开 DNS：rqly.com 已有三个 Cloudflare MX 与 `v=spf1 include:_spf.mx.cloudflare.net ~all`；两个域名都没有 DMARC。7zui.com 未设置 SPF/MX。站主确认准备以后使用这些域名发信；本轮只提供填写说明，不代替站主修改 DNS，不发送测试邮件。

进入 Cloudflare，分别选择域名 → DNS → Records/记录 → Add record/添加记录。以下均为 TXT，TTL Auto；内容直接填写，不手工加外围双引号。

| DNS 区域 | 名称 | 内容 | 操作 |
| --- | --- | --- | --- |
| rqly.com | `_dmarc` | `v=DMARC1; p=reject; sp=reject;` | 新增 |
| 7zui.com | `@` | `v=spf1 -all` | 新增；当前尚无正式发信服务 |
| 7zui.com | `_dmarc` | `v=DMARC1; p=reject; sp=reject;` | 新增 |

rqly.com 的现有 MX/SPF 保留，避免中断 Cloudflare 收信转发。不要给同一名称添加第二条 SPF；以后启用发信时，需要按选定服务商的指示修改或合并到唯一一条 SPF。TXT 记录没有橙色云代理设置。

DMARC reject 通知支持 DMARC 的收件方拒绝验证失败的冒用邮件，sp 对子域名设置相同策略。该配置以目前尚未正式发信为前提；7zui 的 `-all` 表示当前不授权任何服务器通过该域名的 SPF。

## 以后正式发信之前

1. 从发信服务商取得 SPF 和 DKIM 记录，先完成域名认证；DKIM 的 selector/公钥或 CNAME 由服务商提供，不能自己编造。
2. 替换 7zui 的禁止发信 SPF，或合并 rqly 现有 Cloudflare include 与新服务的授权。同一名称保持一个 SPF，遵守总计最多 10 次 DNS 查询的限制。若服务商使用专门的 bounce 子域名，按其要求配置该子域名，不盲目改根域名 SPF。
3. 检查测试邮件的 Authentication-Results：SPF/DKIM 验证结果与可见 From 域名的 DMARC 对齐，最终 dmarc=pass，然后再用于网站通知。25 端口放开不等于发信域名已经通过认证。
4. 使用尚未验证的新发信服务时，可临时采用 `p=none` 观察认证，但它没有拒绝冒用的效果；验证完成后恢复 reject。这里未添加 rua 报告邮箱，避免填写不存在的邮箱或把报告交给未经确认的第三方。

## 保存后的核验

在 Cloudflare 看见记录后，等待 DNS 传播；下面只读命令可查 TXT（系统没有 dig 时，可使用现有 DNS 查询方式）：

```bash
dig +short TXT _dmarc.rqly.com
dig +short TXT 7zui.com
dig +short TXT _dmarc.7zui.com
```

每个 `_dmarc` 名称应只有一条 DMARC 策略，7zui 根名称应只有一条 SPF。无需修改网站 A/CNAME 或 VPS 端口。

官方依据：[Cloudflare 邮件域名与 DNS 配置](https://developers.cloudflare.com/email-service/configuration/domains/)、[SPF RFC 7208](https://www.rfc-editor.org/info/rfc7208/)、[DMARC RFC 9989](https://www.rfc-editor.org/rfc/rfc9989.html)。
