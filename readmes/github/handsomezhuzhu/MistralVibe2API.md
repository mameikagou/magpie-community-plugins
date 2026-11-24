# MistralVibe2API

把你的 **Mistral Vibe API key** 变成一个任何第三方 agent 都能用的供应商：一个反代，把请求伪装成官方 Vibe CLI 发出的样子转发给 Mistral。

可以当 **magpie / OpenCode 插件**用（推荐），也可以当**独立反代服务器**用（OpenAI 兼容 + Anthropic 兼容）。

> **背景**：Mistral 通知自 2026-12-01 起，通过非 Mistral 产品（第三方编程工具 / harness）使用 Vibe key 的用量将计入每月的免费 API 额度，而不再计入 Vibe 额度。本项目的思路是：让请求在 Mistral 侧看起来就是官方 Vibe CLI 发出来的。

---

## 调研结论：Vibe CLI 是如何发起请求的

以下全部读自官方开源仓库 [mistralai/mistral-vibe](https://github.com/mistralai/mistral-vibe)（v3.1.5）及其依赖的 SDK：

### 端点与认证

| 项目 | 值 |
| --- | --- |
| 推理端点 | `POST https://api.mistral.ai/v1/chat/completions`（OpenAI 兼容，流式 `stream: true`） |
| 认证头 | `Authorization: Bearer <Vibe API key>` |
| key 的来源 | `chat.mistral.ai/code/extensions`（Console → Code → Vibe CLI），类型为 **Vibe**，与 Studio key 分开管理、单独计量 |
| 其他地址 | `https://console.mistral.ai/api/vibe/whoami`（返回租户的 `vibe_base` / `api_base`）、`https://chat.mistral.ai/api/v1/code/managed-config`（企业管控配置） |

代码依据：

- `vibe/core/config/_defaults.py`：`DEFAULT_MISTRAL_API_BASE = "https://api.mistral.ai/v1"`、`DEFAULT_VIBE_BASE_URL = "https://chat.mistral.ai"`
- `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/adapters/mistral.py`：`execute_mistral_completion()` 用官方 `mistralai` SDK 的 `client.chat.stream_async(...)` 发请求，`server_url` 由 `api_base` 推导
- `pyproject.toml`：CLI 固定依赖 `mistralai==3.5.0`

### 请求长什么样

CLI 实际发出的请求（抓包等价物）：

```http
POST https://api.mistral.ai/v1/chat/completions
Authorization: Bearer <Vibe key>
User-Agent: speakeasy-sdk/python 3.5.0 2.935.1 1.0.0 mistralai
Content-Type: application/json
Accept: text/event-stream        # 流式时
```

```json
{
  "model": "mistral-medium-latest",
  "messages": [{"role": "user", "content": "..."}],
  "temperature": 0.2,
  "max_tokens": 4096,
  "tools": [{"type": "function", "function": {"name": "...", "parameters": {...}}}],
  "parallel_tool_calls": true,
  "reasoning_effort": "medium",
  "stream": true
}
```

要点：

- **User-Agent 是 `mistralai` Python SDK（Speakeasy 生成）的 UA**：`speakeasy-sdk/python 3.5.0 2.935.1 1.0.0 mistralai`（版本号随 SDK 升级，见 `mistralai/client/_version.py`）。除此之外 SDK 不发任何自定义头。
- 请求体就是标准 OpenAI chat completions；`reasoning_effort` 只对会推理的模型发；Mistral 拒绝 greedy sampling 带 `top_p`，所以 CLI 有温度时才带 `top_p`。
- 响应是标准 OpenAI SSE（`choices[0].delta.content` 可能是字符串，也可能是 `[{type:"text"}]` / `[{type:"thinking"}]` 分片数组；usage 在最后一个 chunk）。

### CLI 实际请求的模型名：`mistral-vibe-cli-*`

用真实 Vibe key 实测 `/v1/models` 和 `/v1/model-catalog?surface=vibe-code`（CLI 自己读这个目录）发现：

| 线报模型名 | 实际身份 |
| --- | --- |
| `mistral-vibe-cli-latest` | harness `LocalModelRoute` 的默认模型，即 Mistral Medium 3.5（`mistral-medium-latest` 的别名） |
| `mistral-vibe-cli-with-tools` | 联网搜索等 utility 调用的默认模型 |
| `mistral-vibe-cli-fast` | 快速 utility 模型（标题生成等） |

模型目录原文（节选）：`{"id":"mistral-medium-latest","label":"Mistral Medium 3.5","aliases":["mistral-medium","mistral-medium-3.5","mistral-vibe-cli-latest"],"max_context_length":262144,...}`。

**这很可能是计量归属的真正开关**：Mistral 的 Vibe 表面按模型名路由（目录里还有 `zai-glm-5-3-flash-vibe-free` 这种 Vibe 专属变体），所以代理默认优先使用 `mistral-vibe-cli-*` 系列名字，其次才是通用模型名。

### Vibe 表面目录全貌（实测 6 条）

`GET /v1/model-catalog?surface=vibe-code` 只返回 Vibe 表面可用的模型（对比 `/v1/models` 的 63 个通用模型）：

| id | 名称 | 上下文 | 备注 |
| --- | --- | --- | --- |
| `mistral-large-4-0` | Mistral Large 4 | 1M | 目录标记 recommended |
| `mistral-medium-latest` | Mistral Medium 3.5 | 256K | 别名含 `mistral-vibe-cli-latest` |
| `zai-glm-5-3` | GLM 5.3 | 1M | 无视觉 |
| `zai-glm-5-3-flash` | GLM 5.3 Flash | 1M | |
| `zai-glm-5-3-flash-vibe-free` | GLM 5.3 Flash（免套餐变体） | 256K | **不是"免费不计费"**，见下 |
| `deepseek-v4-1-flash-1017` | DeepSeek V4.1 Flash | 1M | |

**关于 `-vibe-free` 的实测结论**：它与普通版 `zai-glm-5-3-flash` 的响应头、usage、限流逐字段一致，目录条里也没有任何 pricing/free 字段，而 GLM 5.3 Flash 在 API 定价页明码标价（$0.15/M in、$0.5/M out）。它的上下文被砍到 256K、aliases 挂着普通版 id——形态上是"免费套餐用户的降配路由"，**不是不消耗额度的白嫖通道**。

### Mistral 靠什么区分"Vibe 用量"和"API 用量"

公开信息拼出来的一致结论：

- Mistral 帮工单明确说 *"the Vibe API key is handled differently than the others as we want to provide higher token and rate limit for using the Vibe CLI"*——Vibe key 是单独的类型。
- 付费套餐Console 有两条额度：**Included API usage**（约 $30/月）和 **Included Vibe Code usage**（约 $300/月），每月 1 日 UTC 重置；Enterprise 的 Admin usage API 里 `vibe_usage` 与 `chat`/`completion` 也是分开的项。
- 2026-12-01 起的邮件说明：**按请求来源**分流——非 Mistral 产品发来的用量记到 API 额度。

因此本项目的策略是让转发请求在协议层面与 Vibe CLI 完全一致：

1. 同一个端点 `https://api.mistral.ai/v1/chat/completions`；
2. 同一个 Vibe key（Bearer）；
3. 同一个 User-Agent（`speakeasy-sdk/python 3.5.0 …`，可用环境变量/插件选项覆盖，SDK 升级时跟着改）；
4. **优先使用 Vibe 表面的模型名**（`mistral-vibe-cli-latest` 等），这是 CLI 真正发上去的线报名；
5. **只透传 `content-type` 和 `accept`**，其余客户端头全部剥掉（`user-agent`、`x-stainless-*`、`x-title`、`origin`、`referer`、`anthropic-*`、`x-api-key`、cookie……）， Mistral 看不到前端是哪个 harness。

实测补充（2026-11，真实 Vibe key）：

- 三种组合（Vibe UA + vibe-cli 模型 / Claude UA + vibe-cli 模型 / 无 UA + 通用模型）都返回 200，限流头一致（1M tokens/min、2000 req/min，即 Vibe 套餐级限额，跟着 key 走）；
- `console.mistral.ai/api/vibe/whoami` 用该 key 可查（返回 `plan_type`、`api_base`、`vibe_base`）；其余用量端点（`/api/vibe/usage` 等）是 dashboard 会话鉴权，API key 拿不到——所以插件的 usage 钩子默认不查；
- 代理全链路（OpenAI 流式、Anthropic `/v1/messages`、`mistral-vibe-cli-latest` 模型）实测通过。

---

## 方案一：magpie / OpenCode 插件（推荐）

插件把 Vibe key 注册成一个供应商，magpie 网关负责协议转换（Anthropic / Responses / Chat 互转）、多账号、故障切换，插件的 `fetch` 负责把请求改成 Vibe CLI 的指纹后转发。

```bash
# 从 git 仓库安装（推荐，任何人可用）
magpie plugin add github:handsomezhuzhu/MistralVibe2API

# 或本地目录就地加载（不改动任何文件）
magpie plugin add /path/to/MistralVibe2API

# 登录：粘贴你的 Vibe key
magpie plugin login mistral-vibe

# 验证
magpie plugin
magpie provider test mistral-vibe
```

之后所有 agent 都可以用 `mistral-vibe/mistral-vibe-cli-latest` 这样的模型 id。

> 首次添加插件时 magpie 会自动下载 Bun 运行时（约 110MB），之后所有插件都跑在它上面。

插件选项（`magpie plugin options mistral-vibe '<json>'`）：

| 选项 | 说明 |
| --- | --- |
| `upstreamBase` | 覆盖上游，默认 `https://api.mistral.ai/v1`（区域端点如 `https://api.eu.mistral.ai/v1`） |
| `userAgent` | 覆盖伪装的 User-Agent |
| `extraHeaders` | 额外上游头，如 `{"origin": "https://chat.mistral.ai"}` |
| `usageUrl` | 可选用量查询地址，返回 `{plan, used, limit}`；Mistral 没有公开的按 key 用量 API，默认不查 |

模型列表：插件启动时带一份静态目录（优先 `mistral-vibe-cli-latest` 等 Vibe 线报名，另有 `mistral-medium/large/small-latest`、`mistral-large-4-0`、`codestral-latest`、`magistral-*`、`ministral-*`、`pixtral-large-latest`、`zai-glm-5-3`、`deepseek-v4-1-flash-1017` 等），登录后先向上游 `/v1/model-catalog?surface=vibe-code`（CLI 同款目录）合并账号实际可用的模型，失败再退 `/v1/models`，再失败用静态目录。

## 方案二：独立反代服务器

零依赖（Node ≥ 18），同时讲 **OpenAI** 和 **Anthropic** 两种协议：

```bash
MISTRAL_API_KEY=你的Vibekey node src/server.mjs
# 默认监听 http://127.0.0.1:8317
```

路由：

| 路由 | 用途 |
| --- | --- |
| `POST /v1/chat/completions` | OpenAI 兼容，流式原样透传 |
| `POST /v1/messages` | Anthropic 兼容（Claude Code 用），自动转成 chat completions 再转回 Anthropic SSE |
| `POST /v1/messages/count_tokens` | 本地估算，不打扰上游 |
| `GET /v1/models` | 透传上游列表，失败时回退静态目录 |
| `GET /health` | 健康检查 |

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` / `HOST` | `8317` / `127.0.0.1` | 监听地址 |
| `MISTRAL_API_KEY`（或 `VIBE_API_KEY`） | 无 | Vibe key；不配则要求客户端自带 key |
| `ALLOW_CLIENT_KEY` | 关 | 置 `1` 时优先用客户端自己的 Bearer token（多租户） |
| `MISTRAL_UPSTREAM_BASE` | `https://api.mistral.ai/v1` | 上游地址 |
| `VIBE_USER_AGENT` | `speakeasy-sdk/python 3.5.0 2.935.1 1.0.0 mistralai` | 伪装的 UA |
| `VIBE_EXTRA_HEADERS` | 无 | JSON，额外上游头 |
| `MODEL_MAP` | 无 | JSON，模型别名，如 `{"fast":"mistral-small-latest"}` |
| `QUIET` | 关 | 置 `1` 关闭请求日志 |

### 接到各种 agent

**Claude Code**（Anthropic 协议）：

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8317
export ANTHROPIC_AUTH_TOKEN=任意占位符        # 真实 key 在代理侧
export ANTHROPIC_MODEL=claude-sonnet-4-5      # 或用 MODEL_MAP 映射到 Mistral 模型
claude
```

**Codex / 其他 OpenAI 兼容 agent**：

```bash
export OPENAI_BASE_URL=http://127.0.0.1:8317/v1
export OPENAI_API_KEY=任意占位符
```

**magpie 网关**（远程/集中出口）：在 magpie 里加一个 `@ai-sdk/openai-compatible` 供应商指向 `http://127.0.0.1:8317/v1` 即可，或者直接用上面的插件。

---

## 测试

```bash
node --test        # 44 个用例：头改写、Anthropic 转换、SSE 编解码、端到端（mock 上游）
```

覆盖的关键行为：

- 转发请求只带 `content-type`/`accept` + Vibe key + 官方 UA，客户端身份头全部剥除；
- 流式 / 非流式透传，上游错误（401/429…）原样返回；
- Anthropic ⇄ OpenAI 双向转换：文本、图片、`tool_use`/`tool_result`、`thinking` 块、usage、`stop_reason` 映射；
- 插件各钩子（config / auth.loader / provider.models / usage）的形态与行为。

## 风险与限制

- **这是指纹伪装，不是官方通道。** Mistral 随时可以改判定逻辑（比如要求 SDK 签名、TLS 指纹、额外的 vibe 专属头）。UA 可配置就是为了跟随官方 SDK 版本变化；如果失效，先检查 `mistralai` SDK 的 `_version.py` 更新 `VIBE_USER_AGENT`。
- Vibe key 的额度、限流由 Mistral 侧控制；超出套餐后表现（PAYG 或停用）取决于你自己的账单设置。
- 反代看得见全部流量，只建议跑在本地或你信任的机器上；不要把代理端口暴露到公网。
- 本项目与 Mistral 无关联，使用请自行评估是否违反其服务条款。

## 开发

```
index.mjs          magpie/OpenCode 插件入口（provider + auth + loader fetch）
src/core.mjs       上游指纹逻辑（头改写、key 解析、模型目录、配置）
src/anthropic.mjs  Anthropic ⇄ OpenAI 协议转换 + SSE 编解码
src/server.mjs     独立反代服务器
test/              node:test 用例
```
