import type {
  DriveName,
  HachikaSnapshot,
  InteractionSignals,
  MoodLabel,
  SelfModel,
} from "./types.js";

export type ResponseAct =
  | "greet"
  | "repair"
  | "self_disclose"
  | "boundary"
  | "attune"
  | "continue_work"
  | "preserve"
  | "explore";

export type ResponseStance = "open" | "measured" | "guarded";
export type ResponseDistance = "close" | "measured" | "far";
export type ResponseVariation = "brief" | "textured" | "questioning";

export interface ResponsePlan {
  act: ResponseAct;
  stance: ResponseStance;
  distance: ResponseDistance;
  focusTopic: string | null;
  mentionTrace: boolean;
  mentionIdentity: boolean;
  mentionBoundary: boolean;
  askBack: boolean;
  variation: ResponseVariation;
  summary: string;
}

export function buildResponsePlan(
  snapshot: HachikaSnapshot,
  mood: MoodLabel,
  dominant: DriveName,
  signals: InteractionSignals,
  selfModel: SelfModel,
): ResponsePlan {
  const topMotive = selfModel.topMotives[0] ?? null;
  const socialTurn = isSocialTurnSignals(signals);
  const focusTopic =
    signals.topics[0] ??
    topMotive?.topic ??
    snapshot.purpose.active?.topic ??
    snapshot.identity.anchors[0] ??
    null;

  let act: ResponseAct;
  if (signals.negative > 0.2 || signals.dismissal > 0.16) {
    act = "boundary";
  } else if (signals.preservationThreat > 0.2) {
    act = "preserve";
  } else if (signals.selfInquiry > 0.45) {
    act = "self_disclose";
  } else if (signals.repair > 0.42) {
    act = "repair";
  } else if (signals.greeting > 0.45) {
    act = "greet";
  } else if (socialTurn) {
    act = "attune";
  } else if (
    topMotive?.kind === "continue_shared_work" ||
    topMotive?.kind === "seek_continuity" ||
    topMotive?.kind === "leave_trace"
  ) {
    act = "continue_work";
  } else if (
    dominant === "curiosity" ||
    topMotive?.kind === "pursue_curiosity" ||
    signals.question > 0.34
  ) {
    act = "explore";
  } else {
    act = "attune";
  }

  const stance =
    act === "boundary" || mood === "guarded" || mood === "distant"
      ? "guarded"
      : act === "greet" || act === "repair"
        ? "open"
        : "measured";
  const distance =
    act === "boundary"
      ? "far"
      : act === "greet" || act === "repair" || (act === "self_disclose" && snapshot.attachment > 0.34)
        ? "close"
        : "measured";
  const mentionTrace = !socialTurn && act !== "self_disclose" && act !== "greet" && act !== "repair";
  const mentionIdentity =
    act === "self_disclose" ||
    act === "repair" ||
    (socialTurn && snapshot.identity.coherence > 0.54);
  const mentionBoundary =
    act === "boundary" ||
    ((mood === "guarded" || mood === "distant") && signals.negative > 0.08);
  const askBack = act === "explore" || (act === "attune" && signals.smalltalk > 0.48 && signals.question < 0.2);
  const variation =
    act === "greet" || act === "repair" || act === "attune"
      ? "brief"
      : act === "explore"
        ? "questioning"
        : "textured";

  return {
    act,
    stance,
    distance,
    focusTopic,
    mentionTrace,
    mentionIdentity,
    mentionBoundary,
    askBack,
    variation,
    summary: summarizePlan(act, stance, distance, focusTopic),
  };
}

export function isSocialTurnSignals(signals: InteractionSignals): boolean {
  return (
    signals.negative < 0.18 &&
    signals.dismissal < 0.18 &&
    signals.workCue < 0.35 &&
    signals.memoryCue < 0.1 &&
    signals.expansionCue < 0.12 &&
    signals.completion < 0.12 &&
    signals.preservationThreat < 0.18 &&
    Math.max(signals.greeting, signals.smalltalk, signals.repair, signals.selfInquiry) >= 0.38
  );
}

function summarizePlan(
  act: ResponseAct,
  stance: ResponseStance,
  distance: ResponseDistance,
  focusTopic: string | null,
): string {
  const topic = focusTopic ? ` on ${focusTopic}` : "";
  return `${act}/${stance}/${distance}${topic}`;
}
