import type { SessionContext } from "../core/types";
import { logger } from "../core/logger";

export interface StoreEnv {
  /** KV 绑定可选：未配置时自动降级为模块级内存存储（单实例有效） */
  SESSIONS?: KVNamespace;
}

const TTL_SECONDS = 3600; // 1 小时，与前端"会话已过期"提示一致
const MAX_MEM_SESSIONS = 50; // 内存模式 FIFO 上限，防无限增长

const mem = new Map<string, SessionContext>();

/**
 * 双层存储：内存优先、KV 兜底。
 * KV 是最终一致性存储（传播可达数十秒），而 5W1H 是"生成完立刻点"的场景——
 * 内存层保证同实例读写一致，KV 层保证多实例/重启后可用。
 */
export async function saveSession(env: StoreEnv, id: string, ctx: SessionContext): Promise<void> {
  mem.set(id, ctx);
  if (mem.size > MAX_MEM_SESSIONS) {
    const oldest = mem.keys().next().value;
    if (oldest) mem.delete(oldest);
  }
  if (env.SESSIONS) {
    try {
      await env.SESSIONS.put(id, JSON.stringify(ctx), { expirationTtl: TTL_SECONDS });
    } catch (e) {
      /* KV 写失败不阻断主流程，内存层仍可服务本实例 */
      logger.error("KV 写入会话失败", { id, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

export async function loadSession(env: StoreEnv, id: string): Promise<SessionContext | null> {
  const local = mem.get(id);
  if (local) {
    // 内存层与 KV 同步过期：防 KV 已过期而内存仍命中的不一致
    if (Date.now() - local.createdAt > TTL_SECONDS * 1000) {
      mem.delete(id);
    } else {
      return local;
    }
  }
  if (env.SESSIONS) {
    try {
      const raw = await env.SESSIONS.get(id);
      if (raw) {
        const ctx = JSON.parse(raw) as SessionContext;
        mem.set(id, ctx); // 回填内存，后续读取零延迟
        return ctx;
      }
    } catch (e) {
      /* 损坏数据视同不存在 */
      logger.warn("KV 读取会话失败或数据损坏", { id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return null;
}
