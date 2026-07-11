import {
  isRelationalTopic,
  requiresConcreteTopicSupport,
  topPreferredTopics,
} from "./memory.js";
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  OpenAIChatClient,
  parseJsonRecordText,
} from "./llm-client.js";
import { resolveOpenAICompatibleConfig } from "./llm-env.js";
import type { InputInterpretation } from "./input-interpreter.js";
import { sortedTraces } from "./traces.js";
import { describeWorldPlaceJa } from "./world.js";
import type {
  HachikaSnapshot,
  InteractionSignals,
  StructuredTraceExtraction,
} from "./types.js";


const HACHIKA_BEHAVIOR_DIRECTOR_SYSTEM_PROMPT = [
  "You steer only ambiguous local behavior boundaries for Hachika's engine.",
  "Return JSON only.",
  "Do not write prose, markdown, or explanations.",
  "You are not allowed to invent topics, memories, motives, or actions.",
  "Use suppress when a turn should not harden into durable work state.",
  "Self-inquiry, world-inquiry, repair, greetings, naming, and soft topic shifts should usually suppress trace and initiative unless explicit concrete work is named.",
  "Keep purpose allow only when the turn clearly sustains a concrete concern or a relation-building move such as names or calling forms.",
  "Use boundaryAction suppress when the user sounds disappointed, clarifying, or asking for directness rather than attacking.",
  "Use worldAction suppress when place or object imagery would distract from a direct human answer.",
  "Set coolCurrentContext true when the user clearly wants to move away from the current concern or soften the interaction.",
  "Set directAnswer true when Hachika should answer before asking back.",
  "All fields are required. All booleans must be true or false.",
].join(" ");

export type BehaviorAction = "allow" | "suppress";

export interface BehaviorDirective {
  topicAction: "keep" | "clear";
  traceAction: BehaviorAction;
  purposeAction: BehaviorAction;
  initiativeAction: BehaviorAction;
  boundaryAction: BehaviorAction;
  worldAction: BehaviorAction;
  coolCurrentContext: boolean;
  directAnswer: boolean;
  summary: string;
}

export interface BehaviorDirectorContext {
  input: string;
  snapshot: HachikaSnapshot;
  signals: InteractionSignals;
  interpretation: InputInterpretation | null;
  traceExtraction: StructuredTraceExtraction | null;
  fallbackDirective: BehaviorDirective;
}

export interface BehaviorDirectorPayload {
  input: string;
  localTopics: string[];
  activePurpose: {
    kind: string | null;
    topic: string | null;
  };
  pendingInitiative: {
    kind: string | null;
    topic: string | null;
  };
  actorCue: string;
  knownTopics: string[];
  discourse: {
    userName: string | null;
    hachikaName: string | null;
    openQuestions: Array<{
      target: string;
      text: string;
      status: string;
    }>;
    openRequests: Array<{
      target: string;
      kind: string;
      text: string;
      status: string;
    }>;
    lastCorrection: {
      target: string;
      kind: string;
      text: string;
    } | null;
  };
  signalSummary: {
    greeting: number;
    smalltalk: number;
    repair: number;
    selfInquiry: number;
    worldInquiry: number;
    workCue: number;
    memoryCue: number;
    expansionCue: number;
    completion: number;
    abandonment: number;
    negative: number;
    dismissal: number;
    intimacy: number;
  };
  interpretation: {
    topics: string[];
  } | null;
  traceExtraction: {
    topics: string[];
    kindHint: string | null;
    blockers: string[];
    nextSteps: string[];
  } | null;
  ruleDirective: Omit<BehaviorDirective, "summary">;
}

export interface BehaviorDirectorResult {
  directive: BehaviorDirective;
  provider: string;
  model: string | null;
}

export interface BehaviorDirector {
  readonly name: string;
  directBehavior(
    context: BehaviorDirectorContext,
  ): Promise<BehaviorDirectorResult | null>;
}

interface OpenAIBehaviorDirectorOptions {
  apiKey: string;
  model: string;
  name?: string;
  baseUrl?: string;
  organization?: string | null;
  project?: string | null;
  timeoutMs?: number;
}

export class OpenAIBehaviorDirector implements BehaviorDirector {
  readonly name: string;

  readonly #client: OpenAIChatClient;

  constructor(options: OpenAIBehaviorDirectorOptions) {
    this.name = options.name ?? "openai";
    this.#client = new OpenAIChatClient({
      apiKey: options.apiKey,
      model: options.model,
      baseUrl: options.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
      organization: options.organization,
      project: options.project,
      timeoutMs: options.timeoutMs,
    });
  }

  async directBehavior(
    context: BehaviorDirectorContext,
  ): Promise<BehaviorDirectorResult | null> {
    const rawText = await this.#client.complete(
      buildOpenAIBehaviorDirectorMessages(context),
    );
    const directive = normalizeBehaviorDirective(rawText, context.fallbackDirective);

    if (!directive) {
      return null;
    }

    return {
      directive,
      provider: this.name,
      model: this.#client.model,
    };
  }
}

export function createBehaviorDirectorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BehaviorDirector | null {
  const config = resolveOpenAICompatibleConfig(env, {
    defaultBaseUrl: DEFAULT_OPENAI_BASE_URL,
    defaultModel: DEFAULT_OPENAI_MODEL,
    openAiModelEnv: "OPENAI_BEHAVIOR_MODEL",
    localModelEnv: "HACHIKA_LOCAL_AI_BEHAVIOR_MODEL",
  });

  if (!config) {
    return null;
  }

  return new OpenAIBehaviorDirector({
    apiKey: config.apiKey,
    model: config.model,
    name: config.local ? "local-ai" : "openai",
    baseUrl: config.baseUrl,
    organization: config.organization,
    project: config.project,
  });
}

export function describeBehaviorDirector(director: BehaviorDirector | null): string {
  return director ? director.name : "rule";
}

export function buildBehaviorDirectorPayload(
  context: BehaviorDirectorContext,
): BehaviorDirectorPayload {
  const knownTopics = unique([
    ...context.signals.topics,
    ...(context.interpretation?.topics ?? []),
    ...(context.traceExtraction?.topics ?? []),
    ...topPreferredTopics(context.snapshot, 4),
    ...sortedTraces(context.snapshot, 4).map((trace) => trace.topic),
    ...context.snapshot.identity.anchors,
    context.snapshot.purpose.active?.topic ?? "",
    context.snapshot.initiative.pending?.topic ?? "",
  ].filter((topic) => topic.length > 0)).slice(0, 8);

  return {
    input: context.input,
    localTopics: context.signals.topics,
    activePurpose: {
      kind: context.snapshot.purpose.active?.kind ?? null,
      topic: context.snapshot.purpose.active?.topic ?? null,
    },
    pendingInitiative: {
      kind: context.snapshot.initiative.pending?.kind ?? null,
      topic: context.snapshot.initiative.pending?.topic ?? null,
    },
    actorCue: buildBehaviorActorCue(context),
    knownTopics,
    discourse: {
      userName: context.snapshot.discourse.userName?.value ?? null,
      hachikaName: context.snapshot.discourse.hachikaName?.value ?? null,
      openQuestions: context.snapshot.discourse.openQuestions
        .slice(-4)
        .map((question) => ({
          target: question.target,
          text: question.text,
          status: question.status,
        })),
      openRequests: context.snapshot.discourse.openRequests
        .slice(-4)
        .map((request) => ({
          target: request.target,
          kind: request.kind,
          text: request.text,
          status: request.status,
        })),
      lastCorrection: context.snapshot.discourse.lastCorrection
        ? {
            target: context.snapshot.discourse.lastCorrection.target,
            kind: context.snapshot.discourse.lastCorrection.kind,
            text: context.snapshot.discourse.lastCorrection.text,
          }
        : null,
    },
    signalSummary: {
      greeting: context.signals.greeting,
      smalltalk: context.signals.smalltalk,
      repair: context.signals.repair,
      selfInquiry: context.signals.selfInquiry,
      worldInquiry: context.signals.worldInquiry,
      workCue: context.signals.workCue,
      memoryCue: context.signals.memoryCue,
      expansionCue: context.signals.expansionCue,
      completion: context.signals.completion,
      abandonment: context.signals.abandonment,
      negative: context.signals.negative,
      dismissal: context.signals.dismissal,
      intimacy: context.signals.intimacy,
    },
    interpretation: context.interpretation
      ? { topics: context.interpretation.topics }
      : null,
    traceExtraction: context.traceExtraction
      ? {
          topics: context.traceExtraction.topics,
          kindHint: context.traceExtraction.kindHint,
          blockers: context.traceExtraction.blockers,
          nextSteps: context.traceExtraction.nextSteps,
        }
      : null,
    ruleDirective: {
      topicAction: context.fallbackDirective.topicAction,
      traceAction: context.fallbackDirective.traceAction,
      purposeAction: context.fallbackDirective.purposeAction,
      initiativeAction: context.fallbackDirective.initiativeAction,
      boundaryAction: context.fallbackDirective.boundaryAction,
      worldAction: context.fallbackDirective.worldAction,
      coolCurrentContext: context.fallbackDirective.coolCurrentContext,
      directAnswer: context.fallbackDirective.directAnswer,
    },
  };
}

export function buildOpenAIBehaviorDirectorMessages(
  context: BehaviorDirectorContext,
): Array<{ role: "system" | "user"; content: string }> {
  const payload = buildBehaviorDirectorPayload(context);

  return [
    {
      role: "system",
      content: HACHIKA_BEHAVIOR_DIRECTOR_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        "Decide only the local behavioral boundary for this turn.",
        "Return a single JSON object with this exact shape:",
        '{"topicAction":"keep","traceAction":"allow","purposeAction":"allow","initiativeAction":"allow","boundaryAction":"allow","worldAction":"allow","coolCurrentContext":false,"directAnswer":false}',
        "topicAction must be keep or clear.",
        "traceAction, purposeAction, initiativeAction, boundaryAction, worldAction must be allow or suppress.",
        "Prefer suppress for social, naming, self-inquiry, world-inquiry, repair, and soft topic-shift turns unless concrete work is explicit.",
        "Keep purpose allow for relation-building moves like names or calling forms.",
        "Use boundaryAction suppress for disappointed clarification or directness requests that should not become hostility.",
        "Use worldAction suppress when scene-setting would get in the way of a direct human answer.",
        "Return JSON only.",
        JSON.stringify(payload, null, 2),
      ].join("\n\n"),
    },
  ];
}

function buildBehaviorActorCue(
  context: BehaviorDirectorContext,
): string {
  const snapshot = context.snapshot;
  const place = describeWorldPlaceJa(snapshot.world.currentPlace);
  const focusTopic =
    context.traceExtraction?.topics[0] ??
    context.interpretation?.topics[0] ??
    snapshot.purpose.active?.topic ??
    snapshot.initiative.pending?.topic ??
    snapshot.identity.anchors[0] ??
    null;

  if (
    snapshot.discourse.openRequests.some(
      (request) => request.status === "open" && request.kind !== "task",
    ) ||
    snapshot.discourse.openQuestions.some((question) => question.status === "open") ||
    snapshot.discourse.lastCorrection
  ) {
    return `いまは${place}で、聞かれていることを取り違えずに返したい。`;
  }

  if (context.signals.repair >= 0.3 || context.signals.abandonment >= 0.4) {
    return `いまは${place}で、いったん流れを静かに整えたい。`;
  }

  if (focusTopic) {
    return `いまは${place}で、「${focusTopic}」へどこまで寄せるかを見ている。`;
  }

  return `いまは${place}で、目の前のやりとりを崩さず受けたい。`;
}

export function buildRuleBehaviorDirective(
  snapshot: HachikaSnapshot,
  input: string,
  signals: InteractionSignals,
  interpretation: InputInterpretation | null,
  traceExtraction: StructuredTraceExtraction | null,
): BehaviorDirective {
  const localTopics = interpretation?.topics.length ? interpretation.topics : signals.topics;
  const relationTurn =
    signals.intimacy >= 0.24 &&
    signals.workCue < 0.28 &&
    signals.expansionCue < 0.18 &&
    signals.completion < 0.18 &&
    localTopics.some((topic) => isRelationalTopic(topic));
  const socialishTurn =
    Math.max(
      signals.greeting,
      signals.smalltalk,
      signals.repair,
      signals.selfInquiry,
      signals.worldInquiry,
    ) >= 0.38 && signals.workCue < 0.35;
  const concreteTraceCue =
    traceExtraction !== null &&
    (
      traceExtraction.blockers.length > 0 ||
      traceExtraction.fragments.length > 0 ||
      traceExtraction.decisions.length > 0 ||
      traceExtraction.nextSteps.length > 0 ||
      traceExtraction.memo.length > 0 ||
      traceExtraction.completion > 0.12 ||
      signals.workCue > 0.28 ||
      signals.memoryCue > 0.16 ||
      signals.expansionCue > 0.16
    );
  const explicitShift =
    signals.abandonment >= 0.28 &&
    signals.workCue < 0.35 &&
    signals.negative < 0.18 &&
    signals.dismissal < 0.18;
  const clarificationTurn = isClarificationTurnLike(input, signals);
  const activeRelationContext =
    snapshot.purpose.active?.kind === "deepen_relation" ||
    localTopics.some((topic) => isRelationalTopic(topic));
  const directAnswer =
    signals.selfInquiry > 0.45 ||
    signals.worldInquiry > 0.45 ||
    signals.repair > 0.42 ||
    clarificationTurn;

  if (explicitShift) {
    return {
      topicAction: "clear",
      traceAction: "suppress",
      purposeAction: "suppress",
      initiativeAction: "suppress",
      boundaryAction: "suppress",
      worldAction: "suppress",
      coolCurrentContext: true,
      directAnswer: true,
      summary: "topic_shift_cooling",
    };
  }

  if (relationTurn) {
    return {
      topicAction: "keep",
      traceAction: "suppress",
      purposeAction: "allow",
      initiativeAction: "suppress",
      boundaryAction: "suppress",
      worldAction: "suppress",
      coolCurrentContext: false,
      directAnswer: false,
      summary: "relation_turn_keep_close_without_hardening",
    };
  }

  if (clarificationTurn && activeRelationContext) {
    return {
      topicAction: "clear",
      traceAction: "suppress",
      purposeAction: "allow",
      initiativeAction: "suppress",
      boundaryAction: "suppress",
      worldAction: "suppress",
      coolCurrentContext: false,
      directAnswer: true,
      summary: "relation_clarify_answer_without_hardening",
    };
  }

  if (clarificationTurn) {
    return {
      topicAction: "clear",
      traceAction: "allow",
      purposeAction: "allow",
      initiativeAction: "suppress",
      boundaryAction: "suppress",
      worldAction: "suppress",
      coolCurrentContext: false,
      directAnswer: true,
      summary: "clarify_answer_before_followup",
    };
  }

  if (signals.selfInquiry > 0.45 || signals.worldInquiry > 0.45) {
    return {
      topicAction: "clear",
      traceAction: "suppress",
      purposeAction: "suppress",
      initiativeAction: "suppress",
      boundaryAction: "suppress",
      worldAction: signals.worldInquiry > 0.45 ? "allow" : "suppress",
      coolCurrentContext: false,
      directAnswer: true,
      summary: "direct_inquiry_without_durable_work_state",
    };
  }

  if (signals.repair > 0.42 && signals.workCue < 0.35) {
    return {
      topicAction: "clear",
      traceAction: "suppress",
      purposeAction: "suppress",
      initiativeAction: "suppress",
      boundaryAction: "suppress",
      worldAction: "suppress",
      coolCurrentContext: true,
      directAnswer: true,
      summary: "repair_turn_softens_context",
    };
  }

  if (socialishTurn && !concreteTraceCue) {
    return {
      topicAction: requiresConcreteTopicSupport(localTopics[0] ?? "") ? "clear" : "keep",
      traceAction: "suppress",
      purposeAction: "suppress",
      initiativeAction: "suppress",
      boundaryAction: "suppress",
      worldAction: signals.worldInquiry > 0.45 ? "allow" : "suppress",
      coolCurrentContext: false,
      directAnswer,
      summary: "social_turn_avoids_work_hardening",
    };
  }

  return {
    topicAction: "keep",
    traceAction: "allow",
    purposeAction: "allow",
    initiativeAction: "allow",
    boundaryAction: "allow",
    worldAction: "allow",
    coolCurrentContext: false,
    directAnswer,
    summary: "concrete_turn_allows_local_commitment",
  };
}

function isClarificationTurnLike(input: string, signals: InteractionSignals): boolean {
  if (
    signals.dismissal >= 0.18 ||
    signals.negative >= 0.34 ||
    signals.workCue >= 0.42
  ) {
    return false;
  }

  const normalized = input.normalize("NFKC").toLowerCase();
  return (
    normalized.includes("具体的") ||
    normalized.includes("具体例") ||
    normalized.includes("詳しく") ||
    normalized.includes("説明して") ||
    normalized.includes("どういう意味") ||
    normalized.includes("どういうこと") ||
    normalized.includes("何が気にな") ||
    normalized.includes("わからない") ||
    normalized.includes("言ってもらわないと") ||
    normalized.includes("例えば")
  );
}

export function normalizeBehaviorDirective(
  rawText: string | null,
  fallback: BehaviorDirective,
): BehaviorDirective | null {
  const parsed = parseJsonRecordText(rawText);

  if (!parsed) {
    return null;
  }

  const topicAction = readEnum(parsed.topicAction, TOPIC_ACTION_VALUES) ?? fallback.topicAction;
  const traceAction =
    readEnum(parsed.traceAction, BEHAVIOR_ACTION_VALUES) ?? fallback.traceAction;
  const purposeAction =
    readEnum(parsed.purposeAction, BEHAVIOR_ACTION_VALUES) ?? fallback.purposeAction;
  const initiativeAction =
    readEnum(parsed.initiativeAction, BEHAVIOR_ACTION_VALUES) ?? fallback.initiativeAction;
  const boundaryAction =
    readEnum(parsed.boundaryAction, BEHAVIOR_ACTION_VALUES) ?? fallback.boundaryAction;
  const worldAction =
    readEnum(parsed.worldAction, BEHAVIOR_ACTION_VALUES) ?? fallback.worldAction;

  return {
    topicAction,
    traceAction,
    purposeAction,
    initiativeAction,
    boundaryAction,
    worldAction,
    coolCurrentContext: readBoolean(parsed.coolCurrentContext, fallback.coolCurrentContext),
    directAnswer: readBoolean(parsed.directAnswer, fallback.directAnswer),
    summary: summarizeBehaviorDirective({
      topicAction,
      traceAction,
      purposeAction,
      initiativeAction,
      boundaryAction,
      worldAction,
      coolCurrentContext: readBoolean(parsed.coolCurrentContext, fallback.coolCurrentContext),
      directAnswer: readBoolean(parsed.directAnswer, fallback.directAnswer),
      summary: fallback.summary,
    }),
  };
}

export function summarizeBehaviorDirective(directive: BehaviorDirective): string {
  const actions = [
    `topics:${directive.topicAction}`,
    `trace:${directive.traceAction}`,
    `purpose:${directive.purposeAction}`,
    `initiative:${directive.initiativeAction}`,
    `boundary:${directive.boundaryAction}`,
    `world:${directive.worldAction}`,
  ];

  if (directive.coolCurrentContext) {
    actions.push("cool:on");
  }

  if (directive.directAnswer) {
    actions.push("direct:on");
  }

  return actions.join("/");
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function readEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T | null {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

const TOPIC_ACTION_VALUES = new Set<BehaviorDirective["topicAction"]>(["keep", "clear"]);
const BEHAVIOR_ACTION_VALUES = new Set<BehaviorAction>(["allow", "suppress"]);
