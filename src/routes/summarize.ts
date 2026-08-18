import { buildSummaryPrompt } from "../core/prompts";
import { logger } from "../core/logger";
import { findSection, splitSections } from "../core/markdown";
import type { AppEnv } from "../core/types";
import { generateJson, geminiConfigured, GeminiError } from "../adapters/gemini";
import { loadSession } from "../adapters/store";
import { DEMO_SUMMARIES } from "../demo-transcript";
import { jsonResponse } from "./http";

/**
 * POST /api/summarize  { sessionId, sectionTitle, sectionIndex? } → { summary }
 *
 * 前端只传会话 ID 与章节锚点，不回传文章内容——
 * 总结完全基于服务端保存的本次生成上下文（字幕 + 用户要求 + 全文）。
 */
export async function handleSummarize(request: Request, env: AppEnv): Promise<Response> {
  let body: { sessionId?: string; sectionTitle?: string; sectionIndex?: number };
  try {
    body = await request.json();
  } catch {
    logger.warn("summarize 请求体不是合法 JSON");
    return jsonResponse({ error: "请求体必须是 JSON" }, 400);
  }
  const { sessionId, sectionTitle } = body;
  if (!sessionId || !sectionTitle) {
    logger.warn("summarize 缺少必填参数", { sessionId: !!sessionId, sectionTitle: !!sectionTitle });
    return jsonResponse({ error: "缺少 sessionId 或 sectionTitle" }, 400);
  }

  const ctx = await loadSession(env, sessionId);
  if (!ctx) {
    logger.warn("summarize 会话不存在或已过期", { sessionId });
    return jsonResponse({ error: "会话不存在或已过期（保留 1 小时），请重新生成文章" }, 404);
  }

  const section = findSection(ctx.article, sectionTitle, body.sectionIndex ?? -1);
  if (!section) {
    logger.warn("summarize 章节不存在", { sessionId, sectionTitle });
    return jsonResponse({ error: "章节不存在，请重新生成文章" }, 404);
  }

  // 演示模式：仅内置示例章节，其余明确告知限制（不静默造假）
  if (ctx.demo || !geminiConfigured(env)) {
    const seed = DEMO_SUMMARIES[section.title];
    if (seed) return jsonResponse({ summary: seed, demo: true });
    return jsonResponse(
      {
        error: `演示模式仅「${Object.keys(DEMO_SUMMARIES)[0]}」章节内置 5W1H 示例；配置 GEMINI_API_KEY 后即可总结任意章节`,
      },
      503,
    );
  }

  const allTitles = splitSections(ctx.article)
    .map((s) => s.title)
    .filter(Boolean);

  const { system, user } = buildSummaryPrompt({
    videoTitle: ctx.videoTitle,
    transcript: ctx.transcriptText, // 与生成时同一份截断文本，上下文一致
    userRequest: ctx.userRequest,
    allSectionTitles: allTitles,
    sectionTitle: section.title,
    sectionContent: section.content,
  });

  try {
    const summary = await generateJson(env, system, user);
    logger.info("summarize 生成成功", {
      sessionId,
      sectionTitle: section.title,
      summaryChars: JSON.stringify(summary).length,
    });
    return jsonResponse({ summary });
  } catch (e) {
    const message = e instanceof GeminiError ? e.message : "总结生成失败，请重试";
    const status = e instanceof GeminiError ? e.status : 500;
    logger.error("summarize 生成失败", {
      sessionId,
      sectionTitle: section.title,
      error: e instanceof Error ? e.message : String(e),
    });
    return jsonResponse({ error: message }, status < 400 ? 500 : status);
  }
}
