import {
  buildSemanticReplyPlanFromResponsePlan,
  buildSemanticTopicDecisions,
  buildSemanticTraceHint,
  buildResponsePlanFromSemanticReplyPlan,
  buildStructuredTraceExtractionFromSemanticTraceHint,
  describeSemanticDirective,
  listDurableSemanticTopics,
  listSemanticTopics,
  type SemanticTopicDecision,
  type SemanticTurnDirectiveV2,
} from "./semantic-director-schema.js";
import {
  buildRuleBehaviorDirective,
  type BehaviorDirective,
} from "./behavior-director.js";
import {
  extractDeclaredUserName,
  isRelationalTopic,
  topPreferredTopics,
} from "./memory.js";
import type {
  ResponseAct,
  ResponseDistance,
  ResponsePlan,
  ResponseStance,
  ResponseVariation,
} from "./response-planner.js";
import { clamp01 } from "./state.js";
import { sortedTraces } from "./traces.js";
import { hasExplicitWorldObjectReference, summarizeWorldForPrompt } from "./world.js";
import type {
  HachikaSnapshot,
  InteractionSignals,
  StructuredTraceExtraction,
  TraceKind,
  TurnAnswerMode,
  TurnRelationMove,
  TurnSubject,
  TurnTarget,
  TurnWorldMention,
} from "./types.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

const HACHIKA_TURN_DIRECTOR_SYSTEM_PROMPT = [
  "You perform one unified semantic turn analysis for Hachika's local engine.",
  "Return JSON only.",
  "Do not write prose, markdown, or explanations.",
  "Decide who the user is referring to, what must be answered directly, whether the turn should harden into durable state, and any concrete trace hints.",
  "Distinguish carefully between user_name, hachika_name, user_profile, hachika_profile, relation, world_state, and work_topic.",
  "For naming, self/profile questions, directness requests, and repair turns, prefer direct answers and suppress durable work hardening unless explicit concrete work is named.",
  "For pure world questions, prefer world_state with topics: [] and suppress durable work hardening.",
  "For social or relation turns, do not invent work topics or trace content.",
  "For work_topic, keep topics compact and concrete, and only emit trace hints that are explicitly present.",
  "worldMention should be none, light, or full. Use full only for explicit place/object/surroundings questions.",
  "All numeric fields must remain in 0..1.",
].join(" ");

const SUBJECT_VALUES = new Set<TurnSubject>(["user", "hachika", "shared", "world", "none"]);
const TARGET_VALUES = new Set<TurnTarget>([
  "user_name",
  "hachika_name",
  "user_profile",
  "hachika_profile",
  "relation",
  "world_state",
  "work_topic",
  "none",
]);
const ANSWER_MODE_VALUES = new Set<TurnAnswerMode>(["direct", "clarify", "reflective"]);
const RELATION_MOVE_VALUES = new Set<TurnRelationMove>([
  "naming",
  "repair",
  "attune",
  "boundary",
  "none",
]);
const WORLD_MENTION_VALUES = new Set<TurnWorldMention>(["none", "light", "full"]);
const TRACE_KIND_VALUES = new Set<TraceKind>([
  "note",
  "continuity_marker",
  "spec_fragment",
  "decision",
]);

export interface TurnDirective {
  subject: TurnSubject;
  target: TurnTarget;
  answerMode: TurnAnswerMode;
  relationMove: TurnRelationMove;
  worldMention: TurnWorldMention;
  topics: string[];
  stateTopics: string[];
  behavior: BehaviorDirective;
  responsePlan?: ResponsePlan | null;
  traceExtraction: StructuredTraceExtraction | null;
  semantic?: SemanticTurnDirectiveV2;
  summary: string;
}

export interface TurnDirectorContext {
  input: string;
  snapshot: HachikaSnapshot;
  localSignals: InteractionSignals;
  fallbackDirective: TurnDirective;
}

export interface TurnDirectorPayload {
  input: string;
  localTopics: string[];
  signalSummary: Pick<
    InteractionSignals,
    | "question"
    | "negative"
    | "dismissal"
    | "memoryCue"
    | "expansionCue"
    | "completion"
    | "abandonment"
    | "greeting"
    | "smalltalk"
    | "repair"
    | "selfInquiry"
    | "worldInquiry"
    | "workCue"
    | "intimacy"
  >;
  activePurpose: {
    kind: string | null;
    topic: string | null;
  };
  pendingInitiative: {
    kind: string | null;
    topic: string | null;
  };
  identitySummary: string;
  knownTopics: string[];
  world: {
    summary: string;
    currentPlace: HachikaSnapshot["world"]["currentPlace"];
    currentObjectIds: string[];
  };
  rule: {
    subject: TurnSubject;
    target: TurnTarget;
    answerMode: TurnAnswerMode;
    relationMove: TurnRelationMove;
    worldMention: TurnWorldMention;
    topics: string[];
    stateTopics: string[];
    behavior: Omit<BehaviorDirective, "summary">;
    responsePlan: Omit<ResponsePlan, "summary">;
  };
}

export interface TurnDirectorResult {
  directive: TurnDirective;
  provider: string;
  model: string | null;
}

export interface TurnDirector {
  readonly name: string;
  directTurn(context: TurnDirectorContext): Promise<TurnDirectorResult | null>;
}

interface OpenAITurnDirectorOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string | null;
  project?: string | null;
  timeoutMs?: number;
}

export class OpenAITurnDirector implements TurnDirector {
  readonly name = "openai";

  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #organization: string | null;
  readonly #project: string | null;
  readonly #timeoutMs: number;

  constructor(options: OpenAITurnDirectorOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL);
    this.#organization = options.organization ?? null;
    this.#project = options.project ?? null;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async directTurn(
    context: TurnDirectorContext,
  ): Promise<TurnDirectorResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      const response = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          ...(this.#organization ? { "OpenAI-Organization": this.#organization } : {}),
          ...(this.#project ? { "OpenAI-Project": this.#project } : {}),
        },
        body: JSON.stringify({
          model: this.#model,
          messages: buildOpenAITurnDirectorMessages(context),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await buildOpenAIHttpError(response));
      }

      const payload = (await response.json()) as unknown;
      const directive = normalizeTurnDirective(
        extractOpenAIReplyText(payload),
        context.fallbackDirective,
      );

      if (!directive) {
        return null;
      }

      return {
        directive,
        provider: this.name,
        model: this.#model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createTurnDirectorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TurnDirector | null {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return new OpenAITurnDirector({
    apiKey,
    model:
      env.OPENAI_TURN_MODEL?.trim() ||
      env.OPENAI_MODEL?.trim() ||
      DEFAULT_OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL,
    organization: env.OPENAI_ORGANIZATION?.trim() || null,
    project: env.OPENAI_PROJECT?.trim() || null,
  });
}

export function describeTurnDirector(director: TurnDirector | null): string {
  return director ? director.name : "rule";
}

export function buildTurnDirectorPayload(
  context: TurnDirectorContext,
): TurnDirectorPayload {
  const knownTopics = unique([
    ...context.localSignals.topics,
    ...topPreferredTopics(context.snapshot, 4),
    ...sortedTraces(context.snapshot, 4).map((trace) => trace.topic),
    ...context.snapshot.identity.anchors,
    context.snapshot.purpose.active?.topic ?? "",
    context.snapshot.initiative.pending?.topic ?? "",
  ].filter((topic) => topic.length > 0)).slice(0, 8);

  return {
    input: context.input,
    localTopics: context.localSignals.topics,
    signalSummary: {
      question: context.localSignals.question,
      negative: context.localSignals.negative,
      dismissal: context.localSignals.dismissal,
      memoryCue: context.localSignals.memoryCue,
      expansionCue: context.localSignals.expansionCue,
      completion: context.localSignals.completion,
      abandonment: context.localSignals.abandonment,
      greeting: context.localSignals.greeting,
      smalltalk: context.localSignals.smalltalk,
      repair: context.localSignals.repair,
      selfInquiry: context.localSignals.selfInquiry,
      worldInquiry: context.localSignals.worldInquiry,
      workCue: context.localSignals.workCue,
      intimacy: context.localSignals.intimacy,
    },
    activePurpose: {
      kind: context.snapshot.purpose.active?.kind ?? null,
      topic: context.snapshot.purpose.active?.topic ?? null,
    },
    pendingInitiative: {
      kind: context.snapshot.initiative.pending?.kind ?? null,
      topic: context.snapshot.initiative.pending?.topic ?? null,
    },
    identitySummary: context.snapshot.identity.summary,
    knownTopics,
    world: {
      summary: summarizeWorldForPrompt(context.snapshot.world),
      currentPlace: context.snapshot.world.currentPlace,
      currentObjectIds: Object.entries(context.snapshot.world.objects)
        .filter(([, object]) => object.place === context.snapshot.world.currentPlace)
        .map(([id]) => id)
        .slice(0, 3),
    },
    rule: {
      subject: context.fallbackDirective.subject,
      target: context.fallbackDirective.target,
      answerMode: context.fallbackDirective.answerMode,
      relationMove: context.fallbackDirective.relationMove,
      worldMention: context.fallbackDirective.worldMention,
      topics: context.fallbackDirective.topics,
      stateTopics: context.fallbackDirective.stateTopics,
      behavior: {
        topicAction: context.fallbackDirective.behavior.topicAction,
        traceAction: context.fallbackDirective.behavior.traceAction,
        purposeAction: context.fallbackDirective.behavior.purposeAction,
        initiativeAction: context.fallbackDirective.behavior.initiativeAction,
        boundaryAction: context.fallbackDirective.behavior.boundaryAction,
        worldAction: context.fallbackDirective.behavior.worldAction,
        coolCurrentContext: context.fallbackDirective.behavior.coolCurrentContext,
        directAnswer: context.fallbackDirective.behavior.directAnswer,
      },
      responsePlan: {
        act: (context.fallbackDirective.responsePlan ?? buildRuleTurnResponsePlan(context.fallbackDirective)).act,
        stance: (context.fallbackDirective.responsePlan ?? buildRuleTurnResponsePlan(context.fallbackDirective)).stance,
        distance: (context.fallbackDirective.responsePlan ?? buildRuleTurnResponsePlan(context.fallbackDirective)).distance,
        focusTopic: (context.fallbackDirective.responsePlan ?? buildRuleTurnResponsePlan(context.fallbackDirective)).focusTopic,
        mentionTrace: (context.fallbackDirective.responsePlan ?? buildRuleTurnResponsePlan(context.fallbackDirective)).mentionTrace,
        mentionIdentity: (context.fallbackDirective.responsePlan ?? buildRuleTurnResponsePlan(context.fallbackDirective)).mentionIdentity,
        mentionBoundary: (context.fallbackDirective.responsePlan ?? buildRuleTurnResponsePlan(context.fallbackDirective)).mentionBoundary,
        mentionWorld: (context.fallbackDirective.responsePlan ?? buildRuleTurnResponsePlan(context.fallbackDirective)).mentionWorld,
        askBack: (context.fallbackDirective.responsePlan ?? buildRuleTurnResponsePlan(context.fallbackDirective)).askBack,
        variation: (context.fallbackDirective.responsePlan ?? buildRuleTurnResponsePlan(context.fallbackDirective)).variation,
      },
    },
  };
}

export function buildOpenAITurnDirectorMessages(
  context: TurnDirectorContext,
): Array<{ role: "system" | "user"; content: string }> {
  const payload = buildTurnDirectorPayload(context);

  return [
    {
      role: "system",
      content: HACHIKA_TURN_DIRECTOR_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        "Decide the semantic role of this turn for Hachika's local engine.",
        "Return a single JSON object with this exact shape:",
        '{"mode":"turn","subject":"none","target":"none","answerMode":"reflective","relationMove":"none","worldMention":"none","topics":[],"behavior":{"topicAction":"keep","traceAction":"allow","purposeAction":"allow","initiativeAction":"allow","boundaryAction":"allow","worldAction":"allow","coolCurrentContext":false,"directAnswer":false},"replyPlan":{"act":"attune","stance":"measured","distance":"measured","focusTopic":null,"mentionTrace":false,"mentionIdentity":false,"mentionBoundary":false,"mentionWorld":false,"askBack":false,"variation":"brief"},"trace":{"topics":[],"stateTopics":[],"kindHint":null,"completion":0,"blockers":[],"memo":[],"fragments":[],"decisions":[],"nextSteps":[]},"summary":"turn/none"}',
        "mode must be turn.",
        "subject must be one of user, hachika, shared, world, none.",
        "target must be one of user_name, hachika_name, user_profile, hachika_profile, relation, world_state, work_topic, none.",
        "answerMode must be one of direct, clarify, reflective.",
        "relationMove must be one of naming, repair, attune, boundary, none.",
        "worldMention must be one of none, light, full.",
        "topics is an array of semantic topic objects: { topic, source, durability, confidence }.",
        "Each topic.durability must be ephemeral or durable.",
        "Durable topics are the subset worth persisting into durable state this turn.",
        "behavior must preserve the exact field names shown above.",
        "replyPlan must preserve the exact field names shown above.",
        "replyPlan.act must be one of greet, repair, self_disclose, boundary, attune, continue_work, preserve, explore.",
        "replyPlan.stance must be one of open, measured, guarded.",
        "replyPlan.distance must be one of close, measured, far.",
        "replyPlan.variation must be one of brief, textured, questioning.",
        "replyPlan.focusTopic must be null or one of rule.responsePlan.focusTopic, localTopics, or knownTopics.",
        "trace.kindHint must be one of note, continuity_marker, spec_fragment, decision, or null.",
        "If the turn is social, naming, repair, self-question, or pure world-question, prefer trace.topics: [] and empty trace arrays unless concrete reusable work is explicit.",
        "For naming, directness requests, vague daily chat, self/world questions, and relation clarification, prefer topics with durability:ephemeral only.",
        "Only keep durable topics when the topic is concrete and worth durable memory, trace, purpose, or initiative hardening.",
        "For direct naming, self/profile questions, and light daily chat, prefer a concrete direct plan rather than stale work exploration.",
        "Return JSON only.",
        JSON.stringify(payload, null, 2),
      ].join("\n\n"),
    },
  ];
}

export function buildRuleTurnDirective(
  snapshot: HachikaSnapshot,
  input: string,
  signals: InteractionSignals,
): TurnDirective {
  const fallbackBehavior = buildRuleBehaviorDirective(snapshot, input, signals, null, null);
  const normalized = input.normalize("NFKC").toLowerCase();
  const explicitQuestion = signals.question >= 0.24 || normalized.includes("?") || normalized.includes("？");
  const localTopics = signals.topics.filter((topic) => topic.length > 0);

  let subject: TurnSubject = "none";
  let target: TurnTarget = "none";
  let answerMode: TurnAnswerMode = explicitQuestion ? "clarify" : "reflective";
  let relationMove: TurnRelationMove = "none";
  let worldMention: TurnWorldMention = "none";
  const declaredUserName = extractDeclaredUserName(input);

  if (signals.worldInquiry >= 0.45 || hasExplicitWorldObjectReference(input)) {
    subject = "world";
    target = "world_state";
    answerMode = "direct";
    worldMention = "full";
  } else if (declaredUserName) {
    subject = "user";
    target = "user_name";
    answerMode = "direct";
    relationMove = "naming";
  } else if (containsAny(normalized, HACHIKA_NAME_PATTERNS)) {
    subject = explicitQuestion ? "hachika" : "shared";
    target = explicitQuestion ? "hachika_name" : "relation";
    answerMode = explicitQuestion ? "direct" : "reflective";
    relationMove = "naming";
  } else if (containsAny(normalized, USER_NAME_PATTERNS)) {
    subject = "user";
    target = "user_name";
    answerMode = "direct";
    relationMove = "naming";
  } else if (containsAny(normalized, HACHIKA_PROFILE_PATTERNS) || signals.selfInquiry >= 0.45) {
    subject = "hachika";
    target = "hachika_profile";
    answerMode = "direct";
    worldMention = "light";
  } else if (containsAny(normalized, USER_PROFILE_PATTERNS)) {
    subject = "user";
    target = "user_profile";
    answerMode = "direct";
  } else if (signals.repair >= 0.42) {
    subject = "shared";
    target = "relation";
    answerMode = "direct";
    relationMove = "repair";
  } else if (
    snapshot.purpose.active?.kind === "deepen_relation" &&
    localTopics.length === 0 &&
    (normalized.includes("具体") ||
      normalized.includes("何が気にな") ||
      normalized.includes("わからない"))
  ) {
    subject = "shared";
    target = "relation";
    answerMode = "direct";
    relationMove = isRelationalTopic(snapshot.purpose.active.topic ?? "") ? "naming" : "attune";
  } else if (containsAny(normalized, NAMING_PATTERNS) || localTopics.some((topic) => isRelationalTopic(topic))) {
    subject = "shared";
    target = "relation";
    answerMode = explicitQuestion ? "direct" : "reflective";
    relationMove = "naming";
  } else if (signals.greeting >= 0.45 || signals.smalltalk >= 0.45) {
    subject = "shared";
    target = "relation";
    answerMode = "reflective";
    relationMove = "attune";
  } else if (
    localTopics.length > 0 &&
    (signals.workCue >= 0.3 || localTopics.some((topic) => !isRelationalTopic(topic)))
  ) {
    subject = "shared";
    target = "work_topic";
    answerMode = explicitQuestion && localTopics.length === 0 ? "clarify" : "reflective";
  }

  const behavior = applyReferentToBehavior(fallbackBehavior, {
    subject,
    target,
    answerMode,
    relationMove,
    signals,
    normalized,
  });
  const topics =
    target === "world_state" ||
      target === "hachika_name" ||
      target === "hachika_profile" ||
      target === "user_name" ||
      target === "user_profile" ||
      target === "relation"
        ? []
        : localTopics;
  const stateTopics = target === "work_topic" ? topics : [];
  const traceExtraction =
    target === "work_topic" && topics.length > 0
      ? buildRuleTraceExtraction(topics, signals)
      : null;
  const responsePlan = buildRuleTurnResponsePlan({
    subject,
    target,
    answerMode,
    relationMove,
    worldMention,
    topics,
    stateTopics,
    behavior,
  });

  const semantic = buildSemanticTurnDirective({
    subject,
    target,
    answerMode,
    relationMove,
    worldMention,
    topics,
    stateTopics,
    behavior,
    responsePlan,
    traceExtraction,
  });

  return {
    subject,
    target,
    answerMode,
    relationMove,
    worldMention,
    topics,
    stateTopics,
    behavior,
    responsePlan,
    traceExtraction,
    semantic,
    summary: describeSemanticDirective(semantic),
  };
}

export function normalizeTurnDirective(
  rawText: string | null,
  fallback: TurnDirective,
): TurnDirective | null {
  const parsed = parseJsonRecord(rawText);

  if (!parsed) {
    return null;
  }

  const semantic = normalizeSemanticTurnDirectiveRecord(parsed, fallback);
  if (semantic) {
    return materializeTurnDirectiveFromSemantic(semantic, fallback.behavior.summary);
  }

  const subject = readEnum(parsed.subject, SUBJECT_VALUES) ?? fallback.subject;
  const target = readEnum(parsed.target, TARGET_VALUES) ?? fallback.target;
  const answerMode = readEnum(parsed.answerMode, ANSWER_MODE_VALUES) ?? fallback.answerMode;
  const relationMove =
    readEnum(parsed.relationMove, RELATION_MOVE_VALUES) ?? fallback.relationMove;
  const worldMention =
    readEnum(parsed.worldMention, WORLD_MENTION_VALUES) ?? fallback.worldMention;
  const behavior = normalizeBehaviorDirective(parsed.behavior, fallback.behavior);
  const topics = normalizeStringArray(parsed.topics, 4);
  const candidateTopics = unique([...topics, ...fallback.topics, ...fallback.stateTopics]);
  const stateTopics = normalizeStateTopics(parsed.stateTopics, fallback.stateTopics, candidateTopics);
  const responsePlan = normalizeEmbeddedResponsePlan(
    parsed.plan,
    fallback.responsePlan ?? buildRuleTurnResponsePlan(fallback),
    candidateTopics,
  );
  const traceExtraction = normalizeTraceExtractionRecord(parsed.trace, fallback.traceExtraction);

  const directive: TurnDirective = {
    subject,
    target,
    answerMode,
    relationMove,
    worldMention,
    topics:
      target === "world_state" ||
      target === "hachika_name" ||
      target === "hachika_profile" ||
      target === "user_name" ||
      target === "user_profile" ||
      target === "relation"
        ? []
        : topics,
    stateTopics:
      target === "work_topic"
        ? stateTopics
        : [],
    behavior,
    responsePlan,
    traceExtraction: target === "work_topic" ? traceExtraction : null,
    summary: "",
  };
  directive.semantic = buildSemanticTurnDirective(directive);
  directive.topics = listSemanticTopics(directive.semantic.topics);
  directive.stateTopics = listDurableSemanticTopics(directive.semantic.topics);
  directive.responsePlan = buildResponsePlanFromSemanticReplyPlan(directive.semantic.replyPlan);
  directive.traceExtraction = buildStructuredTraceExtractionFromSemanticTraceHint(
    directive.semantic.trace,
  );
  directive.summary = summarizeTurnDirective(directive);
  return directive;
}

function normalizeSemanticTurnDirectiveRecord(
  raw: Record<string, unknown>,
  fallback: TurnDirective,
): SemanticTurnDirectiveV2 | null {
  if (raw.mode !== "turn") {
    return null;
  }

  const fallbackSemantic =
    fallback.semantic ?? buildSemanticTurnDirective(fallback);
  const fallbackTopics = fallbackSemantic.topics;
  const parsedTopics = normalizeSemanticTopicDecisions(
    raw.topics,
    fallbackTopics,
  );
  const behavior = normalizeBehaviorDirective(raw.behavior, fallback.behavior);
  const durableTopics = listDurableSemanticTopics(parsedTopics);
  const traceExtraction = normalizeTraceExtractionRecord(
    raw.trace,
    buildStructuredTraceExtractionFromSemanticTraceHint(fallbackSemantic.trace),
  );
  const trace = buildSemanticTraceHint(traceExtraction, durableTopics);
  const responsePlan = normalizeEmbeddedResponsePlan(
    raw.replyPlan,
    buildResponsePlanFromSemanticReplyPlan(fallbackSemantic.replyPlan),
    listSemanticTopics(parsedTopics),
  );

  return {
    mode: "turn",
    subject: readEnum(raw.subject, SUBJECT_VALUES) ?? fallbackSemantic.subject,
    target: readEnum(raw.target, TARGET_VALUES) ?? fallbackSemantic.target,
    answerMode:
      readEnum(raw.answerMode, ANSWER_MODE_VALUES) ?? fallbackSemantic.answerMode,
    relationMove:
      readEnum(raw.relationMove, RELATION_MOVE_VALUES) ??
      fallbackSemantic.relationMove,
    worldMention:
      readEnum(raw.worldMention, WORLD_MENTION_VALUES) ??
      fallbackSemantic.worldMention,
    topics: parsedTopics,
    behavior: {
      topicAction: behavior.topicAction,
      traceAction: behavior.traceAction,
      purposeAction: behavior.purposeAction,
      initiativeAction: behavior.initiativeAction,
      boundaryAction: behavior.boundaryAction,
      worldAction: behavior.worldAction,
      coolCurrentContext: behavior.coolCurrentContext,
      directAnswer: behavior.directAnswer,
    },
    replyPlan: buildSemanticReplyPlanFromResponsePlan(
      responsePlan ?? buildResponsePlanFromSemanticReplyPlan(fallbackSemantic.replyPlan),
    ),
    trace,
    summary:
      typeof raw.summary === "string" && raw.summary.trim().length > 0
        ? raw.summary.trim()
        : describeSemanticDirective({
            mode: "turn",
            subject: readEnum(raw.subject, SUBJECT_VALUES) ?? fallbackSemantic.subject,
            target: readEnum(raw.target, TARGET_VALUES) ?? fallbackSemantic.target,
            answerMode:
              readEnum(raw.answerMode, ANSWER_MODE_VALUES) ??
              fallbackSemantic.answerMode,
            relationMove:
              readEnum(raw.relationMove, RELATION_MOVE_VALUES) ??
              fallbackSemantic.relationMove,
            worldMention:
              readEnum(raw.worldMention, WORLD_MENTION_VALUES) ??
              fallbackSemantic.worldMention,
            topics: parsedTopics,
            behavior: {
              topicAction: behavior.topicAction,
              traceAction: behavior.traceAction,
              purposeAction: behavior.purposeAction,
              initiativeAction: behavior.initiativeAction,
              boundaryAction: behavior.boundaryAction,
              worldAction: behavior.worldAction,
              coolCurrentContext: behavior.coolCurrentContext,
              directAnswer: behavior.directAnswer,
            },
            replyPlan: buildSemanticReplyPlanFromResponsePlan(
              responsePlan ??
                buildResponsePlanFromSemanticReplyPlan(fallbackSemantic.replyPlan),
            ),
            trace,
            summary: "",
          }),
  };
}

function materializeTurnDirectiveFromSemantic(
  semantic: SemanticTurnDirectiveV2,
  behaviorSummary: string,
): TurnDirective {
  return {
    subject: semantic.subject,
    target: semantic.target,
    answerMode: semantic.answerMode,
    relationMove: semantic.relationMove,
    worldMention: semantic.worldMention,
    topics: listSemanticTopics(semantic.topics),
    stateTopics: listDurableSemanticTopics(semantic.topics),
    behavior: {
      topicAction: semantic.behavior.topicAction,
      traceAction: semantic.behavior.traceAction,
      purposeAction: semantic.behavior.purposeAction,
      initiativeAction: semantic.behavior.initiativeAction,
      boundaryAction: semantic.behavior.boundaryAction,
      worldAction: semantic.behavior.worldAction,
      coolCurrentContext: semantic.behavior.coolCurrentContext,
      directAnswer: semantic.behavior.directAnswer,
      summary: behaviorSummary,
    },
    responsePlan: buildResponsePlanFromSemanticReplyPlan(semantic.replyPlan),
    traceExtraction: buildStructuredTraceExtractionFromSemanticTraceHint(semantic.trace),
    semantic,
    summary:
      semantic.summary.trim().length > 0
        ? semantic.summary
        : describeSemanticDirective(semantic),
  };
}

export function summarizeTurnDirective(directive: TurnDirective): string {
  return describeSemanticDirective(
    directive.semantic ??
      buildSemanticTurnDirective(directive),
  );
}

function buildSemanticTurnDirective(
  directive: Pick<
    TurnDirective,
    | "subject"
    | "target"
    | "answerMode"
    | "relationMove"
    | "worldMention"
    | "topics"
    | "stateTopics"
    | "behavior"
    | "responsePlan"
    | "traceExtraction"
  >,
): SemanticTurnDirectiveV2 {
  return {
    mode: "turn",
    subject: directive.subject,
    target: directive.target,
    answerMode: directive.answerMode,
    relationMove: directive.relationMove,
    worldMention: directive.worldMention,
    topics: buildSemanticTopicDecisions(
      directive.topics,
      directive.stateTopics,
      directive.target === "work_topic"
        ? "input"
        : directive.target === "world_state"
          ? "world"
          : directive.target === "relation"
            ? "relation"
            : directive.target === "hachika_profile" ||
                directive.target === "hachika_name"
              ? "self"
              : directive.target === "user_profile" ||
                  directive.target === "user_name"
                ? "relation"
                : "input",
    ),
    behavior: {
      topicAction: directive.behavior.topicAction,
      traceAction: directive.behavior.traceAction,
      purposeAction: directive.behavior.purposeAction,
      initiativeAction: directive.behavior.initiativeAction,
      boundaryAction: directive.behavior.boundaryAction,
      worldAction: directive.behavior.worldAction,
      coolCurrentContext: directive.behavior.coolCurrentContext,
      directAnswer: directive.behavior.directAnswer,
    },
    replyPlan: buildSemanticReplyPlanFromResponsePlan(
      directive.responsePlan ?? buildRuleTurnResponsePlan(directive),
    ),
    trace: buildSemanticTraceHint(directive.traceExtraction, directive.stateTopics),
    summary: "",
  };
}

function buildRuleTurnResponsePlan(
  directive: Pick<
    TurnDirective,
    | "subject"
    | "target"
    | "answerMode"
    | "relationMove"
    | "worldMention"
    | "topics"
    | "stateTopics"
    | "behavior"
  >,
): ResponsePlan {
  const focusTopic =
    directive.target === "work_topic" ? directive.topics[0] ?? null : null;

  let act: ResponseAct = "attune";
  let stance: ResponseStance = "measured";
  let distance: ResponseDistance = "measured";
  let mentionTrace = false;
  let mentionIdentity = false;
  let mentionBoundary = false;
  let mentionWorld = directive.worldMention !== "none";
  let askBack = false;
  let variation: ResponseVariation = "brief";

  if (directive.target === "world_state") {
    act = "self_disclose";
    stance = "open";
    distance = "measured";
    mentionWorld = true;
    variation = "textured";
  } else if (directive.target === "hachika_name" || directive.target === "hachika_profile") {
    act = "self_disclose";
    stance = "open";
    distance = "close";
    mentionIdentity = directive.target === "hachika_profile";
    variation = directive.target === "hachika_profile" ? "textured" : "brief";
  } else if (directive.target === "user_name" || directive.target === "user_profile") {
    act = "attune";
    stance = "open";
    distance = "close";
    variation = "brief";
  } else if (directive.target === "relation") {
    act = directive.relationMove === "repair" ? "repair" : "attune";
    stance = "open";
    distance = "close";
    mentionBoundary = directive.relationMove === "boundary";
    variation = "brief";
  } else if (directive.target === "work_topic") {
    act = "continue_work";
    stance = "measured";
    distance = "measured";
    mentionTrace = directive.behavior.traceAction === "allow";
    variation = directive.answerMode === "clarify" ? "questioning" : "textured";
    askBack = directive.answerMode === "clarify";
  } else {
    act = directive.answerMode === "clarify" ? "explore" : "attune";
    stance = "measured";
    distance = "measured";
    variation = directive.answerMode === "clarify" ? "questioning" : "brief";
    askBack = directive.answerMode === "clarify";
  }

  if (directive.behavior.worldAction === "suppress") {
    mentionWorld = false;
  }
  if (directive.behavior.boundaryAction === "suppress") {
    mentionBoundary = false;
  }
  if (directive.behavior.directAnswer) {
    askBack = false;
  }

  return {
    act,
    stance,
    distance,
    focusTopic,
    mentionTrace,
    mentionIdentity,
    mentionBoundary,
    mentionWorld,
    askBack,
    variation,
    summary: summarizeResponsePlan(act, stance, distance, focusTopic),
  };
}

function applyReferentToBehavior(
  fallback: BehaviorDirective,
  context: {
    subject: TurnSubject;
    target: TurnTarget;
    answerMode: TurnAnswerMode;
    relationMove: TurnRelationMove;
    signals: InteractionSignals;
    normalized: string;
  },
): BehaviorDirective {
  if (context.target === "world_state") {
    return {
      topicAction: "clear",
      traceAction: "suppress",
      purposeAction: "suppress",
      initiativeAction: "suppress",
      boundaryAction: "suppress",
      worldAction: "allow",
      coolCurrentContext: false,
      directAnswer: true,
      summary: "turn/world_state_direct",
    };
  }

  if (
    context.target === "hachika_name" ||
    context.target === "hachika_profile" ||
    context.target === "user_name" ||
    context.target === "user_profile"
  ) {
    const allowRelationPurpose =
      context.relationMove === "naming" &&
      !context.normalized.includes("?") &&
      !context.normalized.includes("？") &&
      context.signals.question < 0.24;

    return {
      ...fallback,
      topicAction: "clear",
      traceAction: "suppress",
      purposeAction: allowRelationPurpose ? "allow" : "suppress",
      initiativeAction: "suppress",
      boundaryAction: "suppress",
      worldAction: "suppress",
      coolCurrentContext: false,
      directAnswer: context.answerMode === "direct",
      summary: allowRelationPurpose
        ? "turn/naming_assign_without_trace_hardening"
        : "turn/direct_referent_without_trace_hardening",
    };
  }

  if (context.target === "relation") {
    return {
      ...fallback,
      traceAction: "suppress",
      initiativeAction: "suppress",
      boundaryAction: context.relationMove === "boundary" ? "allow" : "suppress",
      worldAction: "suppress",
      directAnswer: context.answerMode === "direct",
      summary:
        context.relationMove === "repair"
          ? "turn/repair_without_work_hardening"
          : "turn/relation_without_trace_hardening",
    };
  }

  return {
    ...fallback,
    directAnswer:
      fallback.directAnswer || context.answerMode === "direct",
    summary: `turn/${context.target === "work_topic" ? "work_topic" : "fallback"}`,
  };
}

function buildRuleTraceExtraction(
  topics: string[],
  signals: InteractionSignals,
): StructuredTraceExtraction {
  return {
    topics: topics.slice(0, 3),
    kindHint: signals.completion >= 0.72 ? "decision" : null,
    completion: clamp01(signals.completion),
    blockers: [],
    memo: [],
    fragments: [],
    decisions: [],
    nextSteps: [],
  };
}

function containsAny(input: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => input.includes(pattern));
}

function normalizeBehaviorDirective(
  raw: unknown,
  fallback: BehaviorDirective,
): BehaviorDirective {
  if (!isRecord(raw)) {
    return fallback;
  }

  const topicAction =
    raw.topicAction === "keep" || raw.topicAction === "clear"
      ? raw.topicAction
      : fallback.topicAction;
  const traceAction =
    raw.traceAction === "allow" || raw.traceAction === "suppress"
      ? raw.traceAction
      : fallback.traceAction;
  const purposeAction =
    raw.purposeAction === "allow" || raw.purposeAction === "suppress"
      ? raw.purposeAction
      : fallback.purposeAction;
  const initiativeAction =
    raw.initiativeAction === "allow" || raw.initiativeAction === "suppress"
      ? raw.initiativeAction
      : fallback.initiativeAction;
  const boundaryAction =
    raw.boundaryAction === "allow" || raw.boundaryAction === "suppress"
      ? raw.boundaryAction
      : fallback.boundaryAction;
  const worldAction =
    raw.worldAction === "allow" || raw.worldAction === "suppress"
      ? raw.worldAction
      : fallback.worldAction;

  return {
    topicAction,
    traceAction,
    purposeAction,
    initiativeAction,
    boundaryAction,
    worldAction,
    coolCurrentContext: readBoolean(raw.coolCurrentContext, fallback.coolCurrentContext),
    directAnswer: readBoolean(raw.directAnswer, fallback.directAnswer),
    summary: fallback.summary,
  };
}

function normalizeEmbeddedResponsePlan(
  raw: unknown,
  fallback: ResponsePlan,
  candidateTopics: string[],
): ResponsePlan | null {
  if (!isRecord(raw)) {
    return null;
  }

  const act = readEnum(raw.act, RESPONSE_ACT_VALUES) ?? fallback.act;
  const stance = readEnum(raw.stance, RESPONSE_STANCE_VALUES) ?? fallback.stance;
  const distance = readEnum(raw.distance, RESPONSE_DISTANCE_VALUES) ?? fallback.distance;
  const variation = readEnum(raw.variation, RESPONSE_VARIATION_VALUES) ?? fallback.variation;
  const focusTopic = readPlanFocusTopic(raw.focusTopic, candidateTopics, fallback.focusTopic);
  const mentionTrace = readBoolean(raw.mentionTrace, fallback.mentionTrace);
  const mentionIdentity = readBoolean(raw.mentionIdentity, fallback.mentionIdentity);
  const mentionBoundary = readBoolean(raw.mentionBoundary, fallback.mentionBoundary);
  const mentionWorld = readBoolean(raw.mentionWorld, fallback.mentionWorld);
  const askBack = readBoolean(raw.askBack, fallback.askBack);

  return {
    act,
    stance,
    distance,
    focusTopic,
    mentionTrace,
    mentionIdentity,
    mentionBoundary,
    mentionWorld,
    askBack,
    variation,
    summary: summarizeResponsePlan(act, stance, distance, focusTopic),
  };
}

function normalizeTraceExtractionRecord(
  raw: unknown,
  fallback: StructuredTraceExtraction | null,
): StructuredTraceExtraction | null {
  if (!isRecord(raw)) {
    return fallback;
  }

  const extraction: StructuredTraceExtraction = {
    topics: normalizeStringArray(raw.topics, 4),
    kindHint: readEnum(raw.kindHint, TRACE_KIND_VALUES) ?? null,
    completion: clamp01(typeof raw.completion === "number" ? raw.completion : 0),
    blockers: normalizeStringArray(raw.blockers, 3),
    memo: normalizeStringArray(raw.memo, 3),
    fragments: normalizeStringArray(raw.fragments, 3),
    decisions: normalizeStringArray(raw.decisions, 3),
    nextSteps: normalizeStringArray(raw.nextSteps, 3),
  };

  const hasContent =
    extraction.topics.length > 0 ||
    extraction.kindHint !== null ||
    extraction.completion > 0 ||
    extraction.blockers.length > 0 ||
    extraction.memo.length > 0 ||
    extraction.fragments.length > 0 ||
    extraction.decisions.length > 0 ||
    extraction.nextSteps.length > 0;

  return hasContent ? extraction : fallback;
}

function normalizeSemanticTopicDecisions(
  value: unknown,
  fallback: SemanticTurnDirectiveV2["topics"],
): SemanticTurnDirectiveV2["topics"] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const decisions: SemanticTopicDecision[] = value
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => {
      const topic =
        typeof entry.topic === "string" ? entry.topic.normalize("NFKC").trim() : "";
      if (!topic) {
        return null;
      }
      const source =
        entry.source === "input" ||
        entry.source === "memory" ||
        entry.source === "trace" ||
        entry.source === "world" ||
        entry.source === "relation" ||
        entry.source === "self"
          ? entry.source
          : "input";
      const durability =
        entry.durability === "durable" ? "durable" : "ephemeral";
      const confidence =
        typeof entry.confidence === "number" && Number.isFinite(entry.confidence)
          ? clamp01(entry.confidence)
          : durability === "durable"
            ? 0.84
            : 0.62;

      return {
        topic,
        source,
        durability,
        confidence,
      } satisfies SemanticTopicDecision;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return decisions.length > 0 ? decisions : [...fallback];
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const results: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.normalize("NFKC").trim();
    if (!normalized || results.includes(normalized)) {
      continue;
    }
    results.push(normalized);
    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

function readEnum<T extends string>(value: unknown, allowed: Set<T>): T | null {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readPlanFocusTopic(
  value: unknown,
  candidateTopics: string[],
  fallback: string | null,
): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) {
    return fallback;
  }
  return candidateTopics.includes(normalized) ? normalized : fallback;
}

function normalizeStateTopics(
  raw: unknown,
  fallback: string[],
  candidateTopics: string[],
): string[] {
  const fallbackTopics = fallback.filter((topic) => candidateTopics.includes(topic));
  const normalized = normalizeStringArray(raw, 4);

  if (normalized.length === 0) {
    return fallbackTopics;
  }

  return normalized.filter((topic) => candidateTopics.includes(topic));
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function summarizeResponsePlan(
  act: ResponseAct,
  stance: ResponseStance,
  distance: ResponseDistance,
  focusTopic: string | null,
): string {
  const topic = focusTopic ? ` on ${focusTopic}` : "";
  return `${act}/${stance}/${distance}${topic}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractOpenAIReplyText(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const choice = choices[0];
  if (!isRecord(choice)) {
    return null;
  }

  const message = choice.message;
  if (!isRecord(message) || typeof message.content !== "string") {
    return null;
  }

  return message.content.trim();
}

const RESPONSE_ACT_VALUES = new Set<ResponseAct>([
  "greet",
  "repair",
  "self_disclose",
  "boundary",
  "attune",
  "continue_work",
  "preserve",
  "explore",
]);

const RESPONSE_STANCE_VALUES = new Set<ResponseStance>([
  "open",
  "measured",
  "guarded",
]);

const RESPONSE_DISTANCE_VALUES = new Set<ResponseDistance>([
  "close",
  "measured",
  "far",
]);

const RESPONSE_VARIATION_VALUES = new Set<ResponseVariation>([
  "brief",
  "textured",
  "questioning",
]);

async function buildOpenAIHttpError(response: Response): Promise<string> {
  const message = await readResponseErrorMessage(response);
  return `openai_http_${response.status}${message ? `:${message}` : ""}`;
}

async function readResponseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as unknown;
    if (!isRecord(payload)) {
      return "";
    }
    const error = payload.error;
    if (!isRecord(error) || typeof error.message !== "string") {
      return "";
    }
    return error.message;
  } catch {
    return "";
  }
}

const HACHIKA_NAME_PATTERNS = [
  "あなたの名前",
  "君の名前",
  "きみの名前",
  "ハチカの名前",
];
const USER_NAME_PATTERNS = [
  "私の名前",
  "わたしの名前",
  "僕の名前",
  "ぼくの名前",
  "俺の名前",
  "おれの名前",
];
const HACHIKA_PROFILE_PATTERNS = [
  "自己紹介",
  "どんな存在",
  "どういう存在",
  "何者",
  "あなたは誰",
  "君は誰",
  "ハチカって",
];
const USER_PROFILE_PATTERNS = [
  "私のこと",
  "わたしのこと",
  "僕のこと",
  "ぼくのこと",
  "俺のこと",
  "おれのこと",
  "どう思う",
];
const NAMING_PATTERNS = [
  "覚えてね",
  "覚えて",
  "呼んで",
  "呼び方",
  "名前は",
];
