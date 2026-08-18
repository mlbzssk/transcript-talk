import { buildArticlePrompt } from "../core/prompts";
import { logger } from "../core/logger";
import { extractVideoId, truncateTranscript } from "../core/transcript";
import type { AppEnv, SseEvent } from "../core/types";
import { GeminiError, geminiConfigured, streamGenerate } from "../adapters/gemini";
import { fetchTranscript, YoutubeError } from "../adapters/youtube";
import { saveSession } from "../adapters/store";
import { DEMO_ARTICLE, DEMO_TRANSCRIPT, DEMO_VIDEO_ID } from "../demo-transcript";
import type { Transcript } from "../core/types";
import { jsonResponse, sseEncode, sseFromEvents, sseHeaders } from "./http";

/**
 * POST /api/generate  { url, request? } → SSE 流
 *
 * 双跳管线：Gemini SSE → 解析 text delta → 重新编码为自有事件协议转发前端。
 * 演示模式（未配置 GEMINI_API_KEY）：假流逐字下发预生成文章，前端可独立验收。
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

  const demoMode = !geminiConfigured(env);

  // 演示模式只支持演示视频（假流文章只对应 DEMO_TRANSCRIPT，
  // 对其他视频播放同一篇文章会是张冠李戴——明确报错而非静默替换）
  if (demoMode && videoId !== DEMO_VIDEO_ID) {
    logger.warn("generate 演示模式下请求了非演示视频", { sessionId, videoId });
    return sseFromEvents([
      {
        type: "error",
        message:
          "当前为演示模式（未配置 GEMINI_API_KEY），仅支持内置演示视频；配置 Key 后即可生成任意视频，或点击「载入演示视频」体验完整流程",
      },
    ]);
  }

  // ── 第一步：字幕（降级链见 adapters/youtube.ts）──
  let transcript: Transcript;
  if (demoMode) {
    transcript = DEMO_TRANSCRIPT;
  } else {
    try {
      transcript = await fetchTranscript(env, videoId, sessionId);
      logger.info("字幕获取成功", {
        sessionId,
        videoId,
        source: transcript.source,
        languageCode: transcript.languageCode,
        chars: transcript.text.length,
      });
    } catch (e) {
      const message = e instanceof YoutubeError ? e.message : "字幕获取失败，请稍后重试";
      logger.error("字幕获取失败", {
        sessionId,
        videoId,
        kind: e instanceof YoutubeError ? e.kind : "unknown",
        error: e instanceof Error ? e.message : String(e),
      });
      return sseFromEvents([{ type: "error", message }]);
    }
  }

  // ── 第二步：流式生成（pump 模式，客户端断开时 abort 上游）──
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const write = (ev: SseEvent) => writer.write(sseEncode(ev));
  const ac = new AbortController();

  void (async () => {
    let article = "";
    const startedAt = Date.now();
    try {
      logger.info("generate 开始流式生成", {
        sessionId,
        videoId: demoMode ? DEMO_VIDEO_ID : videoId,
        demoMode,
      });
      await write({
        type: "session",
        id: sessionId,
        videoTitle: demoMode ? DEMO_TRANSCRIPT.title : transcript.title,
        transcriptSource: demoMode ? "demo" : transcript.source,
        demoMode,
      });

      let finishReason = "STOP";
      if (demoMode) {
        await write({ type: "info", message: "未配置 GEMINI_API_KEY——演示模式：播放预生成文章（章节 5W1H 仅有内置示例）" });
        for (const piece of chunkText(DEMO_ARTICLE, 6)) {
          await write({ type: "delta", text: piece });
          await sleep(24);
        }
        article = DEMO_ARTICLE;
        finishReason = "DEMO";
      } else {
        if (transcript.source === "demo") {
          await write({ type: "info", message: "字幕抓取未成功（YouTube 风控），已回退演示视频字幕——生成内容与输入视频可能不符" });
        }
        const transcriptText = truncateTranscript(transcript.text);
        const { system, user } = buildArticlePrompt({
          videoTitle: transcript.title,
          transcript: transcriptText,
          userRequest,
        });

        for await (const chunk of streamGenerate(env, system, user, ac.signal)) {
          if (chunk.text) {
            article += chunk.text;
            await write({ type: "delta", text: chunk.text });
          }
          if (chunk.finishReason) finishReason = chunk.finishReason;
        }
      }

      // 先落会话再发 done：保证 done 到达时 5W1H 已可读
      await saveSession(env, sessionId, {
        videoId: demoMode ? DEMO_TRANSCRIPT.videoId : videoId,
        videoTitle: demoMode ? DEMO_TRANSCRIPT.title : transcript.title,
        userRequest,
        transcriptText: truncateTranscript(demoMode ? DEMO_TRANSCRIPT.text : transcript.text),
        article,
        createdAt: Date.now(),
        demo: demoMode,
      });
      await write({ type: "done", finishReason });
      logger.info("generate 完成", {
        sessionId,
        videoId: demoMode ? DEMO_VIDEO_ID : videoId,
        finishReason,
        articleChars: article.length,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (e) {
      ac.abort(); // 释放上游 Gemini 流，不浪费配额
      const message = e instanceof GeminiError ? e.message : "生成中断，请重试";
      logger.error("generate 流式生成中断", {
        sessionId,
        videoId: demoMode ? DEMO_VIDEO_ID : videoId,
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
