#!/usr/bin/env node
/**
 * 从上游实测拉取两个 region 的模型名册，打印可直接粘进 `fallback-models.ts` 的数组。
 *
 * 为什么需要这个脚本：`fallback-models.ts` 是启动期零 I/O 的静态兜底名册，
 * 上游目录平均两三周就会增删模型。手抄必然漂移，而漂移的症状很隐蔽——只有
 * 在「尚未 init / 未登录 / 离线」这几种情形下才会暴露。跑一次本脚本，把输出
 * 覆盖进 `fallback-models.ts` 对应数组即可。
 *
 * 用法：
 *   node scripts/gen-fallback.mjs            # 打印名册
 *   node scripts/gen-fallback.mjs > out.txt  # 落盘后对照修改
 *
 * 依赖：本机已登录 WorkBuddy 桌面端（或 `~/.pi/agent/workbuddy-auth.json`）。
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 逐一尝试定位宿主环境里的 jiti（插件本身不打包 node_modules） */
async function loadJiti() {
  const require = createRequire(import.meta.url);
  const candidates = [];
  try {
    candidates.push(require.resolve("jiti"));
  } catch {}
  for (const p of [
    path.join(homedir(), ".pi", "agent", "npm", "node_modules", "jiti"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "jiti"),
  ]) {
    for (const entry of ["lib/jiti.mjs", "lib/jiti.cjs"]) {
      if (existsSync(path.join(p, entry))) candidates.push(path.join(p, entry));
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

// 官方域名免代理直连，与插件运行时行为保持一致
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

const auth = await jiti.import("./auth.ts");
const upstream = await jiti.import("./vendor/dsh-connect-workbuddy/src/upstream.ts");
const client = new upstream.WorkBuddyUpstreamClient();

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function format(rows) {
  return rows
    .map((m) => {
      const parts = [
        `id: "${esc(m.id)}"`,
        `name: "${esc(m.name)}"`,
        `contextWindow: ${m.contextWindow}`,
        `maxTokens: ${m.maxTokens}`,
      ];
      if (typeof m.creditMultiplier === "number") parts.push(`creditMultiplier: ${m.creditMultiplier}`);
      if (m.supportsImages === true) parts.push(`supportsImages: true`);
      if ((m.reasoning ?? m.supportsReasoning) === false) parts.push(`supportsReasoning: false`);
      return `  { ${parts.join(", ")} },`;
    })
    .join("\n");
}

let failed = false;
for (const [region, constName] of [["cn", "FALLBACK_MODELS_CN"], ["global", "FALLBACK_MODELS_GLOBAL"]]) {
  const cred = await auth.getCredentialFor(region);
  if (!cred) {
    console.error(`\n===== ${region}: 未登录，跳过（可执行 pi 后 /workbuddy-login ${region === "global" ? "global" : ""}） =====`);
    failed = true;
    continue;
  }
  try {
    const models = await client.fetchModels(cred);
    console.log(`\n/** 采集时间：${new Date().toISOString().slice(0, 10)}，共 ${models.length} 款 */`);
    console.log(`export const ${constName}: readonly FallbackModel[] = [`);
    console.log(format(models));
    console.log(`];`);
  } catch (err) {
    console.error(`\n===== ${region}: 拉取失败 ${err?.message ?? err} =====`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
