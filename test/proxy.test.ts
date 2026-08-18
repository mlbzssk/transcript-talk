import { describe, expect, it } from "vitest";
import { proxyConfigured } from "../src/adapters/proxy";

describe("proxyConfigured", () => {
  it("四元组齐全返回 true", () => {
    expect(
      proxyConfigured({
        PROXY_HOST: "h",
        PROXY_PORT: "80",
        PROXY_USERNAME: "u",
        PROXY_PASSWORD: "p",
      }),
    ).toBe(true);
  });
  it("缺任一项返回 false", () => {
    expect(proxyConfigured({})).toBe(false);
    expect(proxyConfigured({ PROXY_HOST: "h" })).toBe(false);
    expect(
      proxyConfigured({
        PROXY_HOST: "h",
        PROXY_PORT: "80",
        PROXY_USERNAME: "u",
      }),
    ).toBe(false);
  });
});
