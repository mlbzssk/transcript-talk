import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // proxy.ts 顶层 import 了 Cloudflare 专有模块，Node 测试环境无此模块
      "cloudflare:sockets": fileURLToPath(new URL("./test/stubs/cloudflare-sockets.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
