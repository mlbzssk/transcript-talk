import type { Transcript } from "../core/types";
import type { DemoEntry } from "./types";
import { ELON_TED_2022_TRANSCRIPT_TEXT } from "./elon-ted-2022-transcript";

export const ELON_TED_2022_VIDEO_ID = "cdZZpaB2kDM";

export const ELON_TED_2022_VIDEO_TITLE =
  "Elon Musk talks Twitter, Tesla and how his brain works — live at TED2022";

export const ELON_TED_2022_TRANSCRIPT: Transcript = {
  videoId: ELON_TED_2022_VIDEO_ID,
  title: ELON_TED_2022_VIDEO_TITLE,
  author: "TED",
  languageCode: "en",
  text: ELON_TED_2022_TRANSCRIPT_TEXT,
  source: "demo",
};

/** 无预生成文章：配置 DeepSeek/Gemini Key 后由 LLM 实时生成 */
export const ELON_TED_2022_DEMO: DemoEntry = {
  videoId: ELON_TED_2022_VIDEO_ID,
  title: ELON_TED_2022_VIDEO_TITLE,
  author: "TED",
  transcript: ELON_TED_2022_TRANSCRIPT,
};
