import { LLMError, type StreamChunk, type Summary5W1H } from "../core/types";
import { logger } from "../core/logger";

/**
 * OpenAI 兼容协议适配器：DeepSeek / 智谱 GLM / Kimi / 通义千问兼容模式 / OpenRouter / OpenAI…
 * 与 gemini.ts 同构：streamGenerate 产出归一化 StreamChunk，generateJson 强制 5W1H。
 * 配置 OPENAI_API_KEY 后经 adapters/llm.ts 分发，优先于 Gemini（Google 账号受限时的逃生门）。
 */
export interface OpenAIEnv {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
}

/** 默认 DeepSeek：注册门槛低、中文强、OpenAI 协议全兼容 */
const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-chat";

export const openaiConfigured = (env: OpenAIEnv): boolean => !!env.OPENAI_API_KEY?.trim();

const baseUrlOf = (env: OpenAIEnv): string =>
  (env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
const modelOf = (env: OpenAIEnv): string => env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;

const authHeaders = (env: OpenAIEnv): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}`,
});

function friendlyError(status: number): LLMError {
  if (status === 401) return new LLMError(401, "OPENAI_API_KEY 无效，请检查 secret");
  if (status === 402) return new LLMError(402, "供应商账户余额不足，请充值后重试");
  if (status === 403) return new LLMError(403, "API_KEY 无权访问当前模型");
  if (status === 404) return new LLMError(404, "OPENAI_MODEL 不存在（或 OPENAI_BASE_URL 填错）");
  if (status === 429) return new LLMError(429, "模型调用被限流，请稍等一分钟再试");
  return new LLMError(status, `模型请求失败（${status}），请稍后重试`);
}

/**
 * 流式生成。SSE 解析含跨 chunk 缓冲（同 gemini.ts）；
 * finish_reason 归一化为 Gemini 风格：stop→STOP、length→MAX_TOKENS（前端已按此提示截断）。
 */
export async function* streamGenerate(
  env: OpenAIEnv,
  system: string,
  user: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const model = modelOf(env);
  const res = await fetch(`${baseUrlOf(env)}/chat/completions`, {
    method: "POST",
    headers: authHeaders(env),
    signal,
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.7,
      // 中文长文章需要高输出上限；8192 是 DeepSeek/Kimi/GLM 都安全接受的最大公约数
      max_tokens: 8192,
    }),
  });
  if (!res.ok || !res.body) {
    logger.error("OpenAI 兼容流式请求失败", { model, status: res.status });
    throw friendlyError(res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data || data === "[DONE]") continue;
      try {
        const choice = (
          JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
          }
        ).choices?.[0];
        const text = choice?.delta?.content ?? "";
        const finishReason = choice?.finish_reason
          ? choice.finish_reason === "length"
            ? "MAX_TOKENS"
            : choice.finish_reason.toUpperCase()
          : undefined;
        if (text || finishReason) {
          yield { text: text || undefined, finishReason };
        }
      } catch {
        /* 忽略不完整残帧 */
      }
    }
  }
}

/** json_object 模式要求提示词含 "json"，后缀同时充当 schema 兜底（供应商对 strict schema 支持不一） */
const JSON_SUFFIX =
  "请只输出一个 JSON 对象，六个键 who、what、when、where、why、how 均为字符串。不要输出任何其他文字或代码块标记。";

/** 个别模型偶尔仍包 ```json 围栏，剥掉再解析 */
const stripCodeFence = (s: string): string => {
  const t = s.trim();
  return t.startsWith("```") ? t.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "") : t;
};

/** 非流式结构化输出：response_format 强制 JSON，解析偶发失败自动重试一次（同 gemini.ts） */
export async function generateJson(
  env: OpenAIEnv,
  system: string,
  user: string,
): Promise<Summary5W1H> {
  const model = modelOf(env);
  const call = async (): Promise<Summary5W1H> => {
    const res = await fetch(`${baseUrlOf(env)}/chat/completions`, {
      method: "POST",
      headers: authHeaders(env),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${user}\n\n${JSON_SUFFIX}` },
        ],
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      logger.error("OpenAI 兼容结构化请求失败", { model, status: res.status });
      throw friendlyError(res.status);
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(stripCodeFence(text)) as Summary5W1H;
    for (const key of ["who", "what", "when", "where", "why", "how"] as const) {
      if (typeof parsed[key] !== "string") throw new Error(`5W1H 字段缺失: ${key}`);
    }
    return parsed;
  };
  try {
    return await call();
  } catch (e) {
    if (e instanceof LLMError) throw e; // 限流/鉴权类错误不重试
    logger.warn("OpenAI 兼容结构化响应不合法，自动重试一次", {
      model,
      error: e instanceof Error ? e.message : String(e),
    });
    return await call();
  }
}
