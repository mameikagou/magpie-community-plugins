# Responses 跨资源修复

Magpie 网关中间件插件，用于缓解 OpenAI Responses API 的跨资源错误。

```text
The requested item was created under a different Azure OpenAI resource.
Use the same resource that created the item to access it.
```

默认处理实际路由到 `agentrouter` 供应商的 Responses 请求，运行在 Magpie 自身的 JavaScript 中间件引擎中。

```text
Codex 等客户端 → Magpie → 本插件清理历史请求 → AgentRouter
```

## 安装

在 Magpie 的「插件 → 添加插件」中填写仓库地址，或运行以下命令。

```sh
magpie plugin add github:JinPen-G/magpie-responses-shim
```

本地开发时可以直接加载仓库目录。

```sh
git clone https://github.com/JinPen-G/magpie-responses-shim.git
magpie plugin add ./magpie-responses-shim
```

客户端连接 Magpie 的网关地址。默认 OpenAI Base URL 为 `http://127.0.0.1:3425/v1`，实际端口以 Magpie 设置为准。插件随 Magpie 运行，对每次符合条件的请求执行清理。

从独立修复代理迁移时，先确认插件已加载，再把客户端 Base URL 指向 Magpie，重新加载客户端配置。在原报错聊天验证恢复后，停止旧的独立代理。

## 处理规则

- 移除历史 `reasoning` 项及其中的密文和资源 ID。
- 对内容完整的 `message`、`function_call`、`function_call_output`、`custom_tool_call`、`custom_tool_call_output`，移除可省略的顶层 `id`。
- 对包含完整 `tools` 定义的 `additional_tools`，移除顶层 `id`。
- 保留消息正文、图片、消息 `phase`、工具定义、调用参数、结果及 `call_id` 配对。
- 保留纯 ID 引用、加密压缩历史、托管工具和未知类型，交由原协议继续处理。

插件使用 `onProvider`，按 `ctx.provider.id` 匹配实际供应商。路由组和故障切换也遵循这个范围，每次供应商尝试都从 Magpie 提供的原请求开始。

## 选项

在「插件 → 已安装 → 选项」中编辑以下 JSON。

```json
{
  "providers": ["agentrouter"],
  "log": false
}
```

| 选项 | 含义 |
| --- | --- |
| `providers` | 要处理的供应商 ID，默认 `agentrouter`。可填写多个准确 ID，空数组暂停全部处理。 |
| `log` | 为 `true` 时记录移除项数量和未解决的资源状态数量，默认关闭。日志内容仅含计数。 |

`magpie.options` 给出编辑器示例，代码也实现了相同默认值。供应商经过改名时，使用 Magpie 中当前的实际 ID。

## 使用限制

移除 `reasoning` 会失去隐藏推理续接状态，可能影响表现和缓存命中。

`previous_response_id`、`conversation`、`item_reference`、加密 `compaction` 等状态仍可能绑定原资源。依赖这些状态的聊天，需要回到原资源，或先恢复完整可重放历史。文件引用和托管工具也可能存在单独的资源限制。

中间件接收客户端的原始协议。本插件处理 `responses` 输入，作用范围还取决于请求是否经过 Magpie 的 `onProvider`。Magpie 自身的会话标题、路由分类器、代搜和图片描述采用各自的内部请求路径。

Magpie 为一次 `onProvider` 调用设置 250 毫秒限时。加载失败、异常或超时会记录在插件状态中，该次请求按宿主规则继续发送。可在插件页面查看加载错误、调用数和失败数。

## 验证

开发验证使用 Node.js 22.15 或更新版本。

```sh
npm test
```

本机宿主验证脚本目前适用于 Windows。

```powershell
npm run test:magpie -- "C:\path\to\magpie.exe"
```

`npm test` 检查清理边界、供应商范围及历史内容保留。`test:magpie` 在独立配置目录启动本机 Magpie，用本地模拟上游检查插件加载、请求转发与 SSE，结束后删除测试目录并退出测试进程。

初版已在 Windows 的 Magpie 0.1.3078 验证加载及本地模拟转发。真实 AgentRouter 和原报错聊天的插件接入验证仍待完成。

临时环境统一位于本仓库 `output/.tmp/magpie-verification`。测试成功和失败均执行退出清理。

## GitHub 分发

`package.json` 位于仓库根目录，通过 `magpie.middleware` 指向已提交的运行文件。源码可直接加载，运行时只使用标准 JavaScript 和插件内的相对导入。

为仓库添加 `magpie-plugin` topic 后，Magpie 可以在「发现 → 非官方插件 · GitHub」中检索它，出现时间取决于 GitHub 索引和 Magpie 缓存。

入口和选项按 Magpie 插件手册实现。[官方插件手册](https://usemagpie.ai/docs/zh/plugins#middleware)

## 来源与许可证

清理器基于 `agentrouter-responses-shim` 2.0.1 的 MIT 实现，包含完整 `additional_tools` 项的 ID 清理补丁。来源与原许可证见 [第三方声明](THIRD_PARTY_NOTICES.md)，本项目采用 [MIT License](LICENSE)。
