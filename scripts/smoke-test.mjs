#!/usr/bin/env node
/**
 * 端到端冒烟测试：用一个 mock 的 Pi 宿主把扩展真实跑起来。
 *
 * 它验证的是「命令能不能真的跑通」——而不只是类型对不对：
 *   - 扩展工厂能否加载（index.ts 经 jiti 现编译，语法/依赖问题会当场炸）
 *   - 命令是否按预期注册（防止改名后文档与实现脱节）
 *   - `/workbuddy-status` 能否读到凭据、积分、签到状态
 *   - `/workbuddy-refresh` 能否拉上游名册、打印差分、重注册 provider
 *
 * 用法：
 *   node scripts/smoke-test.mjs                # 只列命令 + provider
 *   node scripts/smoke-test.mjs status
 *   node scripts/smoke-test.mjs refresh cn|global|all
 *
 * 依赖：本机已登录 WorkBuddy 桌面端（或 `~/.pi/agent/workbuddy-auth.json`）。
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadJiti() {
  const require = createRequire(import.meta.url);
  const candidates = [];
  try {
    candidates.push(require.resolve("jiti"));
  } catch {}
  for (const base of [
    path.join(homedir(), ".pi", "agent", "npm", "node_modules", "jiti"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "jiti"),
  ]) {
    for (const entry of ["lib/jiti.mjs", "lib/jiti.cjs"]) {
      if (existsSync(path.join(base, entry))) candidates.push(path.join(base, entry));
    }
  }
  for (const candidate of candidates) {
    try {
      const mod = await import(pathToFileURL(candidate).href);
      const create = mod.createJiti || mod.default?.createJiti || mod.default;
      if (typeof create === "function") return create;
    } catch {}
  }
  throw new Error("无法定位 jiti，请确认已安装 pi（或在本插件目录执行 npm install）");
}

const DIRECT = [
  "workbuddy.ai", "*.workbuddy.ai", "codebuddy.ai", "*.codebuddy.ai",
  "codebuddy.cn", "*.codebuddy.cn", "workbuddy.cn", "*.workbuddy.cn",
  "copilot.tencent.com", "*.tencent.com",
];
const current = process.env.NO_PROXY || process.env.no_proxy || "";
const merged = current ? `${current},${DIRECT.join(",")}` : DIRECT.join(",");
process.env.NO_PROXY = merged;
process.env.no_proxy = merged;

const createJiti = await loadJiti();
const jiti = createJiti(pathToFileURL(path.join(ROOT, "index.ts")).href);

// ── mock Pi 宿主 ──
const commands = {};
const providers = {};
const events = {};
const pi = {
  registerProvider: (id, cfg) => {
    providers[id] = cfg;
  },
  registerCommand: (name, opts) => {
    commands[name] = opts;
  },
  on: (name, fn) => {
    (events[name] ||= []).push(fn);
  },
  unregisterProvider: () => {},
};

const factory = (await jiti.import("./index.ts")).default;
if (typeof factory !== "function") throw new Error("index.ts 未导出扩展工厂函数");
await factory(pi);

const expected = [
  "workbuddy-login",
  "workbuddy-status",
  "workbuddy-refresh",
  "workbuddy-checkin",
  "workbuddy-update",
];
const missing = expected.filter((name) => !commands[name]);

console.log("已注册命令:", Object.keys(commands).join(", ") || "(无)");
console.log("已注册 provider:", Object.keys(providers).join(", ") || "(无)");
console.log("已注册事件:", Object.keys(events).join(", ") || "(无)");
if (missing.length > 0) console.log(`⚠ 缺少预期命令: ${missing.join(", ")}`);

const ctx = {
  hasUI: false,
  model: { provider: "workbuddy" },
  ui: {
    notify: (msg, level) => console.log(`\n----- notify(${level}) -----\n${msg}`),
    setEditorText: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    select: async () => undefined,
  },
};

const [, , action, arg] = process.argv;
let exitCode = missing.length > 0 ? 1 : 0;

try {
  if (action === "status") {
    await commands["workbuddy-status"].handler("", ctx);
  } else if (action === "refresh") {
    await commands["workbuddy-refresh"].handler(arg || "all", ctx);
  } else if (action) {
    console.error(`未知动作 "${action}"，可用: status | refresh [cn|global|all]`);
    exitCode = 2;
  }
} catch (err) {
  console.error("\n❌ 执行失败:", err);
  exitCode = 1;
}

console.log(
  "\n刷新后 provider 模型数:",
  JSON.stringify(Object.fromEntries(Object.entries(providers).map(([id, cfg]) => [id, cfg.models.length])))
);

// shim 的本地回环 server 会一直挂住 event loop，冒烟测试必须显式退出
process.exit(exitCode);
