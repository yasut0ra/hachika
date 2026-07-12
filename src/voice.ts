import type { HachikaSnapshot, VoiceProfile } from "./types.js";

// v3 Phase 4: voice は自分の発話履歴から蒸留される「言い方の癖」。
// 静かな時間 (idle の最初の窓) に定着し、以後の opener 選択と wording に個体差として効く
const OPENING_HABIT_THRESHOLD = 2;
const MAX_PREFERRED_OPENINGS = 2;

export function createEmptyVoiceProfile(): VoiceProfile {
  return {
    preferredOpenings: [],
    brevityBias: 0,
    updatedAt: null,
  };
}

export function distillVoiceProfile(
  snapshot: HachikaSnapshot,
  timestamp: string,
): void {
  const spoken = snapshot.memories
    .filter((memory) => memory.role === "hachika")
    .map((memory) => memory.text.trim())
    .filter((text) => text.length > 0);

  if (spoken.length < 3) {
    return;
  }

  // 入り方の癖: 最初の一文が繰り返されているなら、それは身についた声
  const openingCounts = new Map<string, number>();
  for (const text of spoken) {
    const opening = firstSentence(text);
    if (opening) {
      openingCounts.set(opening, (openingCounts.get(opening) ?? 0) + 1);
    }
  }

  const preferredOpenings = [...openingCounts.entries()]
    .filter(([, count]) => count >= OPENING_HABIT_THRESHOLD)
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_PREFERRED_OPENINGS)
    .map(([opening]) => opening);

  // 文の長さの癖: 負 = 簡潔寄り、正 = 語り寄り
  const averageSentences =
    spoken.reduce((sum, text) => sum + countSentences(text), 0) / spoken.length;
  const brevityBias = Math.max(-1, Math.min(1, (averageSentences - 2.5) / 2));

  snapshot.voice = {
    preferredOpenings,
    brevityBias: Math.round(brevityBias * 1000) / 1000,
    updatedAt: timestamp,
  };
}

function firstSentence(text: string): string | null {
  const end = text.indexOf("。");

  if (end <= 0 || end > 24) {
    return null;
  }

  return text.slice(0, end + 1);
}

function countSentences(text: string): number {
  return Math.max(1, text.split("。").filter((part) => part.trim().length > 0).length);
}
