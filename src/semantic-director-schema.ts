import type {
  AttentionRationale,
  InitiativeAutonomyAction,
  PendingInitiative,
  StructuredTraceExtraction,
  TraceKind,
  TurnAnswerMode,
  TurnRelationMove,
  TurnSubject,
  TurnTarget,
  TurnWorldMention,
  WorldActionKind,
  WorldPlaceId,
} from "./types.js";
import type {
  ProactiveEmphasis,
  ProactivePlan,
  ResponseAct,
  ResponseDistance,
  ResponsePlan,
  ResponseStance,
  ResponseVariation,
} from "./response-planner.js";
import type { BehaviorDirective } from "./behavior-director.js";

export type SemanticDirectiveMode = "turn" | "proactive";
export type SemanticAutonomyOutwardMode = "none" | "touch" | "speak";

export type SemanticTopicSource =
  | "input"
  | "memory"
  | "trace"
  | "world"
  | "relation"
  | "self";

export type SemanticTopicDurability = "ephemeral" | "durable";

export interface SemanticTopicDecision {
  topic: string;
  source: SemanticTopicSource;
  durability: SemanticTopicDurability;
  confidence: number;
  rationale?: AttentionRationale;
}

const ATTENTION_RATIONALE_VALUES = new Set<AttentionRationale>([
  "direct_referent",
  "relation_uncertain",
  "self_definition",
  "unfinished_work",
  "repair_pressure",
  "memory_pull",
  "trace_pull",
  "world_pull",
  "curiosity",
]);

export interface SemanticTraceHint {
  topics: string[];
  stateTopics: string[];
  kindHint: TraceKind | null;
  completion: number;
  blockers: string[];
  memo: string[];
  fragments: string[];
  decisions: string[];
  nextSteps: string[];
}

export interface SemanticReplyPlan {
  act: ResponseAct;
  stance: ResponseStance;
  distance: ResponseDistance;
  focusTopic: string | null;
  mentionTrace: boolean;
  mentionIdentity: boolean;
  mentionBoundary: boolean;
  mentionWorld: boolean;
  askBack: boolean;
  variation: ResponseVariation;
}

export interface SemanticProactivePlan {
  emit: boolean;
  act: ProactivePlan["act"];
  stance: ProactivePlan["stance"];
  distance: ProactivePlan["distance"];
  focusTopic: string | null;
  stateTopic: string | null;
  emphasis: ProactiveEmphasis;
  mentionBlocker: boolean;
  mentionReopen: boolean;
  mentionMaintenance: boolean;
  mentionIntent: boolean;
  variation: ProactivePlan["variation"];
  place: WorldPlaceId | null;
  worldAction: WorldActionKind | null;
}

export interface SemanticInitiativePlan {
  keep: boolean;
  kind: PendingInitiative["kind"];
  reason: PendingInitiative["reason"];
  motive: PendingInitiative["motive"];
  topic: string | null;
  stateTopic: string | null;
  readyAfterHours: number;
  place: WorldPlaceId | null;
  worldAction: WorldActionKind | null;
}

export interface SemanticAutonomyPlan {
  keep: boolean;
  action: Exclude<InitiativeAutonomyAction, "speak" | "touch" | null>;
  outwardMode: SemanticAutonomyOutwardMode;
}

export interface SemanticTurnDirectiveV2 {
  mode: "turn";
  subject: TurnSubject;
  target: TurnTarget;
  answerMode: TurnAnswerMode;
  relationMove: TurnRelationMove;
  worldMention: TurnWorldMention;
  topics: SemanticTopicDecision[];
  behavior: Omit<BehaviorDirective, "summary">;
  replyPlan: SemanticReplyPlan;
  trace: SemanticTraceHint;
  summary: string;
}

export interface SemanticProactiveDirectiveV2 {
  mode: "proactive";
  topics: SemanticTopicDecision[];
  proactivePlan: SemanticProactivePlan;
  trace: SemanticTraceHint;
  summary: string;
}

export interface SemanticInitiativeDirectiveV2 {
  mode: "initiative";
  topics: SemanticTopicDecision[];
  initiativePlan: SemanticInitiativePlan;
  summary: string;
}

export interface SemanticAutonomyDirectiveV2 {
  mode: "autonomy";
  topics: SemanticTopicDecision[];
  autonomyPlan: SemanticAutonomyPlan;
  summary: string;
}

export type SemanticDirectiveV2 =
  | SemanticTurnDirectiveV2
  | SemanticProactiveDirectiveV2
  | SemanticInitiativeDirectiveV2
  | SemanticAutonomyDirectiveV2;

export function buildSemanticTopicDecisions(
  topics: readonly string[],
  stateTopics: readonly string[],
  source: SemanticTopicSource,
  rationale: AttentionRationale = defaultAttentionRationaleForSource(source),
): SemanticTopicDecision[] {
  const durableTopics = new Set(stateTopics);
  const uniqueTopics = Array.from(new Set(topics));

  return uniqueTopics.map((topic, index) => ({
    topic,
    source,
    durability: durableTopics.has(topic) ? "durable" : "ephemeral",
    confidence: Math.max(0.25, 0.92 - index * 0.12),
    rationale,
  }));
}

export function buildSemanticTraceHint(
  trace: Pick<
    StructuredTraceExtraction,
    | "topics"
    | "kindHint"
    | "completion"
    | "blockers"
    | "memo"
    | "fragments"
    | "decisions"
    | "nextSteps"
  > | null,
  stateTopics: readonly string[],
): SemanticTraceHint {
  return {
    topics: trace?.topics ? [...trace.topics] : [],
    stateTopics: [...stateTopics],
    kindHint: trace?.kindHint ?? null,
    completion: trace?.completion ?? 0,
    blockers: trace?.blockers ? [...trace.blockers] : [],
    memo: trace?.memo ? [...trace.memo] : [],
    fragments: trace?.fragments ? [...trace.fragments] : [],
    decisions: trace?.decisions ? [...trace.decisions] : [],
    nextSteps: trace?.nextSteps ? [...trace.nextSteps] : [],
  };
}

export function buildSemanticReplyPlanFromResponsePlan(
  plan: ResponsePlan,
): SemanticReplyPlan {
  return {
    act: plan.act,
    stance: plan.stance,
    distance: plan.distance,
    focusTopic: plan.focusTopic,
    mentionTrace: plan.mentionTrace,
    mentionIdentity: plan.mentionIdentity,
    mentionBoundary: plan.mentionBoundary,
    mentionWorld: plan.mentionWorld,
    askBack: plan.askBack,
    variation: plan.variation,
  };
}

export function listSemanticTopics(
  topics: readonly SemanticTopicDecision[],
): string[] {
  return topics.map((topic) => topic.topic);
}

export function listDurableSemanticTopics(
  topics: readonly SemanticTopicDecision[],
): string[] {
  return topics
    .filter((topic) => topic.durability === "durable")
    .map((topic) => topic.topic);
}

export function listSemanticAttentionRationales(
  topics: readonly SemanticTopicDecision[],
): AttentionRationale[] {
  return Array.from(
    new Set(
      topics
        .map((topic) => topic.rationale)
        .filter((rationale): rationale is AttentionRationale => !!rationale),
    ),
  );
}

export function defaultAttentionRationaleForSource(
  source: SemanticTopicSource,
): AttentionRationale {
  switch (source) {
    case "memory":
      return "memory_pull";
    case "trace":
      return "trace_pull";
    case "world":
      return "world_pull";
    case "relation":
      return "relation_uncertain";
    case "self":
      return "self_definition";
    case "input":
    default:
      return "curiosity";
  }
}

export function normalizeSemanticTopicDecisionRecord(
  value: unknown,
  fallbackSource: SemanticTopicSource,
): SemanticTopicDecision | null {
  if (!isRecord(value)) {
    return null;
  }

  const topic =
    typeof value.topic === "string" ? value.topic.normalize("NFKC").trim() : "";
  if (!topic) {
    return null;
  }

  const source =
    value.source === "input" ||
    value.source === "memory" ||
    value.source === "trace" ||
    value.source === "world" ||
    value.source === "relation" ||
    value.source === "self"
      ? value.source
      : fallbackSource;
  const durability = value.durability === "durable" ? "durable" : "ephemeral";
  const confidence =
    typeof value.confidence === "number" && Number.isFinite(value.confidence)
      ? Math.max(0, Math.min(1, value.confidence))
      : durability === "durable"
        ? 0.84
        : 0.62;
  const rationale =
    typeof value.rationale === "string" && ATTENTION_RATIONALE_VALUES.has(value.rationale as AttentionRationale)
      ? (value.rationale as AttentionRationale)
      : defaultAttentionRationaleForSource(source);

  return {
    topic,
    source,
    durability,
    confidence,
    rationale,
  };
}

export function buildResponsePlanFromSemanticReplyPlan(
  plan: SemanticReplyPlan,
): ResponsePlan {
  return {
    act: plan.act,
    stance: plan.stance,
    distance: plan.distance,
    focusTopic: plan.focusTopic,
    mentionTrace: plan.mentionTrace,
    mentionIdentity: plan.mentionIdentity,
    mentionBoundary: plan.mentionBoundary,
    mentionWorld: plan.mentionWorld,
    askBack: plan.askBack,
    variation: plan.variation,
    summary: `${plan.act}/${plan.stance}/${plan.distance}${plan.focusTopic ? ` on ${plan.focusTopic}` : ""}`,
  };
}

export function buildSemanticProactivePlan(
  plan: ProactivePlan,
  options: {
    emit: boolean;
    stateTopic: string | null;
    place: WorldPlaceId | null;
    worldAction: WorldActionKind | null;
  },
): SemanticProactivePlan {
  return {
    emit: options.emit,
    act: plan.act,
    stance: plan.stance,
    distance: plan.distance,
    focusTopic: plan.focusTopic,
    stateTopic: options.stateTopic,
    emphasis: plan.emphasis,
    mentionBlocker: plan.mentionBlocker,
    mentionReopen: plan.mentionReopen,
    mentionMaintenance: plan.mentionMaintenance,
    mentionIntent: plan.mentionIntent,
    variation: plan.variation,
    place: options.place,
    worldAction: options.worldAction,
  };
}

export function buildSemanticInitiativePlan(options: {
  keep: boolean;
  kind: PendingInitiative["kind"];
  reason: PendingInitiative["reason"];
  motive: PendingInitiative["motive"];
  topic: string | null;
  stateTopic: string | null;
  readyAfterHours: number;
  place: WorldPlaceId | null;
  worldAction: WorldActionKind | null;
}): SemanticInitiativePlan {
  return {
    keep: options.keep,
    kind: options.kind,
    reason: options.reason,
    motive: options.motive,
    topic: options.topic,
    stateTopic: options.stateTopic,
    readyAfterHours: options.readyAfterHours,
    place: options.place,
    worldAction: options.worldAction,
  };
}

export function buildSemanticAutonomyPlan(options: {
  keep: boolean;
  action: Exclude<InitiativeAutonomyAction, "speak" | "touch" | null>;
  outwardMode: SemanticAutonomyOutwardMode;
}): SemanticAutonomyPlan {
  return {
    keep: options.keep,
    action: options.action,
    outwardMode: options.outwardMode,
  };
}

export function buildProactivePlanFromSemanticProactivePlan(
  plan: SemanticProactivePlan,
): ProactivePlan {
  return {
    act: plan.act,
    stance: plan.stance,
    distance: plan.distance,
    focusTopic: plan.focusTopic,
    emphasis: plan.emphasis,
    mentionBlocker: plan.mentionBlocker,
    mentionReopen: plan.mentionReopen,
    mentionMaintenance: plan.mentionMaintenance,
    mentionIntent: plan.mentionIntent,
    variation: plan.variation,
    summary: `${plan.act}/${plan.stance}/${plan.distance}/${plan.emphasis}${plan.focusTopic ? ` on ${plan.focusTopic}` : ""}`,
  };
}

export function buildStructuredTraceExtractionFromSemanticTraceHint(
  trace: SemanticTraceHint,
): StructuredTraceExtraction | null {
  const extraction: StructuredTraceExtraction = {
    topics: [...trace.topics],
    kindHint: trace.kindHint,
    completion: trace.completion,
    blockers: [...trace.blockers],
    memo: [...trace.memo],
    fragments: [...trace.fragments],
    decisions: [...trace.decisions],
    nextSteps: [...trace.nextSteps],
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

  return hasContent ? extraction : null;
}

export function buildPendingInitiativeFromSemanticInitiativePlan(
  plan: SemanticInitiativePlan,
  fallback: Pick<
    PendingInitiative,
    "blocker" | "concern" | "createdAt"
  >,
): PendingInitiative {
  return {
    kind: plan.kind,
    reason: plan.reason,
    motive: plan.motive,
    topic: plan.topic,
    stateTopic: plan.stateTopic,
    blocker: fallback.blocker,
    place: plan.place,
    worldAction: plan.worldAction,
    concern: fallback.concern,
    createdAt: fallback.createdAt,
    readyAfterHours: plan.readyAfterHours,
  };
}

export function describeSemanticDirective(
  directive: SemanticDirectiveV2,
): string {
  if (directive.mode === "turn") {
    const semanticTopics = directive.topics.map((topic) => topic.topic).join(",");
    const stateTopics = directive.topics
      .filter((topic) => topic.durability === "durable")
      .map((topic) => topic.topic)
      .join(",");
    const reasons = listSemanticAttentionRationales(directive.topics).join(",");

    return [
      "turn",
      `${directive.subject}/${directive.target}/${directive.answerMode}`,
      `topics:${semanticTopics || "none"}`,
      `state:${stateTopics || "none"}`,
      reasons ? `why:${reasons}` : "",
      `act:${directive.replyPlan.act}`,
    ]
      .filter((part) => part.length > 0)
      .join(" ");
  }

  if (directive.mode === "proactive") {
    const semanticTopics = directive.topics.map((topic) => topic.topic).join(",");
    const stateTopics = directive.topics
      .filter((topic) => topic.durability === "durable")
      .map((topic) => topic.topic)
      .join(",");
    const reasons = listSemanticAttentionRationales(directive.topics).join(",");

    return [
      "proactive",
      directive.proactivePlan.emit ? "emit" : "suppress",
      `topics:${semanticTopics || "none"}`,
      `state:${stateTopics || "none"}`,
      reasons ? `why:${reasons}` : "",
      `act:${directive.proactivePlan.act}`,
      directive.proactivePlan.place ? `@${directive.proactivePlan.place}` : "",
      directive.proactivePlan.worldAction
        ? `/${directive.proactivePlan.worldAction}`
        : "",
    ]
      .filter((part) => part.length > 0)
      .join(" ");
  }

  if (directive.mode === "initiative") {
    const semanticTopics = directive.topics.map((topic) => topic.topic).join(",");
    const stateTopics = directive.topics
      .filter((topic) => topic.durability === "durable")
      .map((topic) => topic.topic)
      .join(",");
    const reasons = listSemanticAttentionRationales(directive.topics).join(",");

    return [
      "initiative",
      directive.initiativePlan.keep ? "keep" : "suppress",
      `topics:${semanticTopics || "none"}`,
      `state:${stateTopics || "none"}`,
      reasons ? `why:${reasons}` : "",
      `kind:${directive.initiativePlan.kind}`,
      `motive:${directive.initiativePlan.motive}`,
      directive.initiativePlan.place ? `@${directive.initiativePlan.place}` : "",
      directive.initiativePlan.worldAction
        ? `/${directive.initiativePlan.worldAction}`
        : "",
    ]
      .filter((part) => part.length > 0)
      .join(" ");
  }

  const semanticTopics = directive.topics.map((topic) => topic.topic).join(",");
  const stateTopics = directive.topics
    .filter((topic) => topic.durability === "durable")
    .map((topic) => topic.topic)
    .join(",");
  const reasons = listSemanticAttentionRationales(directive.topics).join(",");

  return [
    "autonomy",
    directive.autonomyPlan.keep ? "keep" : "suppress",
    `topics:${semanticTopics || "none"}`,
    `state:${stateTopics || "none"}`,
    reasons ? `why:${reasons}` : "",
    `action:${directive.autonomyPlan.action}`,
    `out:${directive.autonomyPlan.outwardMode}`,
  ].join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
