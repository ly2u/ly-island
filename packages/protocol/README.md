# 协议核心 `@islands/protocol`

[协议 v0](../../docs/protocol-v0.md) 的参考实现：格式校验、规范化 JSON、Ed25519 签名、密钥历史、撤回归属、出站地址校验和收件箱预检查。

- **没有依赖：** 只用 Web 标准接口（Web Crypto、`URL`、`TextEncoder`），同一份代码能跑在 Node.js 22 以上、Cloudflare Workers 和浏览器里。
- **不联网：** 所有函数都是纯计算，读写网络和存储由调用方负责。

## 模块

| 文件 | 内容 | 协议章节 |
|---|---|---|
| `src/canonicalize.js` | RFC 8785 规范化 JSON | 签名 |
| `src/ed25519.js`、`src/base64url.js` | Ed25519 签名和验签，严格的 base64url | 签名 |
| `src/sign.js` | 给活动签名、验证签名字节 | 签名 |
| `src/activity.js` | 活动外层字段和各类型的规则 | 活动与签名 |
| `src/documents.js` | 名片、动态、邻居列表、密钥日志 | 公开数据 |
| `src/keyhistory.js` | 首次信任、按日志顺序换钥、吊销、链分叉 | 首次信任与密钥历史 |
| `src/authorship.js` | 撤回和修改的归属、搬家后的迁移关系 | 撤回与修改的归属、搬家 |
| `src/outbound.js` | 出站地址、IP 段、重定向、请求头 | 出站请求 |
| `src/inbox.js` | 收件箱第 1 到 5 步 | 收件箱 |

## 两套实现互相校验

- **`schema/`：** JSON Schema（2020-12），格式结构的权威定义。
- **`src/`：** 协议核心，另外负责 Schema 表达不了的规则：同源、日历上是否存在这一天、签名、时间窗口。
- **`fixtures/cases.json`：** 共用的正例和反例。
  - `node --test` 用 JavaScript 检查；
  - `scripts/check_schemas.py` 用 Python 的 jsonschema 和 cryptography 再检查一遍，同时检查文档示例和签名向量。
- **`fixtures/addresses.json`：** 地址写法的共用用例。`check_schemas.py` 还会生成几千个地址，通过 `scripts/address-oracle.mjs` 交给 JavaScript 判断，要求和 Schema 的结果完全一致。

  标为 `schema` 层的反例两边都必须拒绝；标为 `rules` 层的，Schema 接受，协议核心必须拒绝。
- **`fixtures/vectors/signing.json`：** 签名向量，由 `scripts/make-examples.mjs` 生成。用的是公开的测试密钥（种子为 32 个 `0x11` 字节），不要用在真实的岛上。

## 运行

```bash
node --test                                    # 在仓库根目录
python3 packages/protocol/scripts/check_schemas.py   # 需要 jsonschema 和 cryptography
python3 scripts/check_docs.py
```

## 使用方必须自己做的事

这些不在协议核心里，但协议要求必须做到：

- **按序调用：** 收件箱先调用 `precheckDelivery()`，再用 `verifyActivity()` 验签，最后执行接收策略。只有接受后才记录 `id`。
- **首次信任：** 调用 `trustOnFirstUse()` 时，如果名片有 `links.keys`，要先读取密钥日志，通过 `validateKeyLog()` 后作为 `keyLog` 传入。这样才能锚定日志头，之后的同步才能发现改写。
- **保存密钥历史：** `KeyHistory` 是普通 JSON，原样存储。其中 `logHead` 包括 `id`、`index` 和累计摘要 `digest`，三项都要保存。
- **出站请求：**
  - 每次请求前调用 `checkOutboundUrl()`，每次重定向调用 `checkRedirect()`；
  - 自托管时，先解析域名、用 `checkResolvedAddresses()` 检查，再连接检查过的 IP；
  - 请求头一律用 `buildOutboundHeaders()` 从头构造，不复制收到的请求的请求头；发送前再用 `checkOutboundHeaders()` 检查。它只放行白名单里的五个请求头。
- **撤回：** 只在 `checkDelete()` 返回 `ok` 时写删除标记。
