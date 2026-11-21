# magpie-unisound

把云知声 Token Hub（[maas.unisound.com](https://maas.unisound.com)）的 **U Plan** 接入 [magpie](https://usemagpie.ai) 的供应商插件。面向 U Plan（Token Plan）用户：积分口径计费、双池额度窗口、赠送池视觉模型。

> English README: [README.en.md](./README.en.md)

## 功能

- **API Key 登录**：Token Plan key 一把接入（`控制台 > 订阅管理 > U Plan` 页面签发，`tp-` 前缀）
- **U Plan 白名单目录**：只暴露 U Plan 覆盖的聊天模型；旗舰 `u2` 与第三方模型（DeepSeek / Kimi / GLM / Qwen…）需要按量付费，不进目录——Token Plan key 调它们会失败，按量 key 调它们是真实扣费
- **动态模型表**：运行时拉取 `GET /v1/models`（服务端按 key 类型隔离目录），limit 以目录为准；拉不到时兜底静态白名单
- **积分口径 cost**：官方积分系数表换算成「每百万 token 的积分数」，magpie 用量统计里的 cost 就是 U Plan 积分消耗
- **本地积分账本**：每次请求从响应 usage 按官方公式精算积分（`points = (input×coeff + cached×coeff + output×coeff) / 10000`），持久化到 magpie 配置目录，跨宿主进程共享
- **双池额度窗口**：`usage` 钩子返回 5 小时突发池与 7 天周池的本地估算（Free 档口径 500 / 2500 积分）
- **流式记账**：自动为流式请求补 `stream_options.include_usage`，SSE 尾部 usage chunk 照样入账

## U Plan 模型（Free 档实测）

| 模型 | 类型 | 计费池 | context / output |
|---|---|---|---|
| `u2-flash` | 通用文本 | 积分（系数 1 / 0.2 / 2） | 1M / 256K |
| `u2-med` | 医疗文本 | 积分（系数 2 / 0.5 / 7，输出贵 3.5 倍） | 256K / — |
| `u2-radimed` | 医疗影像（图+文） | **独立赠送池**（47.5 万 Token/周，不耗积分） | 40K / — |

赠送池另有 `u2-asr`（8 小时/周）、`u2-tts`（4 万字/周）、`u2-ocr` / `u2-ocr-med`（各 737 万 Token/周），语音与文档接口后续以 MCP 工具形式接入。

**额度套利提示**：视觉请求路由到 `u2-radimed` 走赠送池，不消耗积分、不受 5 小时窗口限制。

## 安装

在 magpie 里添加本插件（GitHub 或本地路径均可）：

```bash
magpie plugin add github:aqiu817/magpie-unisound
# 或本地目录
magpie plugin add ./magpie-unisound
```

登录（API 方式，key 只存本机）：

```bash
magpie plugin login unisound
```

模型即 `unisound/u2-flash`、`unisound/u2-med`、`unisound/u2-radimed`。

## 已知局限

- **积分余量为本地估算**：从装插件起算，不含之前的消耗；窗口为滚动近似（官方的 5 小时窗口是「首次消耗起算重置」，滚动近似只会偏保守）。已与服务端对账：本地精算与控制台 `已用积分` 逐位一致。精确余量与重置时间以 [控制台用量页](https://maas.unisound.com/admin/subscription) 为准（服务端额度接口只认浏览器会话，不接受 API key）。
- **双车道不区分档位**：usage 窗口按 Free 档额度显示（Standard / Plus 用户比例仍然正确）。
- **radimed 无积分 cost**：赠送池积分系数未公布，magpie 侧显示为 0 费用（token 统计不受影响）。

## 数据与隐私

- API key 只保存在 magpie 本机（`plugin login` 写入本机凭据存储），不进任何日志与上传
- 积分账本写入 magpie 配置目录（`magpie-unisound-points.json`），仅含 token 数与积分值，不含消息内容

## 开发

```bash
node --test test/unisound.test.mjs   # 或 bun test
TP_KEY=tp-… bun scripts/smoke.mjs    # 真机冒烟（目录探测 + 双流验证）
```

## License

MIT
