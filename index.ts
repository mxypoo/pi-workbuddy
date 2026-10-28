import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { getJiti, ensureWorkBuddyNoProxy } from "./loader.ts";
import { fallbackModelsFor } from "./fallback-models.ts";

// 启动时确保 WorkBuddy 官方域名免代理直连，防止被本地海外代理节点连接重置或超时
ensureWorkBuddyNoProxy();

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

/**
 * vendor 模块的惰性句柄。
 *
 * 关键设计：`vendor/dsh-connect-workbuddy/src/` 下有 187 个 .ts 文件，
 * 经 jiti 现场编译会给每次 Pi 启动带来 1~1.5 秒的阻塞。因此启动路径上
 * **绝不**触碰它们——启动只用 `fallback-models.ts` 里的纯数据静态名册。
 * 真正的加载推迟到首次使用该 provider（发请求 / 打开模型选择器 / 执行命令）。
 */
interface VendorModules {
  createWorkBuddyShim: any;
  WorkBuddyCredentialStore: any;
  WorkBuddyUpstreamClient: any;
  WorkBuddyCatalog: any;
  getCredentialFor: any;
  startOAuthLoginFlow: any;
}

let vendorModulesPromise: Promise<VendorModules> | undefined;

function loadVendorModules(): Promise<VendorModules> {
  if (!vendorModulesPromise) {
    vendorModulesPromise = (async () => {
      const jiti = await getJiti(import.meta.url);
      const [shimMod, authMod, upstreamMod, catalogMod, ownAuth] = await Promise.all([
        jiti.import("./vendor/dsh-connect-workbuddy/src/shim.ts"),
        jiti.import("./vendor/dsh-connect-workbuddy/src/auth.ts"),
        jiti.import("./vendor/dsh-connect-workbuddy/src/upstream.ts"),
        jiti.import("./vendor/dsh-connect-workbuddy/src/catalog.ts"),
        import("./auth.ts"),
      ]);
      return {
        createWorkBuddyShim: shimMod.createWorkBuddyShim,
        WorkBuddyCredentialStore: authMod.WorkBuddyCredentialStore,
        WorkBuddyUpstreamClient: upstreamMod.WorkBuddyUpstreamClient,
        WorkBuddyCatalog: catalogMod.WorkBuddyCatalog,
        getCredentialFor: ownAuth.getCredentialFor,
        startOAuthLoginFlow: ownAuth.startOAuthLoginFlow,
      };
    })();
  }
  return vendorModulesPromise;
}

interface RegionRuntime {
  providerId: string;
  region: "cn" | "global";
  displayName: string;
  /** 启动期静态名册（纯内存） */
  staticModels: readonly any[];
  /** 惰性初始化后才有值 */
  catalog?: any;
  shim?: any;
  store?: any;
  client?: any;
  /** 幂等的惰性初始化句柄 */
  initialized?: Promise<void>;
}

export default async function (pi: ExtensionAPI) {
  const runtimes = new Map<string, RegionRuntime>();

  /** 把模型条目映射为 Pi 模型定义（保留 1M 原生上下文与倍率标签） */
  const mapToPiModels = (providerId: string, baseUrl: string, models: readonly any[]) => {
    return models.map((m: any) => {
      const factor = m.creditMultiplier ?? m.credits;
      const rateLabel = typeof factor === "number" ? ` · x${factor.toFixed(2)}` : "";
      return {
        id: m.id,
        name: `${m.name || m.id}${rateLabel}`,
        api: "openai-completions",
        provider: providerId,
        baseUrl: `${baseUrl}/v1`,
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

  /** 向 Pi 注册（或重注册）一个 region 的 provider */
  const registerProvider = (rt: RegionRuntime) => {
    const { providerId, displayName, region } = rt;
    const shim = rt.shim;
    // shim 未就绪时用占位 baseUrl，惰性初始化完成后会重注册覆盖
    const baseUrl = shim ? shim.baseUrl() : "http://127.0.0.1:0";
    const models = rt.catalog ? rt.catalog.current() : rt.staticModels;
    const piModels = mapToPiModels(providerId, baseUrl, models);

    pi.registerProvider(providerId, {
      name: displayName,
      baseUrl: `${baseUrl}/v1`,
      apiKey: shim ? shim.token() : "pending-init",
      api: "openai-completions",
      models: (piModels.length > 0 ? piModels : [
        {
          id: `${providerId}-default`,
          name: `${displayName} (请先执行 /workbuddy-login 登录)`,
          api: "openai-completions",
          provider: providerId,
          baseUrl: `${baseUrl}/v1`,
          input: ["text"],
          reasoning: false,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 16_384,
        },
      ]) as any,
      oauth: {
        name: `${displayName} (网页/扫码授权)`,
        login: async (callbacks: any) => {
          await ensureLoaded(providerId);
          const mods = await loadVendorModules();
          const cred = await mods.startOAuthLoginFlow(region, callbacks, rt.store);
          // 登录成功后刷新模型目录
          try {
            const rawModels = await rt.client.fetchModels(cred);
            rt.catalog.set(rawModels);
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
        refreshToken: async (credentials: any) => {
          return {
            access: credentials.access,
            refresh: credentials.refresh,
            expires: Date.now() + 24 * 3600 * 1000,
          };
        },
        // 关键防护：始终返回当前活动的 Shim Bearer Secret，100% 杜绝 401 报错
        getApiKey: () => (rt.shim ? rt.shim.token() : "pending-init"),
      },
      // Pi 不在启动时调用 refreshModels，只在用户打开模型选择器时调用。
      // 因此这里既是「选择器能看到最新名册」的挂载点，也是天然的惰性触发点。
      refreshModels: async () => {
        await ensureLoaded(providerId);
        return mapToPiModels(providerId, rt.shim.baseUrl(), rt.catalog.current()) as any;
      },
    });
  };

  /**
   * 惰性初始化：首次真正使用该 provider 时才加载 vendor、起 shim、读凭据、拉名册。
   * 幂等且并发安全（共享同一个 Promise）。
   */
  const ensureLoaded = (providerId: string): Promise<void> => {
    const rt = runtimes.get(providerId)!;
    if (rt.initialized) return rt.initialized;

    rt.initialized = (async () => {
      const mods = await loadVendorModules();
      const store = new mods.WorkBuddyCredentialStore({ region: rt.region });
      const client = new mods.WorkBuddyUpstreamClient();
      const catalog = new mods.WorkBuddyCatalog(rt.region);
      rt.store = store;
      rt.client = client;
      rt.catalog = catalog;

      // 1. 开启 127.0.0.1 本地私有安全回环代理
      const shim = mods.createWorkBuddyShim({ store, client, catalog });
      await shim.ready;
      rt.shim = shim;

      // 2. 拉取最新模型名册（失败则保留静态兜底）
      try {
        const accounts = await store.readAll();
        if (accounts.length > 0) {
          const rawModels = await client.fetchModels(accounts[0]);
          catalog.set(rawModels);
        }
      } catch {
        // 离线或未登录时静默使用静态兜底名册
      }

      // 3. 用真实 shim 地址与真实名册重注册（registerProvider 支持运行时重注册并合并）
      registerProvider(rt);
    })().catch((err) => {
      // 初始化失败必须清空句柄，否则后续重试会永远拿到同一个 rejected Promise
      rt.initialized = undefined;
      throw err;
    });

    return rt.initialized;
  };

  // ── 启动路径：只做纯内存静态注册，零 I/O、零 jiti 编译 ──
  for (const { id: providerId, region, displayName } of REGIONS) {
    const rt: RegionRuntime = {
      providerId,
      region,
      displayName,
      staticModels: fallbackModelsFor(region),
    };
    runtimes.set(providerId, rt);
    registerProvider(rt);
  }

  // 会话结束时自动释放本地回环代理端口
  pi.on("session_shutdown", async () => {
    for (const rt of runtimes.values()) {
      try {
        await rt.shim?.close();
      } catch {}
    }
  });

  /**
   * 发请求前的最后安全点：若当前模型属于本插件，则必须在请求真正发出前完成 shim 初始化。
   *
   * 这是惰性加载方案完整性的关键——用户可以提前把 workbuddy 模型设为默认模型，
   * 此时启动期不会打开模型选择器，`refreshModels` 也不会被调用，
   * 若没有这个钩子，首次请求就会打到占位 baseUrl 而失败。
   */
  pi.on("before_agent_start", async (_event, ctx) => {
    const providerId = ctx.model?.provider;
    if (!providerId || !runtimes.has(providerId)) return;
    const rt = runtimes.get(providerId)!;
    if (rt.shim) return; // 已就绪
    try {
      await ensureLoaded(providerId);
    } catch {
      // 初始化失败时静默放行，让请求自然报错并保留重试机会
    }
  });

  // ── 命令：/workbuddy-login 登录 ──
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

      // 2. 状态栏启动旋转等待指示器
      try {
        ctx.ui.setWorkingMessage(`⏳ 正在启动 ${regionName} 授权流程...`);
        ctx.ui.setWorkingVisible(true);
      } catch {}

      const abortController = new AbortController();

      try {
        await ensureLoaded(providerId);
        const rt = runtimes.get(providerId)!;
        const mods = await loadVendorModules();
        const cred = await mods.startOAuthLoginFlow(
          region,
          {
            signal: abortController.signal,
            onAuth: ({ url }: any) => {
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
            onProgress: (msg: string) => {
              try {
                ctx.ui.setWorkingMessage(`⏳ ${msg}`);
              } catch {}
            },
          },
          rt.store
        );

        try {
          const rawModels = await rt.client.fetchModels(cred);
          rt.catalog.set(rawModels);
          ctx.ui.notify(`🎉 登录成功！用户: ${cred.nickname || cred.uid}，已激活 ${rawModels.length} 个模型`, "info");
        } catch (e: any) {
          ctx.ui.notify(`✅ 登录成功，模型刷新警告: ${e.message}`, "warning");
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

  // ── 命令：/workbuddy-status 查看用量与账号状态 ──
  pi.registerCommand("workbuddy-status", {
    description: "查看当前 WorkBuddy 账号状态与积分余额",
    handler: async (_args, ctx) => {
      const lines: string[] = ["=== WorkBuddy 状态面板 ==="];
      const mods = await loadVendorModules();

      for (const { id: providerId, region, displayName } of REGIONS) {
        const cred = await mods.getCredentialFor(region);
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
          await ensureLoaded(providerId);
          const rt = runtimes.get(providerId)!;
          if (rt.client) {
            const balance = await rt.client.fetchCreditBalance(cred);
            lines.push(`  剩余积分: ${balance.totalCredits ?? "正常"}`);
          }
        } catch {
          lines.push(`  积分查询: 接口暂时不可达`);
        }
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── 命令：/workbuddy-checkin 每日签到 ──
  pi.registerCommand("workbuddy-checkin", {
    description: "执行 WorkBuddy 国内版每日签到领取免费积分",
    handler: async (_args, ctx) => {
      ctx.ui.notify("正在执行 WorkBuddy 国内版每日签到...", "info");
      const mods = await loadVendorModules();
      const cred = await mods.getCredentialFor("cn");
      if (!cred) {
        ctx.ui.notify("请先登录国内版账号后再签到", "warning");
        return;
      }

      try {
        await ensureLoaded("workbuddy");
        const rt = runtimes.get("workbuddy")!;
        if (rt.client) {
          const res = await rt.client.claimDailyCheckin(cred);
          ctx.ui.notify(`🎉 签到结果: ${JSON.stringify(res)}`, "info");
        }
      } catch (err: any) {
        ctx.ui.notify(`签到提示: ${err.message}`, "info");
      }
    },
  });

  // ── 命令：/workbuddy-update 一键更新 ──
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
