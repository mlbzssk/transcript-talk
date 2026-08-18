import { describe, expect, it } from "vitest";
import { CORS, jsonResponse, sseEncode, sseFromEvents, sseHeaders } from "../src/routes/http";
import type { SseEvent } from "../src/core/types";

describe("jsonResponse", () => {
  it("序列化数据并带 CORS 与 JSON 头", () => {
    const res = jsonResponse({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
  it("默认 200 且可合并额外头", () => {
    const res = jsonResponse({ a: 1 }, undefined, { "X-Custom": "v" });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Custom")).toBe("v");
  });
});

describe("SSE 编码", () => {
  it("sseEncode 输出 data: 帧", () => {
    const ev: SseEvent = { type: "delta", text: "你好" };
    const bytes = sseEncode(ev);
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe(`data: ${JSON.stringify(ev)}\n\n`);
  });
  it("sseFromEvents 拼接多事件且带 SSE 头", async () => {
    const res = sseFromEvents([
      { type: "info", message: "a" },
      { type: "error", message: "b" },
    ]);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain('"type":"info"');
    expect(body).toContain('"type":"error"');
  });
  it("sseHeaders 包含 CORS 与禁用缓冲", () => {
    const h = sseHeaders();
    expect(h["Cache-Control"]).toContain("no-cache");
    expect(h["Access-Control-Allow-Origin"]).toBe("*");
  });
});

describe("CORS", () => {
  it("允许 POST/GET/OPTIONS", () => {
    expect(CORS["Access-Control-Allow-Methods"]).toContain("POST");
    expect(CORS["Access-Control-Allow-Methods"]).toContain("OPTIONS");
  });
});
