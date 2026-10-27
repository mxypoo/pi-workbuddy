# 更新日志 (Changelog)

所有针对 `pi-workbuddy` 插件的实质性变更都会记录在本文档中。

---

## [1.0.1] - 2026-10-27

### 修复 (Fixed)
- **解决国际版登录假死与超时挂起问题**：针对终端配置本地 HTTP/SOCKS 代理（如 `127.0.0.1:7890`）的场景，修复了 `workbuddy.ai` 国际域名被代理错误路由至海外节点导致腾讯云 WAF 重置连接（`Connection reset by peer`）或 10 秒超时挂起的问题。
- **防止轮询死循环**：修复了上游协议在网络异常时被判定为未完成状态进而进入 600 秒静默等待的问题，确保握手与轮询在 200~300ms 内极速响应。
- **凭据统一注入生效**：OAuth 网页授权成功后，增加调用 `store.addOAuthAccount(account)` 写入上游统一凭据库，确保本地私有安全回环代理（Loopback Shim）和模型目录能立刻识别并激活国际版凭据，杜绝授权后依然报“未登录”的问题。

### 优化 (Improved)
- **精准白名单直连保护 (Zero-Side-Effect)**：
  - 在运行时进程内存中自动将 `*.workbuddy.ai`、`*.codebuddy.ai`、`*.workbuddy.cn`、`*.codebuddy.cn`、`copilot.tencent.com` 等官方域名注入 `process.env.NO_PROXY` 与 `no_proxy`。
  - 封装专属直连 `directFetch`（基于独立 Undici Agent），双重确保官方网关通信 100% 畅通。
  - **对宿主业务零副作用**：开发者终端内依赖代理访问的 GitHub、OpenAI、Claude、Google 及各类 API 业务继续 100% 走代理，绝无任何干扰。
- **交互与用户体验重塑**：
  - **消除输入假死感**：在接收到 `/workbuddy-login` 命令时立即调用 `ctx.ui.setEditorText("")` 清空输入框。
  - **动态进度反馈**：TUI 顶部状态栏启用旋转进度动画（`⏳ 正在启动授权流程...` / `⏳ 正在等待浏览器登录... (已等待 Xs)`）。
  - **终端高亮网址与快捷指引**：在自动调用浏览器打开的同时，在终端醒目打印带状态的授权超链接，浏览器未弹出时可一键复制打开。
  - **命令参数补全与交互菜单**：
    - 注册 `getArgumentCompletions`，支持输入 `/workbuddy-login ` 按 Tab 自动补全 `global` 与 `cn`；
    - 执行不带参数的 `/workbuddy-login` 时，交互模式下自动弹出区域版本选择菜单。
- **Pi 原生 `/login` 深度兼容**：
  - 完善 `pi.registerProvider` 的 `oauth.login` 流程，支持直接在终端输入 `/login workbuddy-global` 或 `/login workbuddy` 调起 Pi 原生授权对话框。
