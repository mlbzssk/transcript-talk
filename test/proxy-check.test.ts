import { afterEach, describe, expect, it, vi } from "vitest";

const { proxyFetchMock } = vi.hoisted(() => ({
  proxyFetchMock: vi.fn(),
}));

vi.mock("../src/adapters/proxy", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/adapters/proxy")>();
  return { ...mod, proxyFetch: proxyFetchMock };
});

import { checkProxy } from "../src/routes/proxy-check";

const env = {
  PROXY_HOST: "1.2.3.4",
  PROXY_PORT: "8168",
  PROXY_USERNAME: "user",
  PROXY_PASSWORD: "pass",
};

afterEach(() => {
  proxyFetchMock.mockReset();
});

describe("checkProxy", () => {
  it("未配置代理", async () => {
    const r = await checkProxy({});
    expect(r.configured).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("未配置");
  });

  it("ipify 成功 + YouTube OK", async () => {
    proxyFetchMock
      .mockResolvedValueOnce({ status: 200, bodyText: '{"ip":"8.8.8.8"}' })
      .mockResolvedValueOnce({
        status: 200,
        bodyText: JSON.stringify({
          playabilityStatus: { status: "OK" },
          captions: { playerCaptionsTracklistRenderer: { captionTracks: [{}] } },
        }),
      });
    const r = await checkProxy(env);
    expect(r.ok).toBe(true);
    expect(r.ipify?.exitIp).toBe("8.8.8.8");
    expect(r.youtube?.ok).toBe(true);
    expect(r.youtube?.hasCaptions).toBe(true);
    expect(r.message).toContain("YouTube 放行");
  });

  it("ipify 成功但 YouTube LOGIN_REQUIRED", async () => {
    proxyFetchMock
      .mockResolvedValueOnce({ status: 200, bodyText: '{"ip":"1.1.1.1"}' })
      .mockResolvedValueOnce({
        status: 200,
        bodyText: JSON.stringify({
          playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm" },
        }),
      });
    const r = await checkProxy(env);
    expect(r.ok).toBe(true);
    expect(r.youtube?.ok).toBe(false);
    expect(r.youtube?.playability).toBe("LOGIN_REQUIRED");
    expect(r.message).toContain("YouTube 仍拒绝");
  });

  it("CONNECT 失败", async () => {
    proxyFetchMock.mockRejectedValue(new Error("代理握手失败: HTTP/1.1 407"));
    const r = await checkProxy(env);
    expect(r.ok).toBe(false);
    expect(r.ipify?.error).toContain("407");
    expect(r.message).toContain("代理未连通");
  });
});
