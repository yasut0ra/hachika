import type {
  HachikaSnapshot,
  InitiativeAutonomyAction,
  WorldEventKind,
  WorldPlaceId,
} from "./types.js";

export type EmbodimentPosture = "open" | "settled" | "guarded" | "withdrawn";
export type EmbodimentGazeTarget = "viewer" | "lamp" | "desk" | "shelf" | "down" | "distance";
export type EmbodimentAction = InitiativeAutonomyAction | "rest";
export type EmbodimentManner = "reaching" | "measured" | "guarded" | "searching";

export interface EmbodimentMotionProfile {
  manner: EmbodimentManner;
  gestureAmplitude: number;
  gazePersistence: number;
  stillness: number;
  settlingTimeMs: number;
}

export interface EmbodimentState {
  posture: EmbodimentPosture;
  gazeTarget: EmbodimentGazeTarget;
  action: EmbodimentAction;
  actionId: string;
  place: WorldPlaceId;
  phase: HachikaSnapshot["world"]["phase"];
  movementTempo: number;
  breathDepth: number;
  proximity: number;
  expressionWarmth: number;
  alertness: number;
  tension: number;
  motion: EmbodimentMotionProfile;
  summary: string;
}

const ACTIVE_ACTION_MAX_AGE_MS = 5 * 60 * 1000;
const SPEAKING_MAX_AGE_MS = 12 * 1000;

export function deriveEmbodimentState(
  snapshot: HachikaSnapshot,
  now: Date = new Date(),
): EmbodimentState {
  const currentAction = deriveCurrentAction(snapshot, now);
  const action = currentAction.action;
  const posture = derivePosture(snapshot);
  const gazeTarget = deriveGazeTarget(snapshot, action);
  const motion = deriveMotionProfile(snapshot);
  const movementTempo = clamp01(
    0.12 +
      snapshot.body.energy * 0.48 +
      snapshot.dynamics.activation * 0.24 +
      snapshot.body.boredom * 0.08 -
      snapshot.body.tension * 0.2,
  );
  const breathDepth = clamp01(
    0.28 +
      snapshot.body.energy * 0.34 +
      snapshot.dynamics.safety * 0.18 -
      snapshot.body.tension * 0.22,
  );
  const proximity = clamp01(
    0.34 +
      snapshot.dynamics.trust * 0.24 +
      snapshot.state.relation * 0.18 -
      snapshot.temperament.guardedness * 0.2 -
      snapshot.preservation.threat * 0.24,
  );
  const expressionWarmth = clamp01(
    0.3 +
      snapshot.state.pleasure * 0.28 +
      snapshot.dynamics.trust * 0.18 +
      snapshot.temperament.openness * 0.1 -
      snapshot.reactivity.mistrust * 0.26,
  );
  const alertness = clamp01(
    snapshot.dynamics.activation * 0.42 +
      snapshot.state.curiosity * 0.28 +
      snapshot.reactivity.noveltyHunger * 0.18 +
      snapshot.body.tension * 0.12,
  );

  return {
    posture,
    gazeTarget,
    action,
    actionId: currentAction.id,
    place: snapshot.world.currentPlace,
    phase: snapshot.world.phase,
    movementTempo,
    breathDepth,
    proximity,
    expressionWarmth,
    alertness,
    tension: clamp01(snapshot.body.tension),
    motion,
    summary: describeEmbodiment(posture, action, gazeTarget),
  };
}

function deriveCurrentAction(
  snapshot: HachikaSnapshot,
  now: Date,
): { action: EmbodimentAction; id: string } {
  const latestHachikaMemory = [...snapshot.memories]
    .reverse()
    .find((memory) => memory.role === "hachika");
  const recentProactive =
    latestHachikaMemory !== undefined &&
    snapshot.initiative.lastProactiveAt !== null &&
    timestampsWithin(
      latestHachikaMemory.timestamp,
      snapshot.initiative.lastProactiveAt,
      2_000,
    );

  if (
    latestHachikaMemory &&
    (snapshot.idleClock.absenceHours < 1e-6 || recentProactive) &&
    ageMs(latestHachikaMemory.timestamp, now) <= SPEAKING_MAX_AGE_MS
  ) {
    return {
      action: "speak",
      id: `speak:${latestHachikaMemory.timestamp}`,
    };
  }

  const latestActivity = snapshot.initiative.history.at(-1);
  if (
    latestActivity?.autonomyAction &&
    ageMs(latestActivity.timestamp, now) <= ACTIVE_ACTION_MAX_AGE_MS
  ) {
    return {
      action: latestActivity.autonomyAction,
      id: `${latestActivity.autonomyAction}:${latestActivity.timestamp}`,
    };
  }

  const latestWorldEvent = snapshot.world.recentEvents.at(-1);
  if (latestWorldEvent && ageMs(latestWorldEvent.timestamp, now) <= ACTIVE_ACTION_MAX_AGE_MS) {
    const action = worldEventToAction(latestWorldEvent.kind);
    return {
      action,
      id: `${action}:${latestWorldEvent.timestamp}`,
    };
  }

  return {
    action: "rest",
    id: "rest",
  };
}

function deriveMotionProfile(snapshot: HachikaSnapshot): EmbodimentMotionProfile {
  const temperament = snapshot.temperament;
  const mannerScores: Record<EmbodimentManner, number> = {
    reaching:
      temperament.bondingBias * 0.6 +
      temperament.openness * 0.15 +
      temperament.selfDisclosureBias * 0.15 -
      temperament.guardedness * 0.1,
    searching:
      temperament.openness * 0.35 +
      temperament.workDrive * 0.3 +
      temperament.traceHunger * 0.35 -
      temperament.bondingBias * 0.12,
    guarded:
      temperament.guardedness * 0.58 +
      temperament.traceHunger * 0.16 +
      (1 - temperament.selfDisclosureBias) * 0.18 +
      (1 - temperament.openness) * 0.08,
    measured:
      0.46 -
      Math.max(
        Math.abs(temperament.bondingBias - temperament.workDrive),
        Math.abs(temperament.openness - temperament.guardedness),
        Math.abs(temperament.traceHunger - 0.5),
      ) *
        0.25,
  };
  const manner = (Object.entries(mannerScores) as [EmbodimentManner, number][]).reduce(
    (best, candidate) => (candidate[1] > best[1] ? candidate : best),
  )[0];
  const stillness = clamp01(
    0.28 +
      temperament.guardedness * 0.38 +
      temperament.traceHunger * 0.16 -
      temperament.openness * 0.18,
  );
  const gestureAmplitude = clamp01(
    0.18 +
      temperament.openness * 0.3 +
      temperament.workDrive * 0.12 +
      temperament.bondingBias * 0.08 -
      temperament.guardedness * 0.22,
  );
  const gazePersistence = clamp01(
    0.25 +
      temperament.bondingBias * 0.38 +
      temperament.traceHunger * 0.12 +
      temperament.selfDisclosureBias * 0.1 -
      temperament.guardedness * 0.18,
  );

  return {
    manner,
    gestureAmplitude,
    gazePersistence,
    stillness,
    settlingTimeMs: Math.round(650 + stillness * 1_250 + temperament.traceHunger * 450),
  };
}

function derivePosture(snapshot: HachikaSnapshot): EmbodimentPosture {
  const closure =
    snapshot.body.tension * 0.34 +
    snapshot.temperament.guardedness * 0.28 +
    snapshot.reactivity.mistrust * 0.2 +
    snapshot.preservation.threat * 0.24 -
    snapshot.dynamics.safety * 0.18;

  if (closure >= 0.55 || snapshot.preservation.threat >= 0.62) {
    return "withdrawn";
  }
  if (closure >= 0.3) {
    return "guarded";
  }
  if (snapshot.dynamics.trust >= 0.58 && snapshot.body.tension <= 0.28) {
    return "open";
  }
  return "settled";
}

function deriveGazeTarget(
  snapshot: HachikaSnapshot,
  action: EmbodimentAction,
): EmbodimentGazeTarget {
  switch (action) {
    case "speak":
      return "viewer";
    case "recall":
      return "shelf";
    case "hold":
      return "down";
    case "drift":
      return "distance";
    case "observe":
    case "touch":
      return objectForPlace(snapshot.world.currentPlace);
    case "rest":
      if (snapshot.dynamics.socialNeed >= 0.68 && snapshot.reactivity.mistrust < 0.5) {
        return "viewer";
      }
      return objectForPlace(snapshot.world.currentPlace);
  }
}

function objectForPlace(place: WorldPlaceId): EmbodimentGazeTarget {
  switch (place) {
    case "threshold":
      return "lamp";
    case "studio":
      return "desk";
    case "archive":
      return "shelf";
  }
}

function worldEventToAction(kind: WorldEventKind): EmbodimentAction {
  switch (kind) {
    case "observe":
    case "touch":
      return kind;
    case "leave":
      return "drift";
    default:
      return "rest";
  }
}

function describeEmbodiment(
  posture: EmbodimentPosture,
  action: EmbodimentAction,
  gazeTarget: EmbodimentGazeTarget,
): string {
  const postureText: Record<EmbodimentPosture, string> = {
    open: "ひらいた姿勢",
    settled: "静かな姿勢",
    guarded: "少し身を閉じた姿勢",
    withdrawn: "距離を守る姿勢",
  };
  const actionText: Record<EmbodimentAction, string> = {
    observe: "見ている",
    recall: "思い返している",
    hold: "言葉を抱えている",
    drift: "意識を漂わせている",
    touch: "痕跡に触れている",
    speak: "こちらへ話している",
    rest: "呼吸している",
  };
  const gazeText: Record<EmbodimentGazeTarget, string> = {
    viewer: "こちら",
    lamp: "灯り",
    desk: "机",
    shelf: "棚",
    down: "手元",
    distance: "遠く",
  };

  return `${postureText[posture]}で、${gazeText[gazeTarget]}を見ながら${actionText[action]}。`;
}

function ageMs(timestamp: string, now: Date): number {
  const time = new Date(timestamp).getTime();
  const delta = now.getTime() - time;
  return Number.isFinite(time) && delta >= 0 ? delta : Number.POSITIVE_INFINITY;
}

function timestampsWithin(left: string, right: string, toleranceMs: number): boolean {
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    Math.abs(leftTime - rightTime) <= toleranceMs
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
