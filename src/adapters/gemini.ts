import { LLMError, type StreamChunk, type Summary5W1H } from "../core/types";
import { logger } from "../core/logger";

export interface GeminiEnv {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

/** 继承统一 LLMError：routes 只需 instanceof LLMError 即可同时覆盖两家供应商 */
export class GeminiError extends LLMError {
  constructor(status: number, message: string) {
    super(status, message);
  }
}

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/** 2.5-flash 将于 2026-10-16 退役，默认用官方迁移目标 3.5-flash */
const DEFAULT_MODEL = "gemini-3.5-flash";

export const geminiConfigured = (env: GeminiEnv): boolean => !!env.GEMINI_API_KEY;

const modelOf = (env: GeminiEnv): string => env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

/** 压低 thinking 保首字延迟：Gemini 3+ 与 latest 别名用 thinkingLevel=low（3.x 无法彻底关闭），2.x flash 用 thinkingBudget=0，其余不设 */
const thinkingLow = (model: string): object => {
  if (/^gemini-[3-9]|flash-latest/.test(model)) return { thinkingConfig: { thinkingLevel: "low" } };
  if (/flash/.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  return {};
};

function friendlyError(status: number, raw: string): GeminiError {
  if (status === 429) return new GeminiError(429, "Gemini 免费额度已限流，请稍等一分钟再试");
  if (status === 400 && /api[_ ]?key/i.test(raw)) return new GeminiError(400, "GEMINI_API_KEY 无效，请检查 secret");
  if (status === 403) return new GeminiError(403, "GEMINI_API_KEY 无权访问当前模型");
  if (status === 404) return new GeminiError(404, "GEMINI_MODEL 配置的模型不存在");
  return new GeminiError(status, `Gemini 请求失败（${status}），请稍后重试`);
}

/**
 * 流式生成。SSE 解析含跨 chunk 缓冲（一个事件可能被 TCP 分包切成两半）。
 * key 走请求头（x-goog-api-key），避免出现在任何 URL/日志里。
 */
export async function* streamGenerate(
  env: GeminiEnv,
  system: string,
  user: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const model = modelOf(env);
  const res = await fetch(`${API_BASE}/${model}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 32768,
        ...thinkingLow(model),
      },
    }),
  });
  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    logger.error("Gemini 流式请求失败", { model, status: res.status });
    throw friendlyError(res.status, raw);
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
      if (!data) continue;
      try {
        const cand = (JSON.parse(data) as { candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }> }).candidates?.[0];
        const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
        if (text || cand?.finishReason) {
          yield { text: text || undefined, finishReason: cand?.finishReason };
        }
      } catch {
        /* 忽略不完整残帧 */
      }
    }
  }
}

const SCHEMA_5W1H = {
  type: "OBJECT",
  properties: {
    who: { type: "STRING", description: "核心人物/主体" },
    what: { type: "STRING", description: "核心事件/主题" },
    when: { type: "STRING", description: "涉及时期" },
    where: { type: "STRING", description: "涉及领域/场景" },
    why: { type: "STRING", description: "核心动因" },
    how: { type: "STRING", description: "实现路径/方式" },
  },
  required: ["who", "what", "when", "where", "why", "how"],
} as const;

/** 非流式结构化输出：responseSchema 强制 5W1H JSON，解析偶发失败自动重试一次 */
export async function generateJson(
  env: GeminiEnv,
  system: string,
  user: string,
): Promise<Summary5W1H> {
  const model = modelOf(env);
  const call = async (): Promise<Summary5W1H> => {
    const res = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: SCHEMA_5W1H,
          ...thinkingLow(model),
        },
      }),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      logger.error("Gemini 结构化请求失败", { model, status: res.status });
      throw friendlyError(res.status, raw);
    }
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    const parsed = JSON.parse(text) as Summary5W1H;
    for (const key of ["who", "what", "when", "where", "why", "how"] as const) {
      if (typeof parsed[key] !== "string") throw new Error(`5W1H 字段缺失: ${key}`);
    }
    return parsed;
  };
  try {
    return await call();
  } catch (e) {
    if (e instanceof GeminiError) throw e; // 限流/鉴权类错误不重试
    // 解析类失败（非法 JSON/字段缺失）：重试可见，排障能看到首次失败原因
    logger.warn("Gemini 结构化响应不合法，自动重试一次", {
      model,
      error: e instanceof Error ? e.message : String(e),
    });
    return await call(); // JSON 偶发不合法，重试一次
  }
}
