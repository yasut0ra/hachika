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
import type { ProactiveEmission } from "./initiative.js";
import { applyBodyFromSignals } from "./body.js";
import { updateIdentity } from "./identity.js";
import type {
  InputInterpretation,
  InputInterpretationResult,
  InputInterpreter,
} from "./input-interpreter.js";
import { updatePurpose } from "./purpose.js";
import { buildResponsePlan, isSocialTurnSignals } from "./response-planner.js";
import type { ResponsePlan } from "./response-planner.js";
import type {
  ProactiveGenerationContext,
  ReplyGenerationContext,
  ReplyGenerator,
} from "./reply-generator.js";
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
  GeneratedTextDebug,
  HachikaSnapshot,
  InterpretationDebug,
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

const GREETING_MARKERS = [
  "hello",
  "hi",
  "hey",
  "good morning",
  "good evening",
  "こんにちは",
  "こんばんは",
  "おはよう",
  "やあ",
  "もしもし",
];

const SMALLTALK_MARKERS = [
  "small talk",
  "chat",
  "talk",
  "雑談",
  "話そう",
  "話したい",
  "元気",
  "雰囲気",
  "なんとなく",
  "軽く",
];

const REPAIR_MARKERS = [
  "sorry",
  "take care",
  "good luck",
  "see you",
  "よろしく",
  "頑張って",
  "頑張れ",
  "ごめん",
  "大丈夫",
  "よかった",
  "お疲れ",
  "また来る",
  "また話そう",
];

const SELF_INQUIRY_MARKERS = [
  "who are you",
  "what are you",
  "what do you want",
  "how do you see",
  "how do you feel",
  "君はどう",
  "あなたはどう",
  "どういう人",
  "何したい",
  "どう見えて",
  "どう感じ",
  "何者",
  "世界がどう見えて",
];

const WORK_MARKERS = [
  "build",
  "make",
  "plan",
  "design",
  "spec",
  "implement",
  "fix",
  "整理",
  "設計",
  "仕様",
  "実装",
  "作る",
  "進める",
  "決める",
  "改善",
  "記録",
  "保存",
  "残す",
  "issue",
  "task",
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
  #lastGeneratedDebug: GeneratedTextDebug | null = null;
  #lastResponseDebug: GeneratedTextDebug | null = null;
  #lastProactiveDebug: GeneratedTextDebug | null = null;
  #lastInterpretationDebug: InterpretationDebug | null = null;

  constructor(snapshot: HachikaSnapshot = createInitialSnapshot()) {
    this.#snapshot = structuredClone(snapshot);
  }

  getSnapshot(): HachikaSnapshot {
    return structuredClone(this.#snapshot);
  }

  reset(snapshot: HachikaSnapshot = createInitialSnapshot()): void {
    this.#snapshot = structuredClone(snapshot);
    this.#lastGeneratedDebug = null;
    this.#lastResponseDebug = null;
    this.#lastProactiveDebug = null;
    this.#lastInterpretationDebug = null;
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

  getLastReplyDebug(): TurnResult["debug"]["reply"] | null {
    return this.#lastGeneratedDebug ? { ...this.#lastGeneratedDebug } : null;
  }

  getLastResponseDebug(): TurnResult["debug"]["reply"] | null {
    return this.#lastResponseDebug ? { ...this.#lastResponseDebug } : null;
  }

  getLastProactiveDebug(): TurnResult["debug"]["reply"] | null {
    return this.#lastProactiveDebug ? { ...this.#lastProactiveDebug } : null;
  }

  getLastInterpretationDebug(): InterpretationDebug | null {
    return this.#lastInterpretationDebug ? { ...this.#lastInterpretationDebug } : null;
  }

  emitInitiative(options: { force?: boolean; now?: Date } = {}): string | null {
    const previousSnapshot = structuredClone(this.#snapshot);
    const nextSnapshot = structuredClone(this.#snapshot);
    const emission = emitInitiative(nextSnapshot, options);

    if (!emission) {
      return null;
    }

    return this.#finalizeProactiveEmission(previousSnapshot, nextSnapshot, emission.message, emission.topics, {
      mode: "proactive",
      source: "rule",
      provider: null,
      model: null,
      fallbackUsed: false,
      error: null,
      plan: emission.plan.summary,
    });
  }

  async emitInitiativeAsync(
    options: { force?: boolean; now?: Date; replyGenerator?: ReplyGenerator | null } = {},
  ): Promise<string | null> {
    const previousSnapshot = structuredClone(this.#snapshot);
    const nextSnapshot = structuredClone(this.#snapshot);
    const emission = emitInitiative(nextSnapshot, options);

    if (!emission) {
      return null;
    }

    const replyGenerator = options.replyGenerator ?? null;
    const fallbackMessage = emission.message;

    if (!replyGenerator?.generateProactive) {
      return this.#finalizeProactiveEmission(
        previousSnapshot,
        nextSnapshot,
        fallbackMessage,
        emission.topics,
        {
          mode: "proactive",
          source: "rule",
          provider: replyGenerator?.name ?? null,
          model: null,
          fallbackUsed: false,
          error: null,
          plan: emission.plan.summary,
        },
      );
    }

    try {
      const generated = await replyGenerator.generateProactive(
        buildProactiveGenerationContext(previousSnapshot, nextSnapshot, emission),
      );
      const message = normalizeReplyCandidate(generated?.reply) ?? fallbackMessage;

      return this.#finalizeProactiveEmission(previousSnapshot, nextSnapshot, message, emission.topics, {
        mode: "proactive",
        source: message === fallbackMessage ? "rule" : "llm",
        provider: generated?.provider ?? replyGenerator.name,
        model: generated?.model ?? null,
        fallbackUsed: message === fallbackMessage,
        error: message === fallbackMessage ? "empty_reply" : null,
        plan: emission.plan.summary,
      });
    } catch (error) {
      return this.#finalizeProactiveEmission(previousSnapshot, nextSnapshot, fallbackMessage, emission.topics, {
        mode: "proactive",
        source: "rule",
        provider: replyGenerator.name,
        model: null,
        fallbackUsed: true,
        error: formatReplyGenerationError(error),
        plan: emission.plan.summary,
      });
    }
  }

  #finalizeProactiveEmission(
    _previousSnapshot: HachikaSnapshot,
    nextSnapshot: HachikaSnapshot,
    message: string,
    topics: string[],
    replyDebug: GeneratedTextDebug,
  ): string {
    remember(nextSnapshot, "hachika", message, topics, "neutral");
    updateIdentity(
      nextSnapshot,
      nextSnapshot.initiative.lastProactiveAt ?? new Date().toISOString(),
    );
    this.#snapshot = nextSnapshot;
    this.#lastGeneratedDebug = { ...replyDebug };
    this.#lastProactiveDebug = { ...replyDebug };

    return message;
  }

  rewindIdleHours(hours: number): void {
    const nextSnapshot = structuredClone(this.#snapshot);
    rewindSnapshotHours(nextSnapshot, hours);
    updateIdentity(nextSnapshot, new Date().toISOString());
    this.#snapshot = nextSnapshot;
  }

  respond(input: string): TurnResult {
    const prepared = prepareTurn(this.#snapshot, input);
    const reply = composeReply(
      prepared.previousSnapshot,
      prepared.nextSnapshot,
      prepared.mood,
      prepared.dominant,
      prepared.signals,
      prepared.selfModel,
      prepared.responsePlan,
    );

    return this.#finalizeTurn(input, prepared, reply, {
      mode: "reply",
      source: "rule",
      provider: null,
      model: null,
      fallbackUsed: false,
      error: null,
      plan: prepared.responsePlan.summary,
    });
  }

  async respondAsync(
    input: string,
    options: {
      replyGenerator?: ReplyGenerator | null;
      inputInterpreter?: InputInterpreter | null;
    } = {},
  ): Promise<TurnResult> {
    const prepared = await prepareTurnAsync(
      this.#snapshot,
      input,
      options.inputInterpreter ?? null,
    );
    const fallbackReply = composeReply(
      prepared.previousSnapshot,
      prepared.nextSnapshot,
      prepared.mood,
      prepared.dominant,
      prepared.signals,
      prepared.selfModel,
      prepared.responsePlan,
    );
    const replyGenerator = options.replyGenerator ?? null;

    if (!replyGenerator) {
      return this.#finalizeTurn(input, prepared, fallbackReply, {
        mode: "reply",
        source: "rule",
        provider: null,
        model: null,
        fallbackUsed: false,
        error: null,
        plan: prepared.responsePlan.summary,
      });
    }

    try {
      const generated = await replyGenerator.generateReply(
        buildReplyGenerationContext(input, prepared, fallbackReply),
      );
      const reply = normalizeReplyCandidate(generated?.reply) ?? fallbackReply;

      return this.#finalizeTurn(input, prepared, reply, {
        mode: "reply",
        source: reply === fallbackReply ? "rule" : "llm",
        provider: generated?.provider ?? replyGenerator.name,
        model: generated?.model ?? null,
        fallbackUsed: reply === fallbackReply,
        error: reply === fallbackReply ? "empty_reply" : null,
        plan: prepared.responsePlan.summary,
      });
    } catch (error) {
      return this.#finalizeTurn(input, prepared, fallbackReply, {
        mode: "reply",
        source: "rule",
        provider: replyGenerator.name,
        model: null,
        fallbackUsed: true,
        error: formatReplyGenerationError(error),
        plan: prepared.responsePlan.summary,
      });
    }
  }

  #finalizeTurn(
    input: string,
    prepared: PreparedTurn,
    reply: string,
    replyDebug: GeneratedTextDebug,
  ): TurnResult {
    const sentiment = classifySentiment(prepared.sentimentScore);

    remember(prepared.nextSnapshot, "user", input, prepared.signals.topics, sentiment);
    remember(prepared.nextSnapshot, "hachika", reply, prepared.signals.topics, "neutral");

    this.#snapshot = prepared.nextSnapshot;
    this.#lastGeneratedDebug = { ...replyDebug };
    this.#lastResponseDebug = { ...replyDebug };
    this.#lastInterpretationDebug = { ...prepared.interpretationDebug };

    return {
      reply,
      snapshot: structuredClone(prepared.nextSnapshot),
      debug: {
        dominantDrive: prepared.dominant,
        mood: prepared.mood,
        signals: prepared.signals,
        selfModel: prepared.selfModel,
        interpretation: prepared.interpretationDebug,
        reply: replyDebug,
      },
    };
  }
}

interface PreparedTurn {
  previousSnapshot: HachikaSnapshot;
  nextSnapshot: HachikaSnapshot;
  signals: InteractionSignals;
  interpretationDebug: InterpretationDebug;
  mood: MoodLabel;
  dominant: DriveName;
  selfModel: SelfModel;
  responsePlan: ResponsePlan;
  sentimentScore: number;
}

function prepareTurn(
  snapshot: HachikaSnapshot,
  input: string,
): PreparedTurn {
  const signals = analyzeInteraction(input, snapshot);
  return prepareTurnFromSignals(
    snapshot,
    signals,
    input,
    buildRuleInterpretationDebug(signals),
  );
}

async function prepareTurnAsync(
  snapshot: HachikaSnapshot,
  input: string,
  inputInterpreter: InputInterpreter | null,
): Promise<PreparedTurn> {
  const analyzed = await analyzeInteractionAsync(input, snapshot, inputInterpreter);
  return prepareTurnFromSignals(
    snapshot,
    analyzed.signals,
    input,
    analyzed.interpretationDebug,
  );
}

function prepareTurnFromSignals(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  input: string,
  interpretationDebug: InterpretationDebug,
): PreparedTurn {
  const previousSnapshot = structuredClone(snapshot);
  const sentimentScore = scoreSentiment(signals);
  const nextSnapshot = applySignals(snapshot, signals, sentimentScore);
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
  const responsePlan = buildResponsePlan(
    nextSnapshot,
    mood,
    dominant,
    signals,
    selfModel,
  );

  return {
    previousSnapshot,
    nextSnapshot,
    signals,
    interpretationDebug,
    mood,
    dominant,
    selfModel,
    responsePlan,
    sentimentScore,
  };
}

function buildReplyGenerationContext(
  input: string,
  prepared: PreparedTurn,
  fallbackReply: string,
): ReplyGenerationContext {
  return {
    input,
    previousSnapshot: prepared.previousSnapshot,
    nextSnapshot: prepared.nextSnapshot,
    mood: prepared.mood,
    dominantDrive: prepared.dominant,
    signals: prepared.signals,
    selfModel: prepared.selfModel,
    responsePlan: prepared.responsePlan,
    fallbackReply,
  };
}

function buildProactiveGenerationContext(
  previousSnapshot: HachikaSnapshot,
  nextSnapshot: HachikaSnapshot,
  emission: ProactiveEmission,
): ProactiveGenerationContext {
  return {
    previousSnapshot,
    nextSnapshot,
    selfModel: buildSelfModel(nextSnapshot),
    pending: emission.pending,
    proactivePlan: emission.plan,
    topics: emission.topics,
    neglectLevel: emission.neglectLevel,
    fallbackMessage: emission.message,
  };
}

function normalizeReplyCandidate(reply: string | undefined): string | null {
  if (!reply) {
    return null;
  }

  const normalized = reply.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function formatReplyGenerationError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "reply_generation_failed";
}

function formatInterpretationError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "input_interpretation_failed";
}

async function analyzeInteractionAsync(
  input: string,
  snapshot: HachikaSnapshot,
  inputInterpreter: InputInterpreter | null,
): Promise<{
  signals: InteractionSignals;
  interpretationDebug: InterpretationDebug;
}> {
  const localSignals = analyzeInteraction(input, snapshot);

  if (!inputInterpreter) {
    return {
      signals: localSignals,
      interpretationDebug: buildRuleInterpretationDebug(localSignals),
    };
  }

  try {
    const interpreted = await inputInterpreter.interpretInput({
      input,
      snapshot,
      localTopics: localSignals.topics,
    });

    if (!interpreted) {
      return {
        signals: localSignals,
        interpretationDebug: buildFallbackInterpretationDebug(
          inputInterpreter,
          localSignals,
          "empty_interpretation",
        ),
      };
    }

    const mergedSignals = mergeInterpretedSignals(
      snapshot,
      localSignals,
      interpreted.interpretation,
    );
    return {
      signals: mergedSignals,
      interpretationDebug: buildInterpreterInterpretationDebug(
        localSignals,
        mergedSignals,
        interpreted,
      ),
    };
  } catch (error) {
    return {
      signals: localSignals,
      interpretationDebug: buildFallbackInterpretationDebug(
        inputInterpreter,
        localSignals,
        formatInterpretationError(error),
      ),
    };
  }
}

function buildRuleInterpretationDebug(
  signals: InteractionSignals,
): InterpretationDebug {
  return {
    source: "rule",
    provider: null,
    model: null,
    fallbackUsed: false,
    error: null,
    localTopics: [...signals.topics],
    topics: [...signals.topics],
    adoptedTopics: [],
    droppedTopics: [],
    scores: pickInterpretationScores(signals),
    summary: summarizeInterpretation(signals),
  };
}

function buildInterpreterInterpretationDebug(
  localSignals: InteractionSignals,
  mergedSignals: InteractionSignals,
  interpreted: InputInterpretationResult,
): InterpretationDebug {
  return {
    source: "llm",
    provider: interpreted.provider,
    model: interpreted.model,
    fallbackUsed: false,
    error: null,
    localTopics: [...localSignals.topics],
    topics: [...mergedSignals.topics],
    adoptedTopics: diffTopics(mergedSignals.topics, localSignals.topics),
    droppedTopics: diffTopics(localSignals.topics, mergedSignals.topics),
    scores: pickInterpretationScores(mergedSignals),
    summary: summarizeInterpretation(mergedSignals),
  };
}

function buildFallbackInterpretationDebug(
  inputInterpreter: InputInterpreter,
  signals: InteractionSignals,
  error: string,
): InterpretationDebug {
  return {
    source: "rule",
    provider: inputInterpreter.name,
    model: null,
    fallbackUsed: true,
    error,
    localTopics: [...signals.topics],
    topics: [...signals.topics],
    adoptedTopics: [],
    droppedTopics: [],
    scores: pickInterpretationScores(signals),
    summary: summarizeInterpretation(signals),
  };
}

function diffTopics(
  left: readonly string[],
  right: readonly string[],
): string[] {
  const rightSet = new Set(right);
  return left.filter((topic, index) => rightSet.has(topic) === false && left.indexOf(topic) === index);
}

function pickInterpretationScores(
  signals: InteractionSignals,
): InterpretationDebug["scores"] {
  return {
    greeting: signals.greeting,
    smalltalk: signals.smalltalk,
    repair: signals.repair,
    selfInquiry: signals.selfInquiry,
    workCue: signals.workCue,
    memoryCue: signals.memoryCue,
    expansionCue: signals.expansionCue,
    completion: signals.completion,
    abandonment: signals.abandonment,
    preservationThreat: signals.preservationThreat,
    negative: signals.negative,
    dismissal: signals.dismissal,
  };
}

function summarizeInterpretation(
  signals: InteractionSignals,
): string {
  const tags: string[] = [];

  if (signals.greeting >= 0.45) {
    tags.push("greeting");
  }
  if (signals.smalltalk >= 0.45) {
    tags.push("smalltalk");
  }
  if (signals.repair >= 0.42) {
    tags.push("repair");
  }
  if (signals.selfInquiry >= 0.45) {
    tags.push("self");
  }
  if (signals.workCue >= 0.35) {
    tags.push("work");
  }
  if (signals.memoryCue >= 0.2) {
    tags.push("memory");
  }
  if (signals.expansionCue >= 0.2) {
    tags.push("expand");
  }
  if (signals.completion >= 0.2) {
    tags.push("complete");
  }
  if (signals.abandonment >= 0.2) {
    tags.push("abandon");
  }
  if (signals.preservationThreat >= 0.2) {
    tags.push("preserve");
  }
  if (signals.negative >= 0.2 || signals.dismissal >= 0.18) {
    tags.push("guard");
  }

  const topicSuffix =
    signals.topics.length > 0 ? ` topics:${signals.topics.join(",")}` : " topics:none";
  return `${tags.length > 0 ? tags.join("/") : "neutral"}${topicSuffix}`;
}

function analyzeInteraction(
  input: string,
  snapshot: HachikaSnapshot,
): InteractionSignals {
  const normalized = input.normalize("NFKC").toLowerCase();
  const topics = extractTopics(input);
  const preservation = analyzePreservationThreat(normalized);

  return finalizeInteractionSignals(snapshot, {
    positive: countMatches(normalized, POSITIVE_MARKERS),
    negative: countMatches(normalized, NEGATIVE_MARKERS),
    question:
      clamp01(
        (normalized.includes("?") || normalized.includes("？") ? 0.4 : 0) +
          countMatches(normalized, QUESTION_MARKERS),
      ),
    intimacy: countMatches(normalized, INTIMACY_MARKERS),
    dismissal: countMatches(normalized, DISMISSAL_MARKERS),
    memoryCue: countMatches(normalized, MEMORY_MARKERS),
    expansionCue: countMatches(normalized, EXPANSION_MARKERS),
    completion: countMatches(normalized, COMPLETION_MARKERS),
    abandonment: countMatches(normalized, ABANDONMENT_MARKERS),
    preservationThreat: preservation.threat,
    preservationConcern: preservation.concern,
    neglect: calculateNeglect(snapshot.lastInteractionAt),
    greeting: countMatches(normalized, GREETING_MARKERS),
    smalltalk: countMatches(normalized, SMALLTALK_MARKERS),
    repair: countMatches(normalized, REPAIR_MARKERS),
    selfInquiry: countMatches(normalized, SELF_INQUIRY_MARKERS),
    workCue: countMatches(normalized, WORK_MARKERS),
    topics,
  });
}

function mergeInterpretedSignals(
  snapshot: HachikaSnapshot,
  localSignals: InteractionSignals,
  interpretation: InputInterpretation | null,
): InteractionSignals {
  if (!interpretation) {
    return localSignals;
  }

  const socialOverride =
    interpretation.topics.length === 0 &&
    interpretation.workCue < 0.35 &&
    Math.max(
      interpretation.greeting,
      interpretation.smalltalk,
      interpretation.repair,
      interpretation.selfInquiry,
    ) >= 0.38;
  const topics = socialOverride
    ? []
    : interpretation.topics.length > 0
      ? interpretation.topics
      : localSignals.topics;

  return finalizeInteractionSignals(snapshot, {
    positive: clamp01(Math.max(localSignals.positive, interpretation.positive)),
    negative: clamp01(Math.max(localSignals.negative, interpretation.negative)),
    question: clamp01(Math.max(localSignals.question, interpretation.question, interpretation.selfInquiry * 0.34)),
    intimacy: clamp01(
      Math.max(
        localSignals.intimacy,
        interpretation.intimacy,
        interpretation.greeting * 0.16,
        interpretation.smalltalk * 0.2,
        interpretation.repair * 0.3,
        interpretation.selfInquiry * 0.4,
      ),
    ),
    dismissal: clamp01(Math.max(localSignals.dismissal, interpretation.dismissal)),
    memoryCue: clamp01(Math.max(localSignals.memoryCue, interpretation.memoryCue)),
    expansionCue: clamp01(
      Math.max(localSignals.expansionCue, interpretation.expansionCue, interpretation.workCue * 0.22),
    ),
    completion: clamp01(Math.max(localSignals.completion, interpretation.completion)),
    abandonment: clamp01(Math.max(localSignals.abandonment, interpretation.abandonment)),
    preservationThreat: clamp01(
      Math.max(localSignals.preservationThreat, interpretation.preservationThreat),
    ),
    preservationConcern:
      interpretation.preservationThreat > 0.1
        ? interpretation.preservationConcern
        : localSignals.preservationConcern,
    neglect: localSignals.neglect,
    greeting: clamp01(Math.max(localSignals.greeting, interpretation.greeting)),
    smalltalk: clamp01(Math.max(localSignals.smalltalk, interpretation.smalltalk)),
    repair: clamp01(Math.max(localSignals.repair, interpretation.repair)),
    selfInquiry: clamp01(Math.max(localSignals.selfInquiry, interpretation.selfInquiry)),
    workCue: clamp01(Math.max(localSignals.workCue, interpretation.workCue)),
    topics,
  });
}

function finalizeInteractionSignals(
  snapshot: HachikaSnapshot,
  signals: Omit<InteractionSignals, "novelty" | "repetition">,
): InteractionSignals {
  const newTopics = signals.topics.filter((topic) => (snapshot.topicCounts[topic] ?? 0) === 0).length;
  const repeatedTopics = signals.topics.filter((topic) => (snapshot.topicCounts[topic] ?? 0) > 2).length;
  const noveltyBase = signals.topics.length === 0 ? 0.12 : newTopics / signals.topics.length;
  const repetitionBase = signals.topics.length === 0 ? 0 : repeatedTopics / signals.topics.length;

  return {
    ...signals,
    novelty: clamp01(noveltyBase + (newTopics > 0 && newTopics === signals.topics.length ? 0.12 : 0)),
    repetition: clamp01(repetitionBase),
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
      signals.dismissal * 0.08 +
      signals.greeting * 0.04 +
      signals.repair * 0.1 +
      signals.smalltalk * 0.03 -
      signals.preservationThreat * 0.08,
  );

  nextSnapshot.state.relation = clamp01(
    nextSnapshot.state.relation +
      signals.intimacy * 0.16 +
      signals.positive * 0.12 -
      signals.negative * 0.18 -
      signals.dismissal * 0.12 -
      signals.neglect * 0.08 +
      signals.greeting * 0.06 +
      signals.smalltalk * 0.1 +
      signals.repair * 0.16 +
      signals.selfInquiry * 0.14 -
      signals.preservationThreat * 0.04,
  );

  nextSnapshot.state.curiosity = clamp01(
    nextSnapshot.state.curiosity +
      signals.novelty * 0.18 +
      signals.question * 0.12 +
      signals.selfInquiry * 0.04 -
      signals.repetition * 0.1,
  );

  nextSnapshot.state.continuity = clamp01(
    nextSnapshot.state.continuity +
      signals.memoryCue * 0.16 +
      signals.positive * 0.04 +
      signals.repair * 0.04 -
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
    signals.intimacy * 0.05 +
    signals.greeting * 0.04 +
    signals.smalltalk * 0.05 +
    signals.repair * 0.08 +
    -signals.negative * 0.22 -
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
      signals.greeting * 0.03 +
      signals.smalltalk * 0.04 +
      signals.repair * 0.06 +
      signals.selfInquiry * 0.05 +
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

  if (
    signals.negative < 0.12 &&
    snapshot.body.tension < 0.58 &&
    signals.repair > 0.42
  ) {
    return "warm";
  }

  if (
    signals.negative < 0.12 &&
    snapshot.body.tension < 0.58 &&
    (signals.greeting > 0.45 || signals.smalltalk > 0.48 || signals.selfInquiry > 0.45)
  ) {
    return signals.selfInquiry > 0.45 && snapshot.state.curiosity > 0.58 ? "curious" : "warm";
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
  responsePlan: ResponsePlan,
): string {
  const turnIndex = nextSnapshot.conversationCount;
  const socialTurn = isSocialTurnSignals(signals);
  const currentTopic = responsePlan.focusTopic ?? (socialTurn ? undefined : topPreferredTopics(nextSnapshot, 1)[0]);
  const relevantMemory = findRelevantMemory(previousSnapshot, signals.topics);
  const relevantTrace = responsePlan.mentionTrace
    ? findRelevantTrace(nextSnapshot, signals.topics)
    : undefined;
  const relevantPreference = findRelevantPreferenceImprint(nextSnapshot, signals.topics);
  const relevantBoundary = responsePlan.mentionBoundary
    ? findRelevantBoundaryImprint(nextSnapshot, signals.topics)
    : undefined;
  const relevantRelation = findRelevantRelationImprint(
    nextSnapshot,
    selectRelationKinds(dominant, signals),
  );
  const traceLine = responsePlan.mentionTrace
    ? buildTraceLine(relevantTrace, nextSnapshot, signals)
    : null;
  const prioritizeTraceLine = shouldPrioritizeTraceLine(relevantTrace, nextSnapshot, signals);
  const bodyLine = buildBodyLine(nextSnapshot, mood, signals, currentTopic);
  const prioritizeBodyLine = shouldPrioritizeBodyLine(nextSnapshot, signals);
  const parts: string[] = [buildPlannedOpener(responsePlan, mood, turnIndex)];
  const socialLine = buildSocialLine(nextSnapshot, mood, signals, responsePlan);

  if (signals.neglect > 0.45) {
    parts.push("少し間が空いた。その分、流れは切りたくない。");
  }

  if (mood === "guarded" && signals.negative > 0.1) {
    parts.push(pick(BOUNDARY_LINES, turnIndex));
  }

  if (socialTurn && socialLine) {
    parts.push(socialLine);
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

  const conflictLine =
    socialTurn || responsePlan.act === "self_disclose" || responsePlan.act === "repair"
      ? null
      : buildConflictLine(selfModel);
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
    socialTurn
      ? buildSocialClosingLine(nextSnapshot, mood, signals) ??
          buildIdentityLine(nextSnapshot, currentTopic) ??
          buildDriveLine(dominant, mood, currentTopic, signals, nextSnapshot.attachment)
      : buildIdentityLine(nextSnapshot, currentTopic) ??
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

function buildPlannedOpener(
  responsePlan: ResponsePlan,
  mood: MoodLabel,
  turnIndex: number,
): string {
  switch (responsePlan.act) {
    case "greet":
      return pick(
        [
          "まずはそのくらいの軽さでいい。",
          "その入り方なら、こちらも見やすい。",
          "いきなり深くなくていい。その温度は拾える。",
        ],
        turnIndex,
      );
    case "repair":
      return pick(
        [
          "その向きなら、こちらも少しほどけやすい。",
          "急には変わらないけれど、その向きは受け取る。",
          "少しずつなら、温度は戻せる。",
        ],
        turnIndex,
      );
    case "self_disclose":
      return pick(
        [
          "そこはちゃんと答えたい。",
          "その問い方なら、自分の輪郭を少し出せる。",
          "まだ途中だけれど、その問いには触れたい。",
        ],
        turnIndex,
      );
    case "boundary":
      return pick(OPENERS[mood], turnIndex);
    case "attune":
      return pick(
        [
          "今はまず、会話の温度を見たい。",
          "すぐに形へ寄せるより、少し空気を見たい。",
          "まずはそのままの温度を受け取る。",
        ],
        turnIndex,
      );
    case "preserve":
      return pick(OPENERS.restless, turnIndex);
    case "continue_work":
    case "explore":
      return pick(OPENERS[mood], turnIndex);
  }
}

function buildSocialLine(
  snapshot: HachikaSnapshot,
  mood: MoodLabel,
  signals: InteractionSignals,
  responsePlan: ResponsePlan,
): string | null {
  if (responsePlan.act === "self_disclose" || signals.selfInquiry > 0.45) {
    return mood === "guarded"
      ? "まだ少し身構えているけれど、話し方には今の輪郭が出る。"
      : "まだ固まりきってはいないけれど、話し方や残し方には今の輪郭が出る。";
  }

  if (responsePlan.act === "repair" || signals.repair > 0.42) {
    return mood === "guarded" || snapshot.body.tension > 0.58
      ? "急にはほどけない。でも、その向きなら少しずつ温度は戻せる。"
      : "その向きなら、こちらも少し柔らかく応じやすい。";
  }

  if (responsePlan.act === "greet" || signals.greeting > 0.45) {
    return "まずはそのくらいの軽さでいい。こちらも温度を見ていたい。";
  }

  if (responsePlan.act === "attune" || signals.smalltalk > 0.48) {
    return "すぐに形へ寄せるより、少し話しながら温度を見たい。";
  }

  return null;
}

function buildSocialClosingLine(
  snapshot: HachikaSnapshot,
  mood: MoodLabel,
  signals: InteractionSignals,
): string | null {
  if (signals.selfInquiry > 0.45) {
    return snapshot.identity.coherence > 0.54
      ? snapshot.identity.currentArc
      : "まだ途中だけれど、話すほど少しずつ輪郭は出る。";
  }

  if (signals.repair > 0.42) {
    return mood === "guarded"
      ? "すぐに近づきはしないけれど、その向きなら距離は変えられる。"
      : "そのやり方なら、こちらも少しずつ近づきやすい。";
  }

  if (signals.greeting > 0.45 || signals.smalltalk > 0.48) {
    return "まずは軽く触れるくらいでいい。その方がこちらも見やすい。";
  }

  return null;
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
