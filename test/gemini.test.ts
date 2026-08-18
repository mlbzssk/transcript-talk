import { afterEach, describe, expect, it, vi } from "vitest";
import { generateJson, geminiConfigured, GeminiError, streamGenerate } from "../src/adapters/gemini";

const env = { GEMINI_API_KEY: "test-key" };

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 构造 SSE 流响应 */
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

describe("geminiConfigured", () => {
  it("有 Key 返回 true，无 Key 返回 false", () => {
    expect(geminiConfigured({ GEMINI_API_KEY: "x" })).toBe(true);
    expect(geminiConfigured({})).toBe(false);
    expect(geminiConfigured({ GEMINI_API_KEY: "" })).toBe(false);
  });
});

describe("streamGenerate", () => {
  it("解析 SSE 帧并产出增量文本", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        `data: {"candidates":[{"content":{"parts":[{"text":"你好"}]},"finishReason":null}]}\n\n`,
        `data: {"candidates":[{"content":{"parts":[{"text":"，世界"}]},"finishReason":"STOP"}]}\n\n`,
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    for await (const c of streamGenerate(env, "sys", "user")) {
      if (c.text) chunks.push(c.text);
    }
    expect(chunks.join("")).toBe("你好，世界");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("跨 chunk 缓冲：一个事件被 TCP 分包切开也能解析", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        `data: {"candidates":[{"content":{"parts":[{"text":"前半`,
        `段"}]},"finishReason":"STOP"}]}\n\n`,
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    for await (const c of streamGenerate(env, "sys", "user")) {
      if (c.text) chunks.push(c.text);
    }
    expect(chunks.join("")).toBe("前半段");
  });
  it("非 2xx 响应抛 GeminiError（含友好信息）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("quota", { status: 429 })));
    const gen = streamGenerate(env, "sys", "user");
    await expect(gen.next()).rejects.toMatchObject({ status: 429 });
  });
});

describe("generateJson", () => {
  const summary = { who: "a", what: "b", when: "c", where: "d", why: "e", how: "f" };

  it("解析结构化 5W1H 输出", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(summary) }] } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateJson(env, "sys", "user")).resolves.toEqual(summary);
  });
  it("JSON 偶发不合法时自动重试一次", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not-json" }] } }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(summary) }] } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateJson(env, "sys", "user")).resolves.toEqual(summary);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("GeminiError（如限流）不重试直接抛", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("quota", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateJson(env, "sys", "user")).rejects.toBeInstanceOf(GeminiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("5W1H 字段缺失时报错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"who":"只有who"}' }] } }] }),
          { status: 200 },
        ),
      ),
    );
    await expect(generateJson(env, "sys", "user")).rejects.toThrow();
  });
});
