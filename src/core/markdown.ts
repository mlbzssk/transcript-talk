import type { Section } from "./types";

/**
 * 将文章按 `## 章节标题` 切分。
 * `# 主标题` 与章节开始前的内容（引言）归入序言（index 0，无 5W1H 按钮）。
 *
 * 该函数是「单一事实来源」：
 * - generate 完成后保存章节标题列表
 * - summarize 按同一规则定位章节原文
 */
export function splitSections(article: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { index: 0, title: "", content: "" };
  for (const line of article.split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (current.content.trim()) sections.push(current);
      current = { index: sections.length, title: m[1]!, content: line + "\n" };
    } else {
      current.content += line + "\n";
    }
  }
  if (current.content.trim()) sections.push(current);
  return sections;
}

/** 按标题 + 序号双锚点定位章节（防同名章节） */
export function findSection(article: string, title: string, index: number): Section | null {
  const sections = splitSections(article);
  return (
    sections.find((s) => s.title === title && s.index === index) ??
    sections.find((s) => s.title === title) ??
    null
  );
}
