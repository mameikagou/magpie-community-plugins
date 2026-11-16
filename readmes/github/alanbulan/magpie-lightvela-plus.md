# magpie-lightvela-plus

在 OpenCode 或 magpie 里登录 **LightVela** 账号，直接用它那个 OpenAI 兼容端点，
带套餐积分显示和每日自动打卡。**国内版和国际版在一个插件里**，登录时按你的
账号选入口即可：

| 版本 | 站点 | 登录方式 |
|---|---|---|
| 国内版 | `lightvela.com` | 手机号短信验证码，或粘贴会话 token |
| 国际版 | `lightvela.ai` | 网页 Google 登录后粘贴会话 token（`lc_session`） |

> 本插件合并自社区插件 [ikashana/magpie-lightvela](https://github.com/ikashana/magpie-lightvela)
> （国内版，MIT 许可）：国内版的短信登录、读 key、用量与打卡逻辑直接沿用原版实现，
> 国际版适配（端点、Google 登录后的 token 登录、token + key 兜底登录）在此基础上合并进来。

LightVela 给每个账号配一个 OpenAI 兼容的模型端点，凭证放在账号名下实例的
`~/.hermes/.env` 里。这个插件把它读出来交给 magpie，省掉「云存储 → Agent
数据 → 显示隐藏文件 → 下载 .env → 找 key」那一串手工操作。

## 它到底在做什么

| 项 | 国内版 | 国际版 |
|---|---|---|
| 端点 | `https://token.lightvela.com/v1` | `https://token.lightvela.ai/v1` |
| 认证 | `Authorization: Bearer <CUSTOM_API_KEY>` | 同左 |
| key 位置 | 实例里的 `~/.hermes/.env` 的 `CUSTOM_API_KEY` | 同左 |
| 模型 | 以 `/v1/models` 实时返回为准 | 同左 |

插件只做两步：

1. 用你的 LightVela 会话（短信验证码换来的会话，或你粘进来的 `lc_session`）确认账号；
2. 用这个会话在你自己的实例上执行一段只读命令，把 `CUSTOM_API_KEY` 那一行读出来。

key 不出这台电脑，不经过任何第三方，也不写进日志。

## 安装

在 magpie 的插件页「添加插件」里填：

```
github:alanbulan/magpie-lightvela-plus
```

或选择本地目录安装。装好后在 magpie 的 Providers 面板里找到
**LightVela（国内+国际）**（provider id `lightvela-plus`）。
同一个插件里可以同时登录多个账号（国内、国际、小号都行），互不干扰。

## 登录

`magpie plugin login lightvela-plus`，或者界面里 Providers › LightVela（国内+国际）。
一共五种登录方式，按账号版本选：

### 国内版

1. **手机验证码（推荐）**：插件起一个只监听 `127.0.0.1` 的页面，输入手机号、
   收短信验证码，登录成功后插件自动读 key。
2. **粘贴已有会话 token**：把浏览器里 `api.lightvela.com` 的 `lc_session` 值粘进来。

### 国际版

国际版只有 Google 登录、没有手机短信，所以都是先在网页登录、再粘贴会话 token：

1. **说明页粘贴（推荐）**：插件起一个只监听 `127.0.0.1` 的页面，上面有图文步骤：
   打开 `lightvela.ai` 用 Google 登录 → F12 → 应用（Application）→ Cookie →
   `https://api.lightvela.ai` → 复制 `lc_session` 的值粘进来。
2. **直接粘贴**：在 magpie 的输入框里直接粘 `lc_session`。
3. **粘贴 token + API key（兜底）**：当平台读实例的通道不可用时（见注意事项），
   把 `lc_session` 和实例 `.env` 里的 `CUSTOM_API_KEY` 一起粘进来，跳过读取步骤。

登录成功后插件会当场用这把 key 拉一次模型列表验证可用，拉不到会直接报错，
不会等配好了才发现。

## 登录之后

- **模型**：以账号 `/v1/models` 的实时返回为准（平台内部的 `ep-*` 端点和
  `llmgw-mock-chat` 这类假模型会被过滤掉）。
- **用量卡片**：套餐名、积分余额/总量、到期日，数据来自 `/v1/passes`，缓存 5 分钟。
- **每日打卡**：magpie 每天自动跑一次——当天还没活跃就发一条最短的模型调用
  把活跃点着（成本约 20 token），并顺手查询活跃续期奖励、够格就自动领取
  （奖励为免费续期 1 个月）。
- 会话 token 过期只影响用量卡片和打卡，key 本身仍可用于推理；重新登录一次即可恢复。

## 注意事项

- 国际版平台的实例执行通道（`debug/exec`）出现过整段不可用的情况（返回 502），
  此时国际版的「读 key」类登录会失败，用上面的兜底方式 3（token + key）登录即可；
  平台恢复后其余方式自动可用。国内版不受此问题影响的记录暂无，原理相同。
- 模型 `auto` 与实例自带的在线助手共用平台限流（约 60 RPM），高频调用时
  偶尔返回 429，属平台配额，不是插件故障。
- 本插件是第三方社区插件，与 LightVela 官方无关。

## 卸载

`magpie plugin rm lightvela-plus`，或在插件页移除。它只删自己，
magpie 的其它 provider 与配置一概不动。

## 许可

MIT。国内版原作 © ikashana，见 [LICENSE](./LICENSE)。

---

# English

Sign in to a LightVela account — **China edition** (`lightvela.com`, phone + SMS
code) or **international edition** (`lightvela.ai`, paste the `lc_session`
session token after signing in with Google) — and use its OpenAI-compatible
endpoint from OpenCode or magpie. The plugin reads the account's
`CUSTOM_API_KEY` from its instance (`~/.hermes/.env`) via a read-only command,
verifies it against `/v1/models`, and hands it to magpie as a normal provider.
Plan credits/expiry show on the usage card, and a daily check-in keeps the
account active and auto-claims the activity renewal reward when eligible.
Merged from the community plugin
[ikashana/magpie-lightvela](https://github.com/ikashana/magpie-lightvela) (MIT)
with an international-edition adaptation. Not affiliated with LightVela.
