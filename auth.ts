import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";

// 使用 Pi 内置的 jiti 加载 TS 模块（完美支持 TS 专有构造函数属性）
const { createJiti } = await import(
  "/Users/mxypoo/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs"
);
const jiti = createJiti(import.meta.url);

const vendorAuth = await jiti.import("./vendor/dsh-connect-workbuddy/src/auth.ts");
const vendorOAuth = await jiti.import("./vendor/dsh-connect-workbuddy/src/oauth.ts");

export const { WorkBuddyCredentialStore } = vendorAuth;
export const { oauthStart, oauthPoll } = vendorOAuth;

const AUTH_FILE = join(homedir(), ".pi", "agent", "workbuddy-auth.json");
const PI_AUTH_FILE = join(homedir(), ".pi", "agent", "auth.json");

/** 跨平台打开默认浏览器 */
export function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "darwin") {
    exec(`open "${url}"`);
  } else if (platform === "win32") {
    exec(`start "" "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

/** 读取自定义的本地 workbuddy-auth.json */
export function readAuthFile(): Record<string, any> {
  try {
    if (!existsSync(AUTH_FILE)) return {};
    return JSON.parse(readFileSync(AUTH_FILE, "utf8"));
  } catch {
    return {};
  }
}

/** 保存凭据，权限 0600 */
export function saveAuthFile(data: Record<string, any>): void {
  try {
    mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
    writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error("[pi-workbuddy] 保存凭据失败:", err);
  }
}

/**
 * 获取某个 region 的有效凭据：
 * 1. 优先自动探测本地 WorkBuddy 桌面端已有的登录凭据（零配置）
 * 2. 其次读取本地保存的网页登录凭据 (workbuddy-auth.json 或 auth.json)
 */
export async function getCredentialFor(region: "cn" | "global"): Promise<any | undefined> {
  // 1. 优先从桌面端扫描
  try {
    const store = new WorkBuddyCredentialStore({ region });
    const accounts = await store.readAll();
    if (accounts.length > 0) {
      return accounts[0];
    }
  } catch {
    // 忽略桌面端探测错误
  }

  // 2. 检查本地 workbuddy-auth.json
  const fileData = readAuthFile();
  const entry = fileData[region];
  if (entry && (entry.accessToken || entry.token)) {
    return {
      accessToken: entry.accessToken || entry.token,
      refreshToken: entry.refreshToken || "",
      uid: entry.uid || "",
      domain: entry.domain || (region === "cn" ? "www.workbuddy.cn" : "www.workbuddy.ai"),
      nickname: entry.nickname || "",
      uin: entry.uin || "",
      expiresAtMs: entry.expiresAtMs || 0,
      refreshExpiresAtMs: entry.refreshExpiresAtMs || 0,
    };
  }

  // 3. 检查 Pi 原生 auth.json
  try {
    if (existsSync(PI_AUTH_FILE)) {
      const piAuth = JSON.parse(readFileSync(PI_AUTH_FILE, "utf8"));
      const providerKey = region === "cn" ? "workbuddy" : "workbuddy-global";
      const piEntry = piAuth[providerKey];
      if (piEntry && (piEntry.access || piEntry.accessToken || piEntry.token)) {
        return {
          accessToken: piEntry.access || piEntry.accessToken || piEntry.token,
          refreshToken: piEntry.refresh || piEntry.refreshToken || "",
          uid: piEntry.uid || "",
          domain: piEntry.domain || (region === "cn" ? "www.workbuddy.cn" : "www.workbuddy.ai"),
          nickname: piEntry.nickname || piEntry.name || "",
        };
      }
    }
  } catch {}

  return undefined;
}

/**
 * 执行网页/扫码授权流程
 */
export async function startOAuthLoginFlow(
  region: "cn" | "global",
  callbacks?: {
    onAuth?: (info: { url: string; instructions?: string }) => void;
    onProgress?: (msg: string) => void;
    signal?: AbortSignal;
  }
): Promise<any> {
  const startResult = await oauthStart(region);
  if ("error" in startResult) {
    throw new Error(`启动 WorkBuddy 登录失败: ${startResult.error}`);
  }

  const { loginId, verificationUri, expiresIn } = startResult;

  if (callbacks?.onAuth) {
    callbacks.onAuth({
      url: verificationUri,
      instructions: `请在打开的浏览器中扫码或登录 WorkBuddy (${region === "cn" ? "国内版" : "国际版"})`,
    });
  }
  openBrowser(verificationUri);

  const startTime = Date.now();
  const timeoutMs = (expiresIn || 600) * 1000;

  while (Date.now() - startTime < timeoutMs) {
    if (callbacks?.signal?.aborted) {
      throw new Error("用户取消了授权");
    }

    const pollResult = await oauthPoll(loginId, region);

    if (pollResult.done) {
      if ("error" in pollResult) {
        throw new Error(`授权失败: ${pollResult.error}`);
      }
      if ("account" in pollResult) {
        const account = pollResult.account;
        const allAuth = readAuthFile();
        allAuth[region] = account;
        saveAuthFile(allAuth);
        return account;
      }
    }

    // 轮询间隔 2 秒
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("登录超时，请重试");
}
