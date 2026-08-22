/**
 * 硬编码演示数据（向后兼容 re-export）。
 *
 * 2025–2026 年 YouTube 对无登录态会话全面启用风控，抓取成功率极不稳定——
 * 内置演示字幕用于：① 演示 videoId 自动兜底  ② 无 LLM Key 时的演示模式（a16z 含预生成文章）
 *
 * @see ./demo/index.ts 多视频目录
 */
export {
  DEMO_ARTICLE,
  DEMO_CATALOG,
  DEMO_SUMMARIES,
  DEMO_TRANSCRIPT,
  DEMO_VIDEO_ID,
  DEMO_VIDEO_IDS,
  DEMO_VIDEO_TITLE,
  ELON_TED_2022_DEMO,
  ELON_TED_2022_TRANSCRIPT,
  ELON_TED_2022_VIDEO_ID,
  ELON_TED_2022_VIDEO_TITLE,
  ELON_TED_DEMO,
  ELON_TED_TRANSCRIPT,
  ELON_TED_VIDEO_ID,
  ELON_TED_VIDEO_TITLE,
  getDemoEntry,
  getDemoSummaries,
  isDemoVideoId,
} from "./demo";
export type { DemoEntry } from "./demo";
