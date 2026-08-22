import type { Summary5W1H } from "../core/types";
import { logger } from "../core/logger";
import {
  GeminiError,
  geminiConfigured,
  generateJson as geminiGenerateJson,
  streamGenerate as geminiStream,
  type GeminiEnv,
  type StreamChunk,
} from "./gemini";
import {
  DeepSeekError,
  deepseekConfigured,
  generateJson as deepseekGenerateJson,
  streamGenerate as deepseekStream,
  type DeepSeekEnv,
} from "./deepseek";

export type LlmEnv = GeminiEnv & DeepSeekEnv;

export type LlmProvider = "gemini" | "deepseek";

export class LlmError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type { StreamChunk };

/** 任一上游 Key 已配置 → 非演示模式 */
export const llmConfigured = (env: LlmEnv): boolean =>
  geminiConfigured(env) || deepseekConfigured(env);

export { geminiConfigured, deepseekConfigured };

/** 仅鉴权/权限类回退；429 限流与 5xx 不回退，避免掩盖真实故障 */
const isAuthError = (e: unknown): boolean => {
  if (e instanceof GeminiError || e instanceof DeepSeekError) {
    return e.status === 401 || e.status === 403;
  }
  return false;
};

/**
 * 路由策略：Gemini 优先 → 鉴权类失败且配了 DeepSeek 则回退 → 仅 DeepSeek → 都无则抛错。
 * 流式已产出正文后不再回退，避免拼出「半 Gemini 半 DeepSeek」文章。
 */
export async function* streamGenerate(
  env: LlmEnv,
  system: string,
  user: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk & { provider?: LlmProvider }> {
  if (geminiConfigured(env)) {
    let yielded = false;
    try {
      for await (const chunk of geminiStream(env, system, user, signal)) {
        yielded = true;
        yield { ...chunk, provider: "gemini" };
      }
      return;
    } catch (e) {
      if (yielded || !isAuthError(e) || !deepseekConfigured(env)) {
        if (e instanceof GeminiError) throw e;
        throw e;
      }
      logger.warn("Gemini 鉴权失败，回退 DeepSeek", {
        status: e instanceof GeminiError ? e.status : undefined,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (deepseekConfigured(env)) {
    for await (const chunk of deepseekStream(env, system, user, signal)) {
      yield { ...chunk, provider: "deepseek" };
    }
    return;
  }

  throw new LlmError(503, "未配置 GEMINI_API_KEY 或 DEEPSEEK_API_KEY");
}

/** 与 streamGenerate 相同的路由；鉴权失败可回退 DeepSeek */
export async function generateJson(
  env: LlmEnv,
  system: string,
  user: string,
): Promise<Summary5W1H> {
  if (geminiConfigured(env)) {
    try {
      return await geminiGenerateJson(env, system, user);
    } catch (e) {
      if (!isAuthError(e) || !deepseekConfigured(env)) {
        if (e instanceof GeminiError) throw e;
        throw e;
      }
      logger.warn("Gemini 结构化鉴权失败，回退 DeepSeek", {
        status: e instanceof GeminiError ? e.status : undefined,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (deepseekConfigured(env)) {
    return await deepseekGenerateJson(env, system, user);
  }

  throw new LlmError(503, "未配置 GEMINI_API_KEY 或 DEEPSEEK_API_KEY");
}

/** 把上游错误映射为用户可读文案（供 routes 使用） */
export function llmErrorMessage(e: unknown): string {
  if (e instanceof GeminiError || e instanceof DeepSeekError || e instanceof LlmError) {
    return e.message;
  }
  return "生成中断，请重试";
}

export function llmErrorStatus(e: unknown): number {
  if (e instanceof GeminiError || e instanceof DeepSeekError || e instanceof LlmError) {
    return e.status;
  }
  return 500;
}
