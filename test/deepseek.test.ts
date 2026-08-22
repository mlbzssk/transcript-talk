import { afterEach, describe, expect, it, vi } from "vitest";
import { deepseekConfigured, DeepSeekError, generateJson, streamGenerate } from "../src/adapters/deepseek";

const env = { DEEPSEEK_API_KEY: "test-key" };

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe("deepseekConfigured", () => {
  it("有 Key 返回 true，无 Key 返回 false", () => {
    expect(deepseekConfigured({ DEEPSEEK_API_KEY: "x" })).toBe(true);
    expect(deepseekConfigured({})).toBe(false);
    expect(deepseekConfigured({ DEEPSEEK_API_KEY: "" })).toBe(false);
  });
});

describe("streamGenerate", () => {
  it("解析 OpenAI 兼容 SSE 并产出增量文本", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        `data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n\n`,
        `data: {"choices":[{"delta":{"content":"，世界"},"finish_reason":"stop"}]}\n\n`,
        `data: [DONE]\n\n`,
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    for await (const c of streamGenerate(env, "sys", "user")) {
      if (c.text) chunks.push(c.text);
    }
    expect(chunks.join("")).toBe("你好，世界");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("非 2xx 抛 DeepSeekError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));
    const gen = streamGenerate(env, "sys", "user");
    await expect(gen.next()).rejects.toMatchObject({ status: 401 });
  });
});

describe("generateJson", () => {
  const summary = { who: "a", what: "b", when: "c", where: "d", why: "e", how: "f" };

  it("解析 JSON 输出", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(summary) } }] }), {
          status: 200,
        }),
      ),
    );
    await expect(generateJson(env, "sys", "user")).resolves.toEqual(summary);
  });

  it("鉴权错误不重试", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("auth", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateJson(env, "sys", "user")).rejects.toBeInstanceOf(DeepSeekError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
