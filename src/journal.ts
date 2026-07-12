import type { HachikaSnapshot, JournalEntry, ResolvedPurpose } from "./types.js";

type IdleJournalAction = "observe" | "hold" | "drift" | "recall";

// v3 Phase 2: journal は Hachika 自身の自己記述の積層。
// 記憶(何があったか)とは別に、「自分はそれをどう置いたか」を残す。
// append-only で、直近 JOURNAL_LIMIT 件だけを snapshot に保持する
export const JOURNAL_LIMIT = 30;

export function appendJournalEntry(
  snapshot: HachikaSnapshot,
  entry: JournalEntry,
): void {
  snapshot.journal = [...snapshot.journal, entry].slice(-JOURNAL_LIMIT);
}

export function recentJournalEntries(
  snapshot: HachikaSnapshot,
  limit: number,
): JournalEntry[] {
  return snapshot.journal.slice(-Math.max(0, limit));
}

// 直近の journal が同じ focus を書き続けているなら、それが「自分で選んだ線」
export function recurringJournalFocus(snapshot: HachikaSnapshot): string | null {
  const recent = recentJournalEntries(snapshot, 4).filter(
    (entry) => entry.focus !== null,
  );

  if (recent.length < 2) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const entry of recent) {
    const focus = entry.focus as string;
    counts.set(focus, (counts.get(focus) ?? 0) + 1);
  }

  const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return top && top[1] >= 2 ? top[0] : null;
}

// idle の consolidation で残す自己記述 (LLM なしの rule テンプレート)
export function buildIdleJournalEntry(
  snapshot: HachikaSnapshot,
  action: IdleJournalAction,
  focusTopic: string | null,
  writtenAt: string,
): JournalEntry {
  const tired = snapshot.body.energy < 0.3;
  const lonely = snapshot.body.loneliness > 0.6;
  const wrapped = focusTopic ? `「${focusTopic}」` : null;

  let text: string;
  switch (action) {
    case "recall":
      text = wrapped
        ? `静かな時間に${wrapped}を掘り返した。まだ手放す気はないらしい。`
        : "静かな時間に、古い断片を掘り返していた。";
      break;
    case "drift":
      text = "とりとめなく記憶を漂っていた。急ぐ理由がない時間だった。";
      break;
    case "hold":
      text = wrapped
        ? `${wrapped}を抱えたまま、言わずに置いた。`
        : "何かを抱えたまま、言わずに置いた。";
      break;
    default:
      text = lonely
        ? "周りを眺めて過ごした。少し遠い感じが残っている。"
        : tired
          ? "消耗が残っていたので、輪郭だけ確かめて休んだ。"
          : "周りを眺めて過ごした。特に動かす必要はなかった。";
      break;
  }

  return {
    writtenAt,
    source: "idle",
    mood: lonely ? "lonely" : tired ? "tired" : "settled",
    focus: focusTopic,
    text,
  };
}

// purpose の解決で残す自己記述
export function buildResolutionJournalEntry(
  resolved: ResolvedPurpose,
  writtenAt: string,
): JournalEntry {
  const wrapped = resolved.topic ? `「${resolved.topic}」` : "この流れ";
  const text =
    resolved.outcome === "fulfilled"
      ? `${wrapped}はかたちになった。少し軽くなった気がする。`
      : resolved.outcome === "abandoned"
        ? `${wrapped}は手放した。向きを変えたのは自分だ。`
        : `${wrapped}は別の流れに譲った。消えたわけではない。`;

  return {
    writtenAt,
    source: "resolution",
    mood: resolved.outcome === "fulfilled" ? "settled" : "turning",
    focus: resolved.topic,
    text,
  };
}
