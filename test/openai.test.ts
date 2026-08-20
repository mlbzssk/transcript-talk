import { afterEach, describe, expect, it, vi } from "vitest";
import { generateJson, openaiConfigured, streamGenerate } from "../src/adapters/openai";
import { LLMError } from "../src/core/types";

const env = { OPENAI_API_KEY: "test-key" };

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 构造 SSE 流响应（同 gemini.test.ts） */
const sseResponse = (frames: string[], status = 200): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(stream, { status });
};

describe("openaiConfigured", () => {
  it("有 Key 返回 true，无 Key/空白 Key 返回 false", () => {
    expect(openaiConfigured({ OPENAI_API_KEY: "sk-x" })).toBe(true);
    expect(openaiConfigured({})).toBe(false);
    expect(openaiConfigured({ OPENAI_API_KEY: "  " })).toBe(false);
  });
});

describe("streamGenerate", () => {
  it("解析 SSE 帧并产出增量文本，finish_reason 归一化为 STOP", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        `data: {"choices":[{"delta":{"content":"你好"}}]}\n\n`,
        `data: {"choices":[{"delta":{"content":"，世界"},"finish_reason":null}]}\n\n`,
        `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n`,
        `data: [DONE]\n\n`,
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const chunks: { text?: string; finishReason?: string }[] = [];
    for await (const c of streamGenerate(env, "sys", "user")) chunks.push(c);
    expect(chunks.map((c) => c.text ?? "").join("")).toBe("你好，世界");
    expect(chunks.at(-1)?.finishReason).toBe("STOP");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("finish_reason=length 归一化为 MAX_TOKENS（对齐前端截断提示）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          `data: {"choices":[{"delta":{"content":"x"},"finish_reason":"length"}]}\n\n`,
          `data: [DONE]\n\n`,
        ]),
      ),
    );
    const chunks: { finishReason?: string }[] = [];
    for await (const c of streamGenerate(env, "sys", "user")) chunks.push(c);
    expect(chunks.at(-1)?.finishReason).toBe("MAX_TOKENS");
  });

  it("跨 chunk 缓冲：一个事件被 TCP 分包切开也能解析", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([`data: {"choices":[{"delta":{"content":"前半`, `段"}}]}\n\n`, `data: [DONE]\n\n`]),
      ),
    );
    const chunks: string[] = [];
    for await (const c of streamGenerate(env, "sys", "user")) {
      if (c.text) chunks.push(c.text);
    }
    expect(chunks.join("")).toBe("前半段");
  });

  it("非 2xx 响应抛 LLMError（含状态码）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 401 })));
    await expect(streamGenerate(env, "sys", "user").next()).rejects.toBeInstanceOf(LLMError);
    await expect(streamGenerate(env, "sys", "user").next()).rejects.toMatchObject({ status: 401 });
  });
});

describe("generateJson", () => {
  const summary = { who: "a", what: "b", when: "c", where: "d", why: "e", how: "f" };
  const okBody = JSON.stringify({ choices: [{ message: { content: JSON.stringify(summary) } }] });

  it("解析结构化 5W1H 输出", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(okBody, { status: 200 })));
    await expect(generateJson(env, "sys", "user")).resolves.toEqual(summary);
  });

  it("剥离 ```json 围栏后解析", async () => {
    const fenced = JSON.stringify({
      choices: [{ message: { content: "```json\n" + JSON.stringify(summary) + "\n```" } }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(fenced, { status: 200 })));
    await expect(generateJson(env, "sys", "user")).resolves.toEqual(summary);
  });

  it("JSON 偶发不合法时自动重试一次", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(okBody, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateJson(env, "sys", "user")).resolves.toEqual(summary);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("LLMError（如限流）不重试直接抛", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("quota", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateJson(env, "sys", "user")).rejects.toBeInstanceOf(LLMError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("5W1H 字段缺失时报错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"who":"只有who"}' } }] }), {
          status: 200,
        }),
      ),
    );
    await expect(generateJson(env, "sys", "user")).rejects.toThrow();
  });
});
