import { connect } from "cloudflare:sockets";
import { logger } from "../core/logger";

/**
 * webshare.io HTTP 代理适配器。
 *
 * Cloudflare Worker 的 fetch 不支持配置代理，因此通过 TCP Socket 手工实现：
 *   TCP 连到代理 → 发 CONNECT 建立隧道 → startTls() 升级 TLS
 *   → 在 TLS 流上手工写 HTTP/1.1 请求 → 手工解析响应（含 chunked 编码）
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
    { secureTransport: "starttls", allowHalfOpen: false },
  );
  const timer = setTimeout(() => socket.close(), timeoutMs);
  try {
    // 1. CONNECT 隧道（webshare 端口 80 为明文 HTTP 代理）
    const auth = btoa(`${env.PROXY_USERNAME}:${env.PROXY_PASSWORD}`);
    await writeAll(
      socket,
      `CONNECT ${u.hostname}:443 HTTP/1.1\r\n` +
        `Host: ${u.hostname}:443\r\n` +
        `Proxy-Authorization: Basic ${auth}\r\n\r\n`,
    );
    const reader = new ByteReader(socket);
    const replyHead = (await reader.readUntil("\r\n\r\n")) ?? "";
    const statusLine = replyHead.split("\r\n")[0] ?? "";
    if (!/HTTP\/1\.[01]\s+200/.test(statusLine)) {
      // 只记录状态行（不含 Proxy-Authorization 凭据）
      logger.warn("代理 CONNECT 握手失败", { host: u.hostname, statusLine: statusLine.slice(0, 80) });
      throw new Error(`代理握手失败: ${statusLine.slice(0, 80)}`);
    }
    reader.release();

    // 2. 隧道内 TLS 升级
    const tls = socket.startTls({ expectedServerHostname: u.hostname });

    // 3. 手写 HTTP/1.1 请求（fetch 无法接管 socket）
    const headers: Record<string, string> = {
      Host: u.hostname,
      Connection: "close", // 读完即 EOF，简化响应边界判断
      ...(req.body ? { "Content-Length": String(req.body.length) } : {}),
      ...req.headers,
    };
    const raw =
      `${method} ${u.pathname}${u.search} HTTP/1.1\r\n` +
      Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n") +
      "\r\n\r\n" +
      (req.body ?? "");
    await writeAll(tls, raw);

    // 4. 读完整响应并解析
    const all = await new ByteReader(tls).readAll();
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
  const status = Number((head.split(" ")[1] ?? "0"));
  let body: Uint8Array = all.slice(sep + 4);
  if (/transfer-encoding:\s*chunked/i.test(head)) body = dechunk(body);
  if (body[0] === 0x1f && body[1] === 0x8b) body = await gunzip(body); // 保险：未带 Accept-Encoding 仍可能收到 gzip
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
