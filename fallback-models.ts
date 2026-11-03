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
 *
 * 采集时间：2026-11-03，上游实测（`/workbuddy-refresh` 的同一个
 * `fetchModels()` 通道）。上游目录平均两三周就会增删模型，请用
 * `node scripts/gen-fallback.mjs` 重新生成本文件的这两个数组，
 * 或按 `/workbuddy-refresh` 输出的差分校准，不要凭记忆手改。
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

/** 国内版（codebuddy.cn CLI 通道，2026-11-03 采集，15 款） */
export const FALLBACK_MODELS_CN: readonly FallbackModel[] = [
  { id: "hy4-preview", name: "Hy4 preview", contextWindow: 960_000, maxTokens: 64_000, creditMultiplier: 0.29, supportsImages: true },
  { id: "hy3", name: "Hy3", contextWindow: 192_000, maxTokens: 64_000, creditMultiplier: 0, supportsImages: true },
  { id: "hy3-x", name: "Hy3", contextWindow: 192_000, maxTokens: 64_000, creditMultiplier: 0.05, supportsImages: true },
  { id: "deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 0.11, supportsImages: true },
  { id: "glm-5.3", name: "GLM-5.3", contextWindow: 1_000_000, maxTokens: 64_000, creditMultiplier: 0.69, supportsImages: true },
  { id: "glm-5.3-flash", name: "GLM-5.3-Flash", contextWindow: 1_000_000, maxTokens: 131_072, creditMultiplier: 0.08, supportsImages: true },
  { id: "glm-5.2", name: "GLM-5.2", contextWindow: 1_000_000, maxTokens: 64_000, creditMultiplier: 0.79, supportsImages: true },
  { id: "space-bunny", name: "Space-Bunny", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 0.08, supportsImages: true },
  { id: "minimax-m3.1-flash", name: "MiniMax-M3.1-Flash", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 0.08, supportsImages: true },
  { id: "kimi-k3.1-pro", name: "Kimi-K3.1-Pro", contextWindow: 1_000_000, maxTokens: 32_000, creditMultiplier: 0.97, supportsImages: true },
  { id: "kimi-k3-1", name: "Kimi-K3", contextWindow: 1_000_000, maxTokens: 32_000, creditMultiplier: 1.62, supportsImages: true },
  { id: "kimi-k2.8-preview", name: "Kimi-K2.8-Preview", contextWindow: 1_000_000, maxTokens: 64_000, creditMultiplier: 0.77, supportsImages: true },
  { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 0.51, supportsImages: true },
  { id: "step-5-preview", name: "Step-5-Preview", contextWindow: 1_000_000, maxTokens: 64_000, creditMultiplier: 0.33, supportsImages: true },
  { id: "mimo-v2.6-pro", name: "Xiaomi MiMo-V2.6-Pro", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 0.13, supportsImages: true },
];

/** 国际版（workbuddy.ai/v3/config 桌面通道，2026-11-03 采集，21 款） */
export const FALLBACK_MODELS_GLOBAL: readonly FallbackModel[] = [
  { id: "fast-model", name: "Fast", contextWindow: 200_000, maxTokens: 32_000, creditMultiplier: 0.34, supportsImages: true },
  { id: "balanced-model", name: "Balanced", contextWindow: 256_000, maxTokens: 32_000, creditMultiplier: 0.59, supportsImages: true },
  { id: "primary-model", name: "Primary", contextWindow: 272_000, maxTokens: 72_000, creditMultiplier: 3.31, supportsImages: true },
  { id: "hy4-preview", name: "Hy4 Preview", contextWindow: 1_000_000, maxTokens: 64_000, creditMultiplier: 0.29, supportsImages: true },
  { id: "hy3", name: "Hy3", contextWindow: 192_000, maxTokens: 64_000, creditMultiplier: 0, supportsImages: true },
  { id: "deepseek-v4.1-flash-sg", name: "Deepseek-V4.1-Flash", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 0.11, supportsImages: true },
  { id: "gpt-6-astra", name: "GPT-6-Astra", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 6.67, supportsImages: true },
  { id: "gpt-6.1-sol", name: "GPT-6.1-Sol", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 1.33, supportsImages: true },
  { id: "gpt-6-sol", name: "GPT-6-Sol", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 1.33, supportsImages: true },
  { id: "gpt-6-luna", name: "GPT-6-Luna", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 0.07, supportsImages: true },
  { id: "gpt-5.6-sol", name: "GPT-5.6-Sol", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 3.47, supportsImages: true },
  { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 1.39, supportsImages: true },
  { id: "gpt-5.6-luna", name: "GPT-5.6-Luna", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 0.14, supportsImages: true },
  { id: "grok-4.7", name: "Grok-4.7", contextWindow: 500_000, maxTokens: 128_000, creditMultiplier: 1.9, supportsImages: true },
  { id: "gemini-3.8-flash", name: "Gemini-3.8-Flash", contextWindow: 1_000_000, maxTokens: 65_536, creditMultiplier: 0.95, supportsImages: true },
  { id: "glm-5.3", name: "GLM-5.3", contextWindow: 1_000_000, maxTokens: 48_000, creditMultiplier: 0.69, supportsImages: true },
  { id: "glm-5.3-flash", name: "GLM-5.3-Flash", contextWindow: 1_000_000, maxTokens: 32_000, creditMultiplier: 0.08, supportsImages: true },
  { id: "kimi-k3.1-pro", name: "Kimi-K3.1-Pro", contextWindow: 1_000_000, maxTokens: 32_000, creditMultiplier: 0.97, supportsImages: true },
  { id: "kimi-k3.1-pro-highspeed", name: "Kimi-K3.1-Pro-Highspeed", contextWindow: 1_000_000, maxTokens: 32_000, creditMultiplier: 1.56, supportsImages: true },
  { id: "kimi-k3", name: "Kimi-K3", contextWindow: 1_000_000, maxTokens: 32_000, creditMultiplier: 1.62, supportsImages: true },
  { id: "minimax-m3.1-flash", name: "MiniMax-M3.1-Flash", contextWindow: 1_000_000, maxTokens: 128_000, creditMultiplier: 0.08, supportsImages: true },
];

export function fallbackModelsFor(region: "cn" | "global"): readonly FallbackModel[] {
  return region === "global" ? FALLBACK_MODELS_GLOBAL : FALLBACK_MODELS_CN;
}
