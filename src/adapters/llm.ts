import type { AppEnv, StreamChunk, Summary5W1H } from "../core/types";
import {
  generateJson as geminiGenerateJson,
  geminiConfigured,
  streamGenerate as geminiStreamGenerate,
} from "./gemini";
import {
  generateJson as openaiGenerateJson,
  openaiConfigured,
  streamGenerate as openaiStreamGenerate,
} from "./openai";

export { LLMError } from "../core/types";

// 重新导出两家 adapted 的 configured 检查，供入口等需要分别判断供应商状态的场景使用
export { geminiConfigured } from "./gemini";
export { openaiConfigured } from "./openai";

export type LLMProvider = "openai" | "gemini" | "none";

/**
 * 供应商分发门面（routes 只认这里导出的统一接口）：
 * OPENAI_API_KEY 优先——两套都配置时走 OpenAI 兼容通道（Google 账号受限场景的逃生门）；
 * 否则回落 Gemini；都没配 → 演示模式（routes 用 llmConfigured 判断）。
 */
export const providerOf = (env: AppEnv): LLMProvider =>
  openaiConfigured(env) ? "openai" : geminiConfigured(env) ? "gemini" : "none";

export const llmConfigured = (env: AppEnv): boolean => providerOf(env) !== "none";

export async function* streamGenerate(
  env: AppEnv,
  system: string,
  user: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  if (openaiConfigured(env)) {
    yield* openaiStreamGenerate(env, system, user, signal);
    return;
  }
  yield* geminiStreamGenerate(env, system, user, signal);
}

export async function generateJson(
  env: AppEnv,
  system: string,
  user: string,
): Promise<Summary5W1H> {
  return openaiConfigured(env)
    ? openaiGenerateJson(env, system, user)
    : geminiGenerateJson(env, system, user);
}
