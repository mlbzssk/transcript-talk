import type { Transcript } from "../core/types";
import type { DemoEntry } from "./types";
import { ELON_TED_TRANSCRIPT_TEXT } from "./elon-ted-transcript";

export const ELON_TED_VIDEO_ID = "zIwLWfaAg-8";

export const ELON_TED_VIDEO_TITLE = "Elon Musk: The future we're building -- and boring | TED";

export const ELON_TED_TRANSCRIPT: Transcript = {
  videoId: ELON_TED_VIDEO_ID,
  title: ELON_TED_VIDEO_TITLE,
  author: "TED",
  languageCode: "en",
  text: ELON_TED_TRANSCRIPT_TEXT,
  source: "demo",
};

/** 无预生成文章：配置 DeepSeek/Gemini Key 后由 LLM 实时生成 */
export const ELON_TED_DEMO: DemoEntry = {
  videoId: ELON_TED_VIDEO_ID,
  title: ELON_TED_VIDEO_TITLE,
  author: "TED",
  transcript: ELON_TED_TRANSCRIPT,
};
