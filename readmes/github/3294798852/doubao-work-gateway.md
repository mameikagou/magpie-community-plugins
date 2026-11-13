<p align="center"><img src="public/doubao-work-avatar.png" width="72" alt="豆包工作头像" /></p>
<h1 align="center">豆包工作 · 跨平台网关与 Magpie 插件</h1>
<p align="center">只做豆包工作：多账号、每日签到、JSON 备份和 OpenAI 兼容接口。</p>
<p align="center"><strong>Windows / macOS / Linux</strong> · <strong>Node.js 22+</strong> · <strong>零 npm 运行依赖</strong></p>

<p align="center"><a href="#快速开始">快速开始</a> · <a href="#接入客户端">接入客户端</a> · <a href="#原账号迁移">账号迁移</a> · <a href="#遇到-429--710022004">429 排查</a></p>

> 独立第三方项目，基于 245678000000/doubao-work-gateway 的原生版继续开发。提供独立网关和 Magpie 供应商插件，两种入口共用豆包协议、会话解析和文本响应编码。

## Magpie 供应商插件

在 [Magpie](https://github.com/yetone/magpie) 中通过 GitHub 安装。Windows 和 Linux 使用相同命令。

```sh
magpie plugin add github:3294798852/doubao-work-gateway
magpie plugin login doubaowork
```

在独立浏览器窗口登录后，Magpie 会发现该账号可用的模型。供应商 ID 为 `doubaowork`，模型在 Magpie 中使用 `doubaowork/<实际模型ID>`。插件直接访问豆包，账号、凭据和转发由 Magpie 管理。

无桌面的 Linux 可从独立网关导出账号 JSON 后导入。

```sh
magpie accounts import doubaowork /absolute/path/doubao-accounts.json --yes
```

支持浏览器登录、v2/v3 账号备份导入、模型发现、流式与非流式文本、推理文本透传、额度查询和每日签到。签到在 Magpie 的账号设置中启用。工具调用、图片与工作流仍待实现。详细安装和使用方式见 [Magpie 插件说明](docs/magpie.md)，测试范围见 [本轮验收记录](docs/validation-magpie.md)。

## 界面预览

| 工作台 | 接口节点 |
| --- | --- |
| <img src="docs/screenshots/overview-v02.jpg" width="580" alt="账号、签到与批量操作" /> | <img src="docs/screenshots/nodes-v02.jpg" width="580" alt="接口节点、模型与 JSON 导入导出" /> |

以上为既有布局展示，不代表当前账号的模型与额度。[签到计划](docs/screenshots/checkin.png) · [深色工作台](docs/screenshots/overview-dark-v02.jpg) · [手机工作台](docs/screenshots/overview-mobile-v02.jpg)。

## 功能

- **多账号浏览器登录**：每次在独立 Chrome / Edge 临时会话登录，同一身份更新原账号；日常浏览器不受影响。
- **账号工作台**：搜索、备注、批量启停、额度查询和验证状态。账号与模型 Key 加密保存在本机。
- **自动签到**：北京时间计划，按账号选择；同日有提交记录后只回查，不重复领取。
- **两类 JSON**：账号备份用于登录迁移；节点 JSON 用于保存客户端的 Base URL、模型及可选 Key，不参与转发选路。
- **自建 API Key**：随机生成或指定内容，支持命名、复制、启停；模型 Key 与管理接口分离。
- **文本 API**：`/v1/models` 与 `/v1/chat/completions`，支持流式和非流式文本。不承诺原生工具调用、图片及工作流兼容。

## 快速开始

本节为独立网关的启动方式。

需要 **Node.js 22 或更高版本**。使用浏览器登录时，还需要 Chrome 或 Edge；带图形桌面的 Linux 也可使用 Chromium。解压交付包，进入含有 `package.json` 的目录后运行以下命令。

```sh
npm start
```

从 [GitHub Releases](https://github.com/3294798852/doubao-work-gateway/releases/latest) 下载 ZIP 或 TGZ 源码包，解压后在项目目录执行 `npm start`。前后端只使用 Node.js 内置模块。

1. 打开 [本机面板](http://127.0.0.1:43862)，在工作台点击「添加账号」，在弹出的独立浏览器窗口登录豆包。
2. 登录后在工作台核对账号状态；添加下一个账号时会开启新的临时会话。
3. 如需每日签到，在「自动签到」中设置北京时间、勾选账号，并保存计划。执行时网关需保持运行。

| 系统 | 启动 | 停止 |
| --- | --- | --- |
| Windows | `start.cmd` 或 `npm start` | `stop.cmd` 或 `npm stop` |
| macOS | `./start.command` 或 `npm start` | `./stop.command` 或 `npm stop` |
| Linux | `sh ./start.sh` 或 `npm start` | `sh ./stop.sh` 或 `npm stop` |

也可在启动终端按 Ctrl+C 停止，账号资料会保留。`npm run status` 查看运行状态；`npm run doctor` 检查 Node、运行目录及浏览器。无图形桌面的服务器可用账号 JSON 迁移，见[跨平台说明](docs/platforms.md)。

## 接入客户端

登录并核验账号后，打开面板的「接口接入」，按下表填写 OpenAI 兼容客户端：

| 客户端字段 | 填写内容 |
| --- | --- |
| Base URL | `http://127.0.0.1:43861/v1`（默认本机模型端口） |
| API Key | 面板里的默认 Key，或专为该客户端创建的 Key |
| 模型 ID | 从「接口接入」的实际模型列表复制 |

`43862` 是管理端口，`43861` 是模型端口，别把面板地址填进客户端。模型列表接口为 `GET /v1/models`，文本请求使用 `POST /v1/chat/completions`。面板也提供可复制的调用示例。

## 原账号迁移

优先在工作台「导入 JSON」：支持原生备份与旧版 v2 账号 JSON。先预览、确认导入，再逐个选择「核验备份」。导入的名字或标识不代替官方身份核验。重复账号默认跳过，已核验的会话不会被未核验文件替换。

没有 JSON、但有旧版私有状态目录时，先确认旧进程已停止，再运行 `node launcher.mjs migrate-legacy`。若原目录与当前状态目录不同，将原状态目录作为命令的最后一个参数。迁移只读旧库、只写原生加密库，重复执行跳过已导入条目。旧文件保留。

原生运行目录优先使用 `DW_RUNTIME_ROOT`，其次为项目中的私有 `.runtime-root`，默认 `.local/`。可用 `DW_STATE_DIR` 单独指定状态目录。

## 遇到 429 / 710022004

这表示豆包上游要求人工验证，与普通限流和额度耗尽分开显示。网关暂停实际触发的账号，保留状态和请求编号；不会把本次请求自动转给其他账号，也不会在后台换模型重试。

1. 使用同一个账号打开[豆包官网](https://www.doubao.com/chat/)，发一条普通消息并完成页面提示的验证。
2. 回到工作台，点击「已完成验证」，再点击「复测一次」。只有收到完整的文本响应才恢复该账号参与转发。
3. 如果原出口仍要求验证，账号保持暂停。网页能发消息并不保证云端出口已经恢复。

![账号待验证与暂停转发（模拟账号）](docs/screenshots/verification-native.jpg)

## 数据与安全

账号会话与管理台签发的 Key 在本机用 AES-256-GCM 保存。密钥文件与加密数据均需保留。下载的账号 JSON 是可读的敏感备份；节点 JSON 默认不含 Key。请勿上传备份、状态目录、浏览器资料、Cookie 或管理员凭据。

云端模式需要 HTTPS、管理员认证和专用代理凭据；请看[部署说明](docs/cloud/README.md)。从 GitHub 下载或更新源码不会自动部署服务器。

## 验证与文档

- `npm run check`：源文件语法检查；`npm test`：本地模拟上游、加密库、双端口、导入导出、流式输出和暂停恢复。
- `npm run test:magpie-host` 使用指定的 Magpie Bun 宿主做隔离联调，配置方法见 [插件说明](docs/magpie.md)。
- [三系统 CI](https://github.com/3294798852/doubao-work-gateway/actions/workflows/ci.yml)覆盖 Windows、macOS、Linux × Node.js 22 / 24。真实账号登录、模型调用和签到的进度见 [0.5.0 验收记录](docs/validation-magpie.md)。
- [JSON 导入导出](docs/json-transfer.md) · [原生协议](docs/native-protocol.md) · [安全与反馈](SECURITY.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

## 许可证

新增 Magpie 插件代码采用 MIT 许可证。继承代码及素材保留上游的来源和原始声明，授权范围见 [LICENSE](LICENSE) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。

## 致谢

特别感谢 **[LINUX DO](https://linux.do/)** 社区的分享、讨论与交流，让这个小项目有了从想法走到可用工具的机会。

感谢 [Agent2Providers](https://github.com/ProvidersPlugin/Agent2Providers)、[EchoBird](https://github.com/edison7009/EchoBird) 和 [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)。本项目与上述平台、社区及豆包官方无隶属、担保或官方合作关系。
