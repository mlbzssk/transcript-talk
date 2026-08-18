// Node 测试环境无 cloudflare:sockets，仅提供占位导出以便模块加载。
// 依赖真实 socket 的 proxyFetch 不在单测覆盖范围内（需 Cloudflare 运行时）。
export function connect(): never {
  throw new Error("cloudflare:sockets 在 Node 测试环境不可用");
}
