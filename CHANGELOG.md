# 更新日志 (Changelog)

所有针对 `pi-workbuddy` 插件的实质性变更都会记录在本文档中。

---

## [1.2.0] - 2026-11-03

### 新增 (Added)
- **`/workbuddy-refresh`：强制更新模型目录**。
  - 背景：为了让 Pi 启动零阻塞，插件启动时只注册一份纯内存静态兜底名册，真实名册要等首次使用 provider 或用户打开 `/model` 选择器时才拉取。上游一旦改了目录，而用户又不打开选择器，就始终看不到新模型。
  - 本命令显式重新执行一次上游 `fetchModels()`，写回 catalog 并立即重注册 provider（Pi 对扩展加载后的 `registerProvider` 调用即时生效），随后打印人工可读的**新增 / 移除差分**。
  - 支持参数 `all`（默认）/ `cn` / `global`，带 Tab 补全；无参数时在交互模式下弹选择菜单。
  - 三条安全约束：拉取失败时**保留原有名册**（绝不用空表覆盖）；以当前名册作为 `keepModelIds`，防止上游本次改动把用户正在使用的模型挤掉；`catalog.set()` 对空列表会抛错，因此坏响应不可能写坏状态。
- **`/workbuddy-status` 增加签到状态行**：显示「今日已签到 / 未签到 + 连签天数」，并标注该区域是否存在签到活动。
- **`/workbuddy-status` 增加积分明细**：除总额外，列出各积分包的 `剩余/总量`、周期包标记、到期/重置日期，以及「3 天内将过期」与「最近一笔过期时间」。
- `scripts/gen-fallback.mjs`：从上游实测拉取名册并生成可粘进 `fallback-models.ts` 的数组，避免静态兜底名册靠手抄维护。
- `scripts/smoke-test.mjs`：用 mock 的 Pi 宿主真实跑一遍扩展，验证命令注册、`/workbuddy-status` 与 `/workbuddy-refresh` 的端到端行为。

### 修复 (Fixed)
- **修复 `/workbuddy-status` 积分查询必然失败**（本次反馈的主问题）。
  - 根因：代码调用了上游根本不存在的 `client.fetchCreditBalance()`（vendor 5.x 从 `b052baf` 到 `c08da1e` 全历史中都不存在该方法，`typeof` 实测为 `undefined`），调用必然抛 `TypeError`，而异常又被空 `catch` 吞掉，界面只剩下无从排查的「接口暂时不可达」。
  - 修正：改用真实存在的 `fetchCredits()`（`POST /v2/billing/meter/get-user-resource`），并按它返回的 `{ total, packages, expiringSoon, nearestExpiryMs }` 结构渲染。
- **修复错误信息被静默吞掉**：`/workbuddy-status` 现在把「本地回环代理初始化失败」「积分查询失败」「签到状态查询失败」分成三条独立路径，各自输出真实错误消息，不再伪装成「接口不可达」。
- **修复积分小数尾数显示**：上游现金包带有浮点尾数（如 `2201.91000221`），统一收敛到 2 位小数并去掉无意义的尾随零。
- **修复思考能力判定只看旧字段**：上游（vendor 5.x）用 `reasoning: { supportedEfforts, ... }` 对象表达思考能力，旧代码只认静态名册里的 `supportsReasoning` 布尔值，导致真实名册里的条目前者恒为 `true`。现两者都认。

### 变更 (Changed)
- **静态兜底名册重新采集（2026-11-03 实测）**：国内版 11 款 → **15 款**，国际版 20 款 → **21 款**。旧名册漂移严重，实测差分：
  - 国内版新增 `hy4-preview`、`hy3-x`、`deepseek-v4.1-flash`、`glm-5.3-flash`、`space-bunny`、`minimax-m3.1-flash`、`kimi-k3.1-pro`、`kimi-k2.8-preview`、`step-5-preview`、`mimo-v2.6-pro`；移除 `glm-5v-turbo`、`glm-5.1`、`minimax-m3`、`kimi-k2.7`、`kimi-k2.6`。
  - 国际版补入 `gpt-6-astra`、`gpt-6.1-sol`、`gpt-6-sol`、`gpt-6-luna`、`grok-4.7`、`gemini-3.8-flash`、`kimi-k3.1-pro`、`kimi-k3.1-pro-highspeed`、`minimax-m3.1-flash` 等。
  - 倍率、上下文、`maxTokens`、图片输入能力全部按上游实测值重写。

---

## [1.1.0] - 2026-10-28

### 性能 (Performance)
- **启动零阻塞（重大优化）**：将 vendor 模块加载从模块顶层 `await` 改为惰性按需加载，Pi 启动不再为每次会话平白付出 1~1.5 秒的 jiti 现场编译开销。
  - 原因：`vendor/dsh-connect-workbuddy/src/` 下有 187 个 TypeScript 文件，原先在扩展模块顶层用 `await jiti.import()` 一次性编译，且无缓存。
  - 方案：新增 `fallback-models.ts`（纯数据、零依赖）承载启动期静态名册；vendor 的 jiti 编译、shim 启动、凭据读取、网络拉取全部推迟到首次真正使用该 provider 时。
  - 实测：单独加载本插件从 **1.5s 降至 0.25s**。
- **消除启动期串行网络阻塞**：原先启动时对两个 region 依次执行 `store.readAll()` + `client.fetchModels()`（实测合计约 1.4 秒，且完全串行），现在该路径不再出现在启动流程中。
- **`refreshModels` 改为惰性挂载点**：Pi 只在用户打开模型选择器时才调用它，因此用它承载「首次使用时初始化」，启动零开销且选择器内依然能看到最新名册。

### 修复 (Fixed)
- **修复 `catalog.setLive` 不存在导致的静默失效**：vendor 的 `WorkBuddyCatalog` 只暴露 `set()`，原代码 4 处调用 `catalog.setLive(...)` 必然抛 `TypeError`，而异常被空 `catch` 吞掉，导致启动时那 1.4 秒网络拉取到的模型名册**全部被丢弃**，provider 永远停留在静态兜底列表。现统一改为 `catalog.set()`。
- **修复初始化失败后无法重试**：`ensureLoaded()` 的 rejected Promise 原先会被永久缓存，失败一次后该 provider 再也无法初始化。现在失败时清空句柄，允许后续重试。

### 变更 (Changed)
- 静态兜底名册抽离至独立文件 `fallback-models.ts`，与 `vendor/.../catalog.ts` 的 `FALLBACK_WORKBUDDY_MODELS` / `FALLBACK_WORKBUDDY_MODELS_GLOBAL` 保持数据一致，避免两处维护漂移。
- 国内版 / 国际版名册严格分离，国际版的 `auto` 路由（`default-model`）继续缺席。

---

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
