import { appendJournalEntry, recentJournalEntries } from "./journal.js";
import type { Aspiration, HachikaSnapshot, ResolvedPurpose } from "./types.js";

// v3 Phase 3: aspiration は数週間スケールの「向かい先」。
// journal に書き残された決着 (fulfilled) の繰り返しから昇華され、
// purpose の選好と archived trace の再浮上に長期バイアスとして効く。
// 養われない aspiration は薄れ、消えるときは journal に残る (生の方向転換)
const MAX_ASPIRATIONS = 2;
const FORM_THRESHOLD = 2; // 同じ focus の fulfilled 決着がこの回数で昇華
const FEED_BOOST = 0.15;
const WANING_THRESHOLD = 0.24;
const FADE_THRESHOLD = 0.12;
const DECAY_PER_DAY = 0.02;

export function updateAspirationsFromResolution(
  snapshot: HachikaSnapshot,
  resolved: ResolvedPurpose,
  timestamp: string,
): void {
  if (resolved.outcome !== "fulfilled" || !resolved.topic) {
    return;
  }

  const theme = resolved.topic;
  const existing = snapshot.aspirations.find(
    (aspiration) => aspiration.theme === theme,
  );

  if (existing) {
    existing.strength = Math.min(1, existing.strength + FEED_BOOST);
    existing.lastFedAt = timestamp;
    existing.waning = false;
    return;
  }

  // journal に残した fulfilled の決着が繰り返されて初めて、向かい先として立つ
  const fulfilledCount = recentJournalEntries(snapshot, 30).filter(
    (entry) =>
      entry.source === "resolution" &&
      entry.mood === "settled" &&
      entry.focus === theme,
  ).length;

  if (fulfilledCount < FORM_THRESHOLD) {
    return;
  }

  const formed: Aspiration = {
    theme,
    origin: "resolutions",
    strength: 0.5,
    formedAt: timestamp,
    lastFedAt: timestamp,
    waning: false,
  };

  snapshot.aspirations = [...snapshot.aspirations, formed]
    .sort((left, right) => right.strength - left.strength)
    .slice(0, MAX_ASPIRATIONS);

  appendJournalEntry(snapshot, {
    writtenAt: timestamp,
    source: "resolution",
    mood: "turning",
    focus: theme,
    text: `気づけば「${theme}」へ何度も戻っている。これは自分の向かい先らしい。`,
  });
}

// 放置中、養われない向かい先は少しずつ薄れる
export function rewindAspirationsHours(
  snapshot: HachikaSnapshot,
  hours: number,
): void {
  if (!Number.isFinite(hours) || hours <= 0 || snapshot.aspirations.length === 0) {
    return;
  }

  const decay = (hours / 24) * DECAY_PER_DAY;
  const surviving: Aspiration[] = [];

  for (const aspiration of snapshot.aspirations) {
    const strength = Math.max(0, aspiration.strength - decay);

    if (strength <= FADE_THRESHOLD) {
      // 消えるときは、消えたことが自分の言葉で残る
      appendJournalEntry(snapshot, {
        writtenAt: new Date().toISOString(),
        source: "idle",
        mood: "turning",
        focus: aspiration.theme,
        text: `「${aspiration.theme}」への向かい先は、いつの間にか薄れていた。`,
      });
      continue;
    }

    surviving.push({
      ...aspiration,
      strength,
      waning: strength <= WANING_THRESHOLD,
    });
  }

  snapshot.aspirations = surviving;
}

// 長期バイアス: この topic は自分の向かい先にどれだけ近いか (0..1)
export function aspirationPull(
  snapshot: HachikaSnapshot,
  topic: string | null,
): number {
  if (!topic) {
    return 0;
  }

  const matched = snapshot.aspirations.find(
    (aspiration) =>
      aspiration.theme === topic ||
      topic.includes(aspiration.theme) ||
      aspiration.theme.includes(topic),
  );

  return matched ? matched.strength * (matched.waning ? 0.5 : 1) : 0;
}
