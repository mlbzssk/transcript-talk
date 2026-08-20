import { DEMO_TRANSCRIPT, DEMO_VIDEO_ID } from "../demo-transcript";
import { logger } from "../core/logger";
import {
  extractPlayerFromHtml,
  extractTracks,
  parseJson3,
  pickTrack,
} from "../core/transcript";
import type { CaptionTrack, OnStage, Transcript } from "../core/types";
import { ClientDisconnected } from "../core/types";
import { proxyConfigured, proxyFetch, type ProxyEnv } from "./proxy";

export class YoutubeError extends Error {
  constructor(
    message: string,
    public kind: "not-found" | "no-captions" | "unavailable",
  ) {
    super(message);
  }
}

type YoutubeEnv = ProxyEnv;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface PlayerResult {
  title: string;
  author: string;
  tracks: CaptionTrack[];
  fatal?: "not-found" | "no-captions";
}

/**
 * 字幕抓取降级链（两级 × 直连/代理）：
 *
 *   轨道获取:  ① Innertube API(直连, 多client轮试) → ② watch 页解析(直连)
 *              → ③ Innertube API(代理) → ④ watch 页解析(代理)
 *   字幕内容:  baseUrl+fmt=json3 (直连 → 失败走代理)
 *   兜底:      仅当请求的是演示视频时回退硬编码字幕；否则抛出明确错误
 *
 * 注：2025-2026 年 YouTube 对无登录态会话风控极严（详见 README），
 * 生产环境建议配置 webshare 代理提升 ①③④ 层成功率。
 *
 * @param traceId 追踪标识（由调用方传入，如 generate 的 sessionId），仅用于日志串联
 * @param onStage 进度回调（stepper 展示用）；detail 只描述确定性事实，不猜测失败归因
 */
export async function fetchTranscript(
  env: YoutubeEnv,
  videoId: string,
  traceId?: string,
  onStage?: OnStage,
): Promise<Transcript> {
  const STAGE_DETAIL: Record<string, string> = {
    innertube: "尝试 Innertube API…",
    "watch-html": "改走 watch 页面解析…",
    "innertube-proxy": "通过代理重试 Innertube API…",
    "watch-html-proxy": "通过代理重试 watch 页解析…",
  };
  const stage = (status: "active" | "failed", detail?: string) =>
    onStage?.({ step: "transcript", status, detail });

  const stages: Array<{ source: Transcript["source"]; run: () => Promise<PlayerResult | null> }> = [
    { source: "innertube", run: () => innertubePlayer(env, videoId, false) },
    { source: "watch-html", run: () => watchPagePlayer(env, videoId, false) },
    { source: "innertube-proxy", run: () => innertubePlayer(env, videoId, true) },
    { source: "watch-html-proxy", run: () => watchPagePlayer(env, videoId, true) },
  ];

  let lastPlayer: PlayerResult | null = null;
  for (const stageItem of stages) {
    if (stageItem.source.endsWith("proxy") && !proxyConfigured(env)) {
      logger.debug("fetchTranscript 跳过代理层（未配置代理）", { traceId, videoId, source: stageItem.source });
      continue;
    }
    // 层级开始即上报（Innertube 内部多 client 轮试合并为一条，不逐个透出）
    stage("active", STAGE_DETAIL[stageItem.source]);
    try {
      const r = await stageItem.run();
      if (!r) {
        logger.debug("fetchTranscript 该层未命中", { traceId, videoId, source: stageItem.source });
        continue;
      }
      if (r.fatal) {
        // 视频不存在 / 确定无字幕：降级链解决不了，直接定性
        logger.warn("fetchTranscript 定性失败", {
          traceId,
          videoId,
          source: stageItem.source,
          fatal: r.fatal,
        });
        stage("failed", r.fatal === "not-found" ? "视频不存在、私有或已下线" : "该视频没有可用字幕");
        throw new YoutubeError(
          r.fatal === "not-found" ? "视频不存在、私有或已下线" : "该视频没有可用字幕",
          r.fatal,
        );
      }
      if (r.tracks.length > 0) {
        lastPlayer = r;
        const track = pickTrack(r.tracks)!;
        stage("active", `已找到字幕轨（${track.name}），正在拉取内容…`);
        const text = await fetchCaptionBody(env, track.baseUrl, stageItem.source.endsWith("proxy"));
        if (text) {
          const result: Transcript = {
            videoId,
            title: r.title || track.name,
            author: r.author,
            languageCode: track.languageCode,
            text,
            source: stageItem.source,
          };
          onStage?.({
            step: "transcript",
            status: "done",
            detail: `${result.text.length.toLocaleString()} 字`,
          });
          return result;
        }
        logger.debug("fetchTranscript 字幕内容为空", { traceId, videoId, source: stageItem.source });
      }
    } catch (e) {
      if (e instanceof YoutubeError) throw e;
      // onStage 抛错 = 调用方中止（客户端断开）：立即中止，不继续降级
      if (e instanceof ClientDisconnected) throw e;
      /* 该层级网络失败，落入下一层 */
      logger.debug("fetchTranscript 该层网络失败", {
        traceId,
        videoId,
        source: stageItem.source,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 全链路失败：演示视频回退硬编码字幕，其余给出明确错误
  if (videoId === DEMO_VIDEO_ID) {
    logger.warn("fetchTranscript 全链路失败，回退演示字幕", { traceId, videoId });
    onStage?.({ step: "transcript", status: "done", detail: "回退内置演示字幕" });
    return DEMO_TRANSCRIPT;
  }
  logger.error("fetchTranscript 全链路失败", { traceId, videoId, hadPlayer: !!lastPlayer });
  const failMessage = lastPlayer
    ? "字幕内容拉取失败（可能触发 YouTube 风控），可稍后重试或配置代理"
    : "字幕获取失败：YouTube 对当前出口 IP 触发了风控（验证码），可稍后重试、配置 webshare 代理，或用演示视频体验";
  stage("failed", lastPlayer ? "字幕内容拉取失败，可配置代理后重试" : "YouTube 触发风控，全部方式均未成功");
  throw new YoutubeError(failMessage, "unavailable");
}

/* ────────────────── 层级 1：Innertube player API（响应小、省 CPU） ────────────────── */

const INNERTUBE_CLIENTS = [
  {
    ua: "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)",
    client: {
      clientName: "IOS",
      clientVersion: "19.29.1",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "17.5.1.21F90",
      hl: "en",
    },
  },
  {
    ua: "com.google.android.youtube/19.29.37 (Linux; U; Android 11) gzip",
    client: {
      clientName: "ANDROID",
      clientVersion: "19.29.37",
      androidSdkVersion: 30,
      hl: "en",
    },
  },
  {
    ua: "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15",
    client: {
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      hl: "en",
    },
  },
];

/**
 * playabilityStatus.status === "ERROR" 的归因：
 * 只有 reason 明确指向视频本身不可用时才定性 not-found；
 * 其他 ERROR（如 client 被弃用 "no longer supported"、风控）不能定性——降级链继续。
 */
const VIDEO_GONE_REASONS = /video unavailable|does not exist|private|removed|terminated|account associated/i;

const isVideoGone = (reason?: string): boolean => !!reason && VIDEO_GONE_REASONS.test(reason);

async function innertubePlayer(env: YoutubeEnv, videoId: string, viaProxy: boolean): Promise<PlayerResult | null> {
  const url = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
  for (const c of INNERTUBE_CLIENTS) {
    const body = JSON.stringify({ videoId, context: { client: c.client } });
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": c.ua,
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.youtube.com",
    };
    try {
      let json: unknown = null;
      if (viaProxy) {
        const r = await proxyFetch(env, { method: "POST", url, headers, body, timeoutMs: 15000 });
        if (r.status !== 200) continue;
        json = JSON.parse(r.bodyText);
      } else {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        json = await res.json();
      }
      const player = json as {
        playabilityStatus?: { status?: string; reason?: string };
      };
      const status = player?.playabilityStatus?.status;
      if (status === "ERROR") {
        if (isVideoGone(player?.playabilityStatus?.reason)) {
          return { title: "", author: "", tracks: [], fatal: "not-found" };
        }
        logger.debug("innertube client 返回 ERROR（非定性）", {
          client: c.client.clientName,
          reason: player?.playabilityStatus?.reason,
        });
        continue; // client 被弃用/风控等其他 ERROR → 换 client
      }
      if (status !== "OK") {
        // LOGIN_REQUIRED 等风控状态：记录具体 status/reason，排风控问题的第一手证据
        logger.debug("innertube client 未放行", {
          client: c.client.clientName,
          status,
          reason: player?.playabilityStatus?.reason,
        });
        continue; // 换 client
      }
      const { title, author, tracks } = extractTracks(json);
      if (tracks.length === 0) {
        // player 正常但无字幕轨
        return { title, author, tracks, fatal: "no-captions" };
      }
      return { title, author, tracks };
    } catch (e) {
      /* 该 client 失败 → 换下一个 */
      logger.debug("innertube client 请求异常", {
        client: c.client.clientName,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return null;
}

/* ────────────────── 层级 2：watch 页 HTML 解析（兼容明文/转义双格式） ────────────────── */

async function watchPagePlayer(env: YoutubeEnv, videoId: string, viaProxy: boolean): Promise<PlayerResult | null> {
  const url = `https://www.youtube.com/watch?v=${videoId}&hl=en&cc=1&bpctr=9999999999&has_verified=1`;
  const headers = {
    "User-Agent": BROWSER_UA,
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  try {
    let html: string;
    if (viaProxy) {
      const r = await proxyFetch(env, { url, headers, timeoutMs: 20000 });
      if (r.status !== 200) return null;
      html = r.bodyText;
    } else {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      html = await res.text();
    }
    const player = extractPlayerFromHtml(html);
    if (!player) return null;
    const playability = (player as { playabilityStatus?: { status?: string; reason?: string } })
      .playabilityStatus;
    if (playability?.status === "ERROR" && isVideoGone(playability.reason)) {
      return { title: "", author: "", tracks: [], fatal: "not-found" };
    }
    const { title, author, tracks } = extractTracks(player);
    if (title && tracks.length === 0) {
      // 页面正常返回且带标题但无字幕轨 → 确定无字幕（区别于风控降级页：其 title 为空）
      return { title, author, tracks, fatal: "no-captions" };
    }
    return { title, author, tracks };
  } catch {
    return null;
  }
}

/* ────────────────── 字幕内容拉取（直连 → 代理） ────────────────── */

async function fetchCaptionBody(env: YoutubeEnv, baseUrl: string, preferProxy: boolean): Promise<string> {
  const url = baseUrl + "&fmt=json3";
  const headers = { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9" };

  const attempts: Array<() => Promise<string>> = [];
  if (preferProxy && proxyConfigured(env)) {
    attempts.push(async () => {
      const r = await proxyFetch(env, { url, headers, timeoutMs: 15000 });
      if (r.status !== 200) throw new Error(`caption ${r.status}`);
      return r.bodyText;
    });
    attempts.push(async () => (await fetchDirect(url, headers)) ?? "");
  } else {
    attempts.push(async () => (await fetchDirect(url, headers)) ?? "");
    if (proxyConfigured(env)) {
      attempts.push(async () => {
        const r = await proxyFetch(env, { url, headers, timeoutMs: 15000 });
        if (r.status !== 200) throw new Error(`caption ${r.status}`);
        return r.bodyText;
      });
    }
  }

  for (const attempt of attempts) {
    try {
      const body = await attempt();
      const text = parseJson3(body);
      if (text) return text;
    } catch {
      /* 下一尝试 */
    }
  }
  return "";
}

async function fetchDirect(url: string, headers: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
