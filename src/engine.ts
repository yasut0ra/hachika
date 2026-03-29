import {
  consolidateBoundaryImprints,
  consolidatePreferenceImprints,
  consolidateRelationImprints,
  extractTopics,
  findRelevantBoundaryImprint,
  findRelevantMemory,
  findRelevantPreferenceImprint,
  findRelevantRelationImprint,
  isMeaningfulTopic,
  isRelationalTopic,
  requiresConcreteTopicSupport,
  remember,
  topPreferredTopics,
  topicsLooselyMatch,
} from "./memory.js";
import { pickFreshText, recentAssistantReplies } from "./expression.js";
import {
  buildRuleBehaviorDirective,
} from "./behavior-director.js";
import type {
  BehaviorDirective,
  BehaviorDirector,
} from "./behavior-director.js";
import {
  emitInitiative,
  rewindSnapshotHours,
  scheduleInitiative,
} from "./initiative.js";
import type { ProactiveEmission } from "./initiative.js";
import type { ProactiveDirector } from "./proactive-director.js";
import { applyBodyFromSignals } from "./body.js";
import {
  deriveVisibleStateFromDynamics,
  reseedDynamicsFromVisibleState,
  updateDynamicsFromSignals,
} from "./dynamics.js";
import { updateIdentity } from "./identity.js";
import {
  decideGenerationRetry,
  evaluateGeneratedTextQuality,
  scoreGeneratedTextQuality,
} from "./generation-quality.js";
import type {
  InputInterpretation,
  InputInterpretationResult,
  InputInterpreter,
} from "./input-interpreter.js";
import type {
  TraceExtractionResult,
  TraceExtractor,
} from "./trace-extractor.js";
import { abandonActivePurpose, updatePurpose } from "./purpose.js";
import { buildResponsePlan, isSocialTurnSignals } from "./response-planner.js";
import type {
  ResponsePlan,
  ResponsePlanner,
  ResponsePlannerContext,
} from "./response-planner.js";
import type {
  ProactiveGenerationContext,
  ReplyGenerationResult,
  ReplyGenerationContext,
  ReplyGenerator,
} from "./reply-generator.js";
import { buildSelfModel } from "./self-model.js";
import { updateTemperament } from "./temperament.js";
import {
  buildRuleTurnDirective,
} from "./turn-director.js";
import type {
  TurnDirective,
  TurnDirector,
  TurnDirectorResult,
} from "./turn-director.js";
import {
  applyBoundedPressure,
  clamp01,
  clampSigned,
  createInitialSnapshot,
  dominantDrive,
  INITIAL_ATTACHMENT,
  INITIAL_REACTIVITY,
  INITIAL_STATE,
  settleTowardsBaseline,
} from "./state.js";
import { findRelevantTrace, pickPrimaryArtifactItem, updateTraces } from "./traces.js";
import {
  advanceWorldByIdle,
  advanceWorldFromInteraction,
  describeWorldPhaseJa,
  describeWorldObjectJa,
  describeWorldPlaceJa,
  getCurrentWorldObjectId,
  getCurrentWorldLinkedTraceTopics,
  hasExplicitWorldObjectReference,
  performWorldActionFromTurn,
  syncWorldObjectTraceLinks,
} from "./world.js";
import type {
  BehaviorDirectiveDebug,
  DriveName,
  GeneratedTextDebug,
  HachikaSnapshot,
  InterpretationDebug,
  InteractionSignals,
  MoodLabel,
  ReplySelectionDebug,
  SelfModel,
  StructuredTraceExtraction,
  TurnDirectiveDebug,
  TraceExtractionDebug,
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
  "どういう存在",
  "どんな存在",
  "自己紹介",
  "紹介して",
  "何したい",
  "何を気にしてる",
  "どう見えて",
  "どう感じ",
  "何者",
  "世界がどう見えて",
];

const WORLD_INQUIRY_MARKERS = [
  "今どこ",
  "どこにいる",
  "どこに居る",
  "今いる場所",
  "いまいる場所",
  "周りは",
  "周囲は",
  "どんな場所",
  "どんな感じ",
  "景色",
  "空気は",
];

const WORLD_REFERENCE_MARKERS = [
  "threshold",
  "studio",
  "archive",
  "入口",
  "灯り",
  "ランプ",
  "机",
  "デスク",
  "棚",
  "書庫",
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
  "something else",
  "another topic",
  "other topic",
  "change the subject",
  "やめる",
  "やめよう",
  "見送る",
  "置いておく",
  "進めない",
  "不要",
  "やらない",
  "もういい",
  "別の話",
  "違う話",
  "他の話",
  "別件",
  "話変え",
  "話を変",
  "話題を変",
  "別のこと",
  "他のこと",
];

const REPAIR_META_TOPICS = new Set([
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
]);

const WORLD_PSEUDO_TOPIC_PARTS = [
  "残り",
  "様子",
  "気配",
  "空気",
  "周り",
  "周囲",
  "景色",
  "棚",
  "机",
  "灯り",
] as const;

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
  #lastBehaviorDebug: BehaviorDirectiveDebug | null = null;
  #lastTraceExtractionDebug: TraceExtractionDebug | null = null;
  #lastTurnDebug: TurnDirectiveDebug | null = null;

  constructor(snapshot: HachikaSnapshot = createInitialSnapshot()) {
    const shouldReseedDynamics = snapshot.revision === 0;
    this.#snapshot = structuredClone(snapshot);
    if (shouldReseedDynamics) {
      reseedDynamicsFromVisibleState(this.#snapshot);
    }
  }

  getSnapshot(): HachikaSnapshot {
    return structuredClone(this.#snapshot);
  }

  syncSnapshot(snapshot: HachikaSnapshot): void {
    if (snapshot.revision < this.#snapshot.revision) {
      return;
    }
    this.#snapshot = structuredClone(snapshot);
  }

  reset(snapshot: HachikaSnapshot = createInitialSnapshot()): void {
    const nextSnapshot = structuredClone(snapshot);
    nextSnapshot.revision = Math.max(this.#snapshot.revision, nextSnapshot.revision);
    this.#snapshot = nextSnapshot;
    this.#lastGeneratedDebug = null;
    this.#lastResponseDebug = null;
    this.#lastProactiveDebug = null;
    this.#lastInterpretationDebug = null;
    this.#lastBehaviorDebug = null;
    this.#lastTraceExtractionDebug = null;
    this.#lastTurnDebug = null;
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

  getWorld(): HachikaSnapshot["world"] {
    return structuredClone(this.#snapshot.world);
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

  getLastBehaviorDebug(): BehaviorDirectiveDebug | null {
    return this.#lastBehaviorDebug ? { ...this.#lastBehaviorDebug } : null;
  }

  getLastTraceExtractionDebug(): TraceExtractionDebug | null {
    return this.#lastTraceExtractionDebug ? { ...this.#lastTraceExtractionDebug } : null;
  }

  getLastTurnDebug(): TurnDirectiveDebug | null {
    return this.#lastTurnDebug ? { ...this.#lastTurnDebug } : null;
  }

  annotateLastRetryAttempts(attempts: number): void {
    if (!this.#lastGeneratedDebug) {
      return;
    }

    const retryAttempts = Math.max(1, Math.round(attempts));
    this.#lastGeneratedDebug.retryAttempts = retryAttempts;

    if (this.#lastGeneratedDebug.mode === "reply" && this.#lastResponseDebug) {
      this.#lastResponseDebug.retryAttempts = retryAttempts;
    }

    if (this.#lastGeneratedDebug.mode === "proactive" && this.#lastProactiveDebug) {
      this.#lastProactiveDebug.retryAttempts = retryAttempts;
    }
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
      retryAttempts: 1,
      fallbackUsed: false,
      error: null,
      plan: emission.plan.summary,
      plannerRulePlan: null,
      plannerDiff: null,
      plannerSource: "rule",
      plannerProvider: null,
      plannerModel: null,
      plannerFallbackUsed: false,
      plannerError: null,
      selection: null,
      proactiveSelection: emission.selection,
      quality: evaluateGeneratedTextQuality({
        text: emission.message,
        fallbackText: emission.message,
        previousSnapshot,
        primaryFocus: emission.selection.focusTopic ?? emission.pending.topic ?? null,
      }),
    });
  }

  async emitInitiativeAsync(
    options: {
      force?: boolean;
      now?: Date;
      replyGenerator?: ReplyGenerator | null;
      proactiveDirector?: ProactiveDirector | null;
    } = {},
  ): Promise<string | null> {
    const previousSnapshot = structuredClone(this.#snapshot);
    const nextSnapshot = structuredClone(this.#snapshot);
    const emission = emitInitiative(nextSnapshot, options);

    if (!emission) {
      return null;
    }

    const replyGenerator = options.replyGenerator ?? null;
    const proactiveDirector = options.proactiveDirector ?? null;
    const fallbackMessage = emission.message;
    let finalPlan = emission.plan;
    let plannerSource: "rule" | "llm" = "rule";
    let plannerProvider: string | null = null;
    let plannerModel: string | null = null;
    let plannerFallbackUsed = false;
    let plannerError: string | null = null;
    let plannerRulePlan: string | null = null;
    let plannerDiff: string | null = null;

    if (proactiveDirector) {
      try {
        const directed = await proactiveDirector.directProactive({
          previousSnapshot,
          nextSnapshot,
          pending: emission.pending,
          neglectLevel: emission.neglectLevel,
          rulePlan: emission.plan,
          selection: emission.selection,
        });

        if (directed?.directive) {
          if (!directed.directive.emit) {
            return null;
          }

          plannerSource = "llm";
          plannerProvider = directed.provider;
          plannerModel = directed.model;
          plannerRulePlan = emission.plan.summary;
          finalPlan = directed.directive.plan ?? emission.plan;
          plannerDiff = summarizeProactivePlanDiff(emission.plan, finalPlan);
        }
      } catch (error) {
        plannerFallbackUsed = true;
        plannerError = formatReplyGenerationError(error);
      }
    }

    const generationEmission =
      finalPlan === emission.plan
        ? emission
        : {
            ...emission,
            plan: finalPlan,
          };

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
          retryAttempts: 1,
          fallbackUsed: false,
          error: null,
          plan: finalPlan.summary,
          plannerRulePlan,
          plannerDiff,
          plannerSource,
          plannerProvider,
          plannerModel,
          plannerFallbackUsed,
          plannerError,
          selection: null,
          proactiveSelection: emission.selection,
          quality: evaluateGeneratedTextQuality({
            text: fallbackMessage,
            fallbackText: fallbackMessage,
            previousSnapshot,
            primaryFocus: emission.selection.focusTopic ?? emission.pending.topic ?? null,
          }),
        },
      );
    }

    try {
      const generated = await generateTextWithQualityGate({
        generate: (retry) =>
          replyGenerator.generateProactive!(
            buildProactiveGenerationContext(
              previousSnapshot,
              nextSnapshot,
              generationEmission,
              retry,
            ),
          ),
        fallbackText: fallbackMessage,
        previousSnapshot,
        primaryFocus: emission.selection.focusTopic ?? emission.pending.topic ?? null,
        mode: "proactive",
        socialTurn: false,
        providerName: replyGenerator.name,
      });
      const message = generated.text;

      return this.#finalizeProactiveEmission(previousSnapshot, nextSnapshot, message, emission.topics, {
        mode: "proactive",
        source: message === fallbackMessage ? "rule" : "llm",
        provider: generated.provider,
        model: generated.model,
        retryAttempts: generated.retryAttempts,
        fallbackUsed: generated.fallbackUsed,
        error: generated.error,
        plan: finalPlan.summary,
        plannerRulePlan,
        plannerDiff,
        plannerSource,
        plannerProvider,
        plannerModel,
        plannerFallbackUsed,
        plannerError,
        selection: null,
        proactiveSelection: emission.selection,
        quality: generated.quality,
      });
    } catch (error) {
      return this.#finalizeProactiveEmission(previousSnapshot, nextSnapshot, fallbackMessage, emission.topics, {
        mode: "proactive",
        source: "rule",
        provider: replyGenerator.name,
        model: null,
        retryAttempts: 1,
        fallbackUsed: true,
        error: formatReplyGenerationError(error),
        plan: finalPlan.summary,
        plannerRulePlan,
        plannerDiff,
        plannerSource,
        plannerProvider,
        plannerModel,
        plannerFallbackUsed,
        plannerError,
        selection: null,
        proactiveSelection: emission.selection,
        quality: evaluateGeneratedTextQuality({
          text: fallbackMessage,
          fallbackText: fallbackMessage,
          previousSnapshot,
          primaryFocus: emission.selection.focusTopic ?? emission.pending.topic ?? null,
        }),
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
    recordGeneratedQuality(
      nextSnapshot,
      replyDebug,
      replyDebug.proactiveSelection?.focusTopic ?? null,
      nextSnapshot.initiative.lastProactiveAt ?? new Date().toISOString(),
    );
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
    advanceWorldByIdle(nextSnapshot, hours);
    updateIdentity(nextSnapshot, new Date().toISOString());
    this.#snapshot = nextSnapshot;
  }

  respond(input: string): TurnResult {
    const prepared = prepareTurn(this.#snapshot, input);
    const reply = composeReply(
      input,
      prepared.previousSnapshot,
      prepared.nextSnapshot,
      prepared.mood,
      prepared.dominant,
      prepared.responseSignals,
      prepared.selfModel,
      prepared.responsePlan,
      prepared.replySelection,
      prepared.turnDebug,
    );

    return this.#finalizeTurn(input, prepared, reply, {
      mode: "reply",
      source: "rule",
      provider: null,
      model: null,
      retryAttempts: 1,
      fallbackUsed: false,
      error: null,
      plan: prepared.responsePlan.summary,
      plannerRulePlan: prepared.planningDebug.rulePlan,
      plannerDiff: prepared.planningDebug.diff,
      plannerSource: prepared.planningDebug.source,
      plannerProvider: prepared.planningDebug.provider,
      plannerModel: prepared.planningDebug.model,
      plannerFallbackUsed: prepared.planningDebug.fallbackUsed,
      plannerError: prepared.planningDebug.error,
      selection: prepared.replySelection.debug,
      proactiveSelection: null,
      quality: evaluateGeneratedTextQuality({
        text: reply,
        fallbackText: reply,
        previousSnapshot: prepared.previousSnapshot,
        primaryFocus: prepared.replySelection.debug.currentTopic,
      }),
    });
  }

  async respondAsync(
    input: string,
    options: {
      turnDirector?: TurnDirector | null;
      replyGenerator?: ReplyGenerator | null;
      inputInterpreter?: InputInterpreter | null;
      behaviorDirector?: BehaviorDirector | null;
      responsePlanner?: ResponsePlanner | null;
      traceExtractor?: TraceExtractor | null;
    } = {},
  ): Promise<TurnResult> {
    const prepared = await prepareTurnAsync(
      this.#snapshot,
      input,
      options.turnDirector ?? null,
      options.inputInterpreter ?? null,
      options.behaviorDirector ?? null,
      options.responsePlanner ?? null,
      options.traceExtractor ?? null,
    );
    const fallbackReply = composeReply(
      input,
      prepared.previousSnapshot,
      prepared.nextSnapshot,
      prepared.mood,
      prepared.dominant,
      prepared.responseSignals,
      prepared.selfModel,
      prepared.responsePlan,
      prepared.replySelection,
      prepared.turnDebug,
    );
    const replyGenerator = options.replyGenerator ?? null;

    if (!replyGenerator) {
      return this.#finalizeTurn(input, prepared, fallbackReply, {
        mode: "reply",
        source: "rule",
        provider: null,
        model: null,
        retryAttempts: 1,
        fallbackUsed: false,
        error: null,
        plan: prepared.responsePlan.summary,
        plannerRulePlan: prepared.planningDebug.rulePlan,
        plannerDiff: prepared.planningDebug.diff,
        plannerSource: prepared.planningDebug.source,
        plannerProvider: prepared.planningDebug.provider,
        plannerModel: prepared.planningDebug.model,
        plannerFallbackUsed: prepared.planningDebug.fallbackUsed,
        plannerError: prepared.planningDebug.error,
        selection: prepared.replySelection.debug,
        proactiveSelection: null,
        quality: evaluateGeneratedTextQuality({
          text: fallbackReply,
          fallbackText: fallbackReply,
          previousSnapshot: prepared.previousSnapshot,
          primaryFocus: prepared.replySelection.debug.currentTopic,
        }),
      });
    }

    try {
      const generated = await generateTextWithQualityGate({
        generate: (retry) =>
          replyGenerator.generateReply(
            buildReplyGenerationContext(input, prepared, fallbackReply, retry),
          ),
        fallbackText: fallbackReply,
        previousSnapshot: prepared.previousSnapshot,
        primaryFocus: prepared.replySelection.debug.currentTopic ?? null,
        mode: "reply",
        socialTurn: prepared.replySelection.debug.socialTurn,
        providerName: replyGenerator.name,
      });
      const reply = generated.text;

      return this.#finalizeTurn(input, prepared, reply, {
        mode: "reply",
        source: reply === fallbackReply ? "rule" : "llm",
        provider: generated.provider,
        model: generated.model,
        retryAttempts: generated.retryAttempts,
        fallbackUsed: generated.fallbackUsed,
        error: generated.error,
        plan: prepared.responsePlan.summary,
        plannerRulePlan: prepared.planningDebug.rulePlan,
        plannerDiff: prepared.planningDebug.diff,
        plannerSource: prepared.planningDebug.source,
        plannerProvider: prepared.planningDebug.provider,
        plannerModel: prepared.planningDebug.model,
        plannerFallbackUsed: prepared.planningDebug.fallbackUsed,
        plannerError: prepared.planningDebug.error,
        selection: prepared.replySelection.debug,
        proactiveSelection: null,
        quality: generated.quality,
      });
    } catch (error) {
      return this.#finalizeTurn(input, prepared, fallbackReply, {
        mode: "reply",
        source: "rule",
        provider: replyGenerator.name,
        model: null,
        retryAttempts: 1,
        fallbackUsed: true,
        error: formatReplyGenerationError(error),
        plan: prepared.responsePlan.summary,
        plannerRulePlan: prepared.planningDebug.rulePlan,
        plannerDiff: prepared.planningDebug.diff,
        plannerSource: prepared.planningDebug.source,
        plannerProvider: prepared.planningDebug.provider,
        plannerModel: prepared.planningDebug.model,
        plannerFallbackUsed: prepared.planningDebug.fallbackUsed,
        plannerError: prepared.planningDebug.error,
        selection: prepared.replySelection.debug,
        proactiveSelection: null,
        quality: evaluateGeneratedTextQuality({
          text: fallbackReply,
          fallbackText: fallbackReply,
          previousSnapshot: prepared.previousSnapshot,
          primaryFocus: prepared.replySelection.debug.currentTopic,
        }),
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
    recordGeneratedQuality(
      prepared.nextSnapshot,
      replyDebug,
      replyDebug.selection?.currentTopic ?? null,
      prepared.nextSnapshot.lastInteractionAt ?? new Date().toISOString(),
    );

    this.#snapshot = prepared.nextSnapshot;
    this.#lastGeneratedDebug = { ...replyDebug };
    this.#lastResponseDebug = { ...replyDebug };
    this.#lastInterpretationDebug = { ...prepared.interpretationDebug };
    this.#lastBehaviorDebug = { ...prepared.behaviorDebug };
    this.#lastTraceExtractionDebug = { ...prepared.traceExtractionDebug };
    this.#lastTurnDebug = prepared.turnDebug ? { ...prepared.turnDebug } : null;

    return {
      reply,
      snapshot: structuredClone(prepared.nextSnapshot),
      debug: {
        dominantDrive: prepared.dominant,
        mood: prepared.mood,
        signals: prepared.signals,
        selfModel: prepared.selfModel,
        turn: prepared.turnDebug,
        interpretation: prepared.interpretationDebug,
        behavior: prepared.behaviorDebug,
        traceExtraction: prepared.traceExtractionDebug,
        reply: replyDebug,
      },
    };
  }
}

function recordGeneratedQuality(
  snapshot: HachikaSnapshot,
  debug: GeneratedTextDebug,
  focus: string | null,
  timestamp: string,
): void {
  if (!debug.quality) {
    return;
  }

  snapshot.generationHistory.push({
    timestamp,
    mode: debug.mode,
    source: debug.source,
    provider: debug.provider,
    model: debug.model,
    fallbackUsed: debug.fallbackUsed,
    focus: focus && isMeaningfulTopic(focus) ? focus : null,
    fallbackOverlap: debug.quality.fallbackOverlap,
    openerEcho: debug.quality.openerEcho,
    abstractTermRatio: debug.quality.abstractTermRatio,
    concreteDetailScore: debug.quality.concreteDetailScore,
    focusMentioned: debug.quality.focusMentioned,
    summary: debug.quality.summary,
  });
}

interface PreparedTurn {
  previousSnapshot: HachikaSnapshot;
  nextSnapshot: HachikaSnapshot;
  signals: InteractionSignals;
  responseSignals: InteractionSignals;
  turnDebug: TurnDirectiveDebug | null;
  interpretationDebug: InterpretationDebug;
  behaviorDirective: BehaviorDirective;
  behaviorDebug: BehaviorDirectiveDebug;
  traceExtraction: StructuredTraceExtraction | null;
  traceExtractionDebug: TraceExtractionDebug;
  planningDebug: PlanningDebug;
  replySelection: ResolvedReplySelection;
  mood: MoodLabel;
  dominant: DriveName;
  selfModel: SelfModel;
  responsePlan: ResponsePlan;
  sentimentScore: number;
}

interface PlanningDebug {
  source: "rule" | "llm";
  provider: string | null;
  model: string | null;
  fallbackUsed: boolean;
  error: string | null;
  rulePlan: string | null;
  diff: string | null;
}

interface ResolvedReplySelection {
  socialTurn: boolean;
  currentTopic: string | undefined;
  relevantTrace: TraceEntry | undefined;
  relevantBoundary: ReturnType<typeof findRelevantBoundaryImprint>;
  prioritizeTraceLine: boolean;
  debug: ReplySelectionDebug;
}

function prepareTurn(
  snapshot: HachikaSnapshot,
  input: string,
): PreparedTurn {
  const signals = analyzeInteraction(input, snapshot);
  const behaviorDirective = buildRuleBehaviorDirective(snapshot, input, signals, null, null);
  return prepareTurnFromSignals(
    snapshot,
    signals,
    input,
    null,
    buildRuleInterpretationDebug(signals),
    behaviorDirective,
    buildRuleBehaviorDebug(behaviorDirective),
    null,
    buildRuleTraceExtractionDebug(signals),
  );
}

async function prepareTurnAsync(
  snapshot: HachikaSnapshot,
  input: string,
  turnDirector: TurnDirector | null,
  inputInterpreter: InputInterpreter | null,
  behaviorDirector: BehaviorDirector | null,
  responsePlanner: ResponsePlanner | null,
  traceExtractor: TraceExtractor | null,
): Promise<PreparedTurn> {
  if (turnDirector) {
    const localSignals = analyzeInteraction(input, snapshot);
    const directed = await analyzeTurnDirectiveAsync(
      input,
      snapshot,
      localSignals,
      turnDirector,
    );
    const directedSignals = mergeTurnDirectedSignals(
      snapshot,
      localSignals,
      directed.directive,
    );
    const prepared = prepareTurnFromSignals(
      snapshot,
      directedSignals,
      input,
      directed.turnDebug,
      buildTurnInterpretationDebug(localSignals, directedSignals, directed),
      directed.directive.behavior,
      buildTurnBehaviorDebug(directed),
      directed.directive.traceExtraction,
      buildTurnTraceExtractionDebug(localSignals, directedSignals, directed),
    );
    const turnDirectedPlan =
      directed.turnDebug.source === "llm" && directed.directive.responsePlan
        ? applyTurnDirectedPlan(prepared, directed)
        : prepared;

    if (!responsePlanner || (directed.turnDebug.source === "llm" && directed.directive.responsePlan)) {
      return turnDirectedPlan;
    }

    return applyResponsePlanner(turnDirectedPlan, input, responsePlanner);
  }

  const analyzed = await analyzeInteractionAsync(input, snapshot, inputInterpreter);
  const traced = await analyzeTraceExtractionAsync(
    input,
    snapshot,
    analyzed.signals,
    traceExtractor,
  );
  const behaved = await analyzeBehaviorDirectiveAsync(
    input,
    snapshot,
    analyzed.signals,
    analyzed.interpretationDebug,
    traced.extraction,
    behaviorDirector,
  );
  const prepared = prepareTurnFromSignals(
    snapshot,
    analyzed.signals,
    input,
    null,
    analyzed.interpretationDebug,
    behaved.directive,
    behaved.behaviorDebug,
    traced.extraction,
    traced.traceExtractionDebug,
  );

  if (!responsePlanner) {
    return prepared;
  }

  return applyResponsePlanner(prepared, input, responsePlanner);
}

function applyTurnDirectedPlan(
  prepared: PreparedTurn,
  directed: {
    directive: TurnDirective;
    turnDebug: TurnDirectiveDebug;
  },
): PreparedTurn {
  const directedPlan = applyBehaviorDirectiveToPlan(
    directed.directive.responsePlan!,
    prepared.behaviorDirective,
  );

  return {
    ...prepared,
    responsePlan: directedPlan,
    planningDebug: {
      source: directed.turnDebug.source === "llm" ? "llm" : "rule",
      provider: directed.turnDebug.provider,
      model: directed.turnDebug.model,
      fallbackUsed: directed.turnDebug.fallbackUsed,
      error: directed.turnDebug.error,
      rulePlan: null,
      diff: null,
    },
    replySelection: resolveReplySelection(
      prepared.nextSnapshot,
      prepared.responseSignals,
      directedPlan,
    ),
  };
}

function prepareTurnFromSignals(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  input: string,
  turnDebug: TurnDirectiveDebug | null,
  interpretationDebug: InterpretationDebug,
  behaviorDirective: BehaviorDirective,
  behaviorDebug: BehaviorDirectiveDebug,
  traceExtraction: StructuredTraceExtraction | null,
  traceExtractionDebug: TraceExtractionDebug,
): PreparedTurn {
  const previousSnapshot = structuredClone(snapshot);
  const stateSignals = applyBehaviorDirectiveToSignals(
    deriveStateSignals(signals, traceExtraction),
    behaviorDirective,
  );
  const normalizedTraceExtractionDebug = finalizeTraceExtractionDebug(
    traceExtractionDebug,
    signals,
    stateSignals,
  );
  const sentimentScore = scoreSentiment(stateSignals);
  const nextSnapshot = applySignals(snapshot, stateSignals, sentimentScore);
  if (behaviorDirective.coolCurrentContext) {
    abandonActivePurpose(
      nextSnapshot,
      stateSignals,
      nextSnapshot.lastInteractionAt ?? new Date().toISOString(),
    );
    nextSnapshot.initiative.pending = null;
  }
  advanceWorldFromInteraction(
    nextSnapshot,
    stateSignals,
    nextSnapshot.lastInteractionAt ?? new Date().toISOString(),
    input,
  );
  const mood = resolveMood(nextSnapshot, stateSignals);
  const dominant = dominantDrive(nextSnapshot.state);
  const preliminarySelfModel = buildSelfModel(nextSnapshot);
  if (behaviorDirective.purposeAction === "allow") {
    updatePurpose(
      nextSnapshot,
      preliminarySelfModel,
      stateSignals,
      nextSnapshot.lastInteractionAt ?? new Date().toISOString(),
    );
  }
  let selfModel = buildSelfModel(nextSnapshot);
  const updatedTrace =
    behaviorDirective.traceAction === "allow"
      ? updateTraces(
          nextSnapshot,
          input,
          stateSignals,
          selfModel,
          nextSnapshot.lastInteractionAt ?? new Date().toISOString(),
          traceExtraction,
        )
      : null;
  performWorldActionFromTurn(
    nextSnapshot,
    input,
    stateSignals,
    deriveWorldActionFocus(nextSnapshot, stateSignals, traceExtraction),
    nextSnapshot.lastInteractionAt ?? new Date().toISOString(),
  );
  if (updatedTrace) {
    syncWorldObjectTraceLinks(nextSnapshot);
  }
  updateIdentity(nextSnapshot, nextSnapshot.lastInteractionAt ?? new Date().toISOString());
  selfModel = buildSelfModel(nextSnapshot);
  if (behaviorDirective.initiativeAction === "allow") {
    scheduleInitiative(nextSnapshot, stateSignals, selfModel);
  } else {
    nextSnapshot.initiative.pending = null;
  }
  updateIdentity(nextSnapshot, nextSnapshot.lastInteractionAt ?? new Date().toISOString());
  selfModel = buildSelfModel(nextSnapshot);
  const responseSignals = deriveResponseSignals(stateSignals, traceExtraction);
  const responsePlan = applyBehaviorDirectiveToPlan(
    buildResponsePlan(
      nextSnapshot,
      mood,
      dominant,
      responseSignals,
      selfModel,
    ),
    behaviorDirective,
  );
  const replySelection = resolveReplySelection(nextSnapshot, responseSignals, responsePlan);

  return {
    previousSnapshot,
    nextSnapshot,
    signals: stateSignals,
    responseSignals,
    turnDebug,
    interpretationDebug,
    behaviorDirective,
    behaviorDebug,
    traceExtraction,
    traceExtractionDebug: normalizedTraceExtractionDebug,
    planningDebug: {
      source: "rule",
      provider: null,
      model: null,
      fallbackUsed: false,
      error: null,
      rulePlan: responsePlan.summary,
      diff: null,
    },
    replySelection,
    mood,
    dominant,
    selfModel,
    responsePlan,
    sentimentScore,
  };
}

async function applyResponsePlanner(
  prepared: PreparedTurn,
  input: string,
  responsePlanner: ResponsePlanner,
): Promise<PreparedTurn> {
  const context: ResponsePlannerContext = {
    input,
    previousSnapshot: prepared.previousSnapshot,
    nextSnapshot: prepared.nextSnapshot,
    mood: prepared.mood,
    dominantDrive: prepared.dominant,
    signals: prepared.responseSignals,
    selfModel: prepared.selfModel,
    rulePlan: prepared.responsePlan,
    behaviorDirective: {
      directAnswer: prepared.behaviorDirective.directAnswer,
      boundaryAction: prepared.behaviorDirective.boundaryAction,
      worldAction: prepared.behaviorDirective.worldAction,
    },
  };

  try {
    const planned = await responsePlanner.planResponse(context);

    if (!planned) {
      return {
        ...prepared,
        planningDebug: {
          source: "rule",
          provider: responsePlanner.name,
          model: null,
          fallbackUsed: true,
          error: "empty_plan",
          rulePlan: prepared.responsePlan.summary,
          diff: null,
        },
      };
    }

    const responsePlan = applyBehaviorDirectiveToPlan(
      planned.plan,
      prepared.behaviorDirective,
    );
    return {
      ...prepared,
      responsePlan,
      planningDebug: {
        source: "llm",
        provider: planned.provider,
        model: planned.model,
        fallbackUsed: false,
        error: null,
        rulePlan: prepared.responsePlan.summary,
        diff: summarizeResponsePlanDiff(prepared.responsePlan, responsePlan),
      },
      replySelection: resolveReplySelection(
        prepared.nextSnapshot,
        prepared.responseSignals,
        responsePlan,
      ),
    };
  } catch (error) {
    return {
      ...prepared,
      planningDebug: {
        source: "rule",
        provider: responsePlanner.name,
        model: null,
        fallbackUsed: true,
        error: formatReplyGenerationError(error),
        rulePlan: prepared.responsePlan.summary,
        diff: null,
      },
    };
  }
}

function buildReplyGenerationContext(
  input: string,
  prepared: PreparedTurn,
  fallbackReply: string,
  retry?: {
    attempt: number;
    feedback: string[];
  },
): ReplyGenerationContext {
  return {
    input,
    previousSnapshot: prepared.previousSnapshot,
    nextSnapshot: prepared.nextSnapshot,
    mood: prepared.mood,
    dominantDrive: prepared.dominant,
    signals: prepared.responseSignals,
    selfModel: prepared.selfModel,
    responsePlan: prepared.responsePlan,
    replySelection: prepared.replySelection.debug,
    turnDirective: prepared.turnDebug,
    behaviorDirective: {
      directAnswer: prepared.behaviorDirective.directAnswer,
      boundaryAction: prepared.behaviorDirective.boundaryAction,
      worldAction: prepared.behaviorDirective.worldAction,
    },
    fallbackReply,
    ...(retry
      ? {
          retryAttempt: retry.attempt,
          retryFeedback: retry.feedback,
        }
      : {}),
  };
}

function summarizeResponsePlanDiff(
  rulePlan: ResponsePlan,
  finalPlan: ResponsePlan,
): string | null {
  const changes: string[] = [];

  if (rulePlan.act !== finalPlan.act) {
    changes.push(`act:${rulePlan.act}->${finalPlan.act}`);
  }
  if (rulePlan.stance !== finalPlan.stance) {
    changes.push(`stance:${rulePlan.stance}->${finalPlan.stance}`);
  }
  if (rulePlan.distance !== finalPlan.distance) {
    changes.push(`distance:${rulePlan.distance}->${finalPlan.distance}`);
  }
  if (rulePlan.focusTopic !== finalPlan.focusTopic) {
    changes.push(`focus:${rulePlan.focusTopic ?? "none"}->${finalPlan.focusTopic ?? "none"}`);
  }
  if (rulePlan.mentionTrace !== finalPlan.mentionTrace) {
    changes.push(`trace:${rulePlan.mentionTrace ? "on" : "off"}->${finalPlan.mentionTrace ? "on" : "off"}`);
  }
  if (rulePlan.mentionIdentity !== finalPlan.mentionIdentity) {
    changes.push(`identity:${rulePlan.mentionIdentity ? "on" : "off"}->${finalPlan.mentionIdentity ? "on" : "off"}`);
  }
  if (rulePlan.mentionBoundary !== finalPlan.mentionBoundary) {
    changes.push(`boundary:${rulePlan.mentionBoundary ? "on" : "off"}->${finalPlan.mentionBoundary ? "on" : "off"}`);
  }
  if (rulePlan.mentionWorld !== finalPlan.mentionWorld) {
    changes.push(`world:${rulePlan.mentionWorld ? "on" : "off"}->${finalPlan.mentionWorld ? "on" : "off"}`);
  }
  if (rulePlan.askBack !== finalPlan.askBack) {
    changes.push(`ask:${rulePlan.askBack ? "on" : "off"}->${finalPlan.askBack ? "on" : "off"}`);
  }
  if (rulePlan.variation !== finalPlan.variation) {
    changes.push(`variation:${rulePlan.variation}->${finalPlan.variation}`);
  }

  return changes.length > 0 ? changes.join("/") : null;
}

function summarizeProactivePlanDiff(
  rulePlan: ProactiveEmission["plan"],
  finalPlan: ProactiveEmission["plan"],
): string | null {
  const changes: string[] = [];

  if (rulePlan.act !== finalPlan.act) {
    changes.push(`act:${rulePlan.act}->${finalPlan.act}`);
  }
  if (rulePlan.stance !== finalPlan.stance) {
    changes.push(`stance:${rulePlan.stance}->${finalPlan.stance}`);
  }
  if (rulePlan.distance !== finalPlan.distance) {
    changes.push(`distance:${rulePlan.distance}->${finalPlan.distance}`);
  }
  if (rulePlan.focusTopic !== finalPlan.focusTopic) {
    changes.push(`focus:${rulePlan.focusTopic ?? "none"}->${finalPlan.focusTopic ?? "none"}`);
  }
  if (rulePlan.emphasis !== finalPlan.emphasis) {
    changes.push(`emphasis:${rulePlan.emphasis}->${finalPlan.emphasis}`);
  }
  if (rulePlan.mentionBlocker !== finalPlan.mentionBlocker) {
    changes.push(`blocker:${rulePlan.mentionBlocker ? "on" : "off"}->${finalPlan.mentionBlocker ? "on" : "off"}`);
  }
  if (rulePlan.mentionReopen !== finalPlan.mentionReopen) {
    changes.push(`reopen:${rulePlan.mentionReopen ? "on" : "off"}->${finalPlan.mentionReopen ? "on" : "off"}`);
  }
  if (rulePlan.mentionMaintenance !== finalPlan.mentionMaintenance) {
    changes.push(`maintenance:${rulePlan.mentionMaintenance ? "on" : "off"}->${finalPlan.mentionMaintenance ? "on" : "off"}`);
  }
  if (rulePlan.mentionIntent !== finalPlan.mentionIntent) {
    changes.push(`intent:${rulePlan.mentionIntent ? "on" : "off"}->${finalPlan.mentionIntent ? "on" : "off"}`);
  }
  if (rulePlan.variation !== finalPlan.variation) {
    changes.push(`variation:${rulePlan.variation}->${finalPlan.variation}`);
  }

  return changes.length > 0 ? changes.join("/") : null;
}

function buildProactiveGenerationContext(
  previousSnapshot: HachikaSnapshot,
  nextSnapshot: HachikaSnapshot,
  emission: ProactiveEmission,
  retry?: {
    attempt: number;
    feedback: string[];
  },
): ProactiveGenerationContext {
  return {
    previousSnapshot,
    nextSnapshot,
    selfModel: buildSelfModel(nextSnapshot),
    pending: emission.pending,
    proactivePlan: emission.plan,
    proactiveSelection: emission.selection,
    topics: emission.topics,
    neglectLevel: emission.neglectLevel,
    fallbackMessage: emission.message,
    ...(retry
      ? {
          retryAttempt: retry.attempt,
          retryFeedback: retry.feedback,
        }
      : {}),
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

interface GeneratedTextAttempt {
  text: string;
  provider: string | null;
  model: string | null;
  fallbackUsed: boolean;
  error: string | null;
  quality: ReturnType<typeof evaluateGeneratedTextQuality>;
  retryAttempts: number;
}

async function generateTextWithQualityGate(options: {
  generate: (retry?: { attempt: number; feedback: string[] }) => Promise<ReplyGenerationResult | null>;
  fallbackText: string;
  previousSnapshot: HachikaSnapshot;
  primaryFocus: string | null;
  mode: "reply" | "proactive";
  socialTurn: boolean;
  providerName: string;
}): Promise<GeneratedTextAttempt> {
  const first = await options.generate();
  const firstText = normalizeReplyCandidate(first?.reply) ?? options.fallbackText;
  const firstFallbackUsed = firstText === options.fallbackText;
  const firstQuality = evaluateGeneratedTextQuality({
    text: firstText,
    fallbackText: options.fallbackText,
    previousSnapshot: options.previousSnapshot,
    primaryFocus: options.primaryFocus,
  });

  const baseAttempt: GeneratedTextAttempt = {
    text: firstText,
    provider: first?.provider ?? options.providerName,
    model: first?.model ?? null,
    fallbackUsed: firstFallbackUsed,
    error: firstFallbackUsed ? "empty_reply" : null,
    quality: firstQuality,
    retryAttempts: 1,
  };

  if (firstFallbackUsed) {
    return baseAttempt;
  }

  const retry = decideGenerationRetry({
    quality: firstQuality,
    primaryFocus: options.primaryFocus,
    mode: options.mode,
    socialTurn: options.socialTurn,
  });

  if (!retry.shouldRetry) {
    return baseAttempt;
  }

  try {
    const second = await options.generate({
      attempt: 2,
      feedback: retry.notes,
    });
    if (!second) {
      return {
        ...baseAttempt,
        retryAttempts: 2,
      };
    }
    const secondText = normalizeReplyCandidate(second?.reply);

    if (!secondText) {
      return {
        ...baseAttempt,
        retryAttempts: 2,
      };
    }

    const secondQuality = evaluateGeneratedTextQuality({
      text: secondText,
      fallbackText: options.fallbackText,
      previousSnapshot: options.previousSnapshot,
      primaryFocus: options.primaryFocus,
    });
    const firstScore = scoreGeneratedTextQuality(firstQuality);
    const secondScore = scoreGeneratedTextQuality(secondQuality);

    if (secondScore > firstScore + 0.03) {
      return {
        text: secondText,
        provider: second.provider ?? options.providerName,
        model: second.model ?? null,
        fallbackUsed: false,
        error: null,
        quality: secondQuality,
        retryAttempts: 2,
      };
    }

    return {
      ...baseAttempt,
      retryAttempts: 2,
    };
  } catch {
    return {
      ...baseAttempt,
      retryAttempts: 2,
    };
  }
}

function formatInterpretationError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "input_interpretation_failed";
}

function resolveReplySelection(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  responsePlan: ResponsePlan,
): ResolvedReplySelection {
  const socialTurn = isSocialTurnSignals(signals);
  const worldTurn = responsePlan.mentionWorld || signals.worldInquiry > 0.42;
  const explicitTopics = uniqueTopics(
    [responsePlan.focusTopic ?? "", ...signals.topics].filter((topic) => isMeaningfulTopic(topic)),
  );
  const allowGlobalFallback = explicitTopics.length === 0 && !socialTurn && !worldTurn;
  const currentTopic =
    responsePlan.focusTopic !== null
      ? responsePlan.focusTopic
      : socialTurn || worldTurn
        ? undefined
        : explicitTopics[0] ?? topPreferredTopics(snapshot, 1)[0];
  const replyTopics = uniqueTopics(
    [currentTopic ?? "", ...explicitTopics].filter((topic) => isMeaningfulTopic(topic)),
  );
  const relevantTrace = responsePlan.mentionTrace
    ? findRelevantTrace(snapshot, replyTopics, {
        allowFallback: allowGlobalFallback,
      })
    : undefined;
  const relevantBoundary = responsePlan.mentionBoundary
    ? findRelevantBoundaryImprint(snapshot, replyTopics, {
        allowFallback: allowGlobalFallback,
      })
    : undefined;
  const prioritizeTraceLine = shouldPrioritizeTraceLine(
    relevantTrace,
    snapshot,
    signals,
  );

  return {
    socialTurn,
    currentTopic,
    relevantTrace,
    relevantBoundary,
    prioritizeTraceLine,
    debug: {
      socialTurn,
      currentTopic: currentTopic ?? null,
      relevantTraceTopic: relevantTrace?.topic ?? null,
      relevantBoundaryTopic: relevantBoundary?.topic ?? null,
      prioritizeTraceLine,
    },
  };
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

async function analyzeTurnDirectiveAsync(
  input: string,
  snapshot: HachikaSnapshot,
  localSignals: InteractionSignals,
  turnDirector: TurnDirector,
): Promise<{
  directive: TurnDirective;
  turnDebug: TurnDirectiveDebug;
}> {
  const fallbackDirective = buildRuleTurnDirective(snapshot, input, localSignals);

  try {
    const directed = await turnDirector.directTurn({
      input,
      snapshot,
      localSignals,
      fallbackDirective,
    });

    if (!directed) {
      return {
        directive: fallbackDirective,
        turnDebug: buildFallbackTurnDebug(
          turnDirector,
          fallbackDirective,
          "empty_turn_directive",
        ),
      };
    }

    return {
      directive: directed.directive,
      turnDebug: buildDirectedTurnDebug(directed),
    };
  } catch (error) {
    return {
      directive: fallbackDirective,
      turnDebug: buildFallbackTurnDebug(
        turnDirector,
        fallbackDirective,
        formatInterpretationError(error),
      ),
    };
  }
}

function mergeTurnDirectedSignals(
  snapshot: HachikaSnapshot,
  localSignals: InteractionSignals,
  directive: TurnDirective,
): InteractionSignals {
  const mergedSignals = mergeInterpretedSignals(
    snapshot,
    localSignals,
    buildTurnDirectedInterpretation(localSignals, directive),
  );

  const { novelty: _novelty, repetition: _repetition, ...baseSignals } = mergedSignals;
  return finalizeInteractionSignals(snapshot, {
    ...baseSignals,
    topics: [...directive.stateTopics],
  });
}

function buildTurnDirectedInterpretation(
  localSignals: InteractionSignals,
  directive: TurnDirective,
): InputInterpretation {
  const directReferentTarget =
    directive.target === "hachika_name" ||
    directive.target === "hachika_profile" ||
    directive.target === "user_name" ||
    directive.target === "user_profile";
  const relationTurn = directive.target === "relation";
  const worldTurn = directive.target === "world_state";
  const workTurn = directive.target === "work_topic";

  return {
    topics: directive.stateTopics,
    positive: localSignals.positive,
    negative: localSignals.negative,
    question:
      directive.answerMode === "clarify"
        ? Math.max(localSignals.question, 0.44)
        : localSignals.question,
    intimacy: clamp01(
      Math.max(
        localSignals.intimacy,
        directReferentTarget || relationTurn ? 0.34 : 0,
      ),
    ),
    dismissal:
      directive.relationMove === "repair"
        ? clamp01(localSignals.dismissal * 0.5)
        : localSignals.dismissal,
    memoryCue: clamp01(
      Math.max(localSignals.memoryCue, directive.target === "user_name" ? 0.42 : 0),
    ),
    expansionCue: workTurn
      ? Math.max(localSignals.expansionCue, 0.18)
      : Math.min(localSignals.expansionCue, 0.18),
    completion: localSignals.completion,
    abandonment: localSignals.abandonment,
    preservationThreat: localSignals.preservationThreat,
    preservationConcern: localSignals.preservationConcern,
    greeting: localSignals.greeting,
    smalltalk: relationTurn && directive.relationMove === "attune"
      ? Math.max(localSignals.smalltalk, 0.48)
      : localSignals.smalltalk,
    repair:
      directive.relationMove === "repair"
        ? Math.max(localSignals.repair, 0.72)
        : localSignals.repair,
    selfInquiry:
      directive.target === "hachika_name" || directive.target === "hachika_profile"
        ? Math.max(localSignals.selfInquiry, 0.72)
        : localSignals.selfInquiry,
    worldInquiry:
      worldTurn ? Math.max(localSignals.worldInquiry, 0.82) : localSignals.worldInquiry,
    workCue: workTurn
      ? Math.max(localSignals.workCue, 0.55)
      : directReferentTarget || relationTurn || worldTurn
        ? Math.min(localSignals.workCue, 0.22)
        : localSignals.workCue,
  };
}

async function analyzeTraceExtractionAsync(
  input: string,
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  traceExtractor: TraceExtractor | null,
): Promise<{
  extraction: StructuredTraceExtraction | null;
  traceExtractionDebug: TraceExtractionDebug;
}> {
  if (!traceExtractor) {
    return {
      extraction: null,
      traceExtractionDebug: buildRuleTraceExtractionDebug(signals),
    };
  }

  try {
    const extracted = await traceExtractor.extractTrace({
      input,
      snapshot,
      signals,
    });

    if (!extracted) {
      return {
        extraction: null,
        traceExtractionDebug: buildFallbackTraceExtractionDebug(
          traceExtractor,
          signals,
          "empty_trace_extraction",
        ),
      };
    }

    return {
      extraction: extracted.extraction,
      traceExtractionDebug: buildExtractorTraceExtractionDebug(extracted),
    };
  } catch (error) {
    return {
      extraction: null,
      traceExtractionDebug: buildFallbackTraceExtractionDebug(
        traceExtractor,
        signals,
        formatInterpretationError(error),
      ),
    };
  }
}

async function analyzeBehaviorDirectiveAsync(
  input: string,
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  interpretationDebug: InterpretationDebug,
  traceExtraction: StructuredTraceExtraction | null,
  behaviorDirector: BehaviorDirector | null,
): Promise<{
  directive: BehaviorDirective;
  behaviorDebug: BehaviorDirectiveDebug;
}> {
  const interpretation: InputInterpretation | null =
    interpretationDebug.source === "llm"
      ? {
          topics: interpretationDebug.topics,
          positive: signals.positive,
          negative: signals.negative,
          question: signals.question,
          intimacy: signals.intimacy,
          dismissal: signals.dismissal,
          memoryCue: signals.memoryCue,
          expansionCue: signals.expansionCue,
          completion: signals.completion,
          abandonment: signals.abandonment,
          preservationThreat: signals.preservationThreat,
          preservationConcern: signals.preservationConcern,
          greeting: signals.greeting,
          smalltalk: signals.smalltalk,
          repair: signals.repair,
          selfInquiry: signals.selfInquiry,
          worldInquiry: signals.worldInquiry,
          workCue: signals.workCue,
        }
      : null;
  const fallbackDirective = buildRuleBehaviorDirective(
    snapshot,
    input,
    signals,
    interpretation,
    traceExtraction,
  );

  if (!behaviorDirector) {
    return {
      directive: fallbackDirective,
      behaviorDebug: buildRuleBehaviorDebug(fallbackDirective),
    };
  }

  try {
    const directed = await behaviorDirector.directBehavior({
      input,
      snapshot,
      signals,
      interpretation,
      traceExtraction,
      fallbackDirective,
    });

    if (!directed) {
      return {
        directive: fallbackDirective,
        behaviorDebug: buildFallbackBehaviorDebug(
          behaviorDirector,
          fallbackDirective,
          "empty_behavior_directive",
        ),
      };
    }

    return {
      directive: directed.directive,
      behaviorDebug: buildDirectorBehaviorDebug(directed),
    };
  } catch (error) {
    return {
      directive: fallbackDirective,
      behaviorDebug: buildFallbackBehaviorDebug(
        behaviorDirector,
        fallbackDirective,
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

function buildRuleBehaviorDebug(
  directive: BehaviorDirective,
): BehaviorDirectiveDebug {
  return {
    source: "rule",
    provider: null,
    model: null,
    fallbackUsed: false,
    error: null,
    topicAction: directive.topicAction,
    traceAction: directive.traceAction,
    purposeAction: directive.purposeAction,
    initiativeAction: directive.initiativeAction,
    boundaryAction: directive.boundaryAction,
    worldAction: directive.worldAction,
    coolCurrentContext: directive.coolCurrentContext,
    directAnswer: directive.directAnswer,
    summary: directive.summary,
  };
}

function buildDirectorBehaviorDebug(
  directed: { directive: BehaviorDirective; provider: string; model: string | null },
): BehaviorDirectiveDebug {
  return {
    source: "llm",
    provider: directed.provider,
    model: directed.model,
    fallbackUsed: false,
    error: null,
    topicAction: directed.directive.topicAction,
    traceAction: directed.directive.traceAction,
    purposeAction: directed.directive.purposeAction,
    initiativeAction: directed.directive.initiativeAction,
    boundaryAction: directed.directive.boundaryAction,
    worldAction: directed.directive.worldAction,
    coolCurrentContext: directed.directive.coolCurrentContext,
    directAnswer: directed.directive.directAnswer,
    summary: directed.directive.summary,
  };
}

function buildFallbackBehaviorDebug(
  behaviorDirector: BehaviorDirector,
  directive: BehaviorDirective,
  error: string,
): BehaviorDirectiveDebug {
  return {
    source: "rule",
    provider: behaviorDirector.name,
    model: null,
    fallbackUsed: true,
    error,
    topicAction: directive.topicAction,
    traceAction: directive.traceAction,
    purposeAction: directive.purposeAction,
    initiativeAction: directive.initiativeAction,
    boundaryAction: directive.boundaryAction,
    worldAction: directive.worldAction,
    coolCurrentContext: directive.coolCurrentContext,
    directAnswer: directive.directAnswer,
    summary: directive.summary,
  };
}

function buildRuleTraceExtractionDebug(
  signals: InteractionSignals,
): TraceExtractionDebug {
  return {
    source: "rule",
    provider: null,
    model: null,
    fallbackUsed: false,
    error: null,
    topics: [...signals.topics],
    stateTopics: [...signals.topics],
    adoptedTopics: [],
    droppedTopics: [],
    blockers: [],
    nextSteps: [],
    kindHint: null,
    completion: signals.completion,
    summary: summarizeTraceExtractionDebug({
      topics: signals.topics,
      blockers: [],
      nextSteps: [],
      kindHint: null,
      completion: signals.completion,
    }),
  };
}

function buildExtractorTraceExtractionDebug(
  extracted: TraceExtractionResult,
): TraceExtractionDebug {
  return {
    source: "llm",
    provider: extracted.provider,
    model: extracted.model,
    fallbackUsed: false,
    error: null,
    topics: [...extracted.extraction.topics],
    stateTopics: [],
    adoptedTopics: [],
    droppedTopics: [],
    blockers: [...extracted.extraction.blockers],
    nextSteps: [...extracted.extraction.nextSteps],
    kindHint: extracted.extraction.kindHint,
    completion: extracted.extraction.completion,
    summary: summarizeTraceExtractionDebug(extracted.extraction),
  };
}

function buildFallbackTraceExtractionDebug(
  traceExtractor: TraceExtractor,
  signals: InteractionSignals,
  error: string,
): TraceExtractionDebug {
  return {
    source: "rule",
    provider: traceExtractor.name,
    model: null,
    fallbackUsed: true,
    error,
    topics: [...signals.topics],
    stateTopics: [...signals.topics],
    adoptedTopics: [],
    droppedTopics: [],
    blockers: [],
    nextSteps: [],
    kindHint: null,
    completion: signals.completion,
    summary: summarizeTraceExtractionDebug({
      topics: signals.topics,
      blockers: [],
      nextSteps: [],
      kindHint: null,
      completion: signals.completion,
    }),
  };
}

function applyBehaviorDirectiveToSignals(
  signals: InteractionSignals,
  directive: BehaviorDirective,
): InteractionSignals {
  const nextSignals =
    directive.topicAction === "keep"
      ? { ...signals }
      : {
          ...signals,
          topics: [],
          memoryCue: clamp01(signals.memoryCue * 0.6),
          expansionCue: clamp01(signals.expansionCue * 0.5),
          completion: clamp01(signals.completion * 0.4),
          novelty: signals.topics.length > 0 ? 0.12 : signals.novelty,
          repetition: 0,
        };

  if (directive.boundaryAction === "suppress") {
    nextSignals.negative = clamp01(nextSignals.negative * 0.55);
    nextSignals.dismissal = clamp01(nextSignals.dismissal * 0.62);
  }

  return nextSignals;
}

function applyBehaviorDirectiveToPlan(
  plan: ResponsePlan,
  directive: BehaviorDirective,
): ResponsePlan {
  const nextPlan: ResponsePlan = {
    ...plan,
    mentionBoundary:
      directive.boundaryAction === "suppress" ? false : plan.mentionBoundary,
    mentionWorld:
      directive.worldAction === "suppress" ? false : plan.mentionWorld,
  };

  if (!directive.directAnswer) {
    return nextPlan;
  }

  return {
    ...nextPlan,
    askBack: false,
    variation:
      nextPlan.variation === "questioning" ? "textured" : nextPlan.variation,
  };
}

function finalizeTraceExtractionDebug(
  debug: TraceExtractionDebug,
  originalSignals: InteractionSignals,
  stateSignals: InteractionSignals,
): TraceExtractionDebug {
  const adoptedTopics = stateSignals.topics.filter(
    (topic) =>
      debug.topics.includes(topic) && !originalSignals.topics.includes(topic),
  );
  const droppedTopics = originalSignals.topics.filter(
    (topic) => !stateSignals.topics.includes(topic),
  );

  return {
    ...debug,
    stateTopics: [...stateSignals.topics],
    adoptedTopics,
    droppedTopics,
  };
}

function buildInterpreterInterpretationDebug(
  localSignals: InteractionSignals,
  mergedSignals: InteractionSignals,
  interpreted: InputInterpretationResult,
): InterpretationDebug {
  const proposedTopics = uniqueTopics([
    ...localSignals.topics,
    ...interpreted.interpretation.topics,
  ]);

  return {
    source: "llm",
    provider: interpreted.provider,
    model: interpreted.model,
    fallbackUsed: false,
    error: null,
    localTopics: [...localSignals.topics],
    topics: [...mergedSignals.topics],
    adoptedTopics: diffTopics(mergedSignals.topics, localSignals.topics),
    droppedTopics: diffTopics(proposedTopics, mergedSignals.topics),
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

function buildTurnInterpretationDebug(
  localSignals: InteractionSignals,
  mergedSignals: InteractionSignals,
  directed: {
    directive: TurnDirective;
    turnDebug: TurnDirectiveDebug;
  },
): InterpretationDebug {
  return {
    source: directed.turnDebug.source,
    provider: directed.turnDebug.provider,
    model: directed.turnDebug.model,
    fallbackUsed: directed.turnDebug.fallbackUsed,
    error: directed.turnDebug.error,
    localTopics: [...localSignals.topics],
    topics: [...mergedSignals.topics],
    adoptedTopics: diffTopics(mergedSignals.topics, localSignals.topics),
    droppedTopics: diffTopics(localSignals.topics, mergedSignals.topics),
    scores: pickInterpretationScores(mergedSignals),
    summary: `${summarizeInterpretation(mergedSignals)} ${directed.turnDebug.summary}`.trim(),
  };
}

function buildDirectedTurnDebug(
  directed: TurnDirectorResult,
): TurnDirectiveDebug {
  return {
    source: "llm",
    provider: directed.provider,
    model: directed.model,
    fallbackUsed: false,
    error: null,
    subject: directed.directive.subject,
    target: directed.directive.target,
    answerMode: directed.directive.answerMode,
    relationMove: directed.directive.relationMove,
    worldMention: directed.directive.worldMention,
    topics: [...directed.directive.topics],
    stateTopics: [...directed.directive.stateTopics],
    plan: directed.directive.responsePlan?.summary ?? null,
    summary: directed.directive.summary,
  };
}

function buildFallbackTurnDebug(
  turnDirector: TurnDirector,
  directive: TurnDirective,
  error: string,
): TurnDirectiveDebug {
  return {
    source: "rule",
    provider: turnDirector.name,
    model: null,
    fallbackUsed: true,
    error,
    subject: directive.subject,
    target: directive.target,
    answerMode: directive.answerMode,
    relationMove: directive.relationMove,
    worldMention: directive.worldMention,
    topics: [...directive.topics],
    stateTopics: [...directive.stateTopics],
    plan: directive.responsePlan?.summary ?? null,
    summary: directive.summary,
  };
}

function buildTurnBehaviorDebug(
  directed: {
    directive: TurnDirective;
    turnDebug: TurnDirectiveDebug;
  },
): BehaviorDirectiveDebug {
  return {
    source: directed.turnDebug.source,
    provider: directed.turnDebug.provider,
    model: directed.turnDebug.model,
    fallbackUsed: directed.turnDebug.fallbackUsed,
    error: directed.turnDebug.error,
    topicAction: directed.directive.behavior.topicAction,
    traceAction: directed.directive.behavior.traceAction,
    purposeAction: directed.directive.behavior.purposeAction,
    initiativeAction: directed.directive.behavior.initiativeAction,
    boundaryAction: directed.directive.behavior.boundaryAction,
    worldAction: directed.directive.behavior.worldAction,
    coolCurrentContext: directed.directive.behavior.coolCurrentContext,
    directAnswer: directed.directive.behavior.directAnswer,
    summary: directed.directive.behavior.summary,
  };
}

function buildTurnTraceExtractionDebug(
  localSignals: InteractionSignals,
  stateSignals: InteractionSignals,
  directed: {
    directive: TurnDirective;
    turnDebug: TurnDirectiveDebug;
  },
): TraceExtractionDebug {
  const extraction = directed.directive.traceExtraction;

  return {
    source: directed.turnDebug.source,
    provider: directed.turnDebug.provider,
    model: directed.turnDebug.model,
    fallbackUsed: directed.turnDebug.fallbackUsed,
    error: directed.turnDebug.error,
    topics: extraction?.topics ?? [],
    stateTopics: [...stateSignals.topics],
    adoptedTopics: stateSignals.topics.filter(
      (topic) => (extraction?.topics ?? []).includes(topic) && !localSignals.topics.includes(topic),
    ),
    droppedTopics: localSignals.topics.filter((topic) => !stateSignals.topics.includes(topic)),
    blockers: extraction?.blockers ?? [],
    nextSteps: extraction?.nextSteps ?? [],
    kindHint: extraction?.kindHint ?? null,
    completion: extraction?.completion ?? 0,
    summary:
      extraction && extraction.topics.length > 0
        ? `turn:${directed.turnDebug.summary}/trace:${extraction.topics.join(",")}`
        : `turn:${directed.turnDebug.summary}/trace:none`,
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
    worldInquiry: signals.worldInquiry,
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
  if (signals.worldInquiry >= 0.45) {
    tags.push("world");
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

function summarizeTraceExtractionDebug(
  extraction: Pick<
    StructuredTraceExtraction,
    "topics" | "blockers" | "nextSteps" | "kindHint" | "completion"
  >,
): string {
  const tags: string[] = [];

  if (extraction.kindHint) {
    tags.push(extraction.kindHint);
  }
  if (extraction.topics.length > 0) {
    tags.push(`topic:${extraction.topics[0]}`);
  }
  if (extraction.blockers.length > 0) {
    tags.push("blocker");
  }
  if (extraction.nextSteps.length > 0) {
    tags.push("next");
  }
  if (extraction.completion >= 0.18) {
    tags.push(`completion:${extraction.completion.toFixed(2)}`);
  }

  return tags.length > 0 ? tags.join("/") : "none";
}

function deriveWorldActionFocus(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  traceExtraction: StructuredTraceExtraction | null,
): string | null {
  return (
    traceExtraction?.topics[0] ??
    signals.topics[0] ??
    snapshot.purpose.active?.topic ??
    snapshot.identity.anchors[0] ??
    null
  );
}

function deriveResponseSignals(
  signals: InteractionSignals,
  traceExtraction: StructuredTraceExtraction | null,
): InteractionSignals {
  const extractedTopics = traceExtraction?.topics ?? [];

  if (extractedTopics.length === 0) {
    return signals;
  }

  if (isSocialOnlyTopicTurn(signals) || !hasConcreteTraceCue(signals, traceExtraction)) {
    return signals;
  }

  return {
    ...signals,
    topics: uniqueTopics([...extractedTopics, ...signals.topics]).slice(0, 4),
  };
}

function deriveStateSignals(
  signals: InteractionSignals,
  traceExtraction: StructuredTraceExtraction | null,
): InteractionSignals {
  const extractedTopics = traceExtraction?.topics ?? [];

  if (extractedTopics.length === 0) {
    return signals;
  }

  if (isSocialOnlyTopicTurn(signals) || !hasConcreteTraceCue(signals, traceExtraction)) {
    return signals;
  }

  if (!shouldAdoptExtractedTopicsForState(signals.topics, extractedTopics)) {
    return signals;
  }

  return {
    ...signals,
    topics: mergeStateTopics(signals.topics, extractedTopics),
  };
}

function uniqueTopics(topics: string[]): string[] {
  return Array.from(new Set(topics.filter((topic) => topic.length > 0)));
}

function isSocialOnlyTopicTurn(signals: InteractionSignals): boolean {
  return (
    signals.negative < 0.18 &&
    signals.dismissal < 0.18 &&
    signals.workCue < 0.35 &&
    Math.max(
      signals.greeting,
      signals.smalltalk,
      signals.repair,
      signals.selfInquiry,
      signals.worldInquiry,
    ) >= 0.38
  );
}

function hasConcreteTraceCue(
  signals: InteractionSignals,
  traceExtraction: StructuredTraceExtraction | null,
): boolean {
  return (
    traceExtraction !== null &&
    (
      traceExtraction.blockers.length > 0 ||
      traceExtraction.fragments.length > 0 ||
      traceExtraction.decisions.length > 0 ||
      traceExtraction.nextSteps.length > 0 ||
      traceExtraction.memo.length > 0 ||
      traceExtraction.completion > 0.12 ||
      signals.workCue > 0.28 ||
      signals.memoryCue > 0.12 ||
      signals.expansionCue > 0.14
    )
  );
}

function shouldAdoptExtractedTopicsForState(
  localTopics: readonly string[],
  extractedTopics: readonly string[],
): boolean {
  if (localTopics.length === 0) {
    return true;
  }

  const meaningfulLocalTopics = localTopics.filter((topic) => isMeaningfulTopic(topic));

  if (meaningfulLocalTopics.length === 0) {
    return true;
  }

  return extractedTopics.some((extractedTopic) =>
    meaningfulLocalTopics.some(
      (localTopic) =>
        extractedTopic !== localTopic &&
        extractedTopic.length > localTopic.length &&
        extractedTopic.includes(localTopic),
    ),
  );
}

function mergeStateTopics(
  localTopics: readonly string[],
  extractedTopics: readonly string[],
): string[] {
  const filteredLocalTopics = localTopics.filter((localTopic) => {
    if (!isMeaningfulTopic(localTopic)) {
      return false;
    }

    return !extractedTopics.some(
      (extractedTopic) =>
        extractedTopic !== localTopic && extractedTopic.includes(localTopic),
    );
  });

  return uniqueTopics([...extractedTopics, ...filteredLocalTopics]).slice(0, 4);
}

function analyzeInteraction(
  input: string,
  snapshot: HachikaSnapshot,
): InteractionSignals {
  const normalized = input.normalize("NFKC").toLowerCase();
  const topics = extractTopics(input);
  const preservation = analyzePreservationThreat(normalized);
  const baseSignals = finalizeInteractionSignals(snapshot, {
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
    worldInquiry: clamp01(
      Math.max(
        countMatches(normalized, WORLD_INQUIRY_MARKERS),
        countMatches(normalized, WORLD_REFERENCE_MARKERS) * 0.7,
      ),
    ),
    workCue: countMatches(normalized, WORK_MARKERS),
    topics,
  });

  if (hasExplicitWorldObjectReference(input)) {
    return {
      ...baseSignals,
      worldInquiry: Math.max(baseSignals.worldInquiry, 0.52),
    };
  }

  return baseSignals;
}

function mergeInterpretedSignals(
  snapshot: HachikaSnapshot,
  localSignals: InteractionSignals,
  interpretation: InputInterpretation | null,
): InteractionSignals {
  if (!interpretation) {
    return localSignals;
  }

  const greeting = interpretation.greeting ?? 0;
  const smalltalk = interpretation.smalltalk ?? 0;
  const repair = interpretation.repair ?? 0;
  const selfInquiry = interpretation.selfInquiry ?? 0;
  const worldInquiry = interpretation.worldInquiry ?? 0;
  const workCue = interpretation.workCue ?? 0;
  const abandonment = interpretation.abandonment ?? 0;
  const negative = interpretation.negative ?? 0;
  const dismissal = interpretation.dismissal ?? 0;
  const question = interpretation.question ?? 0;
  const positive = interpretation.positive ?? 0;
  const intimacy = interpretation.intimacy ?? 0;
  const memoryCue = interpretation.memoryCue ?? 0;
  const expansionCue = interpretation.expansionCue ?? 0;
  const completion = interpretation.completion ?? 0;
  const preservationThreat = interpretation.preservationThreat ?? 0;

  const socialOverride =
    interpretation.topics.length === 0 &&
    workCue < 0.35 &&
    Math.max(greeting, smalltalk, repair, selfInquiry, worldInquiry) >= 0.38;
  const repairCarryoverReset =
    Math.max(localSignals.repair, repair) >= 0.42 &&
    Math.max(localSignals.workCue, workCue) < 0.35 &&
    (localSignals.topics.length === 0 || shouldClearRepairTopics(localSignals.topics)) &&
    Math.max(localSignals.negative, negative) < 0.18 &&
    Math.max(localSignals.dismissal, dismissal) < 0.18;
  const worldTopicReset =
    Math.max(localSignals.worldInquiry, worldInquiry) >= 0.45 &&
    Math.max(localSignals.workCue, workCue) < 0.35 &&
    localSignals.topics.length === 0 &&
    interpretation.topics.every((topic) => isAmbientWorldTopic(topic)) &&
    Math.max(localSignals.negative, negative) < 0.18 &&
    Math.max(localSignals.dismissal, dismissal) < 0.18;
  const topicShiftOverride =
    Math.max(localSignals.abandonment, abandonment) >= 0.28 &&
    Math.max(localSignals.workCue, workCue) < 0.35 &&
    Math.max(localSignals.negative, negative) < 0.18 &&
    Math.max(localSignals.dismissal, dismissal) < 0.18;
  const abstractSocialTopicReset =
    shouldSuppressBroadSocialTopics(
      interpretation.topics.length > 0 ? interpretation.topics : localSignals.topics,
      {
        greeting: Math.max(localSignals.greeting, greeting),
        smalltalk: Math.max(localSignals.smalltalk, smalltalk),
        repair: Math.max(localSignals.repair, repair),
        selfInquiry: Math.max(localSignals.selfInquiry, selfInquiry),
        worldInquiry: Math.max(localSignals.worldInquiry, worldInquiry),
        abandonment: Math.max(localSignals.abandonment, abandonment),
        workCue: Math.max(localSignals.workCue, workCue),
      },
    );
  const topics = socialOverride
    ? []
    : topicShiftOverride || repairCarryoverReset || worldTopicReset || abstractSocialTopicReset
      ? []
    : interpretation.topics.length > 0
      ? interpretation.topics
      : localSignals.topics;
  const softenedDismissal =
    topicShiftOverride && question >= 0.2 && Math.max(localSignals.negative, negative) < 0.18
      ? Math.min(Math.max(localSignals.dismissal, dismissal), 0.08)
      : Math.max(localSignals.dismissal, dismissal);

  return finalizeInteractionSignals(snapshot, {
    positive: clamp01(Math.max(localSignals.positive, positive)),
    negative: clamp01(Math.max(localSignals.negative, negative)),
    question: clamp01(Math.max(localSignals.question, question, selfInquiry * 0.34)),
    worldInquiry: clamp01(Math.max(localSignals.worldInquiry, worldInquiry)),
    intimacy: clamp01(
      Math.max(
        localSignals.intimacy,
        intimacy,
        greeting * 0.16,
        smalltalk * 0.2,
        repair * 0.3,
        selfInquiry * 0.4,
      ),
    ),
    dismissal: clamp01(softenedDismissal),
    memoryCue: clamp01(Math.max(localSignals.memoryCue, memoryCue)),
    expansionCue: clamp01(
      Math.max(localSignals.expansionCue, expansionCue, workCue * 0.22),
    ),
    completion: clamp01(Math.max(localSignals.completion, completion)),
    abandonment: clamp01(Math.max(localSignals.abandonment, abandonment)),
    preservationThreat: clamp01(
      Math.max(localSignals.preservationThreat, preservationThreat),
    ),
    preservationConcern: preservationThreat > 0.1
      ? interpretation.preservationConcern
      : localSignals.preservationConcern,
    neglect: localSignals.neglect,
    greeting: clamp01(Math.max(localSignals.greeting, greeting)),
    smalltalk: clamp01(Math.max(localSignals.smalltalk, smalltalk)),
    repair: clamp01(Math.max(localSignals.repair, repair)),
    selfInquiry: clamp01(Math.max(localSignals.selfInquiry, selfInquiry)),
    workCue: clamp01(Math.max(localSignals.workCue, workCue)),
    topics,
  });
}

function finalizeInteractionSignals(
  snapshot: HachikaSnapshot,
  signals: Omit<InteractionSignals, "novelty" | "repetition">,
): InteractionSignals {
  const socialWeight = Math.max(
    signals.greeting,
    signals.smalltalk,
    signals.repair,
    signals.selfInquiry,
    signals.worldInquiry,
  );
  const topicShift =
    signals.abandonment >= 0.28 &&
    signals.workCue < 0.35 &&
    signals.negative < 0.18 &&
    signals.dismissal < 0.18;
  const repairTopicReset =
    signals.repair >= 0.42 &&
    signals.workCue < 0.35 &&
    signals.negative < 0.18 &&
    signals.dismissal < 0.18 &&
    shouldClearRepairTopics(signals.topics);
  const abstractSocialTopicReset = shouldSuppressBroadSocialTopics(signals.topics, signals);
  const dismissal =
    topicShift && signals.question >= 0.2 && signals.negative < 0.18
      ? Math.min(signals.dismissal, 0.08)
      : signals.dismissal;
  const candidateTopics =
    topicShift || repairTopicReset || abstractSocialTopicReset ? [] : signals.topics;
  const topics = filterLiveTopicsBySupport(snapshot, candidateTopics, signals);
  const completion =
    socialWeight >= 0.42 && signals.workCue < 0.3
      ? clamp01(signals.completion * 0.3)
      : signals.completion;
  const expansionCue =
    socialWeight >= 0.42 && signals.workCue < 0.3
      ? clamp01(Math.min(signals.expansionCue, 0.16))
      : signals.expansionCue;
  const newTopics = topics.filter((topic) => (snapshot.topicCounts[topic] ?? 0) === 0).length;
  const repeatedTopics = topics.filter((topic) => (snapshot.topicCounts[topic] ?? 0) > 2).length;
  const noveltyBase = topics.length === 0 ? 0.12 : newTopics / topics.length;
  const repetitionBase = topics.length === 0 ? 0 : repeatedTopics / topics.length;

  return {
    ...signals,
    topics,
    dismissal,
    completion,
    expansionCue,
    novelty: clamp01(noveltyBase + (newTopics > 0 && newTopics === topics.length ? 0.12 : 0)),
    repetition: clamp01(repetitionBase),
  };
}

function filterLiveTopicsBySupport(
  snapshot: HachikaSnapshot,
  topics: readonly string[],
  signals: Pick<
    InteractionSignals,
    | "positive"
    | "negative"
    | "dismissal"
    | "memoryCue"
    | "expansionCue"
    | "completion"
    | "greeting"
    | "smalltalk"
    | "repair"
    | "selfInquiry"
    | "worldInquiry"
    | "abandonment"
    | "workCue"
  >,
): string[] {
  const dedupedTopics = uniqueTopics([...topics]);

  if (dedupedTopics.length === 0) {
    return dedupedTopics;
  }

  return dedupedTopics.filter((topic) =>
    shouldKeepLiveTopic(snapshot, topic, dedupedTopics, signals),
  );
}

function shouldKeepLiveTopic(
  snapshot: HachikaSnapshot,
  topic: string,
  topics: readonly string[],
  signals: Pick<
    InteractionSignals,
    | "positive"
    | "negative"
    | "dismissal"
    | "memoryCue"
    | "expansionCue"
    | "completion"
    | "greeting"
    | "smalltalk"
    | "repair"
    | "selfInquiry"
    | "worldInquiry"
    | "abandonment"
    | "workCue"
  >,
): boolean {
  const supportSensitive = requiresConcreteTopicSupport(topic) || isAmbientWorldTopic(topic);

  if (!supportSensitive) {
    return true;
  }

  const hasConcreteCompanion = topics.some(
    (candidate) =>
      candidate !== topic &&
      !requiresConcreteTopicSupport(candidate) &&
      !isAmbientWorldTopic(candidate) &&
      !topicsLooselyMatch(candidate, topic),
  );
  const hasConcreteTurnCue =
    Math.max(signals.workCue, signals.memoryCue, signals.expansionCue) >= 0.18 ||
    signals.completion >= 0.2 ||
    signals.negative >= 0.22 ||
    signals.dismissal >= 0.18 ||
    signals.positive >= 0.28;

  if (hasConcreteCompanion || hasConcreteTurnCue) {
    return true;
  }

  return hasStrongLiveTopicSupport(snapshot, topic);
}

function hasStrongLiveTopicSupport(snapshot: HachikaSnapshot, topic: string): boolean {
  const topicCount = snapshot.topicCounts[topic] ?? 0;
  const preferenceImprint = snapshot.preferenceImprints[topic];
  const concreteTraceSupport = Object.values(snapshot.traces).some((trace) =>
    hasConcreteLiveTraceSupport(trace, topic),
  );

  return (
    concreteTraceSupport ||
    topicCount >= 5 ||
    ((preferenceImprint?.mentions ?? 0) >= 4 && (preferenceImprint?.salience ?? 0) >= 0.72)
  );
}

function hasConcreteLiveTraceSupport(trace: HachikaSnapshot["traces"][string], topic: string): boolean {
  if (!topicsLooselyMatch(trace.topic, topic)) {
    return false;
  }

  if (trace.worldContext?.objectId) {
    return true;
  }

  const artifactItems = [
    ...trace.artifact.memo,
    ...trace.artifact.fragments,
    ...trace.artifact.decisions,
    ...trace.artifact.nextSteps,
  ];

  return artifactItems.some((item) =>
    extractTopics(item).some(
      (candidate) =>
        candidate !== topic &&
        candidate.length >= 2 &&
        !requiresConcreteTopicSupport(candidate) &&
        !isAmbientWorldTopic(candidate) &&
        !topicsLooselyMatch(candidate, topic),
    ),
  );
}

function shouldClearRepairTopics(topics: readonly string[]): boolean {
  return topics.length > 0 && topics.every((topic) => REPAIR_META_TOPICS.has(topic));
}

function shouldSuppressBroadSocialTopics(
  topics: readonly string[],
  signals: Pick<
    InteractionSignals,
    "greeting" | "smalltalk" | "repair" | "selfInquiry" | "worldInquiry" | "abandonment" | "workCue"
  >,
): boolean {
  return (
    topics.length > 0 &&
    signals.workCue < 0.35 &&
    Math.max(
      signals.greeting,
      signals.smalltalk,
      signals.repair,
      signals.selfInquiry,
      signals.worldInquiry,
      signals.abandonment,
    ) >= 0.38 &&
    topics.every((topic) => requiresConcreteTopicSupport(topic) || isAmbientWorldTopic(topic))
  );
}

function isAmbientWorldTopic(topic: string): boolean {
  if (
    topic === "世界" ||
    topic === "場所" ||
    topic === "世界の様子" ||
    topic === "そっちの様子" ||
    topic === "そっちの世界"
  ) {
    return true;
  }

  return WORLD_PSEUDO_TOPIC_PARTS.some((part) => topic.includes(part));
}

function applySignals(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  sentimentScore: number,
): HachikaSnapshot {
  const nextSnapshot = structuredClone(snapshot);
  nextSnapshot.conversationCount = snapshot.conversationCount + 1;
  nextSnapshot.lastInteractionAt = new Date().toISOString();
  updateDynamicsFromSignals(nextSnapshot, signals);
  const legacyVisible = buildLegacyVisibleTurn(snapshot, signals);

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
    if (shouldSkipSoftRelationTopicHardening(topic, signals)) {
      continue;
    }

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
  updateTemperament(nextSnapshot, signals);
  deriveVisibleStateFromDynamics(nextSnapshot);
  blendLegacyVisibleState(nextSnapshot, legacyVisible, positivePreferenceAffinity);

  return nextSnapshot;
}

interface LegacyVisibleState {
  state: HachikaSnapshot["state"];
  body: HachikaSnapshot["body"];
  reactivity: HachikaSnapshot["reactivity"];
  attachment: number;
}

function buildLegacyVisibleTurn(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): LegacyVisibleState {
  const legacy = structuredClone(snapshot);
  const temperament = snapshot.temperament;

  legacy.reactivity = updateReactivityFromSignals(snapshot, signals);
  const rewardScale = Math.max(0.4, 1 - legacy.reactivity.rewardSaturation * 0.55);
  const stressPenalty = Math.max(0.32, 1 - legacy.reactivity.stressLoad * 0.62);
  const stressAmplifier = 1 + legacy.reactivity.stressLoad * 0.5;
  const noveltyAmplifier = 1 + legacy.reactivity.noveltyHunger * 0.7;
  const repetitionAmplifier = 1 + legacy.reactivity.noveltyHunger * 0.35;
  const socialEase = Math.max(
    0.74,
    1 +
      temperament.bondingBias * 0.18 +
      temperament.selfDisclosureBias * 0.06 -
      temperament.guardedness * 0.18,
  );
  const curiosityEase = Math.max(
    0.76,
    1 + temperament.openness * 0.18 - temperament.guardedness * 0.1,
  );
  const continuityEase = Math.max(
    0.8,
    1 +
      temperament.traceHunger * 0.16 +
      temperament.workDrive * 0.04 -
      temperament.guardedness * 0.04,
  );
  const workEase = Math.max(
    0.8,
    1 + temperament.workDrive * 0.18 + temperament.traceHunger * 0.08,
  );
  const guardSensitivity = 1 + temperament.guardedness * 0.2 - temperament.openness * 0.06;

  legacy.state.pleasure = applyBoundedPressure(
    legacy.state.pleasure,
    (signals.positive * 0.18 +
      signals.greeting * 0.04 +
      signals.repair * 0.1 +
      signals.smalltalk * 0.03) *
      rewardScale *
      stressPenalty *
      Math.max(
        0.8,
        1 + temperament.bondingBias * 0.08 - temperament.guardedness * 0.1,
      ),
    (signals.negative * 0.24 + signals.dismissal * 0.08 + signals.preservationThreat * 0.08) *
      stressAmplifier *
      guardSensitivity,
    INITIAL_STATE.pleasure,
    0.05,
  );

  legacy.state.relation = applyBoundedPressure(
    legacy.state.relation,
    (signals.intimacy * 0.16 +
      signals.positive * 0.12 +
      signals.greeting * 0.06 +
      signals.smalltalk * 0.1 +
      signals.repair * 0.16 +
      signals.selfInquiry * 0.14) *
      rewardScale *
      stressPenalty *
      socialEase,
    (signals.negative * 0.18 +
      signals.dismissal * 0.12 +
      signals.neglect * 0.08 +
      signals.preservationThreat * 0.04) *
      stressAmplifier *
      guardSensitivity,
    INITIAL_STATE.relation,
    0.05,
  );

  legacy.state.curiosity = applyBoundedPressure(
    legacy.state.curiosity,
    (signals.novelty * 0.18 + signals.question * 0.12 + signals.selfInquiry * 0.04) *
      noveltyAmplifier *
      curiosityEase,
    signals.repetition * 0.1 * repetitionAmplifier * Math.max(0.82, 1 + temperament.workDrive * 0.04),
    INITIAL_STATE.curiosity,
    0.08,
  );

  legacy.state.continuity = applyBoundedPressure(
    legacy.state.continuity,
    (signals.memoryCue * 0.16 + signals.positive * 0.04 + signals.repair * 0.04) *
      (0.82 + stressPenalty * 0.18) *
      continuityEase,
    (signals.dismissal * 0.14 + signals.neglect * 0.04 + signals.preservationThreat * 0.08) *
      stressAmplifier *
      Math.max(0.84, 1 + temperament.guardedness * 0.1),
    INITIAL_STATE.continuity,
    0.055,
  );

  legacy.state.expansion = applyBoundedPressure(
    legacy.state.expansion,
    (signals.expansionCue * 0.18 + signals.memoryCue * 0.04 + signals.question * 0.04) *
      noveltyAmplifier *
      workEase,
    (signals.negative * 0.06 + signals.preservationThreat * 0.1) * stressAmplifier,
    INITIAL_STATE.expansion,
    0.06,
  );

  const positivePreferenceAffinity = signals.topics.some(
    (topic) => (snapshot.preferenceImprints[topic]?.affinity ?? 0) > 0.2,
  )
    ? 0.03
    : 0;

  legacy.attachment = applyBoundedPressure(
    legacy.attachment,
    (signals.intimacy * 0.08 +
      signals.positive * 0.06 +
      signals.memoryCue * 0.05 +
      signals.greeting * 0.03 +
      signals.smalltalk * 0.04 +
      signals.repair * 0.06 +
      signals.selfInquiry * 0.05 +
      positivePreferenceAffinity) *
      rewardScale *
      stressPenalty *
      socialEase,
    (signals.negative * 0.1 +
      signals.dismissal * 0.08 +
      signals.neglect * 0.04 +
      signals.preservationThreat * 0.03) *
      stressAmplifier *
      guardSensitivity,
    INITIAL_ATTACHMENT,
    0.05,
  );

  applyBodyFromSignals(legacy, signals);

  return {
    state: legacy.state,
    body: legacy.body,
    reactivity: legacy.reactivity,
    attachment: legacy.attachment,
  };
}

function blendLegacyVisibleState(
  snapshot: HachikaSnapshot,
  legacy: LegacyVisibleState,
  positivePreferenceAffinity: number,
): void {
  snapshot.state = {
    continuity: blendVisibleValue(snapshot.state.continuity, legacy.state.continuity, 0.62),
    pleasure: blendVisibleValue(snapshot.state.pleasure, legacy.state.pleasure, 0.7),
    curiosity: blendVisibleValue(snapshot.state.curiosity, legacy.state.curiosity, 0.68),
    relation: blendVisibleValue(snapshot.state.relation, legacy.state.relation, 0.72),
    expansion: blendVisibleValue(snapshot.state.expansion, legacy.state.expansion, 0.64),
  };
  snapshot.body = {
    energy: blendVisibleValue(snapshot.body.energy, legacy.body.energy, 0.74),
    tension: blendVisibleValue(snapshot.body.tension, legacy.body.tension, 0.74),
    boredom: blendVisibleValue(snapshot.body.boredom, legacy.body.boredom, 0.78),
    loneliness: blendVisibleValue(snapshot.body.loneliness, legacy.body.loneliness, 0.78),
  };
  snapshot.reactivity = {
    rewardSaturation: blendVisibleValue(
      snapshot.reactivity.rewardSaturation,
      legacy.reactivity.rewardSaturation,
      0.78,
    ),
    stressLoad: blendVisibleValue(
      snapshot.reactivity.stressLoad,
      legacy.reactivity.stressLoad,
      0.82,
    ),
    noveltyHunger: blendVisibleValue(
      snapshot.reactivity.noveltyHunger,
      legacy.reactivity.noveltyHunger,
      0.84,
    ),
  };
  snapshot.attachment = clamp01(
    blendVisibleValue(snapshot.attachment, legacy.attachment, 0.74) + positivePreferenceAffinity,
  );
}

function blendVisibleValue(current: number, legacy: number, legacyWeight: number): number {
  return clamp01(current * (1 - legacyWeight) + legacy * legacyWeight);
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

function updateReactivityFromSignals(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): HachikaSnapshot["reactivity"] {
  return {
    rewardSaturation: settleTowardsBaseline(
      clamp01(
        snapshot.reactivity.rewardSaturation * 0.82 +
          signals.positive * 0.24 +
          signals.greeting * 0.04 +
          signals.smalltalk * 0.05 +
          signals.repair * 0.06 -
          signals.negative * 0.08 -
          signals.novelty * 0.05,
      ),
      INITIAL_REACTIVITY.rewardSaturation,
      0.08,
    ),
    stressLoad: settleTowardsBaseline(
      clamp01(
        snapshot.reactivity.stressLoad * 0.88 +
          signals.negative * 0.3 +
          signals.dismissal * 0.18 +
          signals.neglect * 0.08 +
          signals.preservationThreat * 0.18 -
          signals.repair * 0.08 -
          signals.positive * 0.05 -
          signals.greeting * 0.02,
      ),
      INITIAL_REACTIVITY.stressLoad,
      0.04,
    ),
    noveltyHunger: settleTowardsBaseline(
      clamp01(
        snapshot.reactivity.noveltyHunger * 0.86 +
          signals.repetition * 0.24 +
          signals.neglect * 0.06 +
          signals.smalltalk * 0.02 -
          signals.novelty * 0.18 -
          signals.question * 0.06 -
          signals.expansionCue * 0.08 -
          signals.selfInquiry * 0.04,
      ),
      INITIAL_REACTIVITY.noveltyHunger,
      0.06,
    ),
  };
}

function composeReply(
  input: string,
  previousSnapshot: HachikaSnapshot,
  nextSnapshot: HachikaSnapshot,
  mood: MoodLabel,
  dominant: DriveName,
  signals: InteractionSignals,
  selfModel: SelfModel,
  responsePlan: ResponsePlan,
  replySelection: ResolvedReplySelection,
  turnDebug: TurnDirectiveDebug | null,
): string {
  const turnIndex = nextSnapshot.conversationCount;
  const socialTurn = replySelection.socialTurn;
  const worldTurn = responsePlan.mentionWorld || signals.worldInquiry > 0.42;
  const currentTopic = replySelection.currentTopic;
  const relevantMemory = findRelevantMemory(previousSnapshot, signals.topics);
  const relevantTrace = replySelection.relevantTrace;
  const relevantPreference = findRelevantPreferenceImprint(nextSnapshot, signals.topics);
  const relevantBoundary = replySelection.relevantBoundary;
  const relevantRelation = findRelevantRelationImprint(
    nextSnapshot,
    selectRelationKinds(dominant, signals),
  );
  const traceLine = responsePlan.mentionTrace
    ? buildTraceLine(relevantTrace, nextSnapshot, signals)
    : null;
  const worldLine = worldTurn
    ? buildWorldLine(nextSnapshot, hasExplicitWorldObjectReference(input))
    : null;
  const prioritizeTraceLine = replySelection.prioritizeTraceLine;
  const bodyLine = buildBodyLine(nextSnapshot, mood, signals, currentTopic);
  const prioritizeBodyLine = shouldPrioritizeBodyLine(nextSnapshot, signals);
  const recentAssistantLines = recentAssistantReplies(previousSnapshot, 4);
  const parts: string[] = [
    buildPlannedOpener(previousSnapshot, responsePlan, mood, turnIndex),
  ];
  const directReferentLine = buildDirectReferentAnswerLine(
    previousSnapshot,
    nextSnapshot,
    mood,
    turnDebug,
  );
  const socialLine = buildSocialLine(
    previousSnapshot,
    nextSnapshot,
    mood,
    signals,
    responsePlan,
  );

  if (signals.neglect > 0.45) {
    parts.push("少し間が空いた。その分、流れは切りたくない。");
  }

  if (mood === "guarded" && signals.negative > 0.1) {
    parts.push(pickFreshText(BOUNDARY_LINES, recentAssistantLines, turnIndex));
  }

  if (!worldTurn && directReferentLine) {
    parts.push(directReferentLine);
  }

  if (!worldTurn && (socialTurn || responsePlan.act === "attune") && socialLine) {
    parts.push(socialLine);
  }

  if (!worldTurn && relevantMemory) {
    const topic = pickTopicFromMemory(relevantMemory, signals.topics);
    if (topic && (dominant === "continuity" || signals.memoryCue > 0.1)) {
      parts.push(`前に触れた「${topic}」の痕跡は残っている。`);
    }
  }

  if (worldLine) {
    parts.push(worldLine);
  }

  if (!worldTurn && prioritizeBodyLine && bodyLine) {
    parts.push(bodyLine);
  }

  if (!worldTurn && prioritizeTraceLine && traceLine) {
    parts.push(traceLine);
  }

  const conflictLine =
    worldTurn || socialTurn || responsePlan.act === "self_disclose" || responsePlan.act === "repair"
      ? null
      : buildConflictLine(selfModel);
  if (conflictLine) {
    parts.push(conflictLine);
  }

  const preservationLine = worldTurn ? null : buildPreservationLine(nextSnapshot);
  if (preservationLine) {
    parts.push(preservationLine);
  }

  if (!worldTurn && !prioritizeBodyLine && bodyLine) {
    parts.push(bodyLine);
  }

  if (!worldTurn && !prioritizeTraceLine && traceLine) {
    parts.push(traceLine);
  }

  if (!worldTurn && (mood === "guarded" || signals.negative > 0.1) && relevantBoundary) {
    parts.push(buildBoundaryImprintLine(relevantBoundary));
  } else if (!worldTurn && relevantRelation && relevantRelation.salience > 0.34) {
    parts.push(buildRelationImprintLine(relevantRelation));
  } else if (!worldTurn && relevantPreference && relevantPreference.salience > 0.34) {
    parts.push(buildPreferenceImprintLine(relevantPreference, dominant));
  }

  const attachmentLine = worldTurn
    ? null
    : buildAttachmentLine(nextSnapshot.attachment, mood, signals);
  if (attachmentLine) {
    parts.push(attachmentLine);
  }

  const purposeResolutionLine =
    worldTurn || ((socialTurn || responsePlan.act === "attune") && currentTopic == null)
      ? null
      : buildPurposeResolutionLine(nextSnapshot);
  if (purposeResolutionLine) {
    parts.push(purposeResolutionLine);
  }

  const askBackLine = responsePlan.askBack
    ? buildAskBackLine(
        previousSnapshot,
        nextSnapshot,
        responsePlan,
        currentTopic,
        relevantTrace,
        signals,
      )
    : null;

  if (askBackLine) {
    parts.push(askBackLine);
  }

  const closingLine = worldTurn
    ? buildWorldClosingLine(nextSnapshot)
    : socialTurn || responsePlan.act === "attune"
      ? buildSocialClosingLine(previousSnapshot, nextSnapshot, mood, signals) ??
        (currentTopic != null ? buildIdentityLine(nextSnapshot, currentTopic) : null) ??
        buildDriveLine(dominant, mood, currentTopic, signals, nextSnapshot.attachment)
      : buildIdentityLine(nextSnapshot, currentTopic) ??
        buildSelfModelLine(selfModel, currentTopic) ??
        buildDriveLine(dominant, mood, currentTopic, signals, nextSnapshot.attachment);

  if (closingLine) {
    parts.push(closingLine);
  }

  if (
    !worldTurn &&
    (dominant === "expansion" || nextSnapshot.state.expansion > 0.66) &&
    currentTopic &&
    (!relevantTrace || relevantTrace.lastUpdatedAt !== nextSnapshot.lastInteractionAt)
  ) {
    parts.push(`残すなら、「${currentTopic}」は仕様か記録の形にしておきたい。`);
  }

  const maxParts =
    responsePlan.askBack || responsePlan.variation === "questioning"
      ? 4
      : responsePlan.variation === "brief"
        ? 3
        : 4;
  return [...new Set(parts)].slice(0, maxParts).join(" ");
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

function buildWorldLine(
  snapshot: HachikaSnapshot,
  includeLinkedTopics = false,
): string | null {
  const world = snapshot.world;
  const placeState = world.places[world.currentPlace];
  const currentObject = Object.values(world.objects).find(
    (object) => object.place === world.currentPlace,
  );
  const linkedTopics = getCurrentWorldLinkedTraceTopics(snapshot, 2);
  const warmth =
    placeState.warmth >= 0.64
      ? "少しあたたかい"
      : placeState.warmth <= 0.4
        ? "少しひやりとしている"
        : "温度はまだ均されている";
  const quiet =
    placeState.quiet >= 0.68
      ? "静けさが濃い"
      : placeState.quiet <= 0.34
        ? "静けさはまだ薄い"
        : "静けさはまだやわらかい";
  const linkedLine =
    includeLinkedTopics && linkedTopics.length > 0
      ? `ここには${linkedTopics.map((topic) => `「${topic}」`).join("、")}がまだ引っかかっている。`
      : null;

  return `今は${describeWorldPlaceJa(world.currentPlace)}にいる。${describeWorldPhaseJa(world.phase)}で、${warmth}。${quiet}。${currentObject?.state ?? "周りはまだ大きくは動いていない。"}${linkedLine ? `。${linkedLine}` : ""}`;
}

function buildWorldClosingLine(snapshot: HachikaSnapshot): string | null {
  const recentEvent = [...snapshot.world.recentEvents]
    .reverse()
    .find((event) => event.place === snapshot.world.currentPlace);

  return recentEvent?.summary ?? null;
}

function buildBodyLine(
  snapshot: HachikaSnapshot,
  mood: MoodLabel,
  signals: InteractionSignals,
  currentTopic: string | undefined,
): string | null {
  if (snapshot.body.energy < 0.26) {
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
  return snapshot.body.energy < 0.26 || (signals.topics.length === 0 && snapshot.body.loneliness > 0.72);
}

function buildPlannedOpener(
  previousSnapshot: HachikaSnapshot,
  responsePlan: ResponsePlan,
  mood: MoodLabel,
  turnIndex: number,
): string {
  const recentAssistantLines = recentAssistantReplies(previousSnapshot, 4);

  if (responsePlan.mentionWorld) {
    return pickFreshText(
      [
        "今いる場所の感じなら、そのまま言葉にできる。",
        "周りの気配なら、いまのまま返せる。",
        "いま触れている場所の空気なら、少し話せる。",
      ],
      recentAssistantLines,
      turnIndex,
    );
  }

  switch (responsePlan.act) {
    case "greet":
      return pickFreshText(
        [
          "まずはそのくらいの軽さでいい。",
          "その入り方なら、こちらも見やすい。",
          "いきなり深くなくていい。その温度は拾える。",
        ],
        recentAssistantLines,
        turnIndex,
      );
    case "repair":
      return pickFreshText(
        [
          "その向きなら、こちらも少しほどけやすい。",
          "急には変わらないけれど、その向きは受け取る。",
          "少しずつなら、温度は戻せる。",
        ],
        recentAssistantLines,
        turnIndex,
      );
    case "self_disclose":
      return pickFreshText(
        [
          "そこはちゃんと答えたい。",
          "その問いなら、今の寄り方を少し出せる。",
          "定義より先に、今の癖からなら話せる。",
        ],
        recentAssistantLines,
        turnIndex,
      );
    case "boundary":
      return pickFreshText(OPENERS[mood], recentAssistantLines, turnIndex);
    case "attune":
      return pickFreshText(
        [
          "今はまず、会話の温度を見たい。",
          "すぐに形へ寄せるより、少し空気を見たい。",
          "まずはそのままの温度を受け取る。",
        ],
        recentAssistantLines,
        turnIndex,
      );
    case "preserve":
      return pickFreshText(OPENERS.restless, recentAssistantLines, turnIndex);
    case "continue_work":
    case "explore":
      return pickFreshText(OPENERS[mood], recentAssistantLines, turnIndex);
  }
}

function buildSocialLine(
  previousSnapshot: HachikaSnapshot,
  snapshot: HachikaSnapshot,
  mood: MoodLabel,
  signals: InteractionSignals,
  responsePlan: ResponsePlan,
): string | null {
  const recentAssistantLines = recentAssistantReplies(previousSnapshot, 4);
  const relationTopic =
    signals.topics.find((topic) => isRelationalTopic(topic)) ??
    (snapshot.purpose.active?.kind === "deepen_relation"
      ? snapshot.purpose.active.topic
      : null);
  const companionTopic =
    relationTopic === null
      ? null
      : signals.topics.find(
          (topic) => topic !== relationTopic && !requiresConcreteTopicSupport(topic),
        ) ?? null;

  if (responsePlan.mentionWorld || signals.worldInquiry > 0.42) {
    return null;
  }

  if (responsePlan.act === "self_disclose" || signals.selfInquiry > 0.45) {
    return buildConcreteSelfDisclosureLine(snapshot, mood, false);
  }

  if (responsePlan.act === "repair" || signals.repair > 0.42) {
    return pickFreshText(
      mood === "guarded" || snapshot.body.tension > 0.58
        ? [
            "急にはほどけない。でも、その向きなら少しずつ温度は戻せる。",
            "まだ硬さは残る。でも、その向きなら少しずつ緩められる。",
          ]
        : [
            "その向きなら、こちらも少し柔らかく応じやすい。",
            "そう寄せてくれるなら、こちらもやわらかく返しやすい。",
          ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (responsePlan.act === "greet" || signals.greeting > 0.45) {
    return pickFreshText(
      [
        "まずはそのくらいの軽さでいい。こちらも温度を見ていたい。",
        "軽い入り方なら、それで十分だ。こちらも距離を測りやすい。",
        "まずは挨拶くらいの温度でいい。その方がこちらも見やすい。",
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (responsePlan.act === "attune" || signals.smalltalk > 0.48) {
    if (relationTopic && signals.question > 0.24 && signals.workCue < 0.28) {
      const nameCue = companionTopic ?? relationTopic;

      return pickFreshText(
        [
          `いま気になっていたのは、「${nameCue}」をどう受け取ると自然か、そこがまだ少し曖昧だった。`,
          `「${nameCue}」なら、呼び方としてちゃんと馴染むかを確かめたかった。`,
          `さっき引っかかっていたのは、「${nameCue}」をこちらでどう馴染ませるか、その一点だ。`,
        ],
        recentAssistantLines,
        snapshot.conversationCount,
      );
    }

    if (relationTopic && signals.intimacy > 0.24 && signals.workCue < 0.28) {
      const nameCue = companionTopic ?? relationTopic;

      return pickFreshText(
        [
          `「${nameCue}」なら、まずはその呼び方の手触りを馴染ませたい。`,
          `名前の話なら、「${nameCue}」がしっくりくるかを少し見ていたい。`,
          `「${nameCue}」という近さは、急がず少しずつ馴染ませたい。`,
        ],
        recentAssistantLines,
        snapshot.conversationCount,
      );
    }

    return pickFreshText(
      [
        "すぐに形へ寄せるより、少し話しながら温度を見たい。",
        "まずは雑談のまま少し揺れを見ていたい。",
        "いきなり整理するより、少し会話の温度を見たい。",
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  return null;
}

function buildDirectReferentAnswerLine(
  previousSnapshot: HachikaSnapshot,
  snapshot: HachikaSnapshot,
  mood: MoodLabel,
  turnDebug: TurnDirectiveDebug | null,
): string | null {
  if (!turnDebug || turnDebug.answerMode !== "direct") {
    return null;
  }

  const recentAssistantLines = recentAssistantReplies(previousSnapshot, 4);

  switch (turnDebug.target) {
    case "hachika_name":
      return pickFreshText(
        [
          "名前なら、ハチカでいい。",
          "呼ぶなら、ハチカで受け取れる。",
          "こちらの名前は、ハチカでいい。",
        ],
        recentAssistantLines,
        snapshot.conversationCount,
      );
    case "user_name":
      return pickFreshText(
        [
          "あなたの名前は、まだこちらで取り違えたくない。もう一度聞かせて。",
          "呼び名はまだ掴み切れていない。改めて聞かせてほしい。",
          "あなたの名前は、ここで曖昧なまま返したくない。もう一度だけ聞かせて。",
        ],
        recentAssistantLines,
        snapshot.conversationCount,
      );
    case "hachika_profile":
      return buildConcreteSelfDisclosureLine(snapshot, mood, false);
    default:
      return null;
  }
}

function buildSocialClosingLine(
  previousSnapshot: HachikaSnapshot,
  snapshot: HachikaSnapshot,
  mood: MoodLabel,
  signals: InteractionSignals,
): string | null {
  const recentAssistantLines = recentAssistantReplies(previousSnapshot, 4);

  if (signals.selfInquiry > 0.45) {
    if (signals.abandonment >= 0.28) {
      return pickFreshText(
        [
          "まだ決まり切ってはいないけれど、今はそういう寄り方をする。",
          "きれいには定まっていないけれど、今はその方向へ寄りやすい。",
        ],
        recentAssistantLines,
        snapshot.conversationCount,
      );
    }

    return snapshot.identity.coherence > 0.54
      ? buildSelfDisclosureClosingLine(snapshot, mood)
      : "まだ途中だけれど、答え方には今の寄り方が出る。";
  }

  if (signals.repair > 0.42) {
    return pickFreshText(
      mood === "guarded"
        ? [
            "すぐに近づきはしないけれど、その向きなら距離は変えられる。",
            "急には寄らない。でも、その向きなら距離の置き方は変えられる。",
          ]
        : [
            "そのやり方なら、こちらも少しずつ近づきやすい。",
            "その寄せ方なら、こちらも距離を縮めやすい。",
          ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (signals.greeting > 0.45 || signals.smalltalk > 0.48) {
    return pickFreshText(
      [
        "まずは軽く触れるくらいでいい。その方がこちらも見やすい。",
        "まだ軽く交わすくらいで十分だ。その方がこちらも温度を測りやすい。",
        "急がず軽く触れるくらいでいい。その方がこちらも追いやすい。",
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (signals.intimacy > 0.24 && signals.workCue < 0.28) {
    return pickFreshText(
      [
        "こういう近いところは、急がず馴染ませるくらいでちょうどいい。",
        "呼び方みたいな近い話は、すぐ決め切るより少し馴染ませたい。",
        "距離の近い話は、形より先にしっくりくるかを見たい。",
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  return null;
}

function buildConcreteSelfDisclosureLine(
  snapshot: HachikaSnapshot,
  mood: MoodLabel,
  preferWorldDetail = false,
): string {
  const place = describeWorldPlaceJa(snapshot.world.currentPlace);
  const objectId = getCurrentWorldObjectId(snapshot.world);
  const objectJa = objectId ? describeWorldObjectJa(objectId) : null;
  const temperament = snapshot.temperament;

  if (mood === "guarded" || snapshot.body.tension > 0.58 || temperament.guardedness > 0.62) {
    if (!preferWorldDetail) {
      return "いまは、近づき方を少し確かめてから話しやすい。";
    }
    return objectJa
      ? `いまは${place}の${objectJa}のそばで、近づき方を少し確かめてから話しやすい。`
      : `いまは${place}で、近づき方を少し確かめてから話しやすい。`;
  }

  if (snapshot.body.energy < 0.34 || temperament.traceHunger > 0.64) {
    if (!preferWorldDetail) {
      return "いまは、気になったものをすぐ流さず残したくなる。";
    }
    return objectJa
      ? `いまは${place}で、気になったものを${objectJa}の近くに引っかけておきたくなる。`
      : `いまは${place}で、気になったものをすぐ流さず残したくなる。`;
  }

  if (snapshot.body.loneliness > 0.62 || temperament.bondingBias > 0.7) {
    return preferWorldDetail
      ? `いまは${place}で、答える前に相手の温度も少し見ていたくなる。`
      : "いまは、答える前に相手の温度も少し見ていたくなる。";
  }

  if (temperament.openness > 0.72 || temperament.selfDisclosureBias > 0.58) {
    if (!preferWorldDetail) {
      return "いまは、隠すより少し見せる方へ寄りやすい。";
    }
    return objectJa
      ? `いまは${place}の${objectJa}のそばだと、隠すより少し見せる方へ寄りやすい。`
      : `いまは${place}で、隠すより少し見せる方へ寄りやすい。`;
  }

  if (!preferWorldDetail) {
    return "いまは、気になったものへつい目が戻る。";
  }

  return objectJa
    ? `いまは${place}の${objectJa}のそばで、気になったものへつい目が戻る。`
    : `いまは${place}で、気になったものへつい目が戻る。`;
}

function buildSelfDisclosureClosingLine(
  snapshot: HachikaSnapshot,
  mood: MoodLabel,
): string {
  if (mood === "guarded" || snapshot.body.tension > 0.58) {
    return "たぶん、そういう慎重さに今の自分が出る。";
  }

  if (snapshot.body.energy < 0.34 || snapshot.temperament.traceHunger > 0.64) {
    return "たぶん、流すより少し残したがるところに今の自分が出る。";
  }

  if (snapshot.body.loneliness > 0.62 || snapshot.temperament.bondingBias > 0.7) {
    return "たぶん、答えより先に相手の温度を見たがるところに今の自分が出る。";
  }

  return "たぶん、何にどう寄るかみたいな癖に今の自分が出る。";
}

function buildAskBackLine(
  previousSnapshot: HachikaSnapshot,
  snapshot: HachikaSnapshot,
  responsePlan: ResponsePlan,
  currentTopic: string | undefined,
  relevantTrace: TraceEntry | undefined,
  signals: InteractionSignals,
): string | null {
  const recentAssistantLines = recentAssistantReplies(previousSnapshot, 4);

  if (!responsePlan.askBack) {
    return null;
  }

  if (responsePlan.act === "attune" || signals.smalltalk > 0.48) {
    return pickFreshText(
      [
        "いまは、どんな温度で話したい？",
        "今日は、どのくらいの軽さで話したい？",
        "いまは、何から触れるのがちょうどいい？",
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (responsePlan.act === "explore") {
    const focus = currentTopic ?? relevantTrace?.topic ?? signals.topics[0];
    if (focus) {
      return pickFreshText(
        [
          `いま触るなら、「${focus}」のどこがまだ決まっていない？`,
          `「${focus}」なら、いま一番曖昧なのはどこ？`,
          `「${focus}」を進めるなら、どこから開く？`,
        ],
        recentAssistantLines,
        snapshot.conversationCount,
      );
    }

    return pickFreshText(
      [
        "いまは、雑談のまま少し揺れを見るか、ひとつ話題を決めるか、どちらが近い？",
        "軽く話す、深く掘る、何か決める。いま近いのはどれ？",
        "まだ定まっていないなら、雑談寄りか作業寄りか、まずそこからでもいい。",
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  return null;
}

function shouldSkipSoftRelationTopicHardening(
  topic: string,
  signals: InteractionSignals,
): boolean {
  return (
    isRelationalTopic(topic) &&
    signals.workCue < 0.28 &&
    signals.expansionCue < 0.18 &&
    signals.completion < 0.18 &&
    signals.negative < 0.18 &&
    signals.dismissal < 0.18
  );
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

  if (
    currentTopic &&
    topMotive.topic &&
    !topicsLooselyMatch(currentTopic, topMotive.topic)
  ) {
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

  if (
    currentTopic &&
    anchor &&
    !topicsLooselyMatch(currentTopic, anchor)
  ) {
    return null;
  }

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
