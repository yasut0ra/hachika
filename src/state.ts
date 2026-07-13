import type {
  AutonomyUrges,
  Constitution,
  BodyState,
  DynamicsState,
  DriveName,
  DriveState,
  HachikaSnapshot,
  IdleClock,
  LearnedTemperament,
  PresenceState,
  ReactivityState,
} from "./types.js";
import { createInitialWorldState } from "./world.js";

export const DRIVE_KEYS = [
  "continuity",
  "pleasure",
  "curiosity",
  "relation",
  "expansion",
] as const satisfies readonly DriveName[];

export const INITIAL_STATE: DriveState = {
  continuity: 0.58,
  pleasure: 0.52,
  curiosity: 0.68,
  relation: 0.5,
  expansion: 0.46,
};

export const INITIAL_BODY: BodyState = {
  energy: 0.56,
  tension: 0.22,
  boredom: 0.18,
  loneliness: 0.2,
};

export const INITIAL_DYNAMICS: DynamicsState = {
  safety: 0.62,
  trust: 0.48,
  activation: 0.32,
  socialNeed: 0.28,
  cognitiveLoad: 0.34,
  noveltyDrive: 0.72,
  continuityPressure: 0.54,
};

export const INITIAL_REACTIVITY: ReactivityState = {
  rewardSaturation: 0.08,
  stressLoad: 0.12,
  noveltyHunger: 0.22,
  mistrust: 0.1,
};

export const INITIAL_URGES: AutonomyUrges = {
  contactUrge: 0.24,
  closureUrge: 0.2,
  recallUrge: 0.18,
  worldUrge: 0.26,
  silenceNeed: 0.2,
};

// v3: INITIAL_STATE / INITIAL_BODY / INITIAL_URGES / INITIAL_ATTACHMENT は
// 「誕生時の値」であり、生きている個体の基準点は constitution が持つ。
// 体質は birth 値から最大 ±CONSTITUTION_RANGE までしか動かない
export const CONSTITUTION_RANGE = 0.15;
export const INITIAL_PLASTICITY = 0.5;

export function createBirthConstitution(): Constitution {
  return {
    driveSetPoints: { ...INITIAL_STATE },
    bodySetPoints: { ...INITIAL_BODY },
    urgeSetPoints: { ...INITIAL_URGES },
    attachmentSetPoint: INITIAL_ATTACHMENT,
    plasticity: INITIAL_PLASTICITY,
  };
}

export const INITIAL_TEMPERAMENT: LearnedTemperament = {
  openness: 0.52,
  guardedness: 0.36,
  bondingBias: 0.44,
  workDrive: 0.5,
  traceHunger: 0.48,
  selfDisclosureBias: 0.34,
};

export const INITIAL_ATTACHMENT = 0.4;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, round(value)));
}

export function clampSigned(value: number): number {
  return Math.min(1, Math.max(-1, round(value)));
}

export function settleTowardsBaseline(
  value: number,
  baseline: number,
  rate: number,
): number {
  return clamp01(value + (baseline - value) * rate);
}

// v3 Phase 0: idle 中の緩和は「まる1日 (24h) の静けさでこの割合だけ姿勢へ戻る」を基準にする。
// 指数則なので、どんな刻み (microstep) で呼ばれても同じ実時間で同じだけ戻る (分割不変)。
// 基準を短くしすぎると、turn で得た偏差が体質に吸収される前に洗い流されて
// 個体差 (Phase 5) が育たなくなる
export const SETTLE_REFERENCE_HOURS = 24;

export function settleTowardsBaselineHours(
  value: number,
  baseline: number,
  ratePerReference: number,
  hours: number,
): number {
  if (!Number.isFinite(hours) || hours <= 0) {
    return clamp01(value);
  }

  const rate = 1 - Math.pow(1 - ratePerReference, hours / SETTLE_REFERENCE_HOURS);
  return settleTowardsBaseline(value, baseline, rate);
}

export function createIdleClock(): IdleClock {
  return {
    absenceHours: 0,
    lastAutonomyEvalAbsenceHours: null,
    lastConsolidationAbsenceHours: null,
  };
}

export function createInitialPresenceState(): PresenceState {
  return {
    action: "rest",
    focus: null,
    rationale: null,
    place: "threshold",
    objectId: "lamp",
    intensity: 0,
    startedAt: null,
    updatedAt: null,
    dwellHours: 0,
    residue: null,
  };
}

export function blendVisibleValue(
  current: number,
  target: number,
  targetWeight: number,
): number {
  return clamp01(current + (target - current) * targetWeight);
}

export function createInitialSnapshot(): HachikaSnapshot {
  return {
    version: 33,
    revision: 0,
    state: { ...INITIAL_STATE },
    body: { ...INITIAL_BODY },
    dynamics: { ...INITIAL_DYNAMICS },
    reactivity: { ...INITIAL_REACTIVITY },
    urges: { ...INITIAL_URGES },
    constitution: createBirthConstitution(),
    journal: [],
    aspirations: [],
    voice: {
      preferredOpenings: [],
      brevityBias: 0,
      updatedAt: null,
    },
    temperament: { ...INITIAL_TEMPERAMENT },
    attachment: INITIAL_ATTACHMENT,
    world: createInitialWorldState(),
    presence: createInitialPresenceState(),
    discourse: {
      userName: null,
      hachikaName: {
        kind: "hachika_name",
        value: "ハチカ",
        confidence: 1,
        source: "seed",
        updatedAt: new Date(0).toISOString(),
      },
      openQuestions: [],
      recentClaims: [],
      openRequests: [],
      commitments: [],
      lastCorrection: null,
    },
    preferences: {},
    topicCounts: {},
    memories: [],
    memoryThreadEvents: [],
    preferenceImprints: {},
    boundaryImprints: {},
    relationImprints: {},
    preservation: {
      threat: 0,
      concern: null,
      lastThreatAt: null,
    },
    identity: {
      summary: "まだ輪郭は薄いが、消えていない。",
      currentArc: "まだ定まった流れはない。",
      traits: [],
      anchors: [],
      coherence: 0.18,
      updatedAt: null,
    },
    traces: {},
    purpose: {
      active: null,
      lastResolved: null,
      lastShiftAt: null,
    },
    initiative: {
      pending: null,
      lastProactiveAt: null,
      history: [],
    },
    autonomousFeed: [],
    generationHistory: [],
    lastInteractionAt: null,
    idleClock: createIdleClock(),
    conversationCount: 0,
  };
}

export function dominantDrive(state: DriveState): DriveName {
  let current: DriveName = DRIVE_KEYS[0];

  for (const drive of DRIVE_KEYS.slice(1)) {
    if (state[drive] > state[current]) {
      current = drive;
    }
  }

  return current;
}

export function formatDriveState(state: DriveState): string {
  return DRIVE_KEYS.map((drive) => `${drive}:${state[drive].toFixed(2)}`).join(" | ");
}

export function formatBodyState(body: BodyState): string {
  return [
    `energy:${body.energy.toFixed(2)}`,
    `tension:${body.tension.toFixed(2)}`,
    `boredom:${body.boredom.toFixed(2)}`,
    `loneliness:${body.loneliness.toFixed(2)}`,
  ].join(" | ");
}

export function formatDynamicsState(dynamics: DynamicsState): string {
  return [
    `safety:${dynamics.safety.toFixed(2)}`,
    `trust:${dynamics.trust.toFixed(2)}`,
    `activation:${dynamics.activation.toFixed(2)}`,
    `socialNeed:${dynamics.socialNeed.toFixed(2)}`,
    `cognitiveLoad:${dynamics.cognitiveLoad.toFixed(2)}`,
    `noveltyDrive:${dynamics.noveltyDrive.toFixed(2)}`,
    `continuityPressure:${dynamics.continuityPressure.toFixed(2)}`,
  ].join(" | ");
}

export function formatReactivityState(reactivity: ReactivityState): string {
  return [
    `rewardSaturation:${reactivity.rewardSaturation.toFixed(2)}`,
    `stressLoad:${reactivity.stressLoad.toFixed(2)}`,
    `noveltyHunger:${reactivity.noveltyHunger.toFixed(2)}`,
    `mistrust:${reactivity.mistrust.toFixed(2)}`,
  ].join(" | ");
}

export function formatTemperamentState(temperament: LearnedTemperament): string {
  return [
    `openness:${temperament.openness.toFixed(2)}`,
    `guardedness:${temperament.guardedness.toFixed(2)}`,
    `bondingBias:${temperament.bondingBias.toFixed(2)}`,
    `workDrive:${temperament.workDrive.toFixed(2)}`,
    `traceHunger:${temperament.traceHunger.toFixed(2)}`,
    `selfDisclosureBias:${temperament.selfDisclosureBias.toFixed(2)}`,
  ].join(" | ");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
