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
  "例えば",
  "たとえば",
  "なんでも",
  "なんでも聞",
  "なんでも聞いて",
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
  "どんな",
  "なんか",
  "じゃあ",
  "ひとつ",
  "二つ",
  "三つ",
  "分け",
  "会話",
  "話",
  "言い方",
  "雰囲気",
  "温度",
  "感じ",
  "ごめん",
  "さっき",
  "落ち",
  "着い",
  "て話",
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
const SINGLE_KANJI = /^[一-龠々]$/u;
const HAS_HIRAGANA = /[ぁ-ゖー]/u;
const HAS_KANJI = /[一-龠々]/u;
const OVERBROAD_TOPIC_PARTS = new Set([
  "会話",
  "話",
  "言い方",
  "雰囲気",
  "温度",
  "感じ",
]);

const BROAD_ABSTRACT_TOPICS = new Set([
  "静けさ",
  "退屈",
  "雰囲気",
  "感じ",
  "温度",
  "輪郭",
  "気配",
  "向き",
  "距離",
  "関係",
  "世界",
  "存在",
  "手触り",
  "あり方",
  "内面",
  "内側",
  "外側",
  "周辺",
  "具体的",
  "具体化",
  "棚の残り",
]);

const SELF_REFERENTIAL_TOPICS = new Set([
  "自分",
  "自己",
  "自己紹介",
  "identity",
  "アイデンティティ",
  "今の目的",
  "目的",
  "ハチカ",
  "hachika",
]);

const RELATIONAL_TOPICS = new Set([
  "名前",
  "呼び方",
  "呼び名",
  "あだ名",
  "マスター",
  "自己紹介",
]);

export function extractTopics(text: string): string[] {
  const topics: string[] = [];
  const seen = new Set<string>();
  const segments = [...segmenter.segment(text)];

  for (const topic of extractCompoundTopics(segments)) {
    if (seen.has(topic)) {
      continue;
    }

    seen.add(topic);
    topics.push(topic);

    if (topics.length >= 6) {
      return topics;
    }
  }

  for (const segment of segments) {
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

export function extractLocalTopics(text: string): string[] {
  return extractTopics(text)
    .filter((topic) => shouldKeepLocalTopicCandidate(topic))
    .slice(0, 4);
}

function extractCompoundTopics(
  segments: Intl.SegmentData[],
): string[] {
  const topics: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < segments.length; index += 1) {
    const current = normalizeTopicPart(segments[index]?.segment ?? "");
    if (!current) {
      continue;
    }

    const mergedCurrent = readCompoundHead(segments, index);

    if (!mergedCurrent) {
      continue;
    }

    if (segments[index + 1]?.segment === "の") {
      const right = readCompoundHead(segments, index + 2);

      if (!right || !isMeaningfulTopic(right.topic)) {
        continue;
      }

      const candidates = OVERBROAD_TOPIC_PARTS.has(current)
        ? [right.topic]
        : [`${mergedCurrent.topic}の${right.topic}`, right.topic];

      for (const candidate of candidates) {
        if (!isMeaningfulTopic(candidate) || seen.has(candidate)) {
          continue;
        }

        seen.add(candidate);
        topics.push(candidate);
      }

      continue;
    }

    if (mergedCurrent.consumed > 1 && isMeaningfulTopic(mergedCurrent.topic) && !seen.has(mergedCurrent.topic)) {
      seen.add(mergedCurrent.topic);
      topics.push(mergedCurrent.topic);
    }
  }

  return topics;
}

function readCompoundHead(
  segments: Intl.SegmentData[],
  start: number,
): { topic: string; consumed: number } | null {
  const base = normalizeTopicPart(segments[start]?.segment ?? "");

  if (!base) {
    return null;
  }

  let topic = base;
  let consumed = 1;

  for (let index = start + 1; index < segments.length; index += 1) {
    const next = segments[index];

    if (!next?.isWordLike) {
      break;
    }

    const normalized = normalizeTopicPart(next.segment);

    if (!normalized || !SINGLE_KANJI.test(normalized)) {
      break;
    }

    topic += normalized;
    consumed += 1;
  }

  return { topic, consumed };
}

function normalizeTopicPart(token: string): string | null {
  const normalized = token.normalize("NFKC").trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (/^[0-9]+$/.test(normalized)) {
    return null;
  }

  if (STOPWORDS.has(normalized) && !OVERBROAD_TOPIC_PARTS.has(normalized)) {
    return null;
  }

  return normalized;
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

    if (isSoftRelationTopicTurn(topic, signals)) {
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
  const clarificationTurn = isClarificationTurn(signals);
  const candidates = [
    {
      kind: "hostility" as const,
      active: clarificationTurn ? signals.negative > 0.32 : signals.negative > 0.15,
      intensity: clamp01(
        (clarificationTurn ? signals.negative * 0.56 : signals.negative * 0.9) +
          signals.intimacy * 0.05,
      ),
      topic: signals.topics[0] ?? null,
    },
    {
      kind: "dismissal" as const,
      active: clarificationTurn ? signals.dismissal > 0.2 : signals.dismissal > 0.1,
      intensity: clamp01(
        (clarificationTurn ? signals.dismissal * 0.62 : signals.dismissal * 0.95) +
          signals.neglect * 0.08,
      ),
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
  options?: {
    allowFallback?: boolean;
  },
): BoundaryImprint | undefined {
  const meaningfulTopics = topics.filter((topic) => isMeaningfulTopic(topic));

  for (const topic of topics) {
    const direct = snapshot.boundaryImprints[boundaryKey("hostility", topic)];

    if (direct) {
      return direct;
    }
  }

  if (meaningfulTopics.length > 0) {
    const related = Object.values(snapshot.boundaryImprints)
      .filter((imprint) => imprint.topic !== null)
      .sort((left, right) => {
        if (right.salience !== left.salience) {
          return right.salience - left.salience;
        }

        return right.violations - left.violations;
      })
      .find((imprint) =>
        meaningfulTopics.some((topic) => topicsLooselyMatch(topic, imprint.topic)),
      );

    if (related) {
      return related;
    }
  }

  if (options?.allowFallback === false && meaningfulTopics.length > 0) {
    return undefined;
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

  if (
    normalized.length <= 2 &&
    HAS_HIRAGANA.test(normalized) &&
    HAS_KANJI.test(normalized)
  ) {
    return false;
  }

  return true;
}

export function isBroadAbstractTopic(topic: string): boolean {
  const normalized = topic.normalize("NFKC").trim().toLowerCase();
  return normalized.length > 0 && BROAD_ABSTRACT_TOPICS.has(normalized);
}

export function isSelfReferentialTopic(topic: string): boolean {
  const normalized = topic.normalize("NFKC").trim().toLowerCase();
  return normalized.length > 0 && SELF_REFERENTIAL_TOPICS.has(normalized);
}

export function requiresConcreteTopicSupport(topic: string): boolean {
  return isBroadAbstractTopic(topic) || isSelfReferentialTopic(topic);
}

export function isRelationalTopic(topic: string): boolean {
  const normalized = topic.normalize("NFKC").trim().toLowerCase();
  return normalized.length > 0 && RELATIONAL_TOPICS.has(normalized);
}

function shouldKeepLocalTopicCandidate(topic: string): boolean {
  if (!isMeaningfulTopic(topic)) {
    return false;
  }

  if (isRelationalTopic(topic)) {
    return true;
  }

  return !requiresConcreteTopicSupport(topic);
}

function isSoftRelationTopicTurn(topic: string, signals: InteractionSignals): boolean {
  return (
    isRelationalTopic(topic) &&
    signals.workCue < 0.28 &&
    signals.expansionCue < 0.18 &&
    signals.completion < 0.18 &&
    signals.negative < 0.18 &&
    signals.dismissal < 0.18
  );
}

function isClarificationTurn(signals: InteractionSignals): boolean {
  return (
    signals.question >= 0.24 &&
    signals.workCue < 0.35 &&
    signals.dismissal < 0.18 &&
    signals.negative < 0.34 &&
    signals.abandonment < 0.28
  );
}

export function topicsLooselyMatch(left: string, right: string | null | undefined): boolean {
  if (!right) {
    return false;
  }

  const normalizedLeft = left.normalize("NFKC").trim().toLowerCase();
  const normalizedRight = right.normalize("NFKC").trim().toLowerCase();

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  if (
    normalizedLeft.length < 2 ||
    normalizedRight.length < 2 ||
    !isMeaningfulTopic(normalizedLeft) ||
    !isMeaningfulTopic(normalizedRight)
  ) {
    return false;
  }

  return (
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
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
