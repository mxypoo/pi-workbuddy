<h1 align="center">pi-workbuddy</h1>

<p align="center"><b>把本地已登录的 WorkBuddy / WorkBuddy AI 模型接入 Pi Coding Agent，零配置使用 18+ 款主流顶级大模型与 1M 原生上下文。</b></p>

<p align="center">
  <a href="#特性">特性</a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="#安装方式">安装方式</a> ·
  <a href="#常用命令">常用命令</a> ·
  <a href="#版本维护与一键更新">版本维护与一键更新</a> ·
  <a href="CHANGELOG.md">更新日志</a> ·
  <a href="#开源许可与致谢">致谢</a>
</p>

---

## 特性

- ⚡ **零配置桌面端凭据自发现**：自动探测 macOS (`~/Library/Application Support/CodeBuddyExtension/`) 与 Windows 已登录的 WorkBuddy 客户端凭据，装好即用，无需重新登录；
- 🌐 **双区域模型并发**：同时支持国内版 **WorkBuddy** (`workbuddy`) 与国际版 **WorkBuddy AI** (`workbuddy-global`)，互不干扰；
- 🚀 **18+ 款主流大模型与 1M 上下文**：完美映射国内版 `DeepSeek-V4.1-Flash`、`DeepSeek-V4-Pro`、`GLM-5.3`、`Kimi-K3`、`Hy4-preview` 等全部模型，原生保留 1,000,000（1M）上下文窗口，绝无提前截断压缩；
- 🛡️ **智能直连分流保护**：内置专属直连通信机制与官方域名 `NO_PROXY` 自动分流，即便本地终端开启了全局/HTTP 代理（如 7890 端口），也能在 200ms 内瞬间完成握手，同时绝对不影响你原有的 GitHub/OpenAI/Claude 等代理业务；
- 🏷️ **实时积分倍率标识**：模型名称自动携带官方最新计费倍率标签（如 `GLM-5.3 · x0.79`、`Deepseek-V4.1-Flash · x0.00`），直观透明；
- 🔒 **私有 Loopback Shim 保护**：启动时随 Pi 动态监听本地私有端口（`127.0.0.1:随机端口` + 进程内随机 Bearer Token），仅限本机进程调用，退出时自动释放端口，不留常驻守护进程；
- 🔑 **网页/扫码授权兜底**：无客户端环境可通过 `/workbuddy-login` 直接调起浏览器官方扫码登录，支持按 Tab 补全区域参数或直接弹出交互菜单；
- 📦 **上游零冲突挂载**：通过 Git Submodule 挂载上游协议真源，原作者发布协议补丁时可一键无损同步。

---

## 工作原理

```text
Pi Coding Agent (pi)
   │
   │ (标准 OpenAI Completions SSE)
   ▼
pi-workbuddy Loopback Shim (127.0.0.1:随机端口)
   │
   ├─► 1. 自动提取本地已登录 WorkBuddy 客户端 JWT Token
   ├─► 2. 注入腾讯云 CLI / App 身份特征与必要 Headers
   ├─► 3. 动态维护 18+ 款模型上下文与倍率
   │
   ▼
WorkBuddy 官方网关 (国内 copilot.tencent.com / 国际 www.workbuddy.ai)
   │
   ▼ (标准 OpenAI delta chunk + reasoning_content)
Pi 终端界面实时流式渲染
```

---

## 安装方式

### 方式 1：直接克隆到 Pi 扩展目录（推荐）

```bash
# 1. 克隆本仓库（含上游协议子模块）
git clone --recurse-submodules https://github.com/mxypoo/pi-workbuddy.git ~/.pi/agent/extensions/pi-workbuddy

# 2. 建立 Pi 自动加载软链接
ln -sf ~/.pi/agent/extensions/pi-workbuddy/index.ts ~/.pi/agent/extensions/workbuddy.ts
```

### 方式 2：真源存放在 Documents，运行位软链

```bash
git clone --recurse-submodules https://github.com/mxypoo/pi-workbuddy.git ~/Documents/pi-workbuddy
ln -sf ~/Documents/pi-workbuddy ~/.pi/agent/extensions/pi-workbuddy
ln -sf ~/Documents/pi-workbuddy/index.ts ~/.pi/agent/extensions/workbuddy.ts
```

安装完成后，直接输入 `pi` 即可正常使用。若本机已登录过 WorkBuddy 桌面端，直接按 `Ctrl+P` 或用 `/model` 即可看到所有模型！

---

## 常用命令

打开 `pi` 进入会话后，直接在输入框中输入命令：

| 快捷命令 | 说明 |
| :--- | :--- |
| `/workbuddy-login` | 弹出区域选择对话框，或直接登录 WorkBuddy |
| `/workbuddy-login global` | 启动 **WorkBuddy AI (国际版)** 网页登录授权流程（支持 Tab 自动补全） |
| `/workbuddy-login cn` | 启动 **WorkBuddy (国内版)** 扫码登录流程 |
| `/login workbuddy-global` | 通过 Pi 原生交互对话框登录国际版 |
| `/workbuddy-status` | 查看当前已登录账号（UID、昵称、域名、Token 到期时间）及积分余额 |
| `/workbuddy-checkin` | 执行国内版每日签到，自动领取免费积分与权益 |
| `/workbuddy-update` | 会话内一键同步 GitHub 最新上游协议更新并报告当前 Commit 详情 |

---

## 版本维护与一键更新

当 WorkBuddy 上游更新模型列表、接口路由或风控特征时，只需拉取上游子模块即可：

- **会话内一键更新**：在 `pi` 聊天输入框内输入 `/workbuddy-update`
- **命令行一键更新**：在系统终端运行：
  ```bash
  ~/.pi/agent/extensions/pi-workbuddy/update.sh
  ```

---

## 开源许可与致谢

- 核心上游协议客户端与适配逻辑源自 [dingminhua/dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy)，在此致以崇高敬意。
- 本项目采用 [MIT 许可证](LICENSE) 开源。
