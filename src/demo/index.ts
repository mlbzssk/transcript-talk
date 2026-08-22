import { A16Z_DEMO, A16Z_VIDEO_ID } from "./a16z";
import {
  ELON_TED_2022_DEMO,
  ELON_TED_2022_TRANSCRIPT,
  ELON_TED_2022_VIDEO_ID,
  ELON_TED_2022_VIDEO_TITLE,
} from "./elon-ted-2022";
import {
  ELON_TED_DEMO,
  ELON_TED_TRANSCRIPT,
  ELON_TED_VIDEO_ID,
  ELON_TED_VIDEO_TITLE,
} from "./elon-ted";
import type { DemoEntry } from "./types";

export type { DemoEntry } from "./types";

/** 内置演示视频目录（videoId → 条目） */
export const DEMO_CATALOG: Record<string, DemoEntry> = {
  [A16Z_VIDEO_ID]: A16Z_DEMO,
  [ELON_TED_VIDEO_ID]: ELON_TED_DEMO,
  [ELON_TED_2022_VIDEO_ID]: ELON_TED_2022_DEMO,
};

export const DEMO_VIDEO_IDS = Object.keys(DEMO_CATALOG);

export function getDemoEntry(videoId: string): DemoEntry | undefined {
  return DEMO_CATALOG[videoId];
}

export function isDemoVideoId(videoId: string): boolean {
  return videoId in DEMO_CATALOG;
}

export function getDemoSummaries(videoId: string) {
  return DEMO_CATALOG[videoId]?.summaries;
}

/** 首个演示视频（向后兼容） */
export const DEMO_VIDEO_ID = A16Z_VIDEO_ID;

export const DEMO_VIDEO_TITLE = A16Z_DEMO.title;
export const DEMO_TRANSCRIPT = A16Z_DEMO.transcript;
export const DEMO_ARTICLE = A16Z_DEMO.article!;
export const DEMO_SUMMARIES = A16Z_DEMO.summaries ?? {};

export {
  A16Z_DEMO,
  ELON_TED_2022_DEMO,
  ELON_TED_2022_TRANSCRIPT,
  ELON_TED_2022_VIDEO_ID,
  ELON_TED_2022_VIDEO_TITLE,
  ELON_TED_DEMO,
  ELON_TED_TRANSCRIPT,
  ELON_TED_VIDEO_ID,
  ELON_TED_VIDEO_TITLE,
};

