import type { AppEnv } from "./core/types";
import { logger } from "./core/logger";
import { handleGenerate } from "./routes/generate";
import { handleSummarize } from "./routes/summarize";
import { CORS, jsonResponse } from "./routes/http";
import { geminiConfigured } from "./adapters/gemini";
import { proxyConfigured } from "./adapters/proxy";

export { AppEnv } from "./core/types";

/**
 * 入口路由（thin edge，无业务逻辑）：
 *   POST /api/generate   SSE 流式生成文章
 *   POST /api/summarize  章节 5W1H 总结
 *   GET  /api/health     配置自检
 * 静态页面由 wrangler [assets] 托管，未命中静态资源的请求进入本 Worker。
 */
export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const { pathname } = new URL(request.url);
    // cf-ray 是 Cloudflare 每请求唯一标识（本地 dev 无此头时自动生成兜底），
    // 用于入口层日志定位具体 HTTP 请求；业务链路串联见 sessionId/traceId
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    try {
      if (pathname === "/api/generate" && request.method === "POST") {
        return await handleGenerate(request, env);
      }
      if (pathname === "/api/summarize" && request.method === "POST") {
        return await handleSummarize(request, env);
      }
      if (pathname === "/api/health" && request.method === "GET") {
        return jsonResponse({
          ok: true,
          gemini: geminiConfigured(env),
          proxy: proxyConfigured(env),
          kv: !!env.SESSIONS,
        });
      }
      logger.warn("未匹配的路由", { requestId, method: request.method, pathname });
      return jsonResponse({ error: "Not Found" }, 404);
    } catch (e) {
      logger.error("请求处理异常", {
        requestId,
        method: request.method,
        pathname,
        error: e instanceof Error ? e.message : String(e),
      });
      return jsonResponse({ error: "服务器内部错误" }, 500);
    }
  },
};
