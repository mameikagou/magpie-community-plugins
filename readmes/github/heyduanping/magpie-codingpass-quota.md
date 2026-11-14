# CodingPass Usage for Magpie

在 Magpie 的「观测 → 用量 → 概览」查看 CodingPass 个人订阅的 5 小时、每周和每月额度。卡片显示美元额度、百分比和重置时间，使用与 Devin、Codex 相同的原生走势。Magpie 从首次成功读取开始积累历史。

这是非官方插件。已在 Windows 上使用 Magpie 0.1.4113 和 CodingPass Plus 验证。插件只查询账号额度，提供零个模型。

## 安装

从 GitHub 安装 `v0.1.0`：

```sh
magpie plugin add 'github:heyduanping/magpie-codingpass-quota#v0.1.0'
magpie plugin login codingpass-quota
```

如果已下载或克隆仓库，可以在仓库根目录运行：

```sh
magpie plugin add .
magpie plugin login codingpass-quota
```

也可以在 Magpie 的「插件」页面添加本地目录，再到「供应商 → CodingPass Usage」登录。

1. 在浏览器登录自己的 CodingPass 账号，打开[用量页](https://codingpass.ai/zh/app/usage)。
2. 在浏览器开发者工具的「应用 → Cookie」中，找到 `https://codingpass.ai` 下的 `cp_session`，复制它的值。
3. 把值填到 Magpie 隐藏输入的登录提示中。刷新「观测 → 用量 → 概览」，保持「走势」开启。

如果之前手动添加过余额查询卡，先确认新卡片有数据，再停用旧的余额查询项。已有的 CodingPass 模型供应商继续用于推理。

## 更新登录状态

登录失效后，重新登录 CodingPass 网页，然后再次运行 `magpie plugin login codingpass-quota` 更新 Cookie。同一账号更新 Cookie 会沿用已有历史。插件按一个个人账号记录额度，换成另一账号会接着写入同一份历史。

`cp_session` 是网页登录凭据。Magpie 把它保存在本机的 `plugin-auth.json`，也可能保留备份。请仅在 Magpie 的登录提示中输入它，分享日志或配置前检查是否含有凭据。插件只把 Cookie 发送到 `https://codingpass.ai/api/app/usage`，并拒绝跟随重定向。该地址是网页控制台接口，CodingPass 更新网站后可能需要更新插件。

## 检查额度和历史

```sh
magpie quota refresh codingpass-quota
magpie quota history codingpass-quota
```

首个读数是一个点，后续读数会连成曲线。5 小时窗口尚未开启时，卡片可以显示剩余额度，重置时间会在窗口开启后显示。[CodingPass 用量规则](https://codingpass.ai/zh/usage-limits)

## License

[MIT](LICENSE)
