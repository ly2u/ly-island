# 邮件 DNS 防冒用配置

2026-10-07 站主已手动添加下表三条 TXT。Google 与 Cloudflare 两个公开 DNS-over-HTTPS 查询一致：两域 DMARC 均为 `v=DMARC1; p=reject; sp=reject;`，7zui SPF 为 `v=spf1 -all`；rqly 现有三个 Cloudflare MX 与 `v=spf1 include:_spf.mx.cloudflare.net ~all` 正常保留，各名称没有重复适用记录。已完成 DNS 解析核验，未发送测试邮件或验证实际收发。站主准备以后正式发信，届时按下文配置 SPF/DKIM。

进入 Cloudflare，分别选择域名 → DNS → Records/记录 → Add record/添加记录。下表为已添加记录；重建 DNS 时均为 TXT，TTL Auto；内容直接填写，不手工加外围双引号。

| DNS 区域 | 名称 | 内容 | 操作 |
| --- | --- | --- | --- |
| rqly.com | `_dmarc` | `v=DMARC1; p=reject; sp=reject;` | 已添加、核对通过 |
| 7zui.com | `@` | `v=spf1 -all` | 已添加、核对通过；当前无正式发信服务 |
| 7zui.com | `_dmarc` | `v=DMARC1; p=reject; sp=reject;` | 已添加、核对通过 |

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
