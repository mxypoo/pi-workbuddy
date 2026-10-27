import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { getJiti, ensureWorkBuddyNoProxy } from "./loader.ts";

// 启动时确保 WorkBuddy 官方域名免代理直连，防止被本地海外代理节点连接重置或超时
ensureWorkBuddyNoProxy();

const jiti = await getJiti(import.meta.url);

const shimMod = await jiti.import("./vendor/dsh-connect-workbuddy/src/shim.ts");
const authMod = await jiti.import("./vendor/dsh-connect-workbuddy/src/auth.ts");
const upstreamMod = await jiti.import("./vendor/dsh-connect-workbuddy/src/upstream.ts");
const catalogMod = await jiti.import("./vendor/dsh-connect-workbuddy/src/catalog.ts");
const benefitsMod = await jiti.import("./vendor/dsh-connect-workbuddy/src/benefits.ts");

const { createWorkBuddyShim } = shimMod;
const { WorkBuddyCredentialStore } = authMod;
const { WorkBuddyUpstreamClient } = upstreamMod;
const { WorkBuddyCatalog } = catalogMod;

import {
  getCredentialFor,
  startOAuthLoginFlow,
} from "./auth.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = path.join(__dirname, "vendor/dsh-connect-workbuddy");

interface RegionDef {
  id: string;
  region: "cn" | "global";
  displayName: string;
}

const REGIONS: RegionDef[] = [
  { id: "workbuddy", region: "cn", displayName: "WorkBuddy (国内版)" },
  { id: "workbuddy-global", region: "global", displayName: "WorkBuddy AI (国际版)" },
];

export default async function (pi: ExtensionAPI) {
  const shims = new Map<string, any>();
  const catalogs = new Map<string, any>();
  const clients = new Map<string, any>();
  const stores = new Map<string, any>();

  for (const { id: providerId, region, displayName } of REGIONS) {
    const store = new WorkBuddyCredentialStore({ region });
    const client = new WorkBuddyUpstreamClient();
    const catalog = new WorkBuddyCatalog(region);

    stores.set(providerId, store);
    clients.set(providerId, client);
    catalogs.set(providerId, catalog);

    // 1. 随 Pi 启动在 127.0.0.1 开启本地私有安全回环代理
    const shim = createWorkBuddyShim({ store, client, catalog });
    await shim.ready;
    shims.set(providerId, shim);

    // 2. 尝试从本地桌面端或保存凭据拉取最新模型名册
    try {
      const accounts = await store.readAll();
      if (accounts.length > 0) {
        const rawModels = await client.fetchModels(accounts[0]);
        catalog.setLive(rawModels);
      }
    } catch {
      // 启动时若离线或未登录则静默使用预设兜底名册
    }

    // 3. 构建 Pi 模型列表（保留 1M 原生上下文与倍率标签）
    const mapToPiModels = () => {
      const models = catalog.current();
      return models.map((m: any) => {
        const factor = m.creditMultiplier ?? m.credits;
        const rateLabel = typeof factor === "number" ? ` · x${factor.toFixed(2)}` : "";
        return {
          id: m.id,
          name: `${m.name || m.id}${rateLabel}`,
          api: "openai-completions",
          provider: providerId,
          baseUrl: `${shim.baseUrl()}/v1`,
          input: m.supportsImages ? ["text", "image"] : ["text"],
          reasoning: m.supportsReasoning ?? true,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          // 保留原生上下文（例如 1,000,000 完整 1M 上下文）
          contextWindow: m.contextWindow || 1_000_000,
          maxTokens: m.maxTokens || 64_000,
          compat: { supportsReasoningEffort: true },
        };
      });
    };

    const initialPiModels = mapToPiModels();

    // 4. 向 Pi 注册 Provider
    pi.registerProvider(providerId, {
      name: displayName,
      baseUrl: `${shim.baseUrl()}/v1`,
      apiKey: shim.token(),
      api: "openai-completions",
      models: (initialPiModels.length > 0 ? initialPiModels : [
        {
          id: `${providerId}-default`,
          name: `${displayName} (请先执行 /workbuddy-login 登录)`,
          api: "openai-completions",
          provider: providerId,
          baseUrl: `${shim.baseUrl()}/v1`,
          input: ["text"],
          reasoning: false,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 16_384,
        },
      ]) as any,
      oauth: {
        name: `${displayName} (网页/扫码授权)`,
        login: async (callbacks) => {
          const cred = await startOAuthLoginFlow(region, callbacks, store);
          // 登录成功后刷新模型目录
          try {
            const rawModels = await client.fetchModels(cred);
            catalog.setLive(rawModels);
          } catch {}
          return {
            access: cred.accessToken,
            refresh: cred.refreshToken,
            expires: cred.expiresAtMs,
            uid: cred.uid,
            nickname: cred.nickname,
            domain: cred.domain,
          };
        },
        refreshToken: async (credentials) => {
          return {
            access: credentials.access,
            refresh: credentials.refresh,
            expires: Date.now() + 24 * 3600 * 1000,
          };
        },
        // 关键防护：始终返回当前活动的 Shim Bearer Secret，100% 杜绝 401 报错
        getApiKey: () => shim.token(),
      },
      refreshModels: async () => {
        const cred = await getCredentialFor(region);
        if (!cred) return [];
        const rawModels = await client.fetchModels(cred);
        catalog.setLive(rawModels);
        return mapToPiModels() as any;
      },
    });
  }

  // 5. 会话结束时自动释放本地回环代理端口
  pi.on("session_shutdown", async () => {
    for (const shim of shims.values()) {
      try {
        await shim.close();
      } catch {}
    }
  });

  // 6. 命令：/workbuddy-login 登录
  pi.registerCommand("workbuddy-login", {
    description: "登录 WorkBuddy (默认国内版，可选参数 global 指定国际版)",
    getArgumentCompletions: (prefix) => {
      const options = [
        { value: "global", label: "global", description: "WorkBuddy AI (国际版)" },
        { value: "cn", label: "cn", description: "WorkBuddy (国内版)" },
      ];
      return options.filter((o) => o.value.startsWith(prefix.trim().toLowerCase()));
    },
    handler: async (args, ctx) => {
      // 1. 立即清空输入框，消除用户按回车假死无响应感
      try {
        ctx.ui.setEditorText("");
      } catch {}

      const raw = args?.trim().toLowerCase() || "";
      let region: "cn" | "global";

      if (raw === "global" || raw === "intl" || raw === "ai") {
        region = "global";
      } else if (raw === "cn") {
        region = "cn";
      } else if (raw === "") {
        // 未传参数时，如果处于交互模式则弹窗供用户选择；否则默认国内版
        if (ctx.hasUI && typeof ctx.ui.select === "function") {
          const choice = await ctx.ui.select("请选择要登录的 WorkBuddy 版本：", [
            "WorkBuddy AI (国际版 - workbuddy.ai / 谷歌、GitHub或邮箱)",
            "WorkBuddy (国内版 - codebuddy.cn / 企业微信或扫码)",
            "取消",
          ]);
          if (!choice || choice === "取消") return;
          region = choice.includes("国际版") ? "global" : "cn";
        } else {
          region = "cn";
        }
      } else {
        ctx.ui.notify(`未知的区域参数 "${args}"，可用选项: global, cn`, "warning");
        return;
      }

      const isGlobal = region === "global";
      const providerId = isGlobal ? "workbuddy-global" : "workbuddy";
      const regionName = isGlobal ? "WorkBuddy AI (国际版)" : "WorkBuddy (国内版)";
      const store = stores.get(providerId);

      // 2. 状态栏启动旋转等待指示器
      try {
        ctx.ui.setWorkingMessage(`⏳ 正在启动 ${regionName} 授权流程...`);
        ctx.ui.setWorkingVisible(true);
      } catch {}

      const abortController = new AbortController();

      try {
        const cred = await startOAuthLoginFlow(
          region,
          {
            signal: abortController.signal,
            onAuth: ({ url, instructions }) => {
              try {
                ctx.ui.setWorkingMessage(`⏳ 请在打开的浏览器中完成登录 (按 Esc 取消)`);
              } catch {}
              ctx.ui.notify(
                `🌐 【${regionName} 网页授权已开启】\n` +
                `已尝试在默认浏览器中打开登录页面。如未自动弹出，请手动复制以下网址打开：\n` +
                `👉 ${url}\n` +
                `💡 提示: 亦可在会话中直接使用原生命令: /login ${providerId}`,
                "info"
              );
            },
            onProgress: (msg) => {
              try {
                ctx.ui.setWorkingMessage(`⏳ ${msg}`);
              } catch {}
            },
          },
          store
        );

        const client = clients.get(providerId);
        const catalog = catalogs.get(providerId);
        if (client && catalog) {
          try {
            const rawModels = await client.fetchModels(cred);
            catalog.setLive(rawModels);
            ctx.ui.notify(`🎉 登录成功！用户: ${cred.nickname || cred.uid}，已激活 ${rawModels.length} 个模型`, "info");
          } catch (e: any) {
            ctx.ui.notify(`✅ 登录成功，模型刷新警告: ${e.message}`, "warning");
          }
        } else {
          ctx.ui.notify(`🎉 登录成功！用户: ${cred.nickname || cred.uid}`, "info");
        }
      } catch (err: any) {
        ctx.ui.notify(`❌ 登录失败: ${err.message}`, "error");
      } finally {
        try {
          ctx.ui.setWorkingVisible(false);
        } catch {}
      }
    },
  });

  // 7. 命令：/workbuddy-status 查看用量与账号状态
  pi.registerCommand("workbuddy-status", {
    description: "查看当前 WorkBuddy 账号状态与积分余额",
    handler: async (_args, ctx) => {
      const lines: string[] = ["=== WorkBuddy 状态面板 ==="];

      for (const { id: providerId, region, displayName } of REGIONS) {
        const cred = await getCredentialFor(region);
        if (!cred) {
          lines.push(`\n[${displayName}]: 未登录 (可执行 /workbuddy-login ${region === "global" ? "global" : ""})`);
          continue;
        }

        lines.push(`\n[${displayName}]: 已登录`);
        lines.push(`  用户昵称: ${cred.nickname || "默认用户"}`);
        lines.push(`  账号 UID: ${cred.uid}`);
        lines.push(`  绑定域名: ${cred.domain}`);
        if (cred.expiresAtMs) {
          lines.push(`  到期时间: ${new Date(cred.expiresAtMs).toLocaleString()}`);
        }

        try {
          const client = clients.get(providerId);
          if (client) {
            const balance = await client.fetchCreditBalance(cred);
            lines.push(`  剩余积分: ${balance.totalCredits ?? "正常"}`);
          }
        } catch {
          lines.push(`  积分查询: 接口暂时不可达`);
        }
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // 8. 命令：/workbuddy-checkin 每日签到
  pi.registerCommand("workbuddy-checkin", {
    description: "执行 WorkBuddy 国内版每日签到领取免费积分",
    handler: async (_args, ctx) => {
      ctx.ui.notify("正在执行 WorkBuddy 国内版每日签到...", "info");
      const cred = await getCredentialFor("cn");
      if (!cred) {
        ctx.ui.notify("请先登录国内版账号后再签到", "warning");
        return;
      }

      try {
        const client = clients.get("workbuddy");
        if (client) {
          const res = await client.claimDailyCheckin(cred);
          ctx.ui.notify(`🎉 签到结果: ${JSON.stringify(res)}`, "info");
        }
      } catch (err: any) {
        ctx.ui.notify(`签到提示: ${err.message}`, "info");
      }
    },
  });

  // 9. 命令：/workbuddy-update 一键更新
  pi.registerCommand("workbuddy-update", {
    description: "一键同步上游 dsh-connect-workbuddy 最新协议",
    handler: async (_args, ctx) => {
      ctx.ui.notify("正在拉取上游 dsh-connect-workbuddy 最新更新...", "info");
      try {
        const pullOutput = execSync("git pull origin main", { cwd: VENDOR_DIR }).toString().trim();
        const latestCommit = execSync("git log -1 --pretty=format:'%h - %s (%cr)'", { cwd: VENDOR_DIR }).toString().trim();
        ctx.ui.notify(`✅ 更新完成！\n${pullOutput}\n当前核心版本: ${latestCommit}`, "info");
      } catch (err: any) {
        ctx.ui.notify(`❌ 更新失败: ${err.message}`, "error");
      }
    },
  });
}
