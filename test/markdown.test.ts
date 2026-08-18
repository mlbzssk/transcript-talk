import { describe, expect, it } from "vitest";
import { findSection, splitSections } from "../src/core/markdown";

const article = `# 主标题

这是引言段落。

## 第一章：背景
内容一

## 第二章：冲突
内容二
`;

describe("splitSections", () => {
  it("序言归入 index 0", () => {
    const sections = splitSections(article);
    expect(sections[0]?.index).toBe(0);
    expect(sections[0]?.title).toBe("");
    expect(sections[0]?.content).toContain("主标题");
    expect(sections[0]?.content).toContain("引言");
  });
  it("章节从 index 1 起且标题正确", () => {
    const sections = splitSections(article);
    expect(sections[1]?.title).toBe("第一章：背景");
    expect(sections[2]?.title).toBe("第二章：冲突");
    expect(sections[2]?.content).toContain("内容二");
  });
  it("空文章返回空数组", () => {
    expect(splitSections("")).toEqual([]);
  });
});

describe("findSection", () => {
  it("按标题定位", () => {
    const s = findSection(article, "第二章：冲突", -1);
    expect(s?.content).toContain("内容二");
  });
  it("标题 + 序号双锚点可消解同名章节", () => {
    const dup = `# 标题

## 同名
内容A

## 同名
内容B
`;
    expect(findSection(dup, "同名", 1)?.content).toContain("内容A");
    expect(findSection(dup, "同名", 2)?.content).toContain("内容B");
  });
  it("找不到返回 null", () => {
    expect(findSection(article, "不存在", -1)).toBeNull();
  });
});
