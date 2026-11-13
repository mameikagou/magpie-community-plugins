# Magpie T3 飞书桥（实验版）

把 **飞书机器人私聊 → 已有 T3 Code 线程 → 文字回复** 接起来。复用 Magpie 已登录的 T3 MCP，不修改 T3、不拷贝 OAuth token、不需要公网回调服务器。

> v0.1 是可安装试验版，自动化测试通过，但尚未用真实飞书应用、T3 账号和 Magpie 桌面完成端到端联调。微信等其他平台不在本版支持范围。

## 安装与启动

1. 在 Magpie 插件市场搜索本仓库（GitHub topic `magpie-plugin`），或在插件安装界面输入本仓库 GitHub 地址。没有发布 npm 包，不要安装同名第三方包。
2. 打开插件页面，点击 **创建本地控制密钥**。Magpie 会重启插件宿主；关闭并重新打开插件页面，再点 **打开设置**。
3. Magpie 中先连接并完成 T3 MCP OAuth 登录。填入其**实际服务器名称**，不是 T3 Connect URL。本插件通过 `http://MAGPIE_ADDR/mcp/<server-name>` 代理调用。
4. 创建飞书自建应用并启用机器人；事件订阅选择 **长连接**，添加 `im.message.receive_v1`。开通 `im:message.p2p_msg:readonly`、`im:message:send_as_bot`，发布应用版本并确保本人可用。填写 App ID 和 App Secret。
5. 添加绑定：`ou_你的open_id,T3线程ID`，远程关联环境可加第三列 environment ID。每位白名单用户必须绑定独立线程；不自动创建线程、不从聊天指令更换线程。
6. 勾选启用并保存。在状态中确认 `channelConnection` 已连接，再给机器人发一条私聊文字。回复是**轮次结束后分段发送**，不是逐 token 流式。

默认本地服务端口 18991。如冲突，在 Magpie 插件 Options 中修改 `port` 并重新打开页面。Magpie 页面服务代理用于浏览器模式；桌面页面回退到本机 loopback。远程桌面/Docker 的跨机器页面访问未测试。

## 权限和安全边界

- 默认关闭；没有白名单不能启用。只接收私聊文字、明确 user sender；拒绝群聊、机器人消息、附件与超长输入。
- 白名单用户的文字会交给 T3 执行，具有该 T3 线程允许的能力。**只绑定可信本人账户与专用线程**，不要把不可信群消息中转进去。
- 不批准权限弹窗、不代答执行许可、不提供任意 MCP 工具调用；审批、错误细节和完整长回复回 T3 查看。
- 本机控制服务仅绑定 `127.0.0.1`；所有配置和状态 API 必须有随机 Bearer token。页面使用 URL fragment 传入后清除，不放 query，也不使用 Cookie。不要分享这个控制密钥。
- App Secret 只提交本机后端，状态 API 不回显。配置/队列文件位于 `${MAGPIE_CONFIG_DIR}/t3-feishu-private`，未设置时 `~/.config/magpie/t3-feishu-private`；目录 0700、文件 0600（Windows 权限语义不同）。**这是受文件权限保护的明文存储，不是系统钥匙串加密**。队列包含尚待提交的消息和待投递回复，请保护本机账户与备份。
- T3 OAuth 由 Magpie 管理，本插件不读取其凭据。不要给本插件 T3 Connect 密钥。
- 没有安装独立系统服务或本地定时任务，服务活在 Magpie 插件 Bun 宿主。宿主退出即停止；宿主可能按需加载，打开插件页面/调用状态工具触发后才能接收消息。重启后恢复已保存工作。

## 重试与限制

- 飞书消息 ID 去重；入站先持久化，T3 使用稳定 `clientRequestId` + `mode: queue`。超时使用同一个请求 ID，不另开一轮。
- 固定 `runId` 等待与过滤回复，先记录本轮前读取位置，再分页读取，避免回发历史或其他轮次内容。旧版 T3 如果默认从最早消息返回，可能需要扫描较多历史；仍只发送匹配本轮 ID 的回复。
- 飞书发送前保存意图并记录成功 message ID。发送超时/重启导致结果不明确时进入 `blocked`，**不盲目重发**；在 T3 查看回复。本版没有自动清理或人工重放按钮。
- 只转发本插件提交轮次的文字回复，不镜像用户在 T3 UI 额外发起的所有轮次。T3 子任务/后台任务后续输出可能需要回原界面查看。
- 遇到超过 MCP 单项读取窗口的回复，暂停投递并在控制台标明，不把截断结果当完整答案。
- 同一线程串行；全局 MCP 请求顺序执行。网络断开后周期重连；没有无限并行积压执行。
- 24 小时以前的重放入站忽略；正常去重/已完成记录保留约 48 小时。机器人离线期间事件能否补发取决于飞书，不能保证离线消息必达。
- 修改机器人/MCP 服务器/白名单后，不符合新绑定的旧待办保持搁置，不投递到新身份。
- 不支持图片、文件、群聊、语音、卡片交互、自动创建线程。不要把普通“同意”当作 T3 权限批准。

## 架构与后续平台

`src/channels/feishu.mjs` 是首个独立渠道 adapter，负责官方 SDK 长连接、身份/私聊校验、归一化消息和发送回执。`src/bridge.mjs` 处理绑定、持久化队列、T3 轮次与投递状态。后续渠道可以实现 `start(onMessage) / send(chatId,text,idempotencyKey) / stop()`，但必须各自核实身份认证、平台许可和可靠性，不能直接套用飞书的用户 ID。

结构参考 [DSH-IM](https://github.com/xmanrui/dsh-im) 的 channel adapter、会话串行队列、deferred delivery 分层思路；没有复制其代码或引入 DeepSeek Harness 依赖。也参考 [WorkBuddy Tasks](https://github.com/jichie/magpie-workbuddy-tasks) 与 [RSSHub](https://github.com/DIYgod/RSSHub) 的 Magpie 插件入口/页面服务模式。本版不用脱离宿主的 daemon。

上游接口依据：
- [Magpie MCP proxy](https://github.com/yetone/magpie/blob/main/internal/gateway/mcp.go)
- [T3 external agents](https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md)
- [T3 MCP contracts](https://github.com/pingdotgg/t3code/blob/main/packages/contracts/src/orchestratorMcp.ts)
- [Feishu Node SDK](https://github.com/larksuite/node-sdk)

## 开发验证

```sh
npm ci --ignore-scripts
npm test
npm run check
```

测试覆盖白名单、过期事件、入站重复、稳定请求键、固定轮次、未知投递停重发、磁盘失败停机、私密文件权限、Origin/Host/Bearer、Unicode header 和异常 URL。测试不使用真实凭据，不向 IM 发消息。

### Magpie 界面适配

入口页与设置页使用 Magpie 官方页面主题变量，跟随宿主的深浅色和自定义颜色；设置页在服务跳转后仍接收宿主实时主题更新。布局支持窄窗口，用户/线程绑定使用独立表单行，运行状态默认展示连接、待处理和完成数，原始 JSON 收纳在诊断详情中。

- 刷新状态不会覆盖未保存的表单；保存期间禁用重复操作。
- 已保存的 App Secret 不回显，留空保留；保存成功后清空输入框。
- 配置读取失败时不允许用空表单覆盖现有配置；保存超时需要重新打开页面核对，不自动重发。
- 独立打开服务页时使用系统配色回退；正常使用请从 Magpie 插件页打开以获取密钥及宿主主题。
