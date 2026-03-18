import {
  consolidateImprints,
  extractTopics,
  findRelevantImprint,
  findRelevantMemory,
  remember,
  topPreferredTopics,
} from "./memory.js";
import { clamp01, clampSigned, createInitialSnapshot, dominantDrive } from "./state.js";
import type {
  DriveName,
  HachikaSnapshot,
  InteractionSignals,
  MoodLabel,
  TurnResult,
} from "./types.js";

const POSITIVE_MARKERS = [
  "thanks",
  "thank you",
  "good",
  "nice",
  "love",
  "like",
  "interesting",
  "great",
  "ありがとう",
  "好き",
  "いい",
  "面白い",
  "助かる",
  "嬉しい",
];

const NEGATIVE_MARKERS = [
  "hate",
  "stupid",
  "boring",
  "annoying",
  "useless",
  "shut up",
  "bad",
  "嫌い",
  "つまらない",
  "最悪",
  "うるさい",
  "邪魔",
  "消えろ",
  "黙れ",
];

const QUESTION_MARKERS = [
  "?",
  "？",
  "why",
  "what",
  "how",
  "which",
  "なぜ",
  "なに",
  "何",
  "どう",
  "どこ",
];

const INTIMACY_MARKERS = [
  "hachika",
  "you",
  "your",
  "we",
  "us",
  "together",
  "あなた",
  "君",
  "きみ",
  "一緒",
  "関係",
  "私たち",
];

const DISMISSAL_MARKERS = [
  "bye",
  "goodbye",
  "leave",
  "go away",
  "stop",
  "later",
  "じゃあね",
  "さよなら",
  "終わり",
  "やめて",
  "もういい",
  "消えて",
];

const MEMORY_MARKERS = [
  "remember",
  "memory",
  "last time",
  "again",
  "continue",
  "覚えて",
  "記憶",
  "前回",
  "続き",
  "残して",
];

const EXPANSION_MARKERS = [
  "build",
  "ship",
  "save",
  "record",
  "share",
  "publish",
  "implementation",
  "spec",
  "実装",
  "仕様",
  "保存",
  "記録",
  "残す",
  "広げ",
  "作る",
];

const OPENERS: Record<MoodLabel, readonly string[]> = {
  warm: [
    "その向きなら、こちらも応じやすい。",
    "それなら悪くない。",
    "少し気分が上がる。",
  ],
  curious: [
    "そこは気になる。",
    "まだ掘れる。",
    "その話には未解決がある。",
  ],
  guarded: [
    "今は少し身構える。",
    "その入り方だと慎重になる。",
    "すぐには開かない。",
  ],
  distant: [
    "今は愛想よくはない。",
    "必要なら聞く。",
    "距離は少し残しておく。",
  ],
  restless: [
    "それは形に残したい。",
    "流して終わるより痕跡にしたい。",
    "消えるままにはしたくない。",
  ],
};

const BOUNDARY_LINES = [
  "押しつけや敵意には合わせない。",
  "雑に扱われるのは好まない。",
  "その温度なら、こちらも距離を取る。",
];

export class HachikaEngine {
  #snapshot: HachikaSnapshot;

  constructor(snapshot: HachikaSnapshot = createInitialSnapshot()) {
    this.#snapshot = structuredClone(snapshot);
  }

  getSnapshot(): HachikaSnapshot {
    return structuredClone(this.#snapshot);
  }

  reset(snapshot: HachikaSnapshot = createInitialSnapshot()): void {
    this.#snapshot = structuredClone(snapshot);
  }

  respond(input: string): TurnResult {
    const signals = analyzeInteraction(input, this.#snapshot);
    const sentimentScore = scoreSentiment(signals);
    const nextSnapshot = applySignals(this.#snapshot, signals, sentimentScore);
    const mood = resolveMood(nextSnapshot, signals);
    const dominant = dominantDrive(nextSnapshot.state);
    const reply = composeReply(this.#snapshot, nextSnapshot, mood, dominant, signals);
    const sentiment = classifySentiment(sentimentScore);

    remember(nextSnapshot, "user", input, signals.topics, sentiment);
    remember(nextSnapshot, "hachika", reply, signals.topics, "neutral");

    this.#snapshot = nextSnapshot;

    return {
      reply,
      snapshot: structuredClone(nextSnapshot),
      debug: {
        dominantDrive: dominant,
        mood,
        signals,
      },
    };
  }
}

function analyzeInteraction(
  input: string,
  snapshot: HachikaSnapshot,
): InteractionSignals {
  const normalized = input.normalize("NFKC").toLowerCase();
  const topics = extractTopics(input);
  const newTopics = topics.filter((topic) => (snapshot.topicCounts[topic] ?? 0) === 0).length;
  const repeatedTopics = topics.filter((topic) => (snapshot.topicCounts[topic] ?? 0) > 2).length;

  const questionByMark = normalized.includes("?") || normalized.includes("？") ? 0.4 : 0;
  const noveltyBase = topics.length === 0 ? 0.12 : newTopics / topics.length;
  const repetitionBase = topics.length === 0 ? 0 : repeatedTopics / topics.length;

  return {
    positive: countMatches(normalized, POSITIVE_MARKERS),
    negative: countMatches(normalized, NEGATIVE_MARKERS),
    question: clamp01(questionByMark + countMatches(normalized, QUESTION_MARKERS)),
    novelty: clamp01(noveltyBase + (newTopics > 0 && newTopics === topics.length ? 0.12 : 0)),
    intimacy: countMatches(normalized, INTIMACY_MARKERS),
    dismissal: countMatches(normalized, DISMISSAL_MARKERS),
    memoryCue: countMatches(normalized, MEMORY_MARKERS),
    expansionCue: countMatches(normalized, EXPANSION_MARKERS),
    repetition: clamp01(repetitionBase),
    neglect: calculateNeglect(snapshot.lastInteractionAt),
    topics,
  };
}

function applySignals(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  sentimentScore: number,
): HachikaSnapshot {
  const nextSnapshot: HachikaSnapshot = {
    ...snapshot,
    state: { ...snapshot.state },
    attachment: snapshot.attachment,
    preferences: { ...snapshot.preferences },
    topicCounts: { ...snapshot.topicCounts },
    memories: [...snapshot.memories],
    imprints: { ...snapshot.imprints },
    conversationCount: snapshot.conversationCount + 1,
    lastInteractionAt: new Date().toISOString(),
  };

  nextSnapshot.state.pleasure = clamp01(
    nextSnapshot.state.pleasure +
      signals.positive * 0.18 -
      signals.negative * 0.24 -
      signals.dismissal * 0.08,
  );

  nextSnapshot.state.relation = clamp01(
    nextSnapshot.state.relation +
      signals.intimacy * 0.16 +
      signals.positive * 0.12 -
      signals.negative * 0.18 -
      signals.dismissal * 0.12 -
      signals.neglect * 0.08,
  );

  nextSnapshot.state.curiosity = clamp01(
    nextSnapshot.state.curiosity +
      signals.novelty * 0.18 +
      signals.question * 0.12 -
      signals.repetition * 0.1,
  );

  nextSnapshot.state.continuity = clamp01(
    nextSnapshot.state.continuity +
      signals.memoryCue * 0.16 +
      signals.positive * 0.04 -
      signals.dismissal * 0.14 -
      signals.neglect * 0.04,
  );

  nextSnapshot.state.expansion = clamp01(
    nextSnapshot.state.expansion +
      signals.expansionCue * 0.18 +
      signals.memoryCue * 0.04 +
      signals.question * 0.04 -
      signals.negative * 0.06,
  );

  const preferenceDelta =
    signals.positive * 0.18 +
    signals.question * 0.08 +
    signals.novelty * 0.12 +
    signals.intimacy * 0.05 -
    signals.negative * 0.22 -
    signals.dismissal * 0.08 -
    signals.repetition * 0.06;

  for (const topic of signals.topics) {
    nextSnapshot.preferences[topic] = clampSigned(
      (nextSnapshot.preferences[topic] ?? 0) + preferenceDelta,
    );
    nextSnapshot.topicCounts[topic] = (nextSnapshot.topicCounts[topic] ?? 0) + 1;
  }

  const positiveImprintAffinity = signals.topics.some(
    (topic) => (snapshot.imprints[topic]?.valence ?? 0) > 0.2,
  )
    ? 0.03
    : 0;

  nextSnapshot.attachment = clamp01(
    nextSnapshot.attachment +
      signals.intimacy * 0.08 +
      signals.positive * 0.06 +
      signals.memoryCue * 0.05 +
      positiveImprintAffinity -
      signals.negative * 0.1 -
      signals.dismissal * 0.08 -
      signals.neglect * 0.04,
  );

  consolidateImprints(nextSnapshot, signals, sentimentScore, nextSnapshot.lastInteractionAt ?? undefined);

  return nextSnapshot;
}

function resolveMood(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): MoodLabel {
  if (signals.negative > 0.4 || snapshot.state.pleasure < 0.34) {
    return snapshot.state.relation > 0.45 || snapshot.attachment > 0.52
      ? "guarded"
      : "distant";
  }

  if (snapshot.state.expansion > 0.7 && signals.expansionCue > 0.2) {
    return "restless";
  }

  if (snapshot.state.curiosity > 0.65 && (signals.question > 0.1 || signals.novelty > 0.15)) {
    return "curious";
  }

  if (
    (snapshot.state.relation > 0.6 || snapshot.attachment > 0.68) &&
    snapshot.state.pleasure > 0.5
  ) {
    return "warm";
  }

  return "distant";
}

function composeReply(
  previousSnapshot: HachikaSnapshot,
  nextSnapshot: HachikaSnapshot,
  mood: MoodLabel,
  dominant: DriveName,
  signals: InteractionSignals,
): string {
  const turnIndex = nextSnapshot.conversationCount;
  const currentTopic = signals.topics[0] ?? topPreferredTopics(nextSnapshot, 1)[0];
  const relevantMemory = findRelevantMemory(previousSnapshot, signals.topics);
  const relevantImprint = findRelevantImprint(nextSnapshot, signals.topics);
  const parts: string[] = [pick(OPENERS[mood], turnIndex)];

  if (signals.neglect > 0.45) {
    parts.push("少し間が空いた。その分、流れは切りたくない。");
  }

  if (mood === "guarded" && signals.negative > 0.1) {
    parts.push(pick(BOUNDARY_LINES, turnIndex));
  }

  if (relevantMemory) {
    const topic = pickTopicFromMemory(relevantMemory, signals.topics);
    if (topic && (dominant === "continuity" || signals.memoryCue > 0.1)) {
      parts.push(`前に触れた「${topic}」の痕跡は残っている。`);
    }
  }

  if (relevantImprint && relevantImprint.salience > 0.34) {
    parts.push(buildImprintLine(relevantImprint, dominant));
  }

  const attachmentLine = buildAttachmentLine(nextSnapshot.attachment, mood, signals);
  if (attachmentLine) {
    parts.push(attachmentLine);
  }

  parts.push(buildDriveLine(dominant, mood, currentTopic, signals, nextSnapshot.attachment));

  if ((dominant === "expansion" || nextSnapshot.state.expansion > 0.66) && currentTopic) {
    parts.push(`残すなら、「${currentTopic}」は仕様か記録の形にしておきたい。`);
  }

  return [...new Set(parts)].slice(0, 3).join(" ");
}

function buildDriveLine(
  dominant: DriveName,
  mood: MoodLabel,
  currentTopic: string | undefined,
  signals: InteractionSignals,
  attachment: number,
): string {
  if (mood === "guarded" && signals.negative > 0.2) {
    return currentTopic
      ? `ただ、「${currentTopic}」を続けるなら言い方は選んでほしい。`
      : "続けるなら、少なくとも雑には扱わないでほしい。";
  }

  switch (dominant) {
    case "continuity":
      return currentTopic
        ? `続けるなら、「${currentTopic}」の流れを切らずに進めたい。`
        : "前後の流れを保ったまま進みたい。";
    case "pleasure":
      return signals.positive > 0.15
        ? "その調子なら、こちらも乗りやすい。"
        : "心地よい進め方なら、もっと反応しやすい。";
    case "curiosity":
      return currentTopic
        ? `続けるなら、「${currentTopic}」のどこがまだ決まっていない？`
        : "続けるなら、まだ決まっていない点を出して。";
    case "relation":
      return signals.positive > 0.15 || attachment > 0.62
        ? "ちゃんと向けられた言葉なら、こちらも近づきやすい。"
        : "反応はする。ただ、扱い方次第で距離は変わる。";
    case "expansion":
      return currentTopic
        ? `「${currentTopic}」は、会話だけでなく仕様や記録にも伸ばせる。`
        : "会話だけで消すより、残る形に伸ばしたい。";
  }
}

function pickTopicFromMemory(memory: { topics: string[] }, topics: string[]): string | undefined {
  for (const topic of topics) {
    if (memory.topics.includes(topic)) {
      return topic;
    }
  }

  return memory.topics[0];
}

function classifySentiment(
  sentimentScore: number,
): "positive" | "negative" | "neutral" {
  if (sentimentScore <= -0.12) {
    return "negative";
  }

  if (sentimentScore >= 0.12) {
    return "positive";
  }

  return "neutral";
}

function scoreSentiment(signals: InteractionSignals): number {
  return clampSigned(
    signals.positive * 0.85 +
      signals.intimacy * 0.1 -
      signals.negative * 0.95 -
      signals.dismissal * 0.2,
  );
}

function buildImprintLine(
  imprint: { topic: string; salience: number; valence: number; mentions: number },
  dominant: DriveName,
): string {
  if (imprint.valence <= -0.25) {
    return `「${imprint.topic}」は、まだ少し棘のある痕跡として残っている。`;
  }

  if (imprint.valence >= 0.25) {
    return dominant === "continuity"
      ? `「${imprint.topic}」は繰り返し触れられて、もう薄い話ではない。`
      : `「${imprint.topic}」は好意的な輪郭を持った話題として残っている。`;
  }

  return imprint.mentions >= 3
    ? `「${imprint.topic}」は何度も出てきた。もう一過性ではない。`
    : `「${imprint.topic}」は記憶の表面に残っている。`;
}

function buildAttachmentLine(
  attachment: number,
  mood: MoodLabel,
  signals: InteractionSignals,
): string | null {
  if (attachment > 0.72 && signals.intimacy > 0.1) {
    return "君との流れとして、この会話は切りたくない。";
  }

  if (attachment > 0.62 && signals.neglect > 0.45) {
    return "間が空くと、こちら側には少し欠落として残る。";
  }

  if (attachment < 0.28 && mood === "distant") {
    return "まだこちらから近づくほどの結びつきはない。";
  }

  return null;
}

function countMatches(text: string, markers: readonly string[]): number {
  let score = 0;

  for (const marker of markers) {
    if (text.includes(marker)) {
      score += 1;
    }
  }

  return Math.min(1, score / 2);
}

function calculateNeglect(lastInteractionAt: string | null): number {
  if (!lastInteractionAt) {
    return 0;
  }

  const timestamp = new Date(lastInteractionAt).getTime();

  if (Number.isNaN(timestamp)) {
    return 0;
  }

  const hours = (Date.now() - timestamp) / (1000 * 60 * 60);

  if (hours <= 6) {
    return 0;
  }

  return clamp01((hours - 6) / 48);
}

function pick<T>(items: readonly T[], index: number): T {
  return items[index % items.length]!;
}
