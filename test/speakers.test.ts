import { describe, expect, it } from "vitest";
import {
  extractGuestFromTitle,
  extractLabeledSpeakers,
  resolveDialogueSpeakers,
} from "../src/core/speakers";

describe("extractLabeledSpeakers", () => {
  it("提取 Chris Anderson / Elon Musk", () => {
    const names = extractLabeledSpeakers(
      "Chris Anderson: Why?\nElon Musk: Twitter is the town square.\nElon Musk: Yes.",
    );
    expect(names).toEqual(["Chris Anderson", "Elon Musk"]);
  });
});

describe("extractGuestFromTitle", () => {
  it("从 a16z 标题推断 Marc Andreessen", () => {
    expect(
      extractGuestFromTitle("Marc Andreessen's 2026 Outlook: AI Timelines, US vs. China"),
    ).toBe("马克·安德森");
  });
});

describe("resolveDialogueSpeakers", () => {
  it("TED 字幕 → 克里斯·安德森 + 埃隆·马斯克", () => {
    expect(
      resolveDialogueSpeakers({
        videoTitle: "Elon Musk talks Twitter — TED2022",
        transcript: "Chris Anderson: Why?\nElon Musk: Because democracy.",
      }),
    ).toEqual({ host: "克里斯·安德森", guest: "埃隆·马斯克" });
  });

  it("a16z 无说话人标签 → 主持人 + 马克·安德森", () => {
    expect(
      resolveDialogueSpeakers({
        videoTitle: "Marc Andreessen's 2026 Outlook: AI Timelines",
        transcript: "so Marc let's start with the big question",
      }),
    ).toEqual({ host: "主持人", guest: "马克·安德森" });
  });

  it("无法推断 → 主持人 + 嘉宾", () => {
    expect(
      resolveDialogueSpeakers({
        videoTitle: "Random tech talk",
        transcript: "hello world",
      }),
    ).toEqual({ host: "主持人", guest: "嘉宾" });
  });
});
