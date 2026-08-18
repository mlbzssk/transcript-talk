import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTranscript, YoutubeError } from "../src/adapters/youtube";
import { DEMO_VIDEO_ID } from "../src/demo-transcript";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const innertubeOk = JSON.stringify({
  playabilityStatus: { status: "OK" },
  videoDetails: { title: "T", author: "A" },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        { languageCode: "en", baseUrl: "https://timedtext?lang=en", name: { simpleText: "en" } },
      ],
    },
  },
});

const captionJson3 = JSON.stringify({ events: [{ segs: [{ utf8: "hello world" }] }] });

const watchHtml = `<html><script>var ytInitialPlayerResponse = ${innertubeOk};</script></html>`;

/** 按请求 URL 分流的 fetch mock */
function mockFetch(routes: Array<{ match: (url: string) => boolean; body: string; status?: number }>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (const r of routes) {
      if (r.match(url)) return new Response(r.body, { status: r.status ?? 200 });
    }
    return new Response("", { status: 403 }); // 未匹配视作风控拒绝
  });
}

describe("fetchTranscript 降级链", () => {
  it("层级① Innertube 直连成功", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { match: (u) => u.includes("youtubei/v1/player"), body: innertubeOk },
        { match: (u) => u.includes("timedtext"), body: captionJson3 },
      ]),
    );
    const t = await fetchTranscript({}, "dQw4w9WgXcQ", "trace-1");
    expect(t.source).toBe("innertube");
    expect(t.text).toBe("hello world");
    expect(t.title).toBe("T");
  });

  it("层级① 被风控 → 层级② watch 页 HTML 解析成功", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { match: (u) => u.includes("youtubei/v1/player"), body: "", status: 403 },
        { match: (u) => u.includes("/watch"), body: watchHtml },
        { match: (u) => u.includes("timedtext"), body: captionJson3 },
      ]),
    );
    const t = await fetchTranscript({}, "dQw4w9WgXcQ");
    expect(t.source).toBe("watch-html");
    expect(t.text).toBe("hello world");
  });

  it("playabilityStatus=ERROR → 定性 not-found，不再降级", async () => {
    const errorBody = JSON.stringify({ playabilityStatus: { status: "ERROR" } });
    const fetchMock = mockFetch([{ match: (u) => u.includes("youtubei/v1/player"), body: errorBody }]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchTranscript({}, "dQw4w9WgXcQ")).rejects.toMatchObject({ kind: "not-found" });
    // 第一个 client 即定性失败：不再轮试后续 client，也不走 watch 页
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("全链路失败且非演示视频 → 抛 unavailable", async () => {
    vi.stubGlobal("fetch", mockFetch([])); // 全部 403
    await expect(fetchTranscript({}, "dQw4w9WgXcQ")).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("全链路失败但请求的是演示视频 → 回退硬编码字幕", async () => {
    vi.stubGlobal("fetch", mockFetch([]));
    const t = await fetchTranscript({}, DEMO_VIDEO_ID);
    expect(t.source).toBe("demo");
    expect(t.text.length).toBeGreaterThan(0);
  });

  it("失败是 YoutubeError 实例（调用方可按类型识别）", async () => {
    vi.stubGlobal("fetch", mockFetch([]));
    try {
      await fetchTranscript({}, "dQw4w9WgXcQ");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(YoutubeError);
    }
  });
});

describe("traceId 日志串联", () => {
  it("降级链日志携带调用方传入的 traceId", async () => {
    vi.stubGlobal("fetch", mockFetch([]));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await fetchTranscript({}, "dQw4w9WgXcQ", "my-trace-id").catch(() => {});
    expect(errorSpy).toHaveBeenCalled();
    const lines = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(lines).toContain("my-trace-id");
    expect(lines).toContain("fetchTranscript 全链路失败");
  });
});
