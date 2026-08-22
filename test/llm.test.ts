import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateJson,
  llmConfigured,
  streamGenerate,
} from "../src/adapters/llm";
import { GeminiError } from "../src/adapters/gemini";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sseGemini = (text: string): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: {"candidates":[{"content":{"parts":[{"text":${JSON.stringify(text)}}]},"finishReason":"STOP"}]}\n\n`,
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
};

const sseDeepseek = (text: string): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: {"choices":[{"delta":{"content":${JSON.stringify(text)}},"finish_reason":"stop"}]}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
};

describe("llmConfigured", () => {
  it("任一 Key 即可", () => {
    expect(llmConfigured({})).toBe(false);
    expect(llmConfigured({ GEMINI_API_KEY: "g" })).toBe(true);
    expect(llmConfigured({ DEEPSEEK_API_KEY: "d" })).toBe(true);
    expect(llmConfigured({ GEMINI_API_KEY: "g", DEEPSEEK_API_KEY: "d" })).toBe(true);
  });
});

describe("streamGenerate 路由", () => {
  it("优先 Gemini", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseGemini("来自 Gemini"));
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    let provider: string | undefined;
    for await (const c of streamGenerate(
      { GEMINI_API_KEY: "g", DEEPSEEK_API_KEY: "d" },
      "sys",
      "user",
    )) {
      if (c.text) chunks.push(c.text);
      provider = c.provider;
    }
    expect(chunks.join("")).toBe("来自 Gemini");
    expect(provider).toBe("gemini");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("generativelanguage.googleapis.com");
  });

  it("仅 DeepSeek 时走 DeepSeek", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseDeepseek("来自 DeepSeek"));
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    let provider: string | undefined;
    for await (const c of streamGenerate({ DEEPSEEK_API_KEY: "d" }, "sys", "user")) {
      if (c.text) chunks.push(c.text);
      provider = c.provider;
    }
    expect(chunks.join("")).toBe("来自 DeepSeek");
    expect(provider).toBe("deepseek");
  });

  it("Gemini 403 时回退 DeepSeek", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("denied", { status: 403 }))
      .mockResolvedValueOnce(sseDeepseek("回退成功"));
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    let provider: string | undefined;
    for await (const c of streamGenerate(
      { GEMINI_API_KEY: "g", DEEPSEEK_API_KEY: "d" },
      "sys",
      "user",
    )) {
      if (c.text) chunks.push(c.text);
      provider = c.provider;
    }
    expect(chunks.join("")).toBe("回退成功");
    expect(provider).toBe("deepseek");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Gemini 403 且无 DeepSeek 时抛 GeminiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 403 })));
    const gen = streamGenerate({ GEMINI_API_KEY: "g" }, "sys", "user");
    await expect(gen.next()).rejects.toBeInstanceOf(GeminiError);
  });

  it("Gemini 429 不回退 DeepSeek", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("quota", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const gen = streamGenerate({ GEMINI_API_KEY: "g", DEEPSEEK_API_KEY: "d" }, "sys", "user");
    await expect(gen.next()).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("generateJson 路由", () => {
  const summary = { who: "a", what: "b", when: "c", where: "d", why: "e", how: "f" };

  it("Gemini 403 回退 DeepSeek JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("denied", { status: 403 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(summary) } }] }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      generateJson({ GEMINI_API_KEY: "g", DEEPSEEK_API_KEY: "d" }, "sys", "user"),
    ).resolves.toEqual(summary);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
