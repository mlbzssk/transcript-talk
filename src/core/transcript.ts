import type { CaptionTrack } from "./types";

/** 字幕统一截断上限（generate 与 summarize 共用，保证两阶段上下文一致） */
export const MAX_TRANSCRIPT_CHARS = 150_000;

/** 从任意 URL 形态提取 videoId（watch / youtu.be / shorts / embed / 裸 ID） */
export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|\/embed\/|\/shorts\/|youtu\.be\/)([\w-]{11})/);
  return m ? (m[1] ?? null) : null;
}

/** 轨道选择：中文优先 → 英文 → 首轨 */
export function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null;
  return (
    tracks.find((t) => t.languageCode.toLowerCase().startsWith("zh")) ??
    tracks.find((t) => t.languageCode.toLowerCase().startsWith("en")) ??
    tracks[0] ??
    null
  );
}

/** timedtext json3 → 纯文本（每行一句，过滤空段） */
export function parseJson3(body: string): string {
  try {
    const data = JSON.parse(body) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
    return (data.events ?? [])
      .map((e) => (e.segs ?? []).map((s) => s.utf8 ?? "").join(""))
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("\n");
  } catch {
    return "";
  }
}

/** 从 player response 对象提取标题/作者/轨道 */
export function extractTracks(player: unknown): { title: string; author: string; tracks: CaptionTrack[] } {
  const p = player as {
    videoDetails?: { title?: string; author?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] } };
  };
  const raw = p?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const tracks: CaptionTrack[] = [];
  for (const t of raw as Array<Record<string, unknown>>) {
    const baseUrl = typeof t.baseUrl === "string" ? t.baseUrl : "";
    const languageCode = typeof t.languageCode === "string" ? t.languageCode : "";
    if (!baseUrl || !languageCode) continue;
    const nameObj = t.name as { runs?: Array<{ text?: string }>; simpleText?: string } | undefined;
    tracks.push({
      languageCode,
      kind: typeof t.kind === "string" ? t.kind : undefined,
      name: nameObj?.runs?.[0]?.text ?? nameObj?.simpleText ?? languageCode,
      baseUrl,
    });
  }
  return { title: p?.videoDetails?.title ?? "", author: p?.videoDetails?.author ?? "", tracks };
}

/**
 * 从 watch 页 HTML 提取 ytInitialPlayerResponse。
 * YouTube 有两种嵌入格式：明文 JSON 对象、或整体转义的 JSON 字符串，均兼容。
 */
export function extractPlayerFromHtml(html: string): unknown | null {
  const marker = "ytInitialPlayerResponse";
  let i = html.indexOf(marker);
  while (i !== -1) {
    const brace = html.indexOf("{", i);
    if (brace !== -1 && brace - i < 200) {
      const frag = balancedBraces(html, brace);
      if (frag) {
        try {
          return JSON.parse(frag);
        } catch {
          try {
            // 转义字符串形式：{\"key\":...} → 先解转义再解析
            return JSON.parse(JSON.parse(`"${frag}"`));
          } catch {
            /* 尝试下一处出现 */
          }
        }
      }
    }
    i = html.indexOf(marker, i + 1);
  }
  return null;
}

/** 无字符串感知的括号平衡提取（YouTube 的转义格式中 \" 不构成字符串边界） */
function balancedBraces(s: string, start: number): string | null {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** 统一截断：generate 与 summarize 必须共用，确保上下文一致 */
export function truncateTranscript(text: string): string {
  return text.length <= MAX_TRANSCRIPT_CHARS
    ? text
    : text.slice(0, MAX_TRANSCRIPT_CHARS) + "\n…[字幕过长，已截断]";
}
