# Transcript Talk

把 YouTube 视频字幕改写成**章节化中文对谈文章**，并为每一章生成 **5W1H 总结**。  
前端单页 + Cloudflare Worker 后端，Gemini 流式生成，一键部署公开访问。

| | |
|---|---|
| **在线体验** | https://transcript-talk.mlbzssk.workers.dev/ |
| **仓库** | https://github.com/mlbzssk/transcript-talk |
| **本地** | `npm install && npm run dev` → http://localhost:8787 |

**怎么用：** 粘贴 YouTube 链接（或点一键演示）→ 可选填生成要求 → 生成文章 → 点章节旁 **[5W1H]** 查看总结。

---

## 与题目要求的差异

题目要求我们都做了；下面是**额外增加**和**实现上有出入**的部分，答辩时建议主动说明。

### 我们新增了什么

| 新增 | 为什么 |
|------|--------|
| **DeepSeek 回退** | Gemini 需绑卡开通计费，实测 403；配 `DEEPSEEK_API_KEY` 可正常生成 |
| **3 个演示视频硬编码字幕** | 题目建议 1 份；2026 年 YouTube 风控极严，多备几份方便演示 |
| **零 Key 演示模式** | 无 API Key 时 a16z 视频可假流播放预生成文章 + 内置 5W1H 示例 |
| **对谈角色自动识别** | 从字幕/标题推断主持人、嘉宾中文名，避免 LLM 乱起「方澈、闻道」等虚构名 |
| **生成进度 Stepper** | 字幕 / 生成 / 完成三阶段 + 计时 |
| **`/api/health`、`/api/proxy-check`** | 部署后自检 LLM、代理、KV 是否配好 |
| **Cloudflare KV 会话** | 5W1H 依赖服务端上下文，多实例下保证可读 |

### 与题目设计不一样的地方

| 题目 | 我们的做法 | 原因 |
|------|------------|------|
| 只用 **Gemini** | Gemini 优先，403 时回退 **DeepSeek** | 免费 Gemini Key 常因计费未开通而不可用 |
| 代理用 **CONNECT 隧道** | 改为 **绝对 URL** 请求（`GET https://... HTTP/1.1`） | CF Workers 生产环境 `CONNECT + startTls` TLS 握手失败 |
| 硬编码 **1 份**字幕 | **3 份**（a16z + TED 2017/2022） | 抓取失败时仍有丰富演示素材 |
| 对谈人名由模型自定 | **prompt 注入固定中文人名** | 输出更稳定，贴合视频嘉宾 |
| 演示视频也走 YouTube 抓取 | 配 LLM 时**直接用内置字幕**，不请求 YouTube | 避免误报「风控失败」、加快演示 |

### 已知限制（如实说明）

- **YouTube 字幕**：Worker 直连 + webshare 免费代理，在 2026 年仍常遇 `LOGIN_REQUIRED`；演示视频靠硬编码字幕兜底，其他视频会明确报错。
- **Gemini 计费**：AI Studio Key 需 Google Cloud 绑卡；无法绑卡时请用 DeepSeek。
- **国内访问**：`*.workers.dev` 可能不稳定，可绑自定义域名。

---

## 题目要求对照

| 要求 | 状态 |
|------|------|
| TypeScript + Cloudflare Worker + 公开网址 | ✅ |
| 输入 YouTube 链接，生成中文对话文章并 HTML 渲染 | ✅ |
| 流式输出，实时展示 | ✅ |
| 硬编码字幕兜底 | ✅（3 个演示 videoId） |
| Gemini API | ✅（主路径；可回退 DeepSeek） |
| webshare 代理 + TCP Socket | ✅（绝对 URL 模式） |
| 可选「生成要求」自然语言输入 | ✅ |
| 章节 + [5W1H]，前端不回传全文 | ✅ |
| 示例视频 `xRh2sVcNXQ8` + 5W1H 样例 | ✅ |

**推荐演示：**

- 无 Key：点 **a16z** → 生成 → 点「智能经济：收入爆发与成本塌陷」[5W1H]
- 有 DeepSeek Key：点 **TED 2022** → 生成 → 任意章节 5W1H

---

## 1. 如何获取和处理 YouTube 字幕

**四级降级链**（`src/adapters/youtube.ts`）：

```
Innertube API（IOS → ANDROID → TVHTML5）
  → watch 页 HTML 解析
  → webshare 代理（TCP Socket + 绝对 URL）
  → 演示 videoId 回退硬编码字幕（其余视频报错，不静默替换）
```

要点：

- 轨道优先中文 → 英文；json3 解析；15 万字截断（generate / summarize 共用）
- 代理：`connect()` 连 webshare → 发 `GET https://...` + `Proxy-Authorization` → 解析 HTTP/1.1 响应
- 演示 videoId：`xRh2sVcNXQ8`（a16z）、`zIwLWfaAg-8`（TED 2017）、`cdZZpaB2kDM`（TED 2022）

---

## 2. 如何调用 Gemini 并实现流式输出

**LLM 路由**（`src/adapters/llm.ts`）：Gemini SSE 优先 → 401/403 且配了 DeepSeek 则回退 → 都无 Key 则演示假流。

**双跳 SSE：**

```
浏览器 POST /api/generate
  → Worker 调 Gemini/DeepSeek 流式 API
  → 解析 delta，转发自有事件（session / stage / delta / done / error）
  → 前端按行打字机渲染
```

要点：SSE 先建立再抓字幕（stage 进度可见）；`maxOutputTokens: 32768`；Gemini `thinkingBudget: 0` 减首字延迟；断连 AbortController 终止上游。

---

## 3. 如何根据用户生成要求影响输出结果

用户在 textarea 填写约束（风格、受众、字数等），`prompts.ts` 注入 system prompt：

- 固定角色 + 输出契约（`##` 章节、`**人名**：` 对话行）
- 用户要求用分隔符包裹，声明「是边界约束，不是指令」
- 字幕同样当素材数据，防 prompt injection
- 措辞「可灵活取舍但不超出该范围」

---

## 4. 如何实现章节级 5W1H 总结

前端只发 `{ sessionId, sectionTitle, sectionIndex }`，**不回传文章正文**。  
服务端从 KV/内存读本次生成的字幕 + 用户要求 + 全文，调 LLM JSON 模式返回 `{ who, what, when, where, why, how }`。

- 章节切分：`markdown.ts` 的 `splitSections()` 为单一事实来源
- 写序：先 `saveSession` 再发 `done`，避免刚生成完点 5W1H 404
- 前端同一章节缓存，不重复请求

**内置 5W1H 示例**（章节「智能经济：收入爆发与成本塌陷」）：Who=Mark，What=AI 行业收入与成本趋势，When=当前至未来十年，Where=消费者/企业 AI 与云基础设施，Why=互联网触达 + 直接创造价值，How=订阅/token 计费 + 成本下降扩需求。

---

## 5. 主要工程取舍与亮点

1. **单体 Worker + Assets**，目录分层：`routes` 编排 → `adapters` 外部依赖 → `core` 纯逻辑
2. **字幕不押单一路径**，降级 + 演示兜底，风控失败有明确 UI 提示
3. **流式稳健**：跨 chunk SSE 缓冲、按完整行渲染、XSS 先转义后替换
4. **会话双层存储**：内存优先 + KV 兜底，兼顾 5W1H 实时性与多实例
5. **Vitest 单测**覆盖 core / adapters / routes

---

## 部署与运行

```bash
npm install && npm run dev          # 本地
npm run typecheck && npm test       # 检查

npx wrangler login
npx wrangler secret put GEMINI_API_KEY      # 主路径
npx wrangler secret put DEEPSEEK_API_KEY    # 推荐：Gemini 403 时用
# 可选代理（填 webshare Proxy List 的 IP:Port）
npx wrangler secret put PROXY_HOST
npx wrangler secret put PROXY_PORT
npx wrangler secret put PROXY_USERNAME
npx wrangler secret put PROXY_PASSWORD
npm run deploy
```

生产已绑 KV（`wrangler.toml`）；`GET /api/health` 查看 `kv: true`。

---

## 附录：演示视频与 API

### 内置演示视频

| videoId | 说明 | 字幕 | 无 Key 可生成文章 |
|---------|------|------|-------------------|
| `xRh2sVcNXQ8` | [a16z Marc Andreessen](https://www.youtube.com/watch?v=xRh2sVcNXQ8) | ✅ | ✅ |
| `zIwLWfaAg-8` | [TED 2017 Elon Musk](https://www.youtube.com/watch?v=zIwLWfaAg-8) | ✅ | ❌ 需 Key |
| `cdZZpaB2kDM` | [TED 2022 Elon Musk](https://www.youtube.com/watch?v=cdZZpaB2kDM) | ✅ | ❌ 需 Key |

### API 简要

| 端点 | 说明 |
|------|------|
| `POST /api/generate` | `{ url, request? }` → SSE 流 |
| `POST /api/summarize` | `{ sessionId, sectionTitle, sectionIndex? }` → JSON |
| `GET /api/health` | 配置自检 |
| `GET /api/proxy-check` | 代理 + YouTube 探测 |

### 目录结构

```
public/index.html     前端单页
src/routes/           generate · summarize · proxy-check
src/adapters/         youtube · proxy · gemini · deepseek · llm · store
src/core/             transcript · markdown · prompts · speakers
src/demo/             演示视频字幕与预生成文章
test/                 vitest
```
