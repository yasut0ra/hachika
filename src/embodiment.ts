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

export interface EmbodimentLayerState {
  eyes: "open" | "closed";
  mouth: "neutral" | "speaking";
  hands: "rest" | "reach" | "gather";
  blinkIntervalMs: number;
}

export interface EmbodimentSpeechState {
  id: string | null;
  active: boolean;
  startedAt: string | null;
  durationMs: number;
  remainingMs: number;
  cadence: number;
  emphasis: number;
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
  layers: EmbodimentLayerState;
  speech: EmbodimentSpeechState;
  summary: string;
}

const ACTIVE_ACTION_MAX_AGE_MS = 5 * 60 * 1000;
const MIN_SPEECH_DURATION_MS = 1_800;
const MAX_SPEECH_DURATION_MS = 16_000;

export function deriveEmbodimentState(
  snapshot: HachikaSnapshot,
  now: Date = new Date(),
): EmbodimentState {
  const speech = deriveSpeechState(snapshot, now);
  const currentAction = deriveCurrentAction(snapshot, now, speech);
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
  const layers = deriveLayerState(snapshot, action, alertness, motion, speech);

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
    layers,
    speech,
    summary: describeEmbodiment(posture, action, gazeTarget),
  };
}

function deriveLayerState(
  snapshot: HachikaSnapshot,
  action: EmbodimentAction,
  alertness: number,
  motion: EmbodimentMotionProfile,
  speech: EmbodimentSpeechState,
): EmbodimentLayerState {
  const eyes =
    action === "hold" &&
    (snapshot.body.tension >= 0.46 || snapshot.temperament.guardedness >= 0.58)
      ? "closed"
      : "open";
  const hands =
    action === "touch" || action === "observe"
      ? "reach"
      : action === "recall" || action === "hold"
        ? "gather"
        : "rest";

  return {
    eyes,
    mouth: speech.active ? "speaking" : "neutral",
    hands,
    blinkIntervalMs: Math.round(
      2_800 + motion.stillness * 2_800 + motion.gazePersistence * 900 - alertness * 750,
    ),
  };
}

function deriveSpeechState(
  snapshot: HachikaSnapshot,
  now: Date,
): EmbodimentSpeechState {
  const latestHachikaMemory = [...snapshot.memories]
    .reverse()
    .find((memory) => memory.role === "hachika");

  if (!latestHachikaMemory) {
    return {
      id: null,
      active: false,
      startedAt: null,
      durationMs: 0,
      remainingMs: 0,
      cadence: 0,
      emphasis: 0,
    };
  }

  const durationMs = deriveSpeechDurationMs(latestHachikaMemory.text);
  const elapsedMs = ageMs(latestHachikaMemory.timestamp, now);
  const recentProactive =
    snapshot.initiative.lastProactiveAt !== null &&
    timestampsWithin(
      latestHachikaMemory.timestamp,
      snapshot.initiative.lastProactiveAt,
      2_000,
    );
  const canBeSpeaking = snapshot.idleClock.absenceHours < 1e-6 || recentProactive;
  const active = canBeSpeaking && elapsedMs <= durationMs;
  const punctuationEmphasis = /[!！?？]/u.test(latestHachikaMemory.text) ? 0.18 : 0;
  const cadence = clamp01(
    0.34 +
      snapshot.dynamics.activation * 0.28 +
      snapshot.temperament.openness * 0.16 -
      snapshot.body.tension * 0.12 -
      snapshot.voice.brevityBias * 0.06,
  );
  const emphasis = clamp01(
    0.22 +
      snapshot.dynamics.activation * 0.28 +
      snapshot.state.pleasure * 0.1 +
      snapshot.state.relation * 0.08 +
      punctuationEmphasis -
      snapshot.body.tension * 0.08,
  );

  return {
    id: `speak:${latestHachikaMemory.timestamp}`,
    active,
    startedAt: latestHachikaMemory.timestamp,
    durationMs,
    remainingMs: active ? Math.max(0, Math.round(durationMs - elapsedMs)) : 0,
    cadence,
    emphasis,
  };
}

function deriveSpeechDurationMs(text: string): number {
  const spokenUnits = [...text].filter((character) => !/\s/u.test(character)).length;
  const pauseCount = (text.match(/[、,，…]/gu) ?? []).length;
  const stopCount = (text.match(/[。.!！?？]/gu) ?? []).length;
  const estimated = 900 + spokenUnits * 72 + pauseCount * 150 + stopCount * 260;
  return Math.min(MAX_SPEECH_DURATION_MS, Math.max(MIN_SPEECH_DURATION_MS, estimated));
}

function deriveCurrentAction(
  snapshot: HachikaSnapshot,
  now: Date,
  speech: EmbodimentSpeechState,
): { action: EmbodimentAction; id: string } {
  if (speech.active && speech.id) {
    return {
      action: "speak",
      id: speech.id,
    };
  }

  if (snapshot.presence.action !== "rest") {
    return {
      action: snapshot.presence.action,
      id: `presence:${snapshot.presence.action}:${snapshot.presence.startedAt ?? "ongoing"}`,
    };
  }

  const latestActivity = snapshot.initiative.history.at(-1);
  if (
    latestActivity?.autonomyAction &&
    latestActivity.autonomyAction !== "speak" &&
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
      if (snapshot.presence.residue?.intensity && snapshot.presence.residue.intensity >= 0.2) {
        switch (snapshot.presence.residue.action) {
          case "recall":
            return "shelf";
          case "hold":
            return "down";
          case "drift":
            return "distance";
          case "observe":
          case "touch":
            return objectForPlace(snapshot.presence.residue.place);
        }
      }
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
