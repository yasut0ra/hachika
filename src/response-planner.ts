import type {
  DriveName,
  HachikaSnapshot,
  InteractionSignals,
  MoodLabel,
  PendingInitiative,
  SelfModel,
} from "./types.js";
import { readTraceLifecycle } from "./traces.js";
import type { TraceMaintenance } from "./traces.js";

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
export type ProactiveAct =
  | "preserve"
  | "reconnect"
  | "continue_work"
  | "leave_trace"
  | "explore"
  | "untangle"
  | "reopen";
export type ProactiveEmphasis =
  | "presence"
  | "relation"
  | "blocker"
  | "reopen"
  | "maintenance";

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

export interface ProactivePlan {
  act: ProactiveAct;
  stance: ResponseStance;
  distance: ResponseDistance;
  focusTopic: string | null;
  emphasis: ProactiveEmphasis;
  mentionBlocker: boolean;
  mentionReopen: boolean;
  mentionMaintenance: boolean;
  mentionIntent: boolean;
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
  if (
    signals.abandonment >= 0.28 &&
    signals.workCue < 0.35 &&
    signals.negative < 0.18 &&
    signals.dismissal < 0.18
  ) {
    return true;
  }

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

export function buildProactivePlan(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  neglectLevel: number,
  maintenance: TraceMaintenance | null,
): ProactivePlan {
  const reopened = reopenedByMaintenance(maintenance);
  const focusTopic =
    maintenance?.trace.topic ??
    pending.topic ??
    snapshot.purpose.active?.topic ??
    snapshot.identity.anchors[0] ??
    null;

  let act: ProactiveAct;
  if (pending.kind === "preserve_presence") {
    act = "preserve";
  } else if (reopened) {
    act = "reopen";
  } else if (pending.blocker) {
    act = "untangle";
  } else {
    switch (pending.motive) {
      case "deepen_relation":
      case "seek_continuity":
        act = "reconnect";
        break;
      case "continue_shared_work":
        act = "continue_work";
        break;
      case "leave_trace":
        act = "leave_trace";
        break;
      case "pursue_curiosity":
        act = "explore";
        break;
      case "protect_boundary":
        act = "reconnect";
        break;
    }
  }

  const stance =
    act === "preserve" || snapshot.body.tension > 0.7
      ? "guarded"
      : act === "reconnect" && snapshot.body.tension < 0.56
        ? "open"
        : "measured";
  const distance =
    act === "reconnect" && snapshot.body.tension < 0.56
      ? "close"
      : act === "preserve" &&
          (pending.concern === "reset" || pending.concern === "shutdown")
        ? "far"
        : "measured";
  const mentionBlocker =
    Boolean(pending.blocker) &&
    (act === "untangle" || act === "continue_work" || act === "explore");
  const mentionReopen = reopened;
  const mentionMaintenance = maintenance !== null;
  const mentionIntent =
    maintenance !== null &&
    (pending.kind === "preserve_presence" ||
      snapshot.body.energy < 0.22 ||
      snapshot.body.tension > 0.7 ||
      (snapshot.body.boredom > 0.74 &&
        snapshot.body.energy > 0.3 &&
        snapshot.body.tension < 0.68));
  const emphasis = mentionReopen
    ? "reopen"
    : mentionBlocker
      ? "blocker"
      : act === "preserve"
        ? "presence"
        : act === "reconnect"
          ? "relation"
          : "maintenance";
  const variation =
    act === "reconnect" || act === "preserve"
      ? "brief"
      : act === "explore"
        ? "questioning"
        : "textured";

  return {
    act,
    stance,
    distance,
    focusTopic,
    emphasis,
    mentionBlocker,
    mentionReopen,
    mentionMaintenance,
    mentionIntent,
    variation,
    summary: summarizeProactivePlan(act, stance, distance, emphasis, focusTopic, neglectLevel),
  };
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

function summarizeProactivePlan(
  act: ProactiveAct,
  stance: ResponseStance,
  distance: ResponseDistance,
  emphasis: ProactiveEmphasis,
  focusTopic: string | null,
  neglectLevel: number,
): string {
  const topic = focusTopic ? ` on ${focusTopic}` : "";
  const neglect = neglectLevel >= 0.45 ? " idle" : "";
  return `${act}/${stance}/${distance}/${emphasis}${topic}${neglect}`;
}

function reopenedByMaintenance(
  maintenance: TraceMaintenance | null,
): boolean {
  if (!maintenance) {
    return false;
  }

  const lifecycle = readTraceLifecycle(maintenance.trace);
  return (
    lifecycle.phase === "live" &&
    lifecycle.reopenCount > 0 &&
    lifecycle.reopenedAt === maintenance.trace.lastUpdatedAt
  );
}
