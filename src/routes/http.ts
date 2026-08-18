import type { SseEvent } from "../core/types";

/** 默认带 CORS 头——为将来前后端独立部署保留能力（同源部署下无副作用） */
export function jsonResponse(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    ...CORS,
  };
}

export const sseEncode = (ev: SseEvent): Uint8Array =>
  new TextEncoder().encode(`data: ${JSON.stringify(ev)}\n\n`);

export function sseFromEvents(evs: SseEvent[]): Response {
  return new Response(evs.map(sseEncodeToText).join(""), { headers: sseHeaders() });
}

const sseEncodeToText = (ev: SseEvent): string => `data: ${JSON.stringify(ev)}\n\n`;
