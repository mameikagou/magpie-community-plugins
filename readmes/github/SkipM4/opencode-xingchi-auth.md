# XingChi 中转 · 自动换会话插件

把「有会话请求次数上限」的中转站（如 XingChi，每会话 100 次请求）接入
[magpie](https://usemagpie.ai)，并**自动新开会话**：命中上限错误时插件立刻
换一个会话标识、自动重试，agent 与你全程无感，上下文也不丢——因为换会话
只发生在插件与中转站之间，agent 那边的对话原样保留。

也可以当成任何 OpenAI 兼容 / Anthropic 兼容中转站的通用接入插件使用
（不想自动换会话时把 `retries` 设为 0 即可，其余功能照常）。

## 解决什么问题

中转站返回：

```json
{"error":{"code":"session_request_limit_exceeded",
  "message":"XingChi: 当前会话已达到 100 次请求上限，请新开一个会话后继续……"}}
```

手动新开会话麻烦，而且 agent 的上下文清零。本插件在供应商一侧替你「新开」：

1. **主动轮换**：一个会话发到 `maxRequests`（默认 80）次之前就主动换新会话
   标识，尽量不触发上限；
2. **被动自愈**：万一还是命中（不同中转站计数规则不同），立即换会话标识并
   重试同一请求，最多 `retries` 次；仍失败才把原错误交回；
3. **三重覆盖**：轮换 `session_id` / `x-session-id` 请求头、改写 Anthropic
   `metadata.user_id` 的会话段、并在请求体里注入 `[magpie-session:<id>]`
   标记（命中一次后自动启用），无论中转站按哪种方式识别「会话」都有效。

> 原理：中转站判断「新会话」的依据是请求特征（会话头 / metadata /
> 对话前缀哈希），而不是你客户端里那条对话。把这些特征换掉，中转站就会
> 开一个新会话；而 agent 发给 magpie 的对话一个字都不用动。

## 安装（文件夹就地加载）

```sh
magpie plugin add ./opencode-xingchi-auth
magpie plugin login xingchi     # 填 API key、API 地址（如 https://xx.example.com/v1）、可选模型列表
magpie plugin                   # 应显示 xingchi (XingChi 中转)  signed in
magpie provider test xingchi    # 发一个最小请求验证连通
```

agent 里用 `xingchi/<model>` 选择模型，例如 `xingchi/claude-sonnet-4-5`。
应用里则是：插件 → 添加插件 → 填路径 → 在该供应商行登录。

## 选项（magpie plugin options xingchi '<json>')

```jsonc
{
  "format": "openai",     // 中转站的 API 格式：openai（chat completions）/ responses / anthropic
  "models": ["claude-sonnet-4-5"],  // 模型列表，逗号分隔；留空自动拉 /models
  "maxRequests": 80,      // 主动轮换阈值（留出安全余量，别填 100）
  "retries": 3,           // 命中上限后自动重试次数（0 = 关闭自动换会话）
  "retryDelayMs": 300,    // 重试前等待
  "mark": "none",         // 会话标记注入：none / system / first-user / both（命中一次后自动升为 both）
  "rotateMetadata": true, // 是否改写 Anthropic metadata.user_id 的会话段
  "sessionHeaders": ["session_id", "x-session-id"], // 轮换哪些会话头
  "contextLimit": 200000, "outputLimit": 32000      // 模型窗口（拉不到 /models 时的兜底）
}
```

改完从下一个请求起生效，无需重启。

## 常见问题

- **还是偶尔报上限错误**：把 `maxRequests` 调小（比如 50）看看——说明该站
  计数口径比预期严；再确认 `format` 是否与该站一致。
- **模型列表为空**：登录时把模型列表填上，或用 `magpie plugin options
  xingchi '{"models": "..."}'` 设置；该站不支持 `/models` 时只能手动给。
- **用量卡片**：供应商/`magpie quota` 里会显示会话数、请求数与自动换会话
  次数。
- **隐私**：所有处理都在插件宿主本地完成，只与你填的中转站通信。

## 测试

```sh
cd opencode-xingchi-auth && node --test test.mjs   # 或 bun test
```
