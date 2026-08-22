import type { Summary5W1H, Transcript } from "../core/types";

export interface DemoEntry {
  videoId: string;
  title: string;
  author: string;
  transcript: Transcript;
  /** 无 API Key 演示模式下的预生成文章；缺省则仅提供字幕兜底 */
  article?: string;
  /** 演示模式 5W1H 示例，按章节标题索引 */
  summaries?: Record<string, Summary5W1H>;
}
