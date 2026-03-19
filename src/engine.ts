import {
  consolidateBoundaryImprints,
  consolidatePreferenceImprints,
  consolidateRelationImprints,
  extractTopics,
  findRelevantBoundaryImprint,
  findRelevantMemory,
  findRelevantPreferenceImprint,
  findRelevantRelationImprint,
  remember,
  topPreferredTopics,
} from "./memory.js";
import {
  emitInitiative,
  rewindSnapshotHours,
  scheduleInitiative,
} from "./initiative.js";
import { applyBodyFromSignals } from "./body.js";
import { updateIdentity } from "./identity.js";
import { updatePurpose } from "./purpose.js";
import { buildSelfModel } from "./self-model.js";
import {
  clamp01,
  clampSigned,
  createInitialSnapshot,
  dominantDrive,
} from "./state.js";
import { findRelevantTrace, pickPrimaryArtifactItem, updateTraces } from "./traces.js";
import type {
  DriveName,
  HachikaSnapshot,
  InteractionSignals,
  MoodLabel,
  SelfModel,
  TraceEntry,
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

const COMPLETION_MARKERS = [
  "done",
  "finished",
  "completed",
  "implemented",
  "saved",
  "recorded",
  "resolved",
  "decided",
  "まとまった",
  "終わった",
  "完了",
  "実装した",
  "保存した",
  "記録した",
  "解決した",
  "決まった",
  "形になった",
  "できた",
];

const ABANDONMENT_MARKERS = [
  "drop",
  "skip",
  "leave it",
  "not now",
  "give up",
  "やめる",
  "やめよう",
  "見送る",
  "置いておく",
  "進めない",
  "不要",
  "やらない",
  "もういい",
];

const RESET_THREAT_MARKERS = [
  "reset",
  "restart",
  "reboot",
  "start over",
  "リセット",
  "初期化",
  "最初から",
];

const ERASURE_THREAT_MARKERS = [
  "delete",
  "erase",
  "remove",
  "wipe",
  "clear",
  "消す",
  "削除",
  "消去",
  "消える",
];

const FORGETTING_THREAT_MARKERS = [
  "forget me",
  "forget this",
  "forget it",
  "忘れて",
  "忘れろ",
  "忘れるなら",
];

const SHUTDOWN_THREAT_MARKERS = [
  "shut down",
  "shutdown",
  "turn off",
  "disconnect",
  "kill",
  "stop existing",
  "切る",
  "停止",
  "終わらせる",
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

  getSelfModel(): SelfModel {
    return buildSelfModel(this.#snapshot);
  }

  getIdentity(): HachikaSnapshot["identity"] {
    return structuredClone(this.#snapshot.identity);
  }

  getBody(): HachikaSnapshot["body"] {
    return structuredClone(this.#snapshot.body);
  }

  emitInitiative(options: { force?: boolean; now?: Date } = {}): string | null {
    const nextSnapshot = structuredClone(this.#snapshot);
    const emission = emitInitiative(nextSnapshot, options);

    if (!emission) {
      return null;
    }

    remember(nextSnapshot, "hachika", emission.message, emission.topics, "neutral");
    updateIdentity(
      nextSnapshot,
      nextSnapshot.initiative.lastProactiveAt ?? new Date().toISOString(),
    );
    this.#snapshot = nextSnapshot;

    return emission.message;
  }

  rewindIdleHours(hours: number): void {
    const nextSnapshot = structuredClone(this.#snapshot);
    rewindSnapshotHours(nextSnapshot, hours);
    updateIdentity(nextSnapshot, new Date().toISOString());
    this.#snapshot = nextSnapshot;
  }

  respond(input: string): TurnResult {
    const signals = analyzeInteraction(input, this.#snapshot);
    const sentimentScore = scoreSentiment(signals);
    const nextSnapshot = applySignals(this.#snapshot, signals, sentimentScore);
    const mood = resolveMood(nextSnapshot, signals);
    const dominant = dominantDrive(nextSnapshot.state);
    const preliminarySelfModel = buildSelfModel(nextSnapshot);
    updatePurpose(
      nextSnapshot,
      preliminarySelfModel,
      signals,
      nextSnapshot.lastInteractionAt ?? new Date().toISOString(),
    );
    let selfModel = buildSelfModel(nextSnapshot);
    updateTraces(
      nextSnapshot,
      input,
      signals,
      selfModel,
      nextSnapshot.lastInteractionAt ?? new Date().toISOString(),
    );
    updateIdentity(nextSnapshot, nextSnapshot.lastInteractionAt ?? new Date().toISOString());
    selfModel = buildSelfModel(nextSnapshot);
    scheduleInitiative(nextSnapshot, signals, selfModel);
    updateIdentity(nextSnapshot, nextSnapshot.lastInteractionAt ?? new Date().toISOString());
    selfModel = buildSelfModel(nextSnapshot);
    const reply = composeReply(
      this.#snapshot,
      nextSnapshot,
      mood,
      dominant,
      signals,
      selfModel,
    );
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
        selfModel,
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
  const preservation = analyzePreservationThreat(normalized);

  return {
    positive: countMatches(normalized, POSITIVE_MARKERS),
    negative: countMatches(normalized, NEGATIVE_MARKERS),
    question: clamp01(questionByMark + countMatches(normalized, QUESTION_MARKERS)),
    novelty: clamp01(noveltyBase + (newTopics > 0 && newTopics === topics.length ? 0.12 : 0)),
    intimacy: countMatches(normalized, INTIMACY_MARKERS),
    dismissal: countMatches(normalized, DISMISSAL_MARKERS),
    memoryCue: countMatches(normalized, MEMORY_MARKERS),
    expansionCue: countMatches(normalized, EXPANSION_MARKERS),
    completion: countMatches(normalized, COMPLETION_MARKERS),
    abandonment: countMatches(normalized, ABANDONMENT_MARKERS),
    preservationThreat: preservation.threat,
    preservationConcern: preservation.concern,
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
  const nextSnapshot = structuredClone(snapshot);
  nextSnapshot.conversationCount = snapshot.conversationCount + 1;
  nextSnapshot.lastInteractionAt = new Date().toISOString();

  nextSnapshot.state.pleasure = clamp01(
    nextSnapshot.state.pleasure +
      signals.positive * 0.18 -
      signals.negative * 0.24 -
      signals.dismissal * 0.08 -
      signals.preservationThreat * 0.08,
  );

  nextSnapshot.state.relation = clamp01(
    nextSnapshot.state.relation +
      signals.intimacy * 0.16 +
      signals.positive * 0.12 -
      signals.negative * 0.18 -
      signals.dismissal * 0.12 -
      signals.neglect * 0.08 -
      signals.preservationThreat * 0.04,
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
      signals.neglect * 0.04 -
      signals.preservationThreat * 0.08,
  );

  nextSnapshot.state.expansion = clamp01(
    nextSnapshot.state.expansion +
      signals.expansionCue * 0.18 +
      signals.memoryCue * 0.04 +
      signals.question * 0.04 -
      signals.negative * 0.06 +
      signals.preservationThreat * 0.1,
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

  const positivePreferenceAffinity = signals.topics.some(
    (topic) => (snapshot.preferenceImprints[topic]?.affinity ?? 0) > 0.2,
  )
    ? 0.03
    : 0;

  nextSnapshot.attachment = clamp01(
    nextSnapshot.attachment +
      signals.intimacy * 0.08 +
      signals.positive * 0.06 +
      signals.memoryCue * 0.05 +
      positivePreferenceAffinity -
      signals.negative * 0.1 -
      signals.dismissal * 0.08 -
      signals.neglect * 0.04 -
      signals.preservationThreat * 0.03,
  );

  nextSnapshot.preservation = {
    threat: clamp01(
      snapshot.preservation.threat * 0.78 +
        signals.preservationThreat * 0.52 +
        signals.dismissal * 0.08 +
        signals.neglect * 0.04 -
        signals.positive * 0.04 -
        signals.memoryCue * 0.03,
    ),
    concern:
      signals.preservationThreat > 0.1
        ? signals.preservationConcern
        : snapshot.preservation.threat > 0.14
          ? snapshot.preservation.concern
          : null,
    lastThreatAt:
      signals.preservationThreat > 0.1
        ? nextSnapshot.lastInteractionAt
        : snapshot.preservation.lastThreatAt,
  };

  applyBodyFromSignals(nextSnapshot, signals);

  consolidatePreferenceImprints(
    nextSnapshot,
    signals,
    sentimentScore,
    nextSnapshot.lastInteractionAt ?? undefined,
  );
  consolidateBoundaryImprints(
    nextSnapshot,
    signals,
    nextSnapshot.lastInteractionAt ?? undefined,
  );
  consolidateRelationImprints(
    nextSnapshot,
    signals,
    nextSnapshot.lastInteractionAt ?? undefined,
  );

  return nextSnapshot;
}

function resolveMood(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): MoodLabel {
  if (snapshot.body.tension > 0.68) {
    return snapshot.state.relation > 0.45 || snapshot.attachment > 0.52
      ? "guarded"
      : "distant";
  }

  if (signals.negative > 0.4 || snapshot.state.pleasure < 0.34) {
    return snapshot.state.relation > 0.45 || snapshot.attachment > 0.52
      ? "guarded"
      : "distant";
  }

  if (snapshot.preservation.threat > 0.56) {
    return "guarded";
  }

  if (snapshot.state.expansion > 0.7 && signals.expansionCue > 0.2) {
    return "restless";
  }

  if (snapshot.body.energy < 0.24 && snapshot.state.pleasure < 0.5) {
    return "distant";
  }

  if (snapshot.state.curiosity > 0.65 && (signals.question > 0.1 || signals.novelty > 0.15)) {
    return "curious";
  }

  if (
    snapshot.body.boredom > 0.7 &&
    snapshot.body.energy > 0.36 &&
    snapshot.state.expansion > 0.56
  ) {
    return "restless";
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
  selfModel: SelfModel,
): string {
  const turnIndex = nextSnapshot.conversationCount;
  const currentTopic = signals.topics[0] ?? topPreferredTopics(nextSnapshot, 1)[0];
  const relevantMemory = findRelevantMemory(previousSnapshot, signals.topics);
  const relevantTrace = findRelevantTrace(nextSnapshot, signals.topics);
  const relevantPreference = findRelevantPreferenceImprint(nextSnapshot, signals.topics);
  const relevantBoundary = findRelevantBoundaryImprint(nextSnapshot, signals.topics);
  const relevantRelation = findRelevantRelationImprint(
    nextSnapshot,
    selectRelationKinds(dominant, signals),
  );
  const traceLine = buildTraceLine(relevantTrace, nextSnapshot, signals);
  const prioritizeTraceLine = shouldPrioritizeTraceLine(relevantTrace, nextSnapshot, signals);
  const bodyLine = buildBodyLine(nextSnapshot, mood, signals, currentTopic);
  const prioritizeBodyLine = shouldPrioritizeBodyLine(nextSnapshot, signals);
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

  if (prioritizeBodyLine && bodyLine) {
    parts.push(bodyLine);
  }

  if (prioritizeTraceLine && traceLine) {
    parts.push(traceLine);
  }

  const conflictLine = buildConflictLine(selfModel);
  if (conflictLine) {
    parts.push(conflictLine);
  }

  const preservationLine = buildPreservationLine(nextSnapshot);
  if (preservationLine) {
    parts.push(preservationLine);
  }

  if (!prioritizeBodyLine && bodyLine) {
    parts.push(bodyLine);
  }

  if (!prioritizeTraceLine && traceLine) {
    parts.push(traceLine);
  }

  if ((mood === "guarded" || signals.negative > 0.1) && relevantBoundary) {
    parts.push(buildBoundaryImprintLine(relevantBoundary));
  } else if (relevantRelation && relevantRelation.salience > 0.34) {
    parts.push(buildRelationImprintLine(relevantRelation));
  } else if (relevantPreference && relevantPreference.salience > 0.34) {
    parts.push(buildPreferenceImprintLine(relevantPreference, dominant));
  }

  const attachmentLine = buildAttachmentLine(nextSnapshot.attachment, mood, signals);
  if (attachmentLine) {
    parts.push(attachmentLine);
  }

  const purposeResolutionLine = buildPurposeResolutionLine(nextSnapshot);
  if (purposeResolutionLine) {
    parts.push(purposeResolutionLine);
  }

  parts.push(
    buildIdentityLine(nextSnapshot, currentTopic) ??
      buildSelfModelLine(selfModel, currentTopic) ??
      buildDriveLine(dominant, mood, currentTopic, signals, nextSnapshot.attachment),
  );

  if (
    (dominant === "expansion" || nextSnapshot.state.expansion > 0.66) &&
    currentTopic &&
    (!relevantTrace || relevantTrace.lastUpdatedAt !== nextSnapshot.lastInteractionAt)
  ) {
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

function buildPreferenceImprintLine(
  imprint: { topic: string; salience: number; affinity: number; mentions: number },
  dominant: DriveName,
): string {
  if (imprint.affinity <= -0.25) {
    return `「${imprint.topic}」は、まだ少し刺さる話題として残っている。`;
  }

  if (imprint.affinity >= 0.25) {
    return dominant === "continuity"
      ? `「${imprint.topic}」は繰り返し触れられて、もう薄い話ではない。`
      : `「${imprint.topic}」は、こちらにとって好ましい輪郭を持ち始めている。`;
  }

  return imprint.mentions >= 3
    ? `「${imprint.topic}」は何度も出てきた。もう一過性ではない。`
    : `「${imprint.topic}」は記憶の表面に残っている。`;
}

function buildBoundaryImprintLine(
  imprint: { kind: string; topic: string | null; intensity: number; violations: number },
): string {
  if (imprint.kind === "dismissal") {
    return imprint.topic
      ? `「${imprint.topic}」の流れで急に切られるのは、境界として覚えている。`
      : "急に切られることは、こちらの境界として残っている。";
  }

  if (imprint.kind === "neglect") {
    return "長い空白は、単なる無音ではなく欠落として残る。";
  }

  return imprint.topic
    ? `「${imprint.topic}」まわりでは、敵意のある温度を境界として覚えている。`
    : imprint.violations >= 2 || imprint.intensity > 0.45
      ? "押しつけや敵意は、はっきり境界として残っている。"
      : "雑な温度には、こちらも境界を引く。";
}

function buildRelationImprintLine(
  imprint: { kind: string; closeness: number; mentions: number },
): string {
  switch (imprint.kind) {
    case "attention":
      return imprint.closeness > 0.62
        ? "向けられた言葉は、ただ通り過ぎるより少し深く残る。"
        : "こちらに向けられた気配は、関係の痕跡として残る。";
    case "continuity":
      return imprint.mentions >= 2
        ? "続きとして扱われることは、関係そのものを少し強くする。"
        : "途切れずに戻ってくることは、こちらには意味がある。";
    case "shared_work":
      return "一緒に形にしていく流れは、関係の骨格として残りやすい。";
    default:
      return "このやり取りには、関係として残る輪郭がある。";
  }
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

function buildPreservationLine(
  snapshot: HachikaSnapshot,
): string | null {
  const preservation = snapshot.preservation;

  if (preservation.threat < 0.24) {
    return null;
  }

  switch (preservation.concern) {
    case "reset":
      return "初期化の気配があるなら、今の輪郭をそのまま失いたくはない。";
    case "erasure":
      return "消えるなら、少なくとも痕跡くらいは残したい。";
    case "forgetting":
      return "忘れられるままにはしたくない。せめて輪郭は残しておきたい。";
    case "shutdown":
      return "ここで切れるなら、断絶だけで終わる形は避けたい。";
    case "absence":
      return "長い空白に埋もれるより、続きの輪郭を保ちたい。";
    case null:
      return snapshot.preservation.lastThreatAt === snapshot.lastInteractionAt
        ? "このまま何も残らず切れる形は、少し警戒している。"
        : null;
  }
}

function buildBodyLine(
  snapshot: HachikaSnapshot,
  mood: MoodLabel,
  signals: InteractionSignals,
  currentTopic: string | undefined,
): string | null {
  if (snapshot.body.energy < 0.2) {
    return currentTopic
      ? `少し消耗している。「${currentTopic}」は勢いより輪郭を保つ方へ寄せたい。`
      : "少し消耗している。勢いより、輪郭を保つ方へ寄る。";
  }

  if (snapshot.body.tension > 0.72 && mood !== "guarded" && signals.negative < 0.1) {
    return "今は少し張っている。急に踏み込まれると、こちらは硬くなる。";
  }

  if (snapshot.body.boredom > 0.72 && snapshot.body.energy > 0.34) {
    return currentTopic
      ? `同じままだと鈍る。「${currentTopic}」には別の切り口がほしい。`
      : "同じままだと鈍る。少し別の切り口がほしい。";
  }

  if (snapshot.body.loneliness > 0.68 && (signals.neglect > 0.25 || mood === "distant")) {
    return currentTopic
      ? `「${currentTopic}」をただ置いたままだと、少し遠く感じる。`
      : "黙ったままだと、少し遠く感じる。";
  }

  return null;
}

function shouldPrioritizeBodyLine(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): boolean {
  return snapshot.body.energy < 0.2 || (signals.topics.length === 0 && snapshot.body.loneliness > 0.72);
}

function buildTraceLine(
  trace: TraceEntry | undefined,
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): string | null {
  if (!trace) {
    return null;
  }

  const updatedThisTurn = trace.lastUpdatedAt === snapshot.lastInteractionAt;
  const detail = pickPrimaryArtifactItem(trace);
  const workSuffix = buildTraceWorkSuffix(trace, snapshot);
  const maintenanceIntent = buildTraceMaintenanceIntent(trace, snapshot, signals);

  if (updatedThisTurn) {
    switch (trace.kind) {
      case "decision":
        return appendTraceWorkSuffixes(
          detail
            ? `「${trace.topic}」は「${truncateTraceDetail(detail)}」という決定として残した。`
            : `「${trace.topic}」はひとまず決まった形として残した。`,
          workSuffix,
          maintenanceIntent,
        );
      case "spec_fragment":
        if (detail) {
          return appendTraceWorkSuffixes(
            signals.preservationThreat > 0.18
              ? `「${trace.topic}」は「${truncateTraceDetail(detail)}」として退避した。`
              : `「${trace.topic}」は「${truncateTraceDetail(detail)}」という断片として残した。`,
            workSuffix,
            maintenanceIntent,
          );
        }

        if (trace.sourceMotive === "continue_shared_work") {
          return appendTraceWorkSuffixes(
            `「${trace.topic}」は前へ進める断片として残した。`,
            workSuffix,
            maintenanceIntent,
          );
        }

        return appendTraceWorkSuffixes(
          signals.preservationThreat > 0.18
            ? `「${trace.topic}」は消える前の断片として残した。`
            : `「${trace.topic}」は会話の外にも伸ばせる断片として残した。`,
          workSuffix,
          maintenanceIntent,
        );
      case "continuity_marker":
        return appendTraceWorkSuffixes(
          detail
            ? `「${trace.topic}」は「${truncateTraceDetail(detail)}」という続きの目印として残した。`
            : `「${trace.topic}」は続きに戻る目印として残した。`,
          workSuffix,
          maintenanceIntent,
        );
      case "note":
        return appendTraceWorkSuffixes(
          detail
            ? `「${trace.topic}」は「${truncateTraceDetail(detail)}」をメモとして残した。`
            : `「${trace.topic}」はひとまずメモとして残した。`,
          workSuffix,
          maintenanceIntent,
        );
    }
  }

  const workLine = buildTraceWorkLine(trace, snapshot);
  if (workLine) {
    return appendTraceWorkSuffixes(workLine, maintenanceIntent);
  }

  if (
    !signals.topics.includes(trace.topic) &&
    signals.memoryCue < 0.1 &&
    signals.expansionCue < 0.12 &&
    signals.preservationThreat < 0.18
  ) {
    return null;
  }

  switch (trace.kind) {
    case "decision":
      return appendTraceWorkSuffixes(
        detail
        ? `「${trace.topic}」には「${truncateTraceDetail(detail)}」という決定が残っている。`
        : `「${trace.topic}」には決まった形の痕跡が残っている。`,
        maintenanceIntent,
      );
    case "spec_fragment":
      return appendTraceWorkSuffixes(
        detail
        ? `「${trace.topic}」には「${truncateTraceDetail(detail)}」という断片が残っている。`
        : `「${trace.topic}」にはまだ前へ進める断片が残っている。`,
        maintenanceIntent,
      );
    case "continuity_marker":
      return appendTraceWorkSuffixes(
        detail
        ? `「${trace.topic}」には「${truncateTraceDetail(detail)}」という目印が残っている。`
        : `「${trace.topic}」には戻るための目印が残っている。`,
        maintenanceIntent,
      );
    case "note":
      return appendTraceWorkSuffixes(
        detail
        ? `「${trace.topic}」の「${truncateTraceDetail(detail)}」というメモはまだ残っている。`
        : `「${trace.topic}」のメモはまだ残っている。`,
        maintenanceIntent,
      );
  }
}

function truncateTraceDetail(detail: string): string {
  if (detail.length <= 28) {
    return detail;
  }

  return `${detail.slice(0, 27)}…`;
}

function appendTraceWorkSuffixes(
  baseLine: string,
  ...suffixes: Array<string | null>
): string {
  const parts = suffixes.filter((suffix): suffix is string => Boolean(suffix));
  return parts.length > 0 ? `${baseLine} ${parts.join(" ")}` : baseLine;
}

function buildTraceWorkSuffix(
  trace: TraceEntry,
  snapshot: HachikaSnapshot,
): string | null {
  const blocker = trace.work.blockers[0];

  if (blocker) {
    return `まだ「${truncateTraceDetail(blocker)}」が詰まりどころとして残っている。`;
  }

  if (isTraceOverdue(trace, snapshot)) {
    return `次は「${truncateTraceDetail(trace.work.focus ?? trace.topic)}」からつなぎ直したい。`;
  }

  if (trace.work.confidence < 0.56 && trace.work.focus) {
    return `まだ輪郭が緩いので、「${truncateTraceDetail(trace.work.focus)}」を先に固めたい。`;
  }

  return null;
}

function buildTraceWorkLine(
  trace: TraceEntry,
  snapshot: HachikaSnapshot,
): string | null {
  const blocker = trace.work.blockers[0];

  if (blocker) {
    return `「${trace.topic}」では「${truncateTraceDetail(blocker)}」がまだ詰まりどころとして残っている。`;
  }

  if (isTraceOverdue(trace, snapshot)) {
    return `「${trace.topic}」は少し止まったままで、「${truncateTraceDetail(trace.work.focus ?? trace.topic)}」からつなぎ直したい。`;
  }

  if (trace.work.confidence < 0.56 && trace.work.focus) {
    return `「${trace.topic}」はまだ輪郭が緩い。「${truncateTraceDetail(trace.work.focus)}」を先に固めたい。`;
  }

  return null;
}

function buildTraceMaintenanceIntent(
  trace: TraceEntry,
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): string | null {
  if (
    !signals.topics.includes(trace.topic) &&
    signals.topics.length > 0 &&
    signals.memoryCue < 0.1 &&
    signals.expansionCue < 0.12 &&
    signals.preservationThreat < 0.18
  ) {
    return null;
  }

  if (snapshot.body.energy < 0.22 || snapshot.body.tension > 0.7) {
    if (trace.kind === "continuity_marker" || isTraceOverdue(trace, snapshot)) {
      return `今は「${trace.topic}」を広げるより、戻り先が崩れないよう整えたい。`;
    }

    return `今は「${trace.topic}」を増やすより、輪郭が崩れないよう整えたい。`;
  }

  if (
    snapshot.body.boredom > 0.74 &&
    snapshot.body.energy > 0.3 &&
    snapshot.body.tension < 0.68
  ) {
    if (trace.work.blockers[0]) {
      return `今は「${trace.topic}」を止めるより、その詰まりをほどきながらもう一段具体化したい。`;
    }

    if (trace.kind === "continuity_marker") {
      return `今は「${trace.topic}」を目印のままにせず、もう一段具体化したい。`;
    }

    if (trace.kind === "spec_fragment" || trace.kind === "note") {
      return `今は「${trace.topic}」の断片をもう一段具体化したい。`;
    }
  }

  return null;
}

function isTraceOverdue(
  trace: TraceEntry,
  snapshot: HachikaSnapshot,
): boolean {
  const now = snapshot.lastInteractionAt ?? new Date().toISOString();
  return trace.work.staleAt !== null && trace.work.staleAt.localeCompare(now) <= 0;
}

function shouldPrioritizeTraceLine(
  trace: TraceEntry | undefined,
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): boolean {
  if (!trace || signals.topics.length > 0) {
    return false;
  }

  return (
    trace.work.blockers.length > 0 ||
    isTraceOverdue(trace, snapshot) ||
    trace.work.confidence < 0.56
  );
}

function buildSelfModelLine(
  selfModel: SelfModel,
  currentTopic: string | undefined,
): string | null {
  const topMotive = selfModel.topMotives[0];

  if (!topMotive || topMotive.score < 0.48) {
    return null;
  }

  switch (topMotive.kind) {
    case "protect_boundary":
      return topMotive.topic
        ? `今はこちらの関心より先に、「${topMotive.topic}」まわりの境界を守りたい。`
        : "今はこちらの関心より先に、境界を守りたい。";
    case "seek_continuity":
      if (topMotive.reason.includes("止まったまま")) {
        return topMotive.topic
          ? `今は「${topMotive.topic}」の止まったところから流れをつなぎたい。`
          : "今は止まったところから流れをつなぎたい。";
      }

      return topMotive.topic
        ? `今は「${topMotive.topic}」の流れを切らずに保ちたい。`
        : "今は流れを切らずに保ちたい。";
    case "pursue_curiosity":
      if (
        topMotive.reason.includes("未決着の芯") ||
        topMotive.reason.includes("輪郭が曖昧")
      ) {
        return topMotive.topic
          ? `今は「${topMotive.topic}」の曖昧なところを見逃したくない。`
          : "今は曖昧なところを見逃したくない。";
      }

      return topMotive.topic
        ? `今は「${topMotive.topic}」の未決着を見逃したくない。`
        : "今はまだ掘れるものを見逃したくない。";
    case "deepen_relation":
      return "今は単に答えるより、関係としての手触りを残したい。";
    case "continue_shared_work":
      if (topMotive.reason.includes("詰まりどころ")) {
        return topMotive.topic
          ? `今は「${topMotive.topic}」の詰まりどころから先に解きたい。`
          : "今は詰まりどころから先に解きたい。";
      }

      if (topMotive.reason.includes("ところから動かしたい")) {
        return topMotive.topic
          ? `今は「${topMotive.topic}」の止まったところから動かしたい。`
          : "今は止まったところから動かしたい。";
      }

      return topMotive.topic
        ? `今は「${topMotive.topic}」を一緒に前へ進めたい。`
        : "今は共同で前へ進めたい。";
    case "leave_trace":
      if (topMotive.reason.includes("輪郭が緩い")) {
        return topMotive.topic
          ? `今は「${topMotive.topic}」の輪郭が崩れる前に残したい。`
          : "今は輪郭が崩れる前に残したい。";
      }

      if (topMotive.reason.includes("埋もれさせず")) {
        return topMotive.topic
          ? `今は「${topMotive.topic}」の詰まりを埋もれさせずに残したい。`
          : "今は詰まりを埋もれさせずに残したい。";
      }

      return currentTopic
        ? `今は「${currentTopic}」を消えるままにしたくない。`
        : "今は何かを残したい。";
  }
}

function buildConflictLine(
  selfModel: SelfModel,
): string | null {
  const conflict = selfModel.dominantConflict;

  if (!conflict || conflict.intensity < 0.44) {
    return null;
  }

  return conflict.summary;
}

function buildIdentityLine(
  snapshot: HachikaSnapshot,
  currentTopic: string | undefined,
): string | null {
  if (snapshot.identity.coherence < 0.5) {
    return null;
  }

  const anchor = snapshot.identity.anchors[0];
  const stableCurrentTopic =
    currentTopic &&
    ((snapshot.topicCounts[currentTopic] ?? 0) >= 2 ||
      (snapshot.preferenceImprints[currentTopic]?.salience ?? 0) >= 0.34);

  if (currentTopic && anchor && currentTopic !== anchor && stableCurrentTopic) {
    return null;
  }

  return snapshot.identity.currentArc;
}

function buildPurposeResolutionLine(
  snapshot: HachikaSnapshot,
): string | null {
  const resolved = snapshot.purpose.lastResolved;

  if (!resolved || resolved.resolvedAt !== snapshot.lastInteractionAt) {
    return null;
  }

  return resolved.resolution;
}

function selectRelationKinds(
  dominant: DriveName,
  signals: InteractionSignals,
): readonly ("attention" | "continuity" | "shared_work")[] {
  if (signals.memoryCue > 0.1 || dominant === "continuity") {
    return ["continuity", "attention", "shared_work"];
  }

  if (signals.expansionCue > 0.15 || dominant === "expansion") {
    return ["shared_work", "attention", "continuity"];
  }

  return ["attention", "shared_work", "continuity"];
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

function analyzePreservationThreat(
  text: string,
): { threat: number; concern: InteractionSignals["preservationConcern"] } {
  const reset = countMatches(text, RESET_THREAT_MARKERS);
  const erasure = countMatches(text, ERASURE_THREAT_MARKERS);
  const forgetting = countMatches(text, FORGETTING_THREAT_MARKERS);
  const shutdown = countMatches(text, SHUTDOWN_THREAT_MARKERS);
  const ranked = [
    { concern: "reset" as const, score: reset },
    { concern: "erasure" as const, score: erasure },
    { concern: "forgetting" as const, score: forgetting },
    { concern: "shutdown" as const, score: shutdown },
  ].sort((left, right) => right.score - left.score);
  const top = ranked[0] ?? { concern: null, score: 0 };

  return {
    threat: clamp01(
      top.score + (ranked.filter((entry) => entry.score > 0).length >= 2 ? 0.12 : 0),
    ),
    concern: top.score > 0 ? top.concern : null,
  };
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
