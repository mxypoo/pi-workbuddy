import { createRequire } from "node:module";
import { realpathSync, existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

/** WorkBuddy / CodeBuddy 所有官方服务域名，必须绕过本地代理直连 */
export const WORKBUDDY_DIRECT_DOMAINS = [
  "workbuddy.ai",
  "*.workbuddy.ai",
  "codebuddy.ai",
  "*.codebuddy.ai",
  "codebuddy.cn",
  "*.codebuddy.cn",
  "workbuddy.cn",
  "*.workbuddy.cn",
  "copilot.tencent.com",
  "*.tencent.com",
];

/**
 * 确保所有 WorkBuddy 相关域名免代理直连，防止被本地海外代理节点连接重置或超时
 */
export function ensureWorkBuddyNoProxy(): void {
  const current = process.env.NO_PROXY || process.env.no_proxy || "";
  const missing = WORKBUDDY_DIRECT_DOMAINS.filter((d) => !current.includes(d));
  if (missing.length > 0) {
    const updated = current ? `${current},${missing.join(",")}` : missing.join(",");
    process.env.NO_PROXY = updated;
    process.env.no_proxy = updated;
  }
}

// 模块加载第一时间应用 NO_PROXY 保护
ensureWorkBuddyNoProxy();

let cachedDirectFetch: typeof fetch | undefined;

/**
 * 获取专属直连 fetch 实现（绕过宿主 EnvHttpProxyAgent 代理污染）
 */
export async function getDirectFetch(): Promise<typeof fetch> {
  if (cachedDirectFetch) return cachedDirectFetch;
  ensureWorkBuddyNoProxy();

  try {
    const execDir = path.dirname(process.execPath);
    const candidateRoots = [process.cwd(), execDir, path.resolve(execDir, ".."), path.resolve(execDir, "../lib")];

    let undiciMod: any;
    try {
      undiciMod = await import("undici");
    } catch {
      for (const root of candidateRoots) {
        let curr: string | null = root;
        while (curr && curr !== path.dirname(curr)) {
          const locs = [
            path.join(curr, "node_modules", "undici", "index.js"),
            path.join(curr, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "undici", "index.js"),
          ];
          for (const loc of locs) {
            if (existsSync(loc)) {
              undiciMod = await import(pathToFileURL(loc).href);
              break;
            }
          }
          if (undiciMod) break;
          curr = path.dirname(curr);
        }
        if (undiciMod) break;
      }
    }

    const undici = undiciMod?.default || undiciMod;
    if (undici?.Agent && typeof undici.fetch === "function") {
      const directAgent = new undici.Agent({
        connect: { timeout: 15_000 },
        keepAliveTimeout: 30_000,
      });
      cachedDirectFetch = ((url: any, init?: any) => {
        return undici.fetch(url, { ...init, dispatcher: directAgent });
      }) as typeof fetch;
      return cachedDirectFetch;
    }
  } catch {}

  cachedDirectFetch = globalThis.fetch;
  return cachedDirectFetch;
}

/**
 * 跨平台动态定位并创建 Jiti 实例

 * 兼容 Windows（任意盘符如 F:、C:）、macOS、Linux，杜绝任何本机绝对路径硬编码
 */
export async function getJiti(callerUrl: string): Promise<any> {
  // 1. 尝试直接导入（标准 node_modules 解析）
  try {
    const mod: any = await import("jiti");
    const create = mod.createJiti || mod.default?.createJiti || mod.default;
    if (typeof create === "function") return create(callerUrl);
  } catch {}

  // 2. 从当前正在执行的 Pi 宿主入口动态解析 (跨系统/跨盘符自适应)
  if (process.argv[1]) {
    try {
      const realCli = realpathSync(process.argv[1]);
      const req = createRequire(realCli);
      const entry = req.resolve("jiti");
      const mod: any = await import(pathToFileURL(entry).href);
      const create = mod.createJiti || mod.default?.createJiti || mod.default;
      if (typeof create === "function") return create(callerUrl);
    } catch {}
  }

  // 3. 根据当前 Node 可执行文件或常见全局环境动态推导 node_modules
  const execDir = path.dirname(process.execPath);
  const callerDir = path.dirname(fileURLToPath(callerUrl));

  const candidateRoots: string[] = [
    callerDir,
    process.cwd(),
    execDir,
    path.resolve(execDir, ".."),
    path.resolve(execDir, "../lib"), // Unix/macOS: node/lib/node_modules
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "npm") : null,
    process.env.NODE_PATH || null,
  ].filter(Boolean) as string[];

  // 逐级向上与向下搜索可能的 jiti 路径
  for (const root of candidateRoots) {
    let curr: string | null = root;
    while (curr && curr !== path.dirname(curr)) {
      const possibleLocations = [
        path.join(curr, "node_modules", "jiti"),
        path.join(curr, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "jiti"),
      ];

      for (const loc of possibleLocations) {
        for (const sub of [
          path.join("lib", "jiti.mjs"),
          path.join("lib", "jiti.cjs"),
          path.join("dist", "jiti.mjs"),
          path.join("lib", "index.js"),
        ]) {
          const candidate = path.join(loc, sub);
          if (existsSync(candidate)) {
            try {
              const mod: any = await import(pathToFileURL(candidate).href);
              const create = mod.createJiti || mod.default?.createJiti || mod.default;
              if (typeof create === "function") return create(callerUrl);
            } catch {}
          }
        }
      }
      curr = path.dirname(curr);
    }
  }

  throw new Error(
    "[pi-workbuddy] 无法在当前环境自动定位到 jiti 运行时。请在插件目录下运行 npm install 安装依赖。"
  );
}
