/**
 * 启动期静态兜底名册（纯数据，零依赖，零 I/O）。
 *
 * 存在的唯一理由：让 Pi 启动时能立刻注册出可用的 provider 模型列表，
 * 而**不必**为此加载 vendor/ 下的 187 个 TypeScript 文件（那需要 jiti 现场
 * 编译，实测会给每次启动平白增加 1~1.5 秒）。
 *
 * 数据必须与 vendor/dsh-connect-workbuddy/src/catalog.ts 中的
 * FALLBACK_WORKBUDDY_MODELS / FALLBACK_WORKBUDDY_MODELS_GLOBAL 保持一致。
 * 真正的 live 名册由惰性初始化在首次使用 provider 时拉取覆盖。
 *
 * 两个 region 的名册**不可混用**：国内版没有 gpt- / gemini- 前缀的条目，
 * 国际版的 auto 路由（default-model）必须缺席。
 */

export interface FallbackModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  creditMultiplier?: number;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
}

/** 国内版（codebuddy.cn CLI 通道，2026-08-30 采集） */
export const FALLBACK_MODELS_CN: readonly FallbackModel[] = [
  { id: "hy3", name: "Hy3", contextWindow: 192_000, maxTokens: 64_000 },
  { id: "glm-5v-turbo", name: "GLM-5v-Turbo", contextWindow: 200_000, maxTokens: 64_000 },
  { id: "glm-5.3", name: "GLM-5.3", contextWindow: 1_000_000, maxTokens: 48_000 },
  { id: "glm-5.2", name: "GLM-5.2", contextWindow: 1_000_000, maxTokens: 48_000 },
  { id: "glm-5.1", name: "GLM-5.1", contextWindow: 200_000, maxTokens: 48_000 },
  { id: "minimax-m3", name: "MiniMax-M3", contextWindow: 512_000, maxTokens: 128_000 },
  { id: "kimi-k3-1", name: "Kimi-K3", contextWindow: 1_000_000, maxTokens: 32_000 },
  { id: "kimi-k2.7", name: "Kimi-K2.7-Code", contextWindow: 256_000, maxTokens: 32_000 },
  { id: "kimi-k2.6", name: "Kimi-K2.6", contextWindow: 256_000, maxTokens: 32_000 },
  { id: "deepseek-v4-flash", name: "Deepseek-V4-Flash", contextWindow: 1_000_000, maxTokens: 50_000 },
  { id: "deepseek-v4-pro", name: "Deepseek-V4-Pro", contextWindow: 1_000_000, maxTokens: 50_000 },
];

/** 国际版（workbuddy.ai/v3/config 桌面通道，2026-09-11 采集） */
export const FALLBACK_MODELS_GLOBAL: readonly FallbackModel[] = [
  { id: "fast-model", name: "Fast", contextWindow: 200_000, maxTokens: 32_000, creditMultiplier: 0.34 },
  { id: "balanced-model", name: "Balanced", contextWindow: 256_000, maxTokens: 32_000, creditMultiplier: 0.59 },
  { id: "primary-model", name: "Primary", contextWindow: 272_000, maxTokens: 72_000, creditMultiplier: 3.31 },
  { id: "deep-model", name: "Deep", contextWindow: 176_000, maxTokens: 24_000, creditMultiplier: 3.33 },
  { id: "deepseek-v4.1-flash", name: "Deepseek-V4.1-Flash", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 0 },
  { id: "gpt-6-astra", name: "GPT-6-Astra", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 6.67 },
  { id: "hy4-preview", name: "Hy4 preview", contextWindow: 1_000_000, maxTokens: 64_000, creditMultiplier: 0 },
  { id: "hy3", name: "Hy3", contextWindow: 192_000, maxTokens: 64_000, creditMultiplier: 0 },
  { id: "gpt-5.6-sol", name: "GPT-5.6-Sol", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 3.47 },
  { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 1.39 },
  { id: "gpt-5.6-luna", name: "GPT-5.6-Luna", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 0.14 },
  { id: "gpt-5.5", name: "GPT-5.5", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 3.31 },
  { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 272_000, maxTokens: 72_000, creditMultiplier: 1.65 },
  { id: "gpt-5.3-codex", name: "GPT-5.3-Codex", contextWindow: 272_000, maxTokens: 72_000, creditMultiplier: 1.25 },
  { id: "gemini-3.5-flash", name: "Gemini-3.5-Flash", contextWindow: 1_000_000, maxTokens: 65_536, creditMultiplier: 0.99 },
  { id: "glm-5.3", name: "GLM-5.3", contextWindow: 1_000_000, maxTokens: 48_000, creditMultiplier: 0.79 },
  { id: "glm-5.2", name: "GLM-5.2", contextWindow: 1_000_000, maxTokens: 48_000, creditMultiplier: 0.79 },
  { id: "kimi-k3", name: "Kimi-K3", contextWindow: 1_000_000, maxTokens: 32_000, creditMultiplier: 1.62 },
  { id: "kimi-k2.6", name: "Kimi-K2.6", contextWindow: 256_000, maxTokens: 32_000, creditMultiplier: 0.52 },
];

export function fallbackModelsFor(region: "cn" | "global"): readonly FallbackModel[] {
  return region === "global" ? FALLBACK_MODELS_GLOBAL : FALLBACK_MODELS_CN;
}
