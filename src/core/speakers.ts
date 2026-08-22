/** 常见嘉宾 → 中文译名（稳定、可预期） */
const GUEST_ZH: Record<string, string> = {
  "elon musk": "埃隆·马斯克",
  "marc andreessen": "马克·安德森",
  "ronny chieng": "钱信伊",
};

const HOST_ZH: Record<string, string> = {
  "chris anderson": "克里斯·安德森",
};

export interface DialogueSpeakers {
  host: string;
  guest: string;
}

function normKey(name: string): string {
  return name.trim().toLowerCase();
}

function toZh(name: string, map: Record<string, string>): string {
  return map[normKey(name)] ?? name;
}

/** 从「Chris Anderson: …」行首提取说话人 */
export function extractLabeledSpeakers(transcript: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of transcript.split("\n")) {
    const m = line.match(/^([A-Za-z][A-Za-z .'-]{0,48}):\s/);
    if (!m) continue;
    const key = normKey(m[1]!);
    if (!seen.has(key)) {
      seen.add(key);
      names.push(m[1]!.trim());
    }
  }
  return names;
}

/** 从视频标题推断主嘉宾（如 "Marc Andreessen's 2026 Outlook"） */
export function extractGuestFromTitle(title: string): string | null {
  for (const key of Object.keys(GUEST_ZH)) {
    const re = new RegExp(key.replace(/\s+/g, "[\\s']+"), "i");
    if (re.test(title)) {
      return GUEST_ZH[key]!;
    }
  }
  const m = title.match(/^([A-Za-z][A-Za-z .'-]{0,48}?)(?:'s|\s+[—–-]\s)/);
  if (m) return toZh(m[1]!.trim(), GUEST_ZH);
  return null;
}

/**
 * 确定性解析对谈角色名，避免 LLM 每次生成「方澈/闻道/Jen/Mark」等虚构名。
 * 优先级：字幕说话人标签 → 标题/作者 → 主持人 + 嘉宾
 */
export function resolveDialogueSpeakers(input: {
  videoTitle: string;
  author?: string;
  transcript: string;
}): DialogueSpeakers {
  const labeled = extractLabeledSpeakers(input.transcript);
  const hostRaw = labeled.find((n) => /chris anderson/i.test(n));
  const guestRaw = labeled.find((n) => !/chris anderson/i.test(n));

  if (hostRaw && guestRaw) {
    return {
      host: toZh(hostRaw, HOST_ZH),
      guest: toZh(guestRaw, GUEST_ZH),
    };
  }

  const fromTitle = extractGuestFromTitle(input.videoTitle);
  if (fromTitle) {
    return { host: "主持人", guest: fromTitle };
  }

  const author = input.author?.trim();
  if (author && author !== "TED" && author !== "YouTube") {
    return { host: "主持人", guest: toZh(author, GUEST_ZH) };
  }

  if (guestRaw) {
    return { host: hostRaw ? toZh(hostRaw, HOST_ZH) : "主持人", guest: toZh(guestRaw, GUEST_ZH) };
  }

  return { host: "主持人", guest: "嘉宾" };
}
