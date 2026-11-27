# 价格 (Magpie Models Price)

一个 **纯页面插件**（page-only）的 Magpie 模型价格与用量面板：读取 [models.dev](https://models.dev) 公价与 Magpie 本地账单/用量（`usage.jsonl`），按模型聚合展示所有渠道价格、上下文用量与真实 API 花费。页面不注册任何供应商（provider），也不启动插件宿主；模型清单与保存应用由配套 CLI 完成。

![价格界面](docs/images/screenshot.png)

## 为什么是纯页面插件

从 v2.0.0 起本插件只声明 `magpie.page`，没有 `main` / `index.js` 服务端入口，因此：

- Magpie 的「插件」列表只显示 **页面** 徽章，不再把你当成一个供应商插件；
- 不会在每次 Magpie 启动、开关插件时拉起插件宿主；
- 页面运行在 Magpie 的 sandbox 里（`connect-src 'none'`），只通过 `magpie.read` 读用量、`magpie.options` 保存自己的选项，不直接写任何 Magpie 配置文件。

代价是页面自己无法写 `settings.json` / `providers.json`。所以安装后需要运行一次 `sync` 生成模型清单；在页面里改完价格后运行 `apply`（或让 `watch` 常驻）把改动写入 Magpie。这是纯页面插件的边界，不是缺陷。

## 安装与首次使用

```bash
magpie plugin add magpie-models-price
npx magpie-models-price sync     # 生成页面数据（安装后必须跑一次）
```

`sync` 会读取 Magpie 的 `providers-state.json` 与 models.dev 公共目录，把模型清单写到 **Magpie 实际加载的那份插件目录** 的 `page/models-data.js`（不是 npx 临时目录）。本地开发可直接 `magpie plugin add /path/to/magpie-models-price`。

### 页面里改价之后

```bash
npx magpie-models-price apply    # 应用页面保存的价格 / 峰谷设置（幂等，同一笔只应用一次）
npx magpie-models-price watch    # 可选：常驻监听，页面一保存就自动 apply，并刷新模型数据
npx magpie-models-price doctor   # 排查：打印配置目录、实际页面目录、数据与选项状态
```

页面保存的是「待应用」的 options（带 `applyToken`）；`apply` 只写你改动过的键，不会覆盖你在 Magpie 自己编辑器里设的价格，也不会给你没有的 provider 添加价格。`watch` 适合经常调价的用户，默认每 3 秒检查一次。

## 功能特性

- **按模型聚合展示**：同一原生模型（如 `gemini-3.8-flash`）自动归并为一张卡片，展示所有供应商渠道与重叠图标。
- **真实用量与 Token 统计**：通过 `usage:day`（全量历史）与 `usage:summary`（today/7d/30d）读取，打开、聚焦与每 30 秒自动刷新。
- **已启用筛选**：一键过滤当前已启用的活跃模型与渠道。
- **渠道类型筛选**：按 `billingKind=payg` 与 `key.set` 区分「付费 API」和「账号登录」。
- **多维度排序**：智能排序（在用优先，同档按 Token 降序）、调用次数、Token 消耗、价格高低、渠道数、名称。
- **模型后缀智能归类**：`-max` / `-auto` / `-official` / `-highspeed` / 日期快照 / `-antidowngrade` 等变体归为一族；`qwen4` 与 `qwen4-max` 这种同名不同价不会被误并。
- **分时峰谷计价（模型级设置）**：官方价目里真正分时的是 DeepSeek 系模型，默认工作日 09:00-12:00 / 14:00-18:00（Ollama Cloud 为 12:00-18:00 UTC）×2；其他模型全天同价，可在弹窗单独开启并自定义时段与倍率。保存时会汇总同步到 Magpie `providers.json` 的渠道 `rateWindows`（Magpie 只支持渠道级时段，冲突时保持原样并报告）。
- **口径提醒**：编辑弹窗顶部常驻横幅与「闲时价 / 高峰价」角标，填高峰价时明确展示 ÷倍率换算；写进 `settings.json` 的始终是闲时价，高峰由 Magpie 的 rateWindows 计费。
- **账单统计口径切换**：只记录真实 API 花费（订阅/免费渠道 $0）或显示所有渠道等值公价；历史用量按当前 `modelPrices` 重算。
- **公价自动匹配**：自动比对未定价模型，支持一键填入全部公价（写入后需 `apply`）。
- **自定义定价**：支持单渠道定价（`antigravity/claude-sonnet-4-6`）与全网通配（`*/claude-sonnet-4-6`）。
- **原子写入**：插件写 `settings.json` 时用临时文件 + rename，只合并 `modelPrices`，不覆盖其他设置。

## 配置目录

| 用途 | 位置 |
| --- | --- |
| 价格、插件 options | `$XDG_CONFIG_HOME/magpie/`，未设置时 `~/.config/magpie/` |
| models.dev 缓存 | `$XDG_CACHE_HOME/magpie/`，未设置时 `~/.cache/magpie/` |
| 主目录 | `HOME`；Windows 上为 `USERPROFILE` |

`XDG_*` 只有写成绝对路径才生效（与宿主 `internal/appdir` 的判断一致），相对值会被忽略并回落到主目录。首次运行时 `~/.config/magpie` 尚不存在也会自动创建。

插件本身不启动任何 HTTP 服务；页面通过 Magpie bridge（`magpie.read` / `magpie.options`）工作。可选命令 `node bin/magpie-models-price.js ui` 会启动独立 Web 控制台（默认 `127.0.0.1:3456`，只绑回环），它同样只在你显式保存时写配置。

**读权限**：manifest 只声明 `usage:summary` / `usage:day`，不申请 `providers:list`，因此页面看不到供应商列表权限之外的信息；供应商名称与启用状态由本地 `sync` 生成进 `page/models-data.js`。

## 开发与测试

```bash
node check.js      # 21 组自测：目录解析、保存只写改动、纯页面清单、CLI sync/apply、服务边界、页面 CSP
```

CI 在 ubuntu / macOS / Windows 三平台 × Node 20/22/24 跑同一套测试，并检查打包产物不含任何本地配置。

## 命令行工具

```bash
magpie-models-price sync [--force]   # 生成页面数据（安装后 / 模型变化后）
magpie-models-price apply            # 应用页面保存的价格与峰谷
magpie-models-price watch            # 常驻：自动 apply + 刷新页面数据
magpie-models-price doctor           # 显示实际路径和状态
magpie-models-price list             # 列出未定价模型与建议公价
magpie-models-price mode api-only    # 切换统计口径（仅 API 花费）
magpie-models-price mode all         # 切换统计口径（全部等值公价）
magpie-models-price match-public     # 把 models.dev 公价应用到全部未定价模型
magpie-models-price set <model> <in,out,cache_read,cache_write>
magpie-models-price reset <model>
magpie-models-price ui               # 可选独立 Web 控制台
```

## 升级说明（v1 → v2）

v2.0.0 移除了旧的 provider 服务端入口（`main` / `index.js`）与 `providers:list` 权限：这是一次有意的「只作为页面」改造。升级后：

1. 运行 `npx magpie-models-price sync` 重新生成页面数据；
2. 如果之前靠「保存后插件重载」自动落盘，改为 `npx magpie-models-price apply`，或让 `watch` 常驻；
3. 插件行不再显示「供应商」徽章，只保留「页面」。

## 许可证
MIT License © zrtzrt
