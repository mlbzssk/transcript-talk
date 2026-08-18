import { describe, expect, it, vi } from "vitest";
import type { SessionContext } from "../src/core/types";

// 动态导入 + 模块隔离，避免模块级 mem Map 在不同用例间串扰
const loadStore = async () => import("../src/adapters/store");

const makeCtx = (over: Partial<SessionContext> = {}): SessionContext => ({
  videoId: "vid",
  videoTitle: "标题",
  userRequest: "",
  transcriptText: "字幕",
  article: "# 文章",
  createdAt: Date.now(),
  demo: false,
  ...over,
});

/** 内存 KV mock */
const makeKv = (init: Record<string, string> = {}) => {
  const data = new Map(Object.entries(init));
  return {
    put: vi.fn(async (k: string, v: string) => {
      data.set(k, v);
    }),
    get: vi.fn(async (k: string) => data.get(k) ?? null),
  } as unknown as KVNamespace;
};

describe("saveSession / loadSession（内存降级）", () => {
  it("无 KV 时保存后能读回", async () => {
    vi.resetModules();
    const { saveSession, loadSession } = await loadStore();
    const ctx = makeCtx();
    await saveSession({}, "s1", ctx);
    expect(await loadSession({}, "s1")).toEqual(ctx);
  });
  it("无 KV 时读取不存在会话返回 null", async () => {
    vi.resetModules();
    const { loadSession } = await loadStore();
    expect(await loadSession({}, "missing")).toBeNull();
  });
});

describe("saveSession / loadSession（KV 模式）", () => {
  it("保存写 KV，读取时从 KV 回填", async () => {
    vi.resetModules();
    const kv = makeKv();
    const { saveSession } = await loadStore();
    const ctx = makeCtx();
    await saveSession({ SESSIONS: kv }, "s2", ctx);
    expect(kv.put).toHaveBeenCalledTimes(1);
    // 用全新模块实例模拟另一实例：内存为空，只能靠 KV
    vi.resetModules();
    const fresh = await loadStore();
    expect(await fresh.loadSession({ SESSIONS: kv }, "s2")).toEqual(ctx);
  });
  it("KV 写失败不抛错（内存层仍可服务）", async () => {
    vi.resetModules();
    const kv = {
      put: vi.fn(async () => {
        throw new Error("KV down");
      }),
      get: vi.fn(async () => null),
    } as unknown as KVNamespace;
    const { saveSession, loadSession } = await loadStore();
    const ctx = makeCtx();
    await expect(saveSession({ SESSIONS: kv }, "s3", ctx)).resolves.toBeUndefined();
    expect(await loadSession({ SESSIONS: kv }, "s3")).toEqual(ctx);
  });
  it("KV 中损坏数据视同不存在", async () => {
    vi.resetModules();
    const kv = makeKv({ bad: "not-json{{{" });
    const { loadSession } = await loadStore();
    expect(await loadSession({ SESSIONS: kv }, "bad")).toBeNull();
  });
});

describe("内存 FIFO 上限", () => {
  it("超过 50 条淘汰最旧会话", async () => {
    vi.resetModules();
    const { saveSession, loadSession } = await loadStore();
    for (let i = 0; i < 51; i++) {
      await saveSession({}, `id-${i}`, makeCtx({ videoId: `v${i}` }));
    }
    expect(await loadSession({}, "id-0")).toBeNull(); // 最旧被淘汰
    expect(await loadSession({}, "id-50")).not.toBeNull();
  });
});
