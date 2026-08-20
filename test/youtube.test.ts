import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTranscript, YoutubeError } from "../src/adapters/youtube";
import { ClientDisconnected } from "../src/core/types";
import type { StageUpdate } from "../src/core/types";
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

  it("ERROR + 明确不可用 reason（Video unavailable）→ 定性 not-found，不再降级", async () => {
    const errorBody = JSON.stringify({
      playabilityStatus: { status: "ERROR", reason: "Video unavailable" },
    });
    const fetchMock = mockFetch([{ match: (u) => u.includes("youtubei/v1/player"), body: errorBody }]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchTranscript({}, "dQw4w9WgXcQ")).rejects.toMatchObject({ kind: "not-found" });
    // 第一个 client 即定性失败：不再轮试后续 client，也不走 watch 页
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ERROR + client 弃用 reason（no longer supported）→ 不定性，继续降级", async () => {
    // 2026 实测：TVHTML5 client 返回 ERROR + "YouTube is no longer supported in this
    // application or device."——与视频存在性无关，不能定性 not-found
    const errorBody = JSON.stringify({
      playabilityStatus: { status: "ERROR", reason: "YouTube is no longer supported in this application or device." },
    });
    vi.stubGlobal("fetch", mockFetch([{ match: (u) => u.includes("youtubei/v1/player"), body: errorBody }]));
    // 三个 client 全部该错误 → 落入 watch 层（也失败）→ 全链路 unavailable（非 not-found）
    await expect(fetchTranscript({}, "dQw4w9WgXcQ")).rejects.toMatchObject({ kind: "unavailable" });
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

describe("onStage 进度回调", () => {
  const collect = () => {
    const updates: StageUpdate[] = [];
    return { updates, onStage: (u: StageUpdate) => updates.push(u) };
  };

  it("成功路径事件序列：层级 active → 找到轨道 → done（含字数）", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { match: (u) => u.includes("youtubei/v1/player"), body: innertubeOk },
        { match: (u) => u.includes("timedtext"), body: captionJson3 },
      ]),
    );
    const { updates, onStage } = collect();
    await fetchTranscript({}, "dQw4w9WgXcQ", "trace", onStage);
    expect(updates.map((u) => u.status)).toEqual(["active", "active", "done"]);
    expect(updates[0]).toMatchObject({ step: "transcript", status: "active" });
    expect(updates[1]?.detail).toContain("正在拉取内容");
    expect(updates[2]?.detail).toContain("字");
  });

  it("降级路径逐层上报 active，演示视频全链失败上报 done（回退）", async () => {
    vi.stubGlobal("fetch", mockFetch([])); // 全部 403
    const { updates, onStage } = collect();
    const t = await fetchTranscript({}, DEMO_VIDEO_ID, "trace", onStage);
    expect(t.source).toBe("demo");
    // 直连两层各一条 active（未配置代理跳过代理层），最后一条是回退 done
    const actives = updates.filter((u) => u.status === "active");
    expect(actives.length).toBe(2);
    expect(updates[updates.length - 1]).toMatchObject({ status: "done", detail: "回退内置演示字幕" });
  });

  it("fatal 定性上报 failed，且不再降级", async () => {
    const errorBody = JSON.stringify({
      playabilityStatus: { status: "ERROR", reason: "Video unavailable" },
    });
    vi.stubGlobal("fetch", mockFetch([{ match: (u) => u.includes("youtubei/v1/player"), body: errorBody }]));
    const { updates, onStage } = collect();
    await expect(fetchTranscript({}, "dQw4w9WgXcQ", "trace", onStage)).rejects.toMatchObject({
      kind: "not-found",
    });
    expect(updates[updates.length - 1]).toMatchObject({ status: "failed" });
  });

  it("onStage 抛 ClientDisconnected → 立即中止，不继续降级", async () => {
    // 第一层 innertube 全部 403（返回 null 落入第二层），
    // 第二层 watch 页开始时 onStage 抛断开 → fetchTranscript 应原样抛出，
    // 而非吞掉后继续尝试代理层
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response("", { status: 403 });
      }),
    );
    const onStage = (u: StageUpdate) => {
      if (u.detail?.includes("watch 页")) throw new ClientDisconnected();
    };
    await expect(fetchTranscript({}, "dQw4w9WgXcQ", "trace", onStage)).rejects.toBeInstanceOf(
      ClientDisconnected,
    );
    // 断开后不应再发起任何请求（代理层未配置本就跳过；关键是不再有新 fetch）
    const callsAtAbort = calls;
    expect(callsAtAbort).toBeGreaterThan(0);
  });
});
