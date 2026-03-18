import type { HachikaSnapshot, MemoryEntry } from "./types.js";

const segmenter = new Intl.Segmenter("ja", { granularity: "word" });

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "you",
  "your",
  "are",
  "was",
  "were",
  "from",
  "have",
  "has",
  "into",
  "about",
  "just",
  "hello",
  "thanks",
  "then",
  "them",
  "they",
  "ありがとう",
  "こんにちは",
  "こんばんは",
  "おはよう",
  "よろしく",
  "お願い",
  "お願いします",
  "する",
  "して",
  "した",
  "いる",
  "ある",
  "こと",
  "それ",
  "これ",
  "ここ",
  "ため",
  "よう",
  "もの",
  "ので",
  "から",
  "まで",
  "です",
  "ます",
  "ない",
  "たい",
  "では",
  "には",
  "へ",
  "を",
  "に",
  "が",
  "は",
  "と",
  "も",
  "で",
  "の",
]);

export function extractTopics(text: string): string[] {
  const topics: string[] = [];
  const seen = new Set<string>();

  for (const segment of segmenter.segment(text)) {
    if (!segment.isWordLike) {
      continue;
    }

    const normalized = normalizeToken(segment.segment);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    topics.push(normalized);

    if (topics.length >= 6) {
      break;
    }
  }

  return topics;
}

export function remember(
  snapshot: HachikaSnapshot,
  role: MemoryEntry["role"],
  text: string,
  topics: string[],
  sentiment: MemoryEntry["sentiment"],
): void {
  snapshot.memories.push({
    role,
    text,
    timestamp: new Date().toISOString(),
    topics: [...topics],
    sentiment,
  });

  if (snapshot.memories.length > 24) {
    snapshot.memories.splice(0, snapshot.memories.length - 24);
  }
}

export function findRelevantMemory(
  snapshot: HachikaSnapshot,
  topics: string[],
): MemoryEntry | undefined {
  if (topics.length === 0) {
    return undefined;
  }

  for (const memory of [...snapshot.memories].reverse()) {
    if (memory.topics.some((topic) => topics.includes(topic))) {
      return memory;
    }
  }

  return undefined;
}

export function topPreferredTopics(snapshot: HachikaSnapshot, limit = 3): string[] {
  return Object.entries(snapshot.preferences)
    .filter(([, score]) => score > 0.15)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([topic]) => topic);
}

function normalizeToken(token: string): string | null {
  const normalized = token.normalize("NFKC").trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (STOPWORDS.has(normalized)) {
    return null;
  }

  if (/^[0-9]+$/.test(normalized)) {
    return null;
  }

  if (normalized.length === 1 && !/[a-z]/.test(normalized)) {
    return null;
  }

  return normalized;
}
