/**
 * 结构化日志（JSON 单行输出，便于 wrangler tail / 日志平台解析）。
 *
 * 安全约定：日志字段绝不允许出现敏感信息（GEMINI_API_KEY、OPENAI_API_KEY、代理账号密码、
 * 用户完整字幕正文等），调用方只传 id / 状态 / 耗时等非敏感元数据。
 *
 * 追踪标识约定（用于把一次业务流程的日志串起来）：
 * - sessionId：业务层主标识。generate 在请求入口即生成，贯穿
 *   字幕抓取 → 流式生成 → 会话保存；summarize 请求体携带同一 id，
 *   因此 generate → 5W1H 的完整链路可按 sessionId 聚合。
 * - traceId：基础 adapter 层（如 youtube 降级链）的追踪字段，
 *   值由调用方传入（generate 传 sessionId），adapter 自身不感知业务概念。
 * - requestId：HTTP 入口层标识，取 Cloudflare 的 cf-ray（本地兜底随机生成），
 *   用于 404/500 等无业务 id 场景的请求定位。
 */
type Level = "debug" | "info" | "warn" | "error";

interface LogFields {
  [key: string]: unknown;
}

function emit(level: Level, msg: string, fields?: LogFields): void {
  const entry: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    msg,
    ...fields,
  };
  const line = JSON.stringify(entry);
  switch (level) {
    case "debug":
      console.debug(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
    default:
      console.log(line);
  }
}

export const logger = {
  debug: (msg: string, fields?: LogFields): void => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields): void => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields): void => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields): void => emit("error", msg, fields),
};
