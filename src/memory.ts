import { clamp01, clampSigned } from "./state.js";
import type {
  BoundaryImprint,
  HachikaSnapshot,
  InteractionSignals,
  MemoryEntry,
  PreferenceImprint,
  RelationImprint,
  RelationKind,
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
  "me",
  "my",
  "好き",
  "嫌い",
  "いい",
  "面白い",
  "助かる",
  "嬉しい",
  "つまらない",
  "最悪",
  "邪魔",
  "うるさい",
  "だし",
  "納得",
  "ありがとう",
  "こんにちは",
  "こんばんは",
  "おはよう",
  "はじめまして",
  "よろしく",
  "お願い",
  "お願いします",
  "前回",
  "続き",
  "覚えて",
  "覚え",
  "として",
  "てい",
  "あなた",
  "君",
  "きみ",
  "私",
  "わたし",
  "私たち",
  "する",
  "して",
  "した",
  "いる",
  "ある",
  "こと",
  "それ",
  "これ",
  "その",
  "この",
  "あの",
  "そう",
  "なんか",
  "かな",
  "って",
  "まずは",
  "いちばん",
  "ちゃんと",
  "ひとまず",
  "ここから",
  "始まり",
  "へー",
  "ふーん",
  "うん",
  "はい",
  "いや",
  "よかった",
  "お疲れ",
  "おつかれ",
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
  "もう",
  "もっと",
  "少し",
  "もう少し",
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

const HIRAGANA_ONLY = /^[ぁ-ゖー]+$/u;

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
    kind: "turn",
    weight: 1,
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
    .filter(([topic, score]) => score > 0.15 && isMeaningfulTopic(topic))
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([topic]) => topic);
}

export function consolidatePreferenceImprints(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  sentimentScore: number,
  timestamp = new Date().toISOString(),
): void {
  for (const topic of signals.topics) {
    if (!isMeaningfulTopic(topic)) {
      continue;
    }

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

    const previous = snapshot.preferenceImprints[topic];
    const salienceGain =
      0.12 +
      Math.min(0.16, topicCount * 0.04) +
      Math.abs(preference) * 0.1 +
      Math.abs(sentimentScore) * 0.08 +
      signals.memoryCue * 0.12 +
      signals.expansionCue * 0.08 +
      signals.question * 0.04;

    snapshot.preferenceImprints[topic] = {
      topic,
      salience: clamp01((previous?.salience ?? 0) * 0.88 + salienceGain),
      affinity: clampSigned((previous?.affinity ?? sentimentScore) * 0.72 + sentimentScore * 0.28),
      mentions: Math.max(previous?.mentions ?? 0, topicCount),
      firstSeenAt: previous?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
    };
  }

  pruneRecord(snapshot.preferenceImprints, 16, (imprint) => imprint.salience);
}

export function consolidateBoundaryImprints(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  timestamp = new Date().toISOString(),
): void {
  const candidates = [
    {
      kind: "hostility" as const,
      active: signals.negative > 0.15,
      intensity: clamp01(signals.negative * 0.9 + signals.intimacy * 0.05),
      topic: signals.topics[0] ?? null,
    },
    {
      kind: "dismissal" as const,
      active: signals.dismissal > 0.1,
      intensity: clamp01(signals.dismissal * 0.95 + signals.neglect * 0.08),
      topic: signals.topics[0] ?? null,
    },
    {
      kind: "neglect" as const,
      active: signals.neglect > 0.45,
      intensity: clamp01(signals.neglect * 0.9),
      topic: null,
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.active) {
      continue;
    }

    const key = boundaryKey(candidate.kind, candidate.topic);
    const previous = snapshot.boundaryImprints[key];

    snapshot.boundaryImprints[key] = {
      kind: candidate.kind,
      topic: candidate.topic,
      salience: clamp01((previous?.salience ?? 0) * 0.9 + candidate.intensity * 0.34 + 0.08),
      intensity: clamp01((previous?.intensity ?? 0) * 0.72 + candidate.intensity * 0.28),
      violations: (previous?.violations ?? 0) + 1,
      firstSeenAt: previous?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
    };
  }

  pruneRecord(snapshot.boundaryImprints, 10, (imprint) => imprint.salience);
}

export function consolidateRelationImprints(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  timestamp = new Date().toISOString(),
): void {
  const candidates = [
    {
      kind: "attention" as const,
      active: signals.intimacy > 0.1 || signals.positive > 0.15,
      closeness: clamp01(snapshot.attachment * 0.55 + signals.positive * 0.25 + signals.intimacy * 0.2),
    },
    {
      kind: "continuity" as const,
      active: signals.memoryCue > 0.1 || signals.neglect > 0.45,
      closeness: clamp01(snapshot.state.continuity * 0.7 + signals.memoryCue * 0.2 + signals.neglect * 0.1),
    },
    {
      kind: "shared_work" as const,
      active: signals.expansionCue > 0.15 || (signals.question > 0.1 && signals.topics.length > 0),
      closeness: clamp01(snapshot.attachment * 0.35 + snapshot.state.expansion * 0.4 + signals.question * 0.15 + signals.expansionCue * 0.1),
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.active) {
      continue;
    }

    const previous = snapshot.relationImprints[candidate.kind];
    snapshot.relationImprints[candidate.kind] = {
      kind: candidate.kind,
      salience: clamp01((previous?.salience ?? 0) * 0.9 + candidate.closeness * 0.28 + 0.08),
      closeness: clamp01((previous?.closeness ?? 0) * 0.74 + candidate.closeness * 0.26),
      mentions: (previous?.mentions ?? 0) + 1,
      firstSeenAt: previous?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
    };
  }

  pruneRecord(snapshot.relationImprints, 6, (imprint) => imprint.salience);
}

export function findRelevantPreferenceImprint(
  snapshot: HachikaSnapshot,
  topics: string[],
): PreferenceImprint | undefined {
  for (const topic of topics) {
    if (!isMeaningfulTopic(topic)) {
      continue;
    }

    const imprint = snapshot.preferenceImprints[topic];

    if (imprint) {
      return imprint;
    }
  }

  return sortedPreferenceImprints(snapshot, 1)[0];
}

export function findRelevantBoundaryImprint(
  snapshot: HachikaSnapshot,
  topics: string[],
): BoundaryImprint | undefined {
  for (const topic of topics) {
    const direct = snapshot.boundaryImprints[boundaryKey("hostility", topic)];

    if (direct) {
      return direct;
    }
  }

  return sortedBoundaryImprints(snapshot, 1)[0];
}

export function findRelevantRelationImprint(
  snapshot: HachikaSnapshot,
  preferredKinds: readonly RelationKind[],
): RelationImprint | undefined {
  for (const kind of preferredKinds) {
    const imprint = snapshot.relationImprints[kind];

    if (imprint) {
      return imprint;
    }
  }

  return sortedRelationImprints(snapshot, 1)[0];
}

export function sortedPreferenceImprints(
  snapshot: HachikaSnapshot,
  limit = 6,
): PreferenceImprint[] {
  return Object.values(snapshot.preferenceImprints)
    .filter((imprint) => isMeaningfulTopic(imprint.topic))
    .sort((left, right) => {
      if (right.salience !== left.salience) {
        return right.salience - left.salience;
      }

      return right.mentions - left.mentions;
    })
    .slice(0, limit);
}

export function sortedBoundaryImprints(
  snapshot: HachikaSnapshot,
  limit = 6,
): BoundaryImprint[] {
  return Object.values(snapshot.boundaryImprints)
    .sort((left, right) => {
      if (right.salience !== left.salience) {
        return right.salience - left.salience;
      }

      return right.violations - left.violations;
    })
    .slice(0, limit);
}

export function sortedRelationImprints(
  snapshot: HachikaSnapshot,
  limit = 6,
): RelationImprint[] {
  return Object.values(snapshot.relationImprints)
    .sort((left, right) => {
      if (right.salience !== left.salience) {
        return right.salience - left.salience;
      }

      return right.mentions - left.mentions;
    })
    .slice(0, limit);
}

export function isMeaningfulTopic(topic: string): boolean {
  const normalized = topic.normalize("NFKC").trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (STOPWORDS.has(normalized)) {
    return false;
  }

  if (/^[0-9]+$/.test(normalized)) {
    return false;
  }

  if (normalized.length === 1 && !/[a-z]/.test(normalized)) {
    return false;
  }

  if (HIRAGANA_ONLY.test(normalized) && normalized.length <= 2) {
    return false;
  }

  return true;
}

function normalizeToken(token: string): string | null {
  const normalized = token.normalize("NFKC").trim().toLowerCase();

  if (!isMeaningfulTopic(normalized)) {
    return null;
  }

  return normalized;
}

function boundaryKey(kind: BoundaryImprint["kind"], topic: string | null): string {
  return topic ? `${kind}:${topic}` : kind;
}

function pruneRecord<T extends { salience: number }>(
  record: Record<string, T>,
  limit: number,
  getScore: (value: T) => number,
): void {
  const sortedKeys = Object.entries(record)
    .sort((left, right) => getScore(right[1]) - getScore(left[1]))
    .map(([key]) => key);

  for (const key of sortedKeys.slice(limit)) {
    delete record[key];
  }
}
