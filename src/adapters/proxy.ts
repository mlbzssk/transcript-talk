import { connect } from "cloudflare:sockets";
import { logger } from "../core/logger";

/**
 * webshare.io HTTP 代理适配器。
 *
 * Cloudflare Worker 的 fetch 不支持配置代理，因此通过 TCP Socket 手工实现。
 *
 * 采用「绝对 URL」模式（GET https://host/path HTTP/1.1），由代理端发起与目标的 HTTPS，
 * Worker 侧仅明文 HTTP 对话代理——避免 CONNECT 隧道内 startTls() 在 CF 生产环境
 * （尤其 PROXY_HOST 为 IP 时 expectedServerHostname 不生效）导致 TLS Handshake Failed。
 */
export interface ProxyEnv {
  PROXY_HOST?: string;
  PROXY_PORT?: string;
  PROXY_USERNAME?: string;
  PROXY_PASSWORD?: string;
}

export function proxyConfigured(env: ProxyEnv): boolean {
  return !!(env.PROXY_HOST && env.PROXY_PORT && env.PROXY_USERNAME && env.PROXY_PASSWORD);
}

export interface ProxyRequest {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface ProxyResponse {
  status: number;
  bodyText: string;
}

/** 经代理发起 HTTPS 请求。任何失败抛 Error，由上层降级链决定下一步。 */
export async function proxyFetch(env: ProxyEnv, req: ProxyRequest): Promise<ProxyResponse> {
  const u = new URL(req.url);
  if (u.protocol !== "https:") throw new Error("proxy fetch 仅支持 https");
  const method = req.method ?? "GET";
  const timeoutMs = req.timeoutMs ?? 20000;

  const socket = connect(
    { hostname: env.PROXY_HOST!, port: Number(env.PROXY_PORT!) },
    { allowHalfOpen: false },
  );
  const timer = setTimeout(() => socket.close(), timeoutMs);
  try {
    const auth = btoa(`${env.PROXY_USERNAME}:${env.PROXY_PASSWORD}`);
    const headers: Record<string, string> = {
      Host: u.hostname,
      Connection: "close",
      "Proxy-Authorization": `Basic ${auth}`,
      ...(req.body ? { "Content-Length": String(req.body.length) } : {}),
      ...req.headers,
    };
    // 绝对 URL：代理代为 HTTPS，Worker 不再 CONNECT + startTls
    const raw =
      `${method} ${u.href} HTTP/1.1\r\n` +
      Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n") +
      "\r\n\r\n" +
      (req.body ?? "");
    await writeAll(socket, raw);
    const all = await new ByteReader(socket).readAll();
    return await parseHttpResponse(all);
  } finally {
    clearTimeout(timer);
    safeClose(socket);
  }
}

/** Socket 写入辅助（Socket 接口无 write 方法，统一走 writable 流） */
async function writeAll(socket: Socket, text: string): Promise<void> {
  const writer = socket.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(text));
  } finally {
    writer.releaseLock();
  }
}

/** 单 reader 字节流：支持「读到分隔符为止」与「读到 EOF」，内部维护缓冲 */
class ByteReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buf = new Uint8Array(0);
  private eof = false;

  constructor(socket: Socket) {
    this.reader = socket.readable.getReader();
  }

  release(): void {
    try {
      this.reader.releaseLock();
    } catch {
      /* already released */
    }
  }

  private append(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
  }

  async readUntil(sep: string): Promise<string | null> {
    const needle = new TextEncoder().encode(sep);
    while (true) {
      const idx = findSub(this.buf, needle);
      if (idx !== -1) {
        const out = new TextDecoder().decode(this.buf.slice(0, idx));
        this.buf = this.buf.slice(idx + needle.length);
        return out;
      }
      if (this.eof) return null;
      const { done, value } = await this.reader.read();
      if (done) {
        this.eof = true;
        continue;
      }
      if (value) this.append(value);
    }
  }

  async readAll(): Promise<Uint8Array> {
    while (!this.eof) {
      const { done, value } = await this.reader.read();
      if (done) {
        this.eof = true;
        break;
      }
      if (value) this.append(value);
    }
    return this.buf;
  }
}

async function parseHttpResponse(all: Uint8Array): Promise<ProxyResponse> {
  const sep = findSub(all, new TextEncoder().encode("\r\n\r\n"));
  if (sep === -1) throw new Error("代理响应格式异常（无 header 边界）");
  const head = new TextDecoder().decode(all.slice(0, sep));
  const statusLine = head.split("\r\n")[0] ?? "";
  const status = Number(statusLine.split(" ")[1] ?? "0");
  if (status === 0) {
    logger.warn("代理响应无法解析状态行", { statusLine: statusLine.slice(0, 120) });
  }
  let body: Uint8Array = all.slice(sep + 4);
  if (/transfer-encoding:\s*chunked/i.test(head)) body = dechunk(body);
  if (body[0] === 0x1f && body[1] === 0x8b) body = await gunzip(body);
  return { status, bodyText: new TextDecoder().decode(body) };
}

/** bytes 层解 chunked（chunk 边界可能切断 UTF-8 多字节序列，不能在字符串层做） */
function dechunk(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 0;
  while (i < b.length) {
    const nl = findSub(b.slice(i), new TextEncoder().encode("\r\n"));
    if (nl === -1) break;
    const size = parseInt(new TextDecoder().decode(b.slice(i, i + nl)).trim(), 16);
    if (!Number.isFinite(size) || size === 0) break;
    const start = i + nl + 2;
    parts.push(b.slice(start, start + size));
    i = start + size + 2;
  }
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function gunzip(b: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(b).body!.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findSub(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function safeClose(socket: Socket): void {
  socket.close().catch(() => {
    /* already closed */
  });
}
