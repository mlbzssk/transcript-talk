import { buildArticlePrompt } from "../core/prompts";
import { logger } from "../core/logger";
import { extractVideoId, truncateTranscript } from "../core/transcript";
import type { AppEnv, SseEvent } from "../core/types";
import { ClientDisconnected } from "../core/types";
import { llmConfigured, llmErrorMessage, streamGenerate } from "../adapters/llm";
import { fetchTranscript, YoutubeError } from "../adapters/youtube";
import { saveSession } from "../adapters/store";
import { getDemoEntry } from "../demo-transcript";
import type { Transcript } from "../core/types";
import { jsonResponse, sseEncode, sseFromEvents, sseHeaders } from "./http";

/**
 * POST /api/generate  { url, request? } → SSE 流
 *
 * 双跳管线：上游 LLM SSE → 解析 text delta → 重新编码为自有事件协议转发前端。
 * 控制流：参数校验后立即返回 SSE 响应，字幕抓取与生成都发生在后台泵里——
 * 这样 stage 进度事件从字幕抓取的第一层就能推到浏览器（而非等抓取完成才建立连接）。
 * 演示模式（未配置 Gemini/DeepSeek Key）：假流逐字下发预生成文章，前端可独立验收。
 * LLM 路由：Gemini 优先 → 鉴权失败回退 DeepSeek → 都无则演示。
 */
export async function handleGenerate(request: Request, env: AppEnv): Promise<Response> {
  let body: { url?: string; request?: string };
  try {
    body = await request.json();
  } catch {
    logger.warn("generate 请求体不是合法 JSON");
    return jsonResponse({ error: "请求体必须是 JSON" }, 400);
  }
  const videoId = extractVideoId(body.url ?? "");
  if (!videoId) {
    logger.warn("generate 无法从输入提取 videoId", { input: body.url?.slice(0, 200) });
    return jsonResponse({ error: "无法识别 YouTube 视频链接" }, 400);
  }
  const userRequest = (body.request ?? "").trim().slice(0, 2000);

  // 提前生成 sessionId：它同时充当本次请求的 traceId——
  // 字幕降级链 → 流式生成 → 会话保存 → 后续 summarize 全部由它串联
  const sessionId = crypto.randomUUID();

  const demoMode = !llmConfigured(env);

  const demoEntry = getDemoEntry(videoId);

  // 演示模式仅支持内置演示视频；无预生成文章的条目在生成阶段再报错
  if (demoMode && !demoEntry) {
    logger.warn("generate 演示模式下请求了非演示视频", { sessionId, videoId });
    return sseFromEvents([
      {
        type: "error",
        message:
          "当前为演示模式（未配置 GEMINI_API_KEY / DEEPSEEK_API_KEY），仅支持内置演示视频；配置 Key 后即可生成任意视频，或点击「载入演示视频」体验完整流程",
      },
    ]);
  }

  // ── 立即建立 SSE 通道，全部后续步骤在后台泵中执行 ──
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  // write 抛错统一标记为客户端断开（用户停止/网络中断），
  // 与真实业务异常区分开——排障时不把主动停止误判为故障
  const write = (ev: SseEvent): Promise<void> =>
    writer.write(sseEncode(ev)).catch(() => {
      throw new ClientDisconnected();
    });
  const ac = new AbortController();

  void (async () => {
    let article = "";
    const startedAt = Date.now();
    // 与入口 access log 同源（cf-ray），本地 dev 无此头时记 local——
    // 按 requestId 聚合 HTTP 层、按 sessionId 聚合业务层，两者由此对齐
    const requestId = request.headers.get("cf-ray") ?? "local";
    logger.info("generate 开始", {
      requestId,
      sessionId,
      videoId: demoMode ? (demoEntry?.videoId ?? videoId) : videoId,
      demoMode,
      userRequestChars: userRequest.length,
    });
    try {
      // ── 第一步：字幕（降级链见 adapters/youtube.ts，进度经 stage 事件逐层透出）──
      let transcript: Transcript;
      if (demoMode) {
        await write({ type: "stage", step: "transcript", status: "active", detail: "演示模式：使用内置字幕" });
        transcript = demoEntry!.transcript;
        await write({
          type: "stage",
          step: "transcript",
          status: "done",
          detail: `${demoEntry!.transcript.text.length.toLocaleString()} 字`,
        });
      } else {
        try {
          transcript = await fetchTranscript(env, videoId, sessionId, (u) =>
            write({ type: "stage", ...u }),
          );
          logger.info("字幕获取成功", {
            sessionId,
            videoId,
            source: transcript.source,
            languageCode: transcript.languageCode,
            chars: transcript.text.length,
          });
        } catch (e) {
          if (e instanceof ClientDisconnected) throw e; // 断开不是字幕失败，交外层定性
          const message = e instanceof YoutubeError ? e.message : "字幕获取失败，请稍后重试";
          logger.error("字幕获取失败", {
            sessionId,
            videoId,
            kind: e instanceof YoutubeError ? e.kind : "unknown",
            error: e instanceof Error ? e.message : String(e),
          });
          await write({ type: "error", message });
          return;
        }
      }

      await write({
        type: "session",
        id: sessionId,
        videoTitle: demoMode ? demoEntry!.title : transcript.title,
        transcriptSource: demoMode ? "demo" : transcript.source,
        demoMode,
      });

      // ── 第二步：流式生成（stage 先行，首字后由前端统计字数/章节）──
      await write({ type: "stage", step: "generate", status: "active", detail: "正在组织语言…" });
      let finishReason = "STOP";
      if (demoMode) {
        const demoArticle = demoEntry!.article;
        if (!demoArticle) {
          await write({
            type: "error",
            message:
              "此演示视频暂无预生成文章；请配置 GEMINI_API_KEY 或 DEEPSEEK_API_KEY 后重新生成（字幕已可用）",
          });
          return;
        }
        await write({
          type: "info",
          message: "未配置大模型 Key——演示模式：播放预生成文章（章节 5W1H 仅有内置示例）",
        });
        for (const piece of chunkText(demoArticle, 6)) {
          await write({ type: "delta", text: piece });
          await sleep(24);
        }
        article = demoArticle;
        finishReason = "DEMO";
      } else {
        if (transcript.source === "demo") {
          await write({
            type: "info",
            message: "字幕抓取未成功（YouTube 风控），已回退演示视频字幕——生成内容与输入视频可能不符",
          });
        }
        const transcriptText = truncateTranscript(transcript.text);
        const { system, user } = buildArticlePrompt({
          videoTitle: transcript.title,
          transcript: transcriptText,
          userRequest,
        });

        let announcedProvider = false;
        for await (const chunk of streamGenerate(env, system, user, ac.signal)) {
          if (!announcedProvider && chunk.provider) {
            announcedProvider = true;
            await write({
              type: "info",
              message: chunk.provider === "deepseek" ? "当前使用 DeepSeek 生成" : "当前使用 Gemini 生成",
            });
          }
          if (chunk.text) {
            article += chunk.text;
            await write({ type: "delta", text: chunk.text });
          }
          if (chunk.finishReason) finishReason = chunk.finishReason;
        }
      }

      // 先落会话再发 done：保证 done 到达时 5W1H 已可读
      await saveSession(env, sessionId, {
        videoId: demoMode ? demoEntry!.videoId : videoId,
        videoTitle: demoMode ? demoEntry!.title : transcript.title,
        userRequest,
        transcriptText: truncateTranscript(demoMode ? demoEntry!.transcript.text : transcript.text),
        article,
        createdAt: Date.now(),
        demo: demoMode,
      });
      await write({
        type: "stage",
        step: "generate",
        status: "done",
        detail: `${article.length.toLocaleString()} 字`,
      });
      await write({ type: "done", finishReason });
      logger.info("generate 完成", {
        requestId,
        sessionId,
        videoId: demoMode ? (demoEntry?.videoId ?? videoId) : videoId,
        finishReason,
        articleChars: article.length,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (e) {
      ac.abort(); // 释放上游 LLM 流，不浪费配额
      if (e instanceof ClientDisconnected) {
        // 用户停止或网络中断：非故障，warn 级别（article 长度可判断中断位置）
        logger.warn("generate 客户端断开", {
          requestId,
          sessionId,
          videoId: demoMode ? (demoEntry?.videoId ?? videoId) : videoId,
          articleChars: article.length,
          elapsedMs: Date.now() - startedAt,
        });
        return;
      }
      const message = llmErrorMessage(e);
      logger.error("generate 流式生成中断", {
        requestId,
        sessionId,
        videoId: demoMode ? (demoEntry?.videoId ?? videoId) : videoId,
        error: e instanceof Error ? e.message : String(e),
      });
      try {
        await write({ type: "error", message });
      } catch {
        /* 客户端已断开 */
      }
    } finally {
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
    }
  })();

  return new Response(readable, { headers: sseHeaders() });
}

function* chunkText(s: string, size: number): Generator<string> {
  for (let i = 0; i < s.length; i += size) yield s.slice(i, i + size);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
