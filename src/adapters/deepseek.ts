import type { Summary5W1H } from "../core/types";
import { logger } from "../core/logger";
import type { StreamChunk } from "./gemini";

export interface DeepSeekEnv {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
}

export class DeepSeekError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const API_URL = "https://api.deepseek.com/chat/completions";
/** 2026-07 后 deepseek-chat 别名已下线，默认走 v4 flash */
const DEFAULT_MODEL = "deepseek-v4-flash";

export const deepseekConfigured = (env: DeepSeekEnv): boolean => !!env.DEEPSEEK_API_KEY;

const modelOf = (env: DeepSeekEnv): string => env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;

function friendlyError(status: number, raw: string): DeepSeekError {
  if (status === 429) return new DeepSeekError(429, "DeepSeek 额度已限流，请稍后再试");
  if (status === 401) return new DeepSeekError(401, "DEEPSEEK_API_KEY 无效，请检查 secret");
  if (status === 402) return new DeepSeekError(402, "DeepSeek 余额不足，请充值后再试");
  if (status === 403) return new DeepSeekError(403, "DEEPSEEK_API_KEY 无权访问当前模型");
  if (status === 404) return new DeepSeekError(404, "DEEPSEEK_MODEL 配置的模型不存在");
  if (status === 400 && /api[_ ]?key|authentication|unauthorized/i.test(raw)) {
    return new DeepSeekError(400, "DEEPSEEK_API_KEY 无效，请检查 secret");
  }
  return new DeepSeekError(status, `DeepSeek 请求失败（${status}），请稍后重试`);
}

/**
 * OpenAI 兼容流式生成。SSE 解析含跨 chunk 缓冲；key 走 Authorization Bearer。
 */
export async function* streamGenerate(
  env: DeepSeekEnv,
  system: string,
  user: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const model = modelOf(env);
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY!}`,
    },
    signal,
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0.7,
      max_tokens: 8192,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    logger.error("DeepSeek 流式请求失败", { model, status: res.status });
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
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
        };
        const choice = json.choices?.[0];
        const text = choice?.delta?.content;
        const finishReason = choice?.finish_reason ?? undefined;
        if (text || finishReason) {
          yield {
            text: text || undefined,
            finishReason: finishReason === "length" ? "MAX_TOKENS" : finishReason || undefined,
          };
        }
      } catch {
        /* 忽略不完整残帧 */
      }
    }
  }
}

const JSON_SYSTEM_SUFFIX =
  "\n\n你必须只输出一个 JSON 对象，字段为 who/what/when/where/why/how（均为字符串），不要输出其它文字或 Markdown。";

/** 非流式 JSON：response_format=json_object；解析偶发失败自动重试一次 */
export async function generateJson(
  env: DeepSeekEnv,
  system: string,
  user: string,
): Promise<Summary5W1H> {
  const model = modelOf(env);
  const call = async (): Promise<Summary5W1H> => {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY!}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system + JSON_SYSTEM_SUFFIX },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      logger.error("DeepSeek 结构化请求失败", { model, status: res.status });
      throw friendlyError(res.status, raw);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as Summary5W1H;
    for (const key of ["who", "what", "when", "where", "why", "how"] as const) {
      if (typeof parsed[key] !== "string") throw new Error(`5W1H 字段缺失: ${key}`);
    }
    return parsed;
  };
  try {
    return await call();
  } catch (e) {
    if (e instanceof DeepSeekError) throw e;
    logger.warn("DeepSeek 结构化响应不合法，自动重试一次", {
      model,
      error: e instanceof Error ? e.message : String(e),
    });
    return await call();
  }
}
