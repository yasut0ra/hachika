import { clamp01, clampSigned } from "./state.js";
import type {
  HachikaSnapshot,
  InteractionSignals,
  MemoryEntry,
  TopicImprint,
} from "./types.js";

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

export function consolidateImprints(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  sentimentScore: number,
  timestamp = new Date().toISOString(),
): void {
  for (const topic of signals.topics) {
    const topicCount = snapshot.topicCounts[topic] ?? 0;
    const preference = snapshot.preferences[topic] ?? 0;
    const qualifies =
      topicCount >= 2 ||
      Math.abs(preference) >= 0.18 ||
      Math.abs(sentimentScore) >= 0.35 ||
      signals.memoryCue > 0.1 ||
      signals.expansionCue > 0.2;

    if (!qualifies) {
      continue;
    }

    const previous = snapshot.imprints[topic];
    const salienceGain =
      0.12 +
      Math.min(0.16, topicCount * 0.04) +
      Math.abs(preference) * 0.1 +
      Math.abs(sentimentScore) * 0.08 +
      signals.memoryCue * 0.12 +
      signals.expansionCue * 0.08 +
      signals.question * 0.04;

    snapshot.imprints[topic] = {
      topic,
      salience: clamp01((previous?.salience ?? 0) * 0.88 + salienceGain),
      valence: clampSigned((previous?.valence ?? sentimentScore) * 0.72 + sentimentScore * 0.28),
      mentions: Math.max(previous?.mentions ?? 0, topicCount),
      firstSeenAt: previous?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
    };
  }

  pruneImprints(snapshot, 16);
}

export function findRelevantImprint(
  snapshot: HachikaSnapshot,
  topics: string[],
): TopicImprint | undefined {
  const imprints = Object.values(snapshot.imprints);

  for (const topic of topics) {
    const imprint = snapshot.imprints[topic];

    if (imprint) {
      return imprint;
    }
  }

  return imprints
    .sort((left, right) => right.salience - left.salience)
    .find((imprint) => imprint.salience > 0.45);
}

export function sortedImprints(snapshot: HachikaSnapshot, limit = 6): TopicImprint[] {
  return Object.values(snapshot.imprints)
    .sort((left, right) => {
      if (right.salience !== left.salience) {
        return right.salience - left.salience;
      }

      return right.mentions - left.mentions;
    })
    .slice(0, limit);
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

function pruneImprints(snapshot: HachikaSnapshot, limit: number): void {
  const sortedTopics = Object.values(snapshot.imprints)
    .sort((left, right) => right.salience - left.salience)
    .map((imprint) => imprint.topic);

  for (const topic of sortedTopics.slice(limit)) {
    delete snapshot.imprints[topic];
  }
}
