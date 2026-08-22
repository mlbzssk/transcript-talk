/** 字幕轨道（从 player response 提取） */
export interface CaptionTrack {
  languageCode: string;
  /** "asr" 表示自动生成字幕 */
  kind?: string;
  name: string;
  baseUrl: string;
}

export type TranscriptSource =
  | "innertube"
  | "innertube-proxy"
  | "watch-html"
  | "watch-html-proxy"
  | "demo";

/** 抓取成功的字幕 */
export interface Transcript {
  videoId: string;
  title: string;
  author: string;
  languageCode: string;
  text: string;
  source: TranscriptSource;
}

/** 文章章节（服务端定位 5W1H 用，与前端渲染规则一致） */
export interface Section {
  /** 0 = 主标题/引言（序言），从 1 起为正文章节 */
  index: number;
  title: string;
  /** 含标题行在内的完整 markdown */
  content: string;
}

/** 5W1H 结构化总结（Gemini responseSchema 强制） */
export interface Summary5W1H {
  who: string;
  what: string;
  when: string;
  where: string;
  why: string;
  how: string;
}

/** 会话上下文：生成完成后保存，5W1H 请求的唯一次数据来源 */
export interface SessionContext {
  videoId: string;
  videoTitle: string;
  userRequest: string;
  /** 与生成时完全一致（截断后）的字幕文本 */
  transcriptText: string;
  article: string;
  createdAt: number;
  /** 演示模式（无 Gemini/DeepSeek Key）生成的会话 */
  demo: boolean;
}

/** SSE 事件协议 —— 前后端唯一契约，详见 README */
export type SseEvent =
  | { type: "session"; id: string; videoTitle: string; transcriptSource: TranscriptSource; demoMode: boolean }
  | { type: "info"; message: string }
  | { type: "delta"; text: string }
  | { type: "done"; finishReason: string }
  | { type: "error"; message: string }
  /** 阶段进度（stepper 用）：过程性信息走 stage，一次性关键提示走 info */
  | { type: "stage"; step: StageStep; status: StageStatus; detail?: string };

export type StageStep = "transcript" | "generate";
export type StageStatus = "active" | "done" | "failed";

/** 字幕抓取过程的进度回调（降级链逐层上报） */
export interface StageUpdate {
  step: StageStep;
  status: StageStatus;
  detail?: string;
}
export type OnStage = (update: StageUpdate) => void;

/**
 * 客户端断开（用户停止/网络中断）——非故障信号。
 * 定义在 core 供 routes 与 adapters 共享：onStage 回调抛出此错误时，
 * 降级链须立即中止而非当作"该层网络失败"继续降级。
 */
export class ClientDisconnected extends Error {
  constructor() {
    super("client disconnected");
  }
}

/** Worker 环境绑定（[vars] + secrets，全部可选——未配置时逐项降级） */
export interface AppEnv {
  /** Gemini AI Studio API Key；与 DeepSeek 都未配置 → 演示模式（假流） */
  GEMINI_API_KEY?: string;
  /** 默认 gemini-2.5-flash（flash 系列自动关闭 thinking 保证首字延迟） */
  GEMINI_MODEL?: string;
  /** DeepSeek API Key；Gemini 未配或鉴权失败时回退 */
  DEEPSEEK_API_KEY?: string;
  /** 默认 deepseek-v4-flash */
  DEEPSEEK_MODEL?: string;
  /** webshare.io 代理四元组；未配置 → 跳过代理层 */
  PROXY_HOST?: string;
  PROXY_PORT?: string;
  PROXY_USERNAME?: string;
  PROXY_PASSWORD?: string;
  /** KV 绑定；未配置 → 内存存储降级（单实例有效） */
  SESSIONS?: KVNamespace;
}
