import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTranscript, YoutubeError } from "../src/adapters/youtube";
import { handleGenerate } from "../src/routes/generate";
import type { SseEvent } from "../src/core/types";
import { DEMO_TRANSCRIPT, DEMO_VIDEO_ID } from "../src/demo-transcript";

vi.mock("../src/adapters/youtube", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/adapters/youtube")>();
  return { ...mod, fetchTranscript: vi.fn() };
});

function genRequest(url: string, extra?: string): Request {
  return new Request("http://t/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: extra ?? JSON.stringify({ url }),
  });
}

async function readUntil(
  res: Response,
  pred: (ev: SseEvent) => boolean,
  max = 30,
): Promise<SseEvent[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: SseEvent[] = [];
  try {
    while (events.length < max) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const ev = JSON.parse(line.slice(5).trim()) as SseEvent;
        events.push(ev);
        if (pred(ev)) {
          await reader.cancel();
          return events;
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already cancelled */
    }
  }
  return events;
}

describe("handleGenerate", () => {
  afterEach(() => {
    vi.mocked(fetchTranscript).mockReset();
  });

  it("非法 JSON 返回 400", async () => {
    const res = await handleGenerate(genRequest("x", "not-json"), {});
    expect(res.status).toBe(400);
  });

  it("无法识别链接返回 400", async () => {
    const res = await handleGenerate(genRequest("https://example.com"), {});
    expect(res.status).toBe(400);
  });

  it("演示模式非演示视频立刻 error", async () => {
    const res = await handleGenerate(genRequest("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), {});
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain('"type":"error"');
    expect(body).toContain("演示模式");
  });

  it("仅配 DeepSeek 时非演示视频不进演示模式（会去抓字幕）", async () => {
    vi.mocked(fetchTranscript).mockRejectedValue(new YoutubeError("该视频没有可用字幕", "no-captions"));
    const res = await handleGenerate(genRequest("https://www.youtube.com/watch?v=abcdefghijk"), {
      DEEPSEEK_API_KEY: "d",
    });
    const events = await readUntil(res, (ev) => ev.type === "error");
    expect(events.some((e) => e.type === "error" && e.message.includes("字幕"))).toBe(true);
    expect(fetchTranscript).toHaveBeenCalled();
  });

  it("演示模式先发 transcript stage，再 session，再 generate stage", async () => {
    const res = await handleGenerate(
      genRequest(`https://www.youtube.com/watch?v=${DEMO_VIDEO_ID}`),
      {},
    );
    const events = await readUntil(
      res,
      (ev) => ev.type === "stage" && ev.step === "generate" && ev.status === "active",
    );
    expect(events[0]).toMatchObject({ type: "stage", step: "transcript", status: "active" });
    expect(events.some((e) => e.type === "session")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "stage", step: "generate", status: "active" });
  });

  it("字幕抓取完成前已下发 transcript stage", async () => {
    let release!: (t: typeof DEMO_TRANSCRIPT) => void;
    vi.mocked(fetchTranscript).mockImplementation(async (_env, _id, _tid, onStage) => {
      onStage?.({ step: "transcript", status: "active", detail: "正在获取字幕…" });
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const res = await handleGenerate(genRequest("https://www.youtube.com/watch?v=abcdefghijk"), {
      GEMINI_API_KEY: "test-key",
    });
    const events = await readUntil(
      res,
      (ev) => ev.type === "stage" && ev.step === "transcript" && ev.status === "active",
    );
    expect(events[0]).toMatchObject({
      type: "stage",
      step: "transcript",
      status: "active",
      detail: "正在获取字幕…",
    });
    release(DEMO_TRANSCRIPT);
  });

  it("字幕失败作为流内 error，且不阻塞首个 stage", async () => {
    vi.mocked(fetchTranscript).mockImplementation(async (_env, _id, _tid, onStage) => {
      onStage?.({ step: "transcript", status: "active", detail: "正在获取字幕…" });
      throw new YoutubeError("该视频没有可用字幕", "no-captions");
    });
    const res = await handleGenerate(genRequest("https://www.youtube.com/watch?v=abcdefghijk"), {
      GEMINI_API_KEY: "test-key",
    });
    const events = await readUntil(res, (ev) => ev.type === "error");
    expect(events[0]).toMatchObject({ type: "stage", step: "transcript", status: "active" });
    expect(events[1]).toMatchObject({ type: "error", message: "该视频没有可用字幕" });
  });
});
