import {
  isRelationalTopic,
  requiresConcreteTopicSupport,
  topPreferredTopics,
} from "./memory.js";
import type { InputInterpretation } from "./input-interpreter.js";
import { sortedTraces } from "./traces.js";
import type {
  HachikaSnapshot,
  InteractionSignals,
  StructuredTraceExtraction,
} from "./types.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

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
  identitySummary: string;
  knownTopics: string[];
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
  baseUrl?: string;
  organization?: string | null;
  project?: string | null;
  timeoutMs?: number;
}

export class OpenAIBehaviorDirector implements BehaviorDirector {
  readonly name = "openai";

  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #organization: string | null;
  readonly #project: string | null;
  readonly #timeoutMs: number;

  constructor(options: OpenAIBehaviorDirectorOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL);
    this.#organization = options.organization ?? null;
    this.#project = options.project ?? null;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async directBehavior(
    context: BehaviorDirectorContext,
  ): Promise<BehaviorDirectorResult | null> {
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
          messages: buildOpenAIBehaviorDirectorMessages(context),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await buildOpenAIHttpError(response));
      }

      const payload = (await response.json()) as unknown;
      const directive = normalizeBehaviorDirective(
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

export function createBehaviorDirectorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BehaviorDirector | null {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return new OpenAIBehaviorDirector({
    apiKey,
    model:
      env.OPENAI_BEHAVIOR_MODEL?.trim() ||
      env.OPENAI_MODEL?.trim() ||
      DEFAULT_OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL,
    organization: env.OPENAI_ORGANIZATION?.trim() || null,
    project: env.OPENAI_PROJECT?.trim() || null,
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
    identitySummary: context.snapshot.identity.summary,
    knownTopics,
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
  const parsed = parseJsonRecord(rawText);

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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function buildOpenAIHttpError(response: Response): Promise<string> {
  const bodyText = await response.text();
  return `openai_${response.status}:${bodyText.slice(0, 200)}`;
}

function extractOpenAIReplyText(payload: unknown): string | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("choices" in payload) ||
    !Array.isArray(payload.choices)
  ) {
    return null;
  }

  const choice = payload.choices[0];
  if (
    typeof choice !== "object" ||
    choice === null ||
    !("message" in choice) ||
    typeof choice.message !== "object" ||
    choice.message === null ||
    !("content" in choice.message)
  ) {
    return null;
  }

  const content = choice.message.content;
  return typeof content === "string" ? content : null;
}

function parseJsonRecord(rawText: string | null): Record<string, unknown> | null {
  if (!rawText) {
    return null;
  }

  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawText.slice(start, end + 1)) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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
