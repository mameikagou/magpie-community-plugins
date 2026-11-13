# magpie-comate-auth

给 magpie 加一个**文心快码（Baidu Comate）**provider：账号卡片（会员席位 / 增购 / 赠送积分）+ **15 个模型**（DeepSeek V4 系、GLM-5 系、Kimi K2.6、MiniMax M3、ERNIE 5.5…）。

## 为什么要单独一个插件

百度搭子的 Pro / Max 会员和文心快码**共用同一份会员权益**：在搭子那边下单买的会员，积分（席位积分，Pro 25,000 分/月、Max 100,000 分/月）落在 **comate.baidu.com** 的账号上，不在搭子自己的配额接口里。

所以只看 `magpie-dumate` 那张卡片，会看到「只有签到赠送积分、会员那 25,000 分不见了」。装上这个插件，同一份百度登录态就能把会员积分显示出来。

## 它做什么 / 不做什么

- 做 `auth`：复用 magpie 里已登录的百度账号（零操作），或浏览器粘贴 Cookie。
- 做 `usage`：读 `/api/user/agent/balance`，显示席位 / 增购 / 赠送 / 独立积分包。
- 做模型：插件自己在 `127.0.0.1:3427` 起一个 OpenAI 兼容口，直连 Comate 的 HTTP API（`/autowork/v2/execute`）。**没有独立服务进程**，端口随插件生死。
- 不改 magpie 的 provider 配置，只写一份用量缓存 `comate-usage-cache.json`（在 magpie 的 data 目录）。卸载干净：`magpie plugin rm magpie-comate-auth`。

## 安装

```bash
magpie plugin add github:ikashana/magpie-comate-auth
```

也可以 clone 到本地后 `magpie plugin add <本地目录>`（插件会被原地加载，不拷进 magpie 的 node_modules）。

模型通道**不依赖 CLI**，登录后即可用。`@comate/zulu` 现在只剩一个用途：`zulu list-model` 用来刷新模型 ID（服务端版本变了才需要）。

## 登录

三种方式，卡片右上角「登录」里任选：

1. **复用 magpie 里已登录的百度账号（零操作）** —— 只读 `<data>/plugin-auth.json` 里 `dumate`（或 `comate`）的 cookies，验证后直接建账号。已经在 magpie 里登录过百度搭子的话，选这个即可。
2. **百度账号浏览器登录（粘贴 Cookie）** —— 登录 `comate.baidu.com`，F12 → Network → 点任意 comate.baidu.com 请求 → 复制 Request Headers 的 `Cookie` 整行。关键 cookie `BDUSS` 是 httpOnly，`document.cookie` 拿不到，必须从 Network 面板复制。
3. **手动粘贴 Cookie 字符串** —— 同上，给已经手上有 cookie 串的场景。

## 显示内容

| 字段 | 含义 |
| --- | --- |
| `plan` | 会员等级从席位积分反推：`会员 · 席位 25,000 分/月`，后面附下期补满日期或最近到期日 |
| `balance` | 席位 + 增购 + 赠送 + 独立积分包 的**可用**合计 |
| `windows[]` | 每类积分一行（只列总额 > 0 的）：已用 / 总额 |
| `user` | 百度账号名 |

## 模型通道（15 个模型）

Comate 没有公开 API，但它的 IDE 插件走的是普通 HTTPS，这套接口可以直连：

```
GET  /api/key/valid/<license>                        验票
POST /api/aidevops/autocomate/rest/autowork/v2/conversation   → conversationId
POST /api/aidevops/autocomate/rest/autowork/v2/task           → taskId
POST /api/aidevops/autocomate/rest/autowork/v2/execute        → SSE（ANSWER.delta）
```

**认证只需要把 license 放进请求头**，没有签名、没有设备绑定、不用换 token：

```http
login-name: <license>
Uuap-login-name: <license>
X-Source: COMATE
plugin-version: zulucli-4.13.0
```

license 就是 `/api/user` 返回的那串 UUID，和额度卡片共用同一份 cookie。

```
magpie ──OpenAI 格式──▶ 127.0.0.1:3427（插件内）──▶ Comate HTTP API
```

`GET /v1/models` 与 `POST /v1/chat/completions`（含 SSE 流式）都支持。

**多轮**：`conversationId` 就是会话标识，续会话时只发最后一句增量，历史留在服务端。
认会话的优先级：

1. 客户端显式给的会话标识：`prompt_cache_key`，或 `x-session-id` / `x-conversation-id` / `x-thread-id` 头；
2. 没有就退回指纹：拿「上一轮自己返回的 assistant 文本」做 hash（客户端下一轮必然把它带回来）。

> 刻意**不用** OpenAI 的 `user` 字段当会话 key —— 它是用户身份，拿它当会话会把同一用户的不同对话串成一条。

其他实情：

- 单轮约 **1.4~2.8 秒**，1.5 万字长文约 **2 秒**（没有进程开销、没有命令行长度限制）。
- `modelKey` 是服务端的完整模型 ID（`<type>_<hash>`），随服务端版本变；对不上时重跑一次 `zulu list-model` 更新。
- `tool_call: false`：接口只暴露 Ask（纯问答），agent 能力不映射成 OpenAI tools 协议。
- 会话映射存在内存里（最多 300 条，LRU），magpie 重启后旧会话接不上，会当新会话处理。
- **图片**：暂未接入（`contexts` 字段的图片格式未验证），视觉模型目前按纯文本处理。

> 早期版本走的是官方 CLI `@comate/zulu`（`zulu run --mode Ask`），每轮 spawn 一个进程，
> 慢 4~11 秒，还受 Windows 32k 命令行上限和附件语义困扰。2026-11 换成上面的直连实现后这些问题都没有了。

## 接口（实测）

```
GET https://comate.baidu.com/api/user
GET https://comate.baidu.com/api/user/agent/balance
GET https://comate.baidu.com/api/user/agent/addon/detail
GET https://comate.baidu.com/api/user/agent/gift/detail
```

`balance` 返回：

```json
{
  "seatPoints":            { "totalPoints": 25000, "usedPoints": 0,      "availablePoints": 25000 },
  "addonPoints":           { "totalPoints": 0,     "usedPoints": 0,      "availablePoints": 0 },
  "giftPoints":            { "totalPoints": 500,   "usedPoints": 472.13, "availablePoints": 27.87 },
  "seatPointsNextUpdate":  "2026-12-13 00:25:57"
}
```

## 踩过的坑

- **不能带 `bce-*` cookie。** 从百度搭子（`console.bce.baidu.com`）复用的登录态里有一堆 `bce-sessionid`、`bce-passport-stoken` 等百度智能云控制台的会话 cookie；带着它们访问 `comate.baidu.com`，服务端会走 BCE 鉴权路径并直接返回 `{"status":"UNAUTHORIZED","message":"没有授权!"}`。`buildCookieHeader` 里把它们剔掉即可（`x-bce-login-redirect-url` 这几个要留着）。
- **别保存服务端下发的 `SESSION`。** 无 SESSION 请求 `balance` 会成功并 `Set-Cookie: SESSION`，但**带着这个 SESSION 再请求反而变成 `没有授权!`**。所以插件不维护 cookie jar、不写回任何 cookie，每次都用登录时那份快照。
- **连打会被限流。** 同一个登录态短时间内发好几次请求，之后会连续返回 `没有授权!`（几分钟到十几分钟自己恢复）。插件因此：只打 `balance` 一个接口、不重试、结果缓存 10 分钟、失败时回落到上次的数据。别把它当故障去疯狂刷新。
- **`/api/user` 比 `balance` 更容易被拒。** 拿账号名只在登录时试一次，拿不到就退回 `balance` 判断登录态；卡片上的用户名用登录时存下的。
- **插件可能被原地加载。** `magpie plugin add <路径>` 不会把插件拷进 `data/plugins/node_modules`，所以 `import.meta.url` 相对定位找不到 `plugin-auth.json`。要按 `MAGPIE_DATA` → `process.execPath`（magpie.exe 同级 `data/`）→ 插件自身位置 → `cwd` 依次找。
- **`/api/user/agent/balance` 才是积分本体。** 个人中心页面上那几个数字是从这个接口来的；`/api/user/score/balance`、`/api/user/vip` 一类路径不存在（404）。
- Cookie 必须按域名过滤到 `.baidu.com`，passport 的 `BDUSS` 是 httpOnly。
- 日期直接按接口原串（`2026-12-13 00:25:57`）显示，别经 `Date` 转 ISO —— 会掉到 UTC 前一天。

## 许可

MIT