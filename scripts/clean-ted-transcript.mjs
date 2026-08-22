/**
 * 将 TED 原始转写（含时间戳、舞台提示）清理为纯对话文本，输出 .ts 常量文件。
 *
 * 用法:
 *   node scripts/clean-ted-transcript.mjs <input.txt> [output.ts] [EXPORT_NAME] [comment...]
 *
 * 默认（无参数）→ elon-ted-raw.txt → elon-ted-transcript.ts / ELON_TED_TRANSCRIPT_TEXT
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const rawPath = process.argv[2] ?? join(root, "elon-ted-raw.txt");
const outPath =
  process.argv[3] ?? join(root, "..", "src", "demo", "elon-ted-transcript.ts");
const exportName = process.argv[4] ?? "ELON_TED_TRANSCRIPT_TEXT";
const comment = process.argv.slice(5).join(" ") || "TED — 人工整理字幕（已去时间戳与舞台提示）";

const raw = readFileSync(rawPath, "utf8");
const lines = raw.split(/\r?\n/);
const out = [];

const STAGE_ONLY = /^\((Laughter|Applause|Applause and cheers|Video|Music|Laughs)\)$/i;

for (const line of lines) {
  let t = line.trim();
  if (!t) continue;
  if (/^\d{2}:\d{2}$/.test(t)) continue;
  if (STAGE_ONLY.test(t)) continue;
  t = t.replace(/^\((Laughter|Applause|Applause and cheers|Video|Music|Laughs)\)\s*/gi, "");
  if (!t) continue;
  t = t.replace(/^CA:\s*/, "Chris Anderson: ").replace(/^EM:\s*/, "Elon Musk: ");
  out.push(t);
}

const text = out.join("\n");
writeFileSync(outPath, `/** ${comment} */\nexport const ${exportName} = ${JSON.stringify(text)};\n`, "utf8");
console.log(`Wrote ${outPath} (${text.length} chars, ${out.length} lines)`);
