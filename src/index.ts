import type { AppEnv } from "./core/types";
import { logger } from "./core/logger";
import { handleGenerate } from "./routes/generate";
import { handleSummarize } from "./routes/summarize";
import { CORS, jsonResponse } from "./routes/http";
import { geminiConfigured, llmConfigured, openaiConfigured, providerOf } from "./adapters/llm";
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
    const isHealth = pathname === "/api/health";
    // access log：health 探活用 debug（避免部署后探活刷屏），业务端点用 info
    const log = isHealth ? logger.debug : logger.info;
    log("http 请求进入", { requestId, method: request.method, pathname });
    const startedAt = Date.now();
    try {
      let res: Response;
      if (pathname === "/api/generate" && request.method === "POST") {
        res = await handleGenerate(request, env);
      } else if (pathname === "/api/summarize" && request.method === "POST") {
        res = await handleSummarize(request, env);
      } else if (isHealth && request.method === "GET") {
        res = jsonResponse({
          ok: true,
          llm: llmConfigured(env),
          provider: providerOf(env),
          gemini: geminiConfigured(env),
          openai: openaiConfigured(env),
          proxy: proxyConfigured(env),
          kv: !!env.SESSIONS,
        });
      } else {
        logger.warn("未匹配的路由", { requestId, method: request.method, pathname });
        res = jsonResponse({ error: "Not Found" }, 404);
      }
      // 注：generate 的 SSE 响应此处 status=200、耗时≈建立连接耗时；
      // 完整生成时长看业务日志"generate 完成"的 elapsedMs
      log("http 响应", { requestId, method: request.method, status: res.status, elapsedMs: Date.now() - startedAt });
      return res;
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
