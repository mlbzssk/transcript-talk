import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../src/core/logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("info 输出单行 JSON，含 level/time/msg 与业务字段", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("会话保存成功", { sessionId: "s1", chars: 100 });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("会话保存成功");
    expect(parsed.sessionId).toBe("s1");
    expect(parsed.chars).toBe(100);
    expect(typeof parsed.time).toBe("string");
  });
  it("warn / error 走对应 console 方法", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.warn("警告");
    logger.error("错误");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
  it("debug 走 console.debug", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    logger.debug("调试", { a: 1 });
    expect(debug).toHaveBeenCalledTimes(1);
  });
});
