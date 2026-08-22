import type { AppEnv } from "../core/types";
import { logger } from "../core/logger";
import {
  proxyConfigured,
  proxyFetch,
  type ProxyEnv,
} from "../adapters/proxy";
import { jsonResponse } from "./http";

export interface ProxyProbe {
  ok: boolean;
  elapsedMs: number;
  error?: string;
}

export interface ProxyIpifyProbe extends ProxyProbe {
  status: number;
  exitIp?: string;
}

export interface ProxyYoutubeProbe extends ProxyProbe {
  playability?: string;
  reason?: string;
  hasCaptions?: boolean;
  /** 非 200 时代理/YouTube 返回体摘要 */
  detail?: string;
}

/** Worker 侧代理自检结果（不含密码） */
export interface ProxyCheckResult {
  configured: boolean;
  /** 代理隧道是否连通（ipify 成功） */
  ok: boolean;
  host?: string;
  port?: string;
  ipify?: ProxyIpifyProbe;
  youtube?: ProxyYoutubeProbe;
  message: string;
}

/**
 * 经 proxyFetch 探测：① ipify 验证 CONNECT/TLS/认证 ② Innertube 验证 YouTube 是否放行该出口 IP。
 */
export async function checkProxy(env: ProxyEnv): Promise<ProxyCheckResult> {
  if (!proxyConfigured(env)) {
    return {
      configured: false,
      ok: false,
      message: "未配置 PROXY_HOST / PROXY_PORT / PROXY_USERNAME / PROXY_PASSWORD",
    };
  }

  const host = env.PROXY_HOST!;
  const port = env.PROXY_PORT!;
  const result: ProxyCheckResult = {
    configured: true,
    ok: false,
    host,
    port,
    message: "",
  };

  const ipifyStart = Date.now();
  try {
    const r = await proxyFetch(env, {
      url: "https://api.ipify.org?format=json",
      timeoutMs: 15000,
    });
    const elapsedMs = Date.now() - ipifyStart;
    let exitIp: string | undefined;
    if (r.status === 200) {
      try {
        exitIp = (JSON.parse(r.bodyText) as { ip?: string }).ip;
      } catch {
        /* ignore */
      }
    }
    result.ipify = {
      ok: r.status === 200 && !!exitIp,
      status: r.status,
      exitIp,
      elapsedMs,
      error: r.status === 200 && exitIp ? undefined : `HTTP ${r.status}`,
    };
  } catch (e) {
    result.ipify = {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - ipifyStart,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const ytStart = Date.now();
  try {
    const r = await proxyFetch(env, {
      method: "POST",
      url: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://www.youtube.com",
      },
      body: JSON.stringify({
        videoId: "xRh2sVcNXQ8",
        context: {
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
      }),
      timeoutMs: 15000,
    });
    const elapsedMs = Date.now() - ytStart;
    if (r.status !== 200) {
      const snippet = r.bodyText.trim().slice(0, 200) || undefined;
      result.youtube = { ok: false, elapsedMs, error: `HTTP ${r.status}`, ...(snippet ? { detail: snippet } : {}) };
    } else {
      const json = JSON.parse(r.bodyText) as {
        playabilityStatus?: { status?: string; reason?: string };
        captions?: {
          playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] };
        };
      };
      const playability = json.playabilityStatus?.status;
      const reason = json.playabilityStatus?.reason;
      const tracks = json.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      result.youtube = {
        ok: playability === "OK",
        playability,
        reason,
        hasCaptions: tracks.length > 0,
        elapsedMs,
      };
    }
  } catch (e) {
    result.youtube = {
      ok: false,
      elapsedMs: Date.now() - ytStart,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  result.ok = result.ipify?.ok ?? false;
  if (!result.ok) {
    result.message =
      "代理未连通，请核对 PROXY_HOST 是否为列表 IP、PORT 与用户名密码；若 ipify.error 含 HTTP 4xx/5xx 可能是代理不支持绝对 URL 模式";
  } else if (!result.youtube?.ok) {
    const hint = result.youtube?.playability ?? result.youtube?.error ?? "未知";
    const is400 = result.youtube?.error?.includes("400");
    result.message = is400
      ? `代理已连通（出口 ${result.ipify?.exitIp}），但 YouTube 返回 HTTP 400——免费 Datacenter 代理（10 个共享机房 IP）几乎都会被 YouTube 拦截，换国家 IP 通常无效。作业请用「演示视频」，或购买 Residential 套餐`
      : `代理已连通（出口 ${result.ipify?.exitIp}），但 YouTube 仍拒绝：${hint}。请换 Proxy List 中其他国家 IP，或使用演示视频`;
  } else {
    result.message = `代理连通且 YouTube 放行（出口 ${result.ipify?.exitIp}，字幕轨 ${result.youtube?.hasCaptions ? "有" : "无"}）`;
  }

  return result;
}

/**
 * GET /api/proxy-check — Worker 侧探测 webshare 代理是否连通。
 */
export async function handleProxyCheck(request: Request, env: AppEnv): Promise<Response> {
  const requestId = request.headers.get("cf-ray") ?? "local";
  const startedAt = Date.now();
  const result = await checkProxy(env);
  logger.info("proxy-check 完成", {
    requestId,
    configured: result.configured,
    ok: result.ok,
    youtubeOk: result.youtube?.ok,
    elapsedMs: Date.now() - startedAt,
  });
  return jsonResponse(result);
}
