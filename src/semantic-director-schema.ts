import type {
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
}

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

export type SemanticDirectiveV2 =
  | SemanticTurnDirectiveV2
  | SemanticProactiveDirectiveV2;

export function buildSemanticTopicDecisions(
  topics: readonly string[],
  stateTopics: readonly string[],
  source: SemanticTopicSource,
): SemanticTopicDecision[] {
  const durableTopics = new Set(stateTopics);
  const uniqueTopics = Array.from(new Set(topics));

  return uniqueTopics.map((topic, index) => ({
    topic,
    source,
    durability: durableTopics.has(topic) ? "durable" : "ephemeral",
    confidence: Math.max(0.25, 0.92 - index * 0.12),
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

export function describeSemanticDirective(
  directive: SemanticDirectiveV2,
): string {
  if (directive.mode === "turn") {
    const semanticTopics = directive.topics.map((topic) => topic.topic).join(",");
    const stateTopics = directive.topics
      .filter((topic) => topic.durability === "durable")
      .map((topic) => topic.topic)
      .join(",");

    return [
      "turn",
      `${directive.subject}/${directive.target}/${directive.answerMode}`,
      `topics:${semanticTopics || "none"}`,
      `state:${stateTopics || "none"}`,
      `act:${directive.replyPlan.act}`,
    ].join(" ");
  }

  const semanticTopics = directive.topics.map((topic) => topic.topic).join(",");
  const stateTopics = directive.topics
    .filter((topic) => topic.durability === "durable")
    .map((topic) => topic.topic)
    .join(",");

  return [
    "proactive",
    directive.proactivePlan.emit ? "emit" : "suppress",
    `topics:${semanticTopics || "none"}`,
    `state:${stateTopics || "none"}`,
    `act:${directive.proactivePlan.act}`,
    directive.proactivePlan.place ? `@${directive.proactivePlan.place}` : "",
    directive.proactivePlan.worldAction
      ? `/${directive.proactivePlan.worldAction}`
      : "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}
