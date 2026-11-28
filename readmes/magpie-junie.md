# magpie-junie

把 **JetBrains Junie** 接入 magpie 的供应商插件（`junie`）。

直连 Grazie 上游时，free tier 账号（`licenseType:NONE`）会被 403 拒绝；但 Junie CLI 内部的 `junie-lite` 通道可以正常回答。因此本插件提供两种模式：

- **桥接模式（推荐，free tier 可用）**：随附 `bridge-server.mjs` 启动一个本地 OpenAI 兼容服务。默认后端**直连 Ingrazzio 的 `/v1/responses`**（free 通道，模型 `gpt-6-luna`），`tools` 原样透传、上游原生返回 `tool_calls`——Codex、Claude Code 等 harness 的 function calling 能完整闭环（权限、审计、多轮都正常）。插件配 `bridgeUrl` 后把请求转给它。
- **CLI 后端（可选）**：`JUNIE_BACKEND=cli` 时桥接改为调用 CLI headless，由 CLI 自己执行搜索/改文件等工具，再把结果写进答案。适合"让模型独立跑完任务"，但 harness 侧的 tool 协议不会触发。
- **直连模式**：基于逆向项目 [fabienfleureau/junie-api](https://github.com/fabienfleureau/junie-api) 的上游抓包事实，直接请求 `ingrazzio-cloud-prod.labs.jb.gg` 的原生端点，需有效订阅 + 代理。

> ⚠️ **风险声明**：Junie/Grazie 是 JetBrains 商业订阅服务，本项目不受 JetBrains 支持，可能随时失效。过度自动化或脚本化使用可能违反 [JetBrains AI Service Terms](https://www.jetbrains.com/legal/docs/terms/jetbrains-ai-service/)。请只用于自己的订阅，并自行承担账号风险。

## 登录方式

按优先级提供三种（在 magpie 里给 `junie` 添加账号时选择）：

1. **从本机 Junie CLI 导入登录态**（推荐）——读取 `~/.junie/dpapi_credentials/*.dpapi`，用 Windows DPAPI 解密出 JetBrains OAuth token。本机装了 [Junie CLI](https://junie.jetbrains.com) 且登录过就可以直接用，不用浏览器。
2. **浏览器登录（JetBrains 账号）**——复刻 Junie CLI 的 PKCE 授权码流程，本地回调端口 62345–62364。
3. **API key (`perm-*`)**——从 https://junie.jetbrains.com/cli 获取，直接粘贴。

登录信息保存在 magpie 的 `plugin-auth.json`（权限 600），与 OpenCode auth.json 格式兼容。token 过期前由 magpie 的 `auth.refresh` 自动续期（提前 90 秒）。

## 模型与请求

| 模型 | 上游路径 |
|---|---|
| `claude-sonnet-4-6`、`claude-opus-4-6` | `POST /v1/messages`（Anthropic 原生直通） |
| `openai-gpt4.1`、`openai-gpt4.1-mini`、`openai-gpt-4o` | `POST /v1/chat/completions`（OpenAI 原生直通，profile id 映射到真实模型名） |
| `Qwen/Qwen3.6-27B-FP8` | `POST /llm/vllm/v1/chat/completions`（CLI 4100.11 实测） |
| `google-chat-gemini-pro-2.5`、`google-chat-gemini-flash-2.5` | 需在插件选项里设 `passthroughOnly: false`（Grazie 原生翻译，实验性） |

流式（SSE）与非流式都支持：上游响应原样透传。请求头带 Junie CLI 抓包得到的 `Grazie-Agent` 等固定字段；上游返回 477（免费 Google 档不可用）时自动去掉 `X-Free-Google-Api` 重试一次。

额度显示走 `GET /auth/test`：`plan` = licenseType、`balance` = balanceLeft + unit。上游不提供窗口百分比，所以用量窗口为空（不编造 `used: 0`）。账号无有效订阅时会显示 `NO_LICENSE` 提示。

## 安装

```sh
magpie plugin add magpie-junie
# 或开发时
magpie plugin add ./magpie-junie
```

## 重要：代理

Junie 上游对中国大陆 IP 直连返回 **403**，`/auth/test` 也一样。需要让插件的 fetch 走代理：

- Node 24 可用 `NODE_USE_ENV_PROXY=1`（读取 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量）。
- magpie 宿主（Bun）下请确认其代理设置对本插件生效；否则上游会返回 403 HTML。
- 本机调试时可用 `scripts/verify-cli-import.mjs` 验证凭据导入、`NODE_USE_ENV_PROXY=1 node scripts/verify-refresh-pkce.mjs` 验证续期。

## 开发

```sh
npm test          # node --test
bun test          # 双通道
node scripts/verify-cli-import.mjs   # 真机验证 CLI 登录态导入（不打印 token）
NODE_USE_ENV_PROXY=1 node scripts/verify-refresh-pkce.mjs  # 真机验证续期/PKCE URL
```

## 许可证

MIT — 本插件自身代码。Junie 与 JetBrains 是 JetBrains s.r.o. 的商标。

## 本地桥接服务（free 通道 + 原生工具调用）

直连 Grazie 上游会因 `licenseType:NONE` 被 403 拒绝；但 free 通道（模型 `gpt-6-luna`）带上正确的 license 头后可以直接调用，而且**原生支持 OpenAI function calling**。`bridge-server.mjs` 把它包装成本地 OpenAI 兼容服务：

```sh
node bridge-server.mjs                            # 默认 direct 后端，127.0.0.1:4141
JUNIE_BACKEND=cli node bridge-server.mjs          # 切回 CLI 后端（由 CLI 自己执行工具）
PORT=4142 JUNIE_TOKEN=... node bridge-server.mjs  # 指定端口 / 直接给 Bearer
```

direct 模式的链路：harness → magpie → 插件 `bridgeUrl` → 本服务 `POST /v1/chat/completions` → 转成 `POST https://ingrazzio-cloud-prod.labs.jb.gg/v1/responses` → 上游的 `function_call` 转回 `tool_calls`（流式按 SSE 事件增量转换）。

放行的两个关键头（反编译 `IngrazzioLicenseHeadersKt` / `JunieProjectKt` 实证，2026-11-28）：

| 头 | 值 | 说明 |
|---|---|---|
| `X-Forced-License-Free` | `2` | free license 协议版本号。写成 `true` 会被判旧客户端，返回 400 `UPDATE_REQUIRED` |
| `Grazie-Agent` | `junie:cli` + `<CLI 版本>:<CLI 版本>` | 版本过旧同样被 `UPDATE_REQUIRED` 拦。服务读 `~/.local/share/junie/current` 自动跟随本机 CLI 版本 |

认证：默认复用本机 Junie CLI 登录态（DPAPI 解密，过期自动 refresh）；Linux/服务器场景可用 `JUNIE_TOKEN` 直接给 Bearer。

接口：`GET /health`（含 backend / cliVersion）、`GET /v1/models`、`POST /v1/chat/completions`（流式与非流式，含 `tool_calls`）。

环境变量：`JUNIE_BACKEND`（direct | cli，默认 direct）、`JUNIE_DIRECT_MODEL`（上游 wire name，默认 `gpt-6-luna`）、`JUNIE_MODEL`（对外模型名，默认 `junie-lite`）、`PORT`、`HOST`、`JUNIE_TOKEN`、`JUNIE_UPSTREAM`、`JUNIE_TIMEOUT_MS`、`JUNIE_BIN`（CLI 后端用）。

**代理**：上游对中国大陆 IP 直连 403。Node 下启动服务时加 `NODE_USE_ENV_PROXY=1` 并设 `HTTPS_PROXY`；Bun 下自动走代理选项。

CLI 后端的前置条件：CLI 版本必须满足上游 free 模型门槛（26.11.3+）。技术要点：CLI 的 stdin 必须是真实文件（pipe 在 Windows 报 `java.io.IOException: 函数不正确`）；`.bat` 必须经 `cmd /c` 执行；stdout 混日志且中文 Windows 上是 GBK，需先累积 Buffer 再解码。

## CLI 版本维护

上游按 `Grazie-Agent` 的版本判定客户端新旧。direct 后端不依赖 CLI 运行，但会读本机 CLI 的当前版本（`~/.local/share/junie/current`）拼进请求头，所以 CLI 升级后桥接会自动跟上；没装 CLI 时用兜底版本号。

CLI 后端额外内置自动版本维护（无需 Windows 计划任务或外部调度）：

- 服务启动时后台检查一次；每次对话前也会检查（**6 小时节流**）。
- 发现新版本自动执行 `junie update` 并切换，同时清理上次中断留下的半成品下载文件。
- 状态写在 `~/.config/magpie/junie-update-check.json`，`/health` 可查看最近检查结果。

关闭自动更新：`JUNIE_AUTO_UPDATE=off node bridge-server.mjs`；改间隔：`JUNIE_UPDATE_INTERVAL_MS=3600000`（毫秒）。
