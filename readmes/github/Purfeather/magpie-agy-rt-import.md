# AGY 令牌管理 · Magpie 页面插件

单页双栏工作台：在同一页面内完成 AGY-CLI 导入 JSON 转换，并直接浏览、搜索和导出本机已保存 Magpie 账号的 Refresh Token（RT）。支持 Windows、macOS 与 Linux。

## 安装

```sh
magpie plugin add github:Purfeather/magpie-agy-rt-import
```

已安装旧版时，可在 **插件 → 已安装** 检查更新，或运行 `magpie plugin update`。也可以先克隆仓库，再从仓库目录运行 `magpie plugin add .`。

## 导入 RT

1. 在 Magpie 侧栏的插件分组打开 **AGY 令牌管理**。
2. 在左侧 **导入 Refresh Token** 粘贴裸 RT（或直接粘贴含 `refresh_token` / `token.refresh_token` 的 JSON，页面会自动提取并展示脱敏结构预览）。
3. 点击 **复制导入 JSON**（或 **下载 JSON** 保存 `agy-account.json`）。如窗口限制自动复制，页面会自动选中文本供手动复制。
4. 打开 **供应商 → Antigravity（本地 agy CLI）→ 从文件导入账号**，粘贴 JSON 或选择文件导入。

账号验证和续期由已安装的 `agy-cli` 插件和本机 `agy` 完成。RT 须来自可被 Antigravity OAuth 客户端续期的有效授权。

## 导出 Magpie 账号的 RT

在 Magpie 中展开 **手动选择账号目录**，选择整个 `accounts` 目录或单个账号目录，再点击该账号的 **复制 RT** 或 **复制 JSON**。目录选择器授予本次页面访问所选文件的权限。工作台保留 Magpie 主题和当前输入，端口未监听或被其他程序占用时仍可使用。

默认目录是 Windows 的 `%USERPROFILE%\.local\state\magpie-agy-bridge\accounts` 或 macOS / Linux 的 `~/.local/state/magpie-agy-bridge/accounts`。设置了 `XDG_STATE_HOME` 时使用 `$XDG_STATE_HOME/magpie-agy-bridge/accounts`。

### 独立浏览器中扫描本机账号

在插件目录的个人交互式终端运行以下命令（Node.js 22+ 或 Bun）。可选参数为含 `plugin-auth.json` 的 Magpie 配置目录；省略时扫描默认状态目录，按 Profile ID 展示账号。

```sh
node index.mjs --workbench
# 同时读取账号登记信息和邮箱
node index.mjs --workbench "/path/to/magpie/config"
```

用浏览器直接打开终端显示的本地 `page/index.html` 文件。在 **连接终端启动的本机扫描会话** 输入终端显示的会话码。连接成功后支持搜索、刷新、复制 RT 或 AGY-CLI JSON。不要共享会话码；持有码的进程或人员在服务运行期间可读取账号。按 Ctrl+C 即可撤销该会话，重新启动会生成新码。

## 安全与兼容性

- Magpie 静态页在 `connect-src 'none'` 的沙箱中运行。插件保留宿主提供的页面与主题，使用文件选择器授权，加载插件时不启动网络监听器。详见 [Magpie 页面插件文档](https://usemagpie.ai/docs/plugins#pages)。
- 独立扫描会话只监听 `127.0.0.1` 的临时端口。只有交互式启动者的终端显示随机 256 位密钥。服务公开的页面与脚本均不包含密钥。文件页面通过 AES-GCM 验证服务响应，请求与响应绑定到操作路径，响应还绑定到请求的随机 IV。输入的 RT 和导入 JSON 始终只在受信任的本地页面处理。
- 账号扫描检查从所选信任根开始的每段路径，核对打开句柄与路径的文件身份，按上限读取凭据（64 KiB）和索引（4 MiB）。索引和凭据均支持 UTF-8 BOM。上级目录与操作系统账户权限属于信任边界。
- 已知 `@magpie-community/opencode-agy-cli-auth` 从 `0.1.68` 起支持此导入格式。详见 [AGY-CLI 导入支持](https://github.com/magpie-community/plugins/commit/9907c187b212c55680acae4d46f5d2c868cda5f2)。
