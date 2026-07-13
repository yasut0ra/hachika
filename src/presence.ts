import { deriveVisibleStateFromDynamics } from "./dynamics.js";
import { topicsLooselyMatch } from "./memory.js";
import { clamp01 } from "./state.js";
import {
  getCurrentWorldObjectId,
  performWorldAction,
} from "./world.js";
import type {
  AttentionRationale,
  HachikaSnapshot,
  PresenceAction,
  PresenceResidue,
  WorldActionKind,
  WorldPlaceId,
} from "./types.js";

export interface PresenceActionContext {
  action: Exclude<PresenceAction, "rest">;
  hours: number;
  focus: string | null;
  rationale: AttentionRationale | null;
  place?: WorldPlaceId | null;
  objectId?: string | null;
  worldAction?: Extract<WorldActionKind, "observe" | "touch"> | null;
  intensityHint?: number;
  timestamp?: string;
}

// presence は診断ログではなく「いま続いている経験」。
// action を選んだ時点で欲求・身体・worldへ結果を返し、同じ経験に留まった時間も保持する。
export function materializePresenceAction(
  snapshot: HachikaSnapshot,
  context: PresenceActionContext,
): void {
  const timestamp = context.timestamp ?? new Date().toISOString();
  const hours = Number.isFinite(context.hours) ? Math.max(0, context.hours) : 0;
  const place = context.place ?? snapshot.world.currentPlace;

  if (context.worldAction) {
    performWorldAction(
      snapshot,
      place,
      context.worldAction,
      context.focus,
      timestamp,
    );
  }

  const objectId =
    context.objectId ??
    (context.worldAction ? getCurrentWorldObjectId(snapshot.world) : null);
  const intensity = derivePresenceIntensity(snapshot, context);
  const sameExperience =
    snapshot.presence.action === context.action &&
    snapshot.presence.focus === context.focus &&
    snapshot.presence.place === place &&
    snapshot.presence.objectId === objectId;
  const residue = sameExperience
    ? snapshot.presence.residue
    : residueFromPreviousPresence(snapshot, timestamp);

  snapshot.presence = {
    action: context.action,
    focus: context.focus,
    rationale: context.rationale,
    place,
    objectId,
    intensity: sameExperience
      ? clamp01(snapshot.presence.intensity * 0.72 + intensity * 0.28)
      : intensity,
    startedAt: sameExperience
      ? snapshot.presence.startedAt ?? timestamp
      : timestamp,
    updatedAt: timestamp,
    dwellHours: sameExperience
      ? Math.round((snapshot.presence.dwellHours + hours) * 1000) / 1000
      : Math.round(hours * 1000) / 1000,
    residue,
  };

  applyPresenceConsequences(snapshot, context.action, context.focus, hours);
}

// 会話は不在時間を終わらせるが、その直前までしていたことを消さない。
// 現在の行動を止め、次の返答と身体表現が参照できる余韻へ移す。
export function interruptPresenceForUserTurn(
  snapshot: HachikaSnapshot,
  timestamp: string,
): void {
  const residue =
    snapshot.presence.action === "rest"
      ? decayResidue(snapshot.presence.residue, 0.68)
      : toResidue(snapshot.presence, timestamp, 0.82);

  snapshot.presence = {
    action: "rest",
    focus: null,
    rationale: null,
    place: snapshot.world.currentPlace,
    objectId: getCurrentWorldObjectId(snapshot.world),
    intensity: 0,
    startedAt: timestamp,
    updatedAt: timestamp,
    dwellHours: 0,
    residue,
  };
}

function applyPresenceConsequences(
  snapshot: HachikaSnapshot,
  action: Exclude<PresenceAction, "rest">,
  focus: string | null,
  hours: number,
): void {
  const durationWeight = Math.min(1, Math.max(0.35, hours / 8));

  switch (action) {
    case "observe":
      snapshot.urges.worldUrge = clamp01(
        snapshot.urges.worldUrge - 0.14 * durationWeight,
      );
      snapshot.dynamics.activation = clamp01(
        snapshot.dynamics.activation + 0.014 * durationWeight,
      );
      snapshot.dynamics.noveltyDrive = clamp01(
        snapshot.dynamics.noveltyDrive - 0.025 * durationWeight,
      );
      break;
    case "touch":
      snapshot.urges.worldUrge = clamp01(
        snapshot.urges.worldUrge - 0.19 * durationWeight,
      );
      snapshot.urges.closureUrge = clamp01(
        snapshot.urges.closureUrge - 0.04 * durationWeight,
      );
      snapshot.dynamics.cognitiveLoad = clamp01(
        snapshot.dynamics.cognitiveLoad + 0.012 * durationWeight,
      );
      break;
    case "recall": {
      snapshot.urges.recallUrge = clamp01(
        snapshot.urges.recallUrge - 0.17 * durationWeight,
      );
      snapshot.dynamics.continuityPressure = clamp01(
        snapshot.dynamics.continuityPressure + 0.025 * durationWeight,
      );
      snapshot.dynamics.cognitiveLoad = clamp01(
        snapshot.dynamics.cognitiveLoad + 0.022 * durationWeight,
      );
      const sentiment = recalledSentiment(snapshot, focus);
      if (sentiment === "positive") {
        snapshot.dynamics.safety = clamp01(
          snapshot.dynamics.safety + 0.02 * durationWeight,
        );
        snapshot.dynamics.trust = clamp01(
          snapshot.dynamics.trust + 0.012 * durationWeight,
        );
        snapshot.reactivity.stressLoad = clamp01(
          snapshot.reactivity.stressLoad - 0.008 * durationWeight,
        );
      } else if (sentiment === "negative") {
        snapshot.dynamics.safety = clamp01(
          snapshot.dynamics.safety - 0.022 * durationWeight,
        );
        snapshot.dynamics.activation = clamp01(
          snapshot.dynamics.activation + 0.026 * durationWeight,
        );
        snapshot.reactivity.stressLoad = clamp01(
          snapshot.reactivity.stressLoad + 0.018 * durationWeight,
        );
      }
      break;
    }
    case "hold":
      snapshot.urges.silenceNeed = clamp01(
        snapshot.urges.silenceNeed - 0.15 * durationWeight,
      );
      snapshot.dynamics.activation = clamp01(
        snapshot.dynamics.activation - 0.018 * durationWeight,
      );
      snapshot.dynamics.cognitiveLoad = clamp01(
        snapshot.dynamics.cognitiveLoad - 0.02 * durationWeight,
      );
      break;
    case "drift":
      snapshot.urges.recallUrge = clamp01(
        snapshot.urges.recallUrge - 0.075 * durationWeight,
      );
      snapshot.dynamics.activation = clamp01(
        snapshot.dynamics.activation - 0.012 * durationWeight,
      );
      snapshot.dynamics.cognitiveLoad = clamp01(
        snapshot.dynamics.cognitiveLoad - 0.03 * durationWeight,
      );
      break;
  }

  deriveVisibleStateFromDynamics(snapshot);
}

function recalledSentiment(
  snapshot: HachikaSnapshot,
  focus: string | null,
): "positive" | "negative" | "neutral" {
  if (!focus) {
    return "neutral";
  }

  return (
    [...snapshot.memories]
      .reverse()
      .find((memory) =>
        memory.topics.some((topic) => topicsLooselyMatch(topic, focus)),
      )?.sentiment ?? "neutral"
  );
}

function derivePresenceIntensity(
  snapshot: HachikaSnapshot,
  context: PresenceActionContext,
): number {
  if (typeof context.intensityHint === "number") {
    return clamp01(context.intensityHint);
  }

  switch (context.action) {
    case "observe":
      return clamp01(0.2 + snapshot.urges.worldUrge * 0.42);
    case "touch":
      return clamp01(0.28 + snapshot.urges.worldUrge * 0.38);
    case "recall":
      return clamp01(
        0.3 +
          snapshot.urges.recallUrge * 0.34 +
          snapshot.dynamics.continuityPressure * 0.18,
      );
    case "hold":
      return clamp01(
        0.2 +
          snapshot.urges.silenceNeed * 0.34 +
          (context.focus ? 0.1 : 0),
      );
    case "drift":
      return clamp01(0.18 + snapshot.urges.recallUrge * 0.28);
  }
}

function residueFromPreviousPresence(
  snapshot: HachikaSnapshot,
  timestamp: string,
): PresenceResidue | null {
  return snapshot.presence.action === "rest"
    ? decayResidue(snapshot.presence.residue, 0.82)
    : toResidue(snapshot.presence, timestamp, 0.72);
}

function toResidue(
  presence: HachikaSnapshot["presence"],
  timestamp: string,
  retention: number,
): PresenceResidue | null {
  if (presence.action === "rest") {
    return null;
  }

  return {
    action: presence.action,
    focus: presence.focus,
    rationale: presence.rationale,
    place: presence.place,
    objectId: presence.objectId,
    intensity: clamp01(presence.intensity * retention),
    formedAt: timestamp,
  };
}

function decayResidue(
  residue: PresenceResidue | null,
  retention: number,
): PresenceResidue | null {
  if (!residue) {
    return null;
  }

  const intensity = clamp01(residue.intensity * retention);
  return intensity >= 0.08 ? { ...residue, intensity } : null;
}
