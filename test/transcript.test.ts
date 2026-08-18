import { describe, expect, it } from "vitest";
import {
  extractPlayerFromHtml,
  extractTracks,
  extractVideoId,
  MAX_TRANSCRIPT_CHARS,
  parseJson3,
  pickTrack,
  truncateTranscript,
} from "../src/core/transcript";
import type { CaptionTrack } from "../src/core/types";

const track = (languageCode: string, baseUrl = `https://x/${languageCode}`): CaptionTrack => ({
  languageCode,
  name: languageCode,
  baseUrl,
});

describe("extractVideoId", () => {
  it("识别 watch 链接", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("识别 youtu.be 短链", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ?t=10")).toBe("dQw4w9WgXcQ");
  });
  it("识别 shorts / embed 链接", () => {
    expect(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("识别裸 ID", () => {
    expect(extractVideoId("  dQw4w9WgXcQ  ")).toBe("dQw4w9WgXcQ");
  });
  it("非法输入返回 null", () => {
    expect(extractVideoId("")).toBeNull();
    expect(extractVideoId("https://example.com/watch?v=short")).toBeNull();
  });
});

describe("pickTrack", () => {
  it("中文优先", () => {
    expect(pickTrack([track("en"), track("zh-Hans")])?.languageCode).toBe("zh-Hans");
  });
  it("无中文则英文", () => {
    expect(pickTrack([track("ja"), track("en-US")])?.languageCode).toBe("en-US");
  });
  it("都没有则取首轨", () => {
    expect(pickTrack([track("ja"), track("fr")])?.languageCode).toBe("ja");
  });
  it("空数组返回 null", () => {
    expect(pickTrack([])).toBeNull();
  });
});

describe("parseJson3", () => {
  it("合并 segs 并按行过滤空段", () => {
    const body = JSON.stringify({
      events: [
        { segs: [{ utf8: "你好" }, { utf8: "，世界" }] },
        { segs: [{ utf8: "   " }] },
        { segs: [{ utf8: "第二行" }] },
      ],
    });
    expect(parseJson3(body)).toBe("你好，世界\n第二行");
  });
  it("非法 JSON 返回空串", () => {
    expect(parseJson3("not-json")).toBe("");
    expect(parseJson3("")).toBe("");
  });
  it("缺 events 字段返回空串", () => {
    expect(parseJson3("{}")).toBe("");
  });
});

describe("extractTracks", () => {
  it("提取标题/作者/轨道并跳过无 baseUrl 或 languageCode 的轨道", () => {
    const player = {
      videoDetails: { title: "标题", author: "作者" },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { languageCode: "en", baseUrl: "https://x/en", name: { runs: [{ text: "English" }] } },
            { languageCode: "zh", baseUrl: "https://x/zh", name: { simpleText: "中文" } },
            { baseUrl: "https://x/nolang" },
            { languageCode: "nourl" },
          ],
        },
      },
    };
    const r = extractTracks(player);
    expect(r.title).toBe("标题");
    expect(r.author).toBe("作者");
    expect(r.tracks).toHaveLength(2);
    expect(r.tracks[0]?.name).toBe("English");
    expect(r.tracks[1]?.name).toBe("中文");
  });
  it("无字幕轨返回空数组", () => {
    const r = extractTracks({ videoDetails: { title: "t" } });
    expect(r.tracks).toEqual([]);
    expect(r.title).toBe("t");
  });
});

describe("extractPlayerFromHtml", () => {
  it("解析明文 JSON 对象", () => {
    const html = `<script>var ytInitialPlayerResponse = {"videoDetails":{"title":"Hello"}};</script>`;
    const p = extractPlayerFromHtml(html) as { videoDetails?: { title?: string } };
    expect(p?.videoDetails?.title).toBe("Hello");
  });
  it("解析整体转义字符串形式", () => {
    // 构造 \"...\" 转义后的嵌入形式
    const obj = JSON.stringify({ videoDetails: { title: "转义标题" } });
    const escaped = obj.replace(/"/g, '\\"');
    const html = `<script>ytInitialPlayerResponse = "${escaped}";</script>`;
    const p = extractPlayerFromHtml(html) as { videoDetails?: { title?: string } };
    expect(p?.videoDetails?.title).toBe("转义标题");
  });
  it("无 player 响应返回 null", () => {
    expect(extractPlayerFromHtml("<html></html>")).toBeNull();
  });
});

describe("truncateTranscript", () => {
  it("未超限原样返回", () => {
    expect(truncateTranscript("短文本")).toBe("短文本");
  });
  it("超限截断并追加标记", () => {
    const long = "字".repeat(MAX_TRANSCRIPT_CHARS + 10);
    const out = truncateTranscript(long);
    expect(out).toContain("已截断");
    // 正文部分截断到上限，标记是额外追加的
    expect(out.startsWith("字".repeat(MAX_TRANSCRIPT_CHARS))).toBe(true);
  });
});
