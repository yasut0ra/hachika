import type {
  BodyState,
  DynamicsState,
  DriveName,
  DriveState,
  HachikaSnapshot,
  LearnedTemperament,
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
};

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

export function applyBoundedPressure(
  value: number,
  increase: number,
  decrease: number,
  baseline: number,
  settleRate: number,
): number {
  const amplifiedIncrease = increase * (0.4 + (1 - value) * 0.6);
  const amplifiedDecrease = decrease * (0.4 + value * 0.6);

  return settleTowardsBaseline(
    clamp01(value + amplifiedIncrease - amplifiedDecrease),
    baseline,
    settleRate,
  );
}

export function createInitialSnapshot(): HachikaSnapshot {
  return {
    version: 22,
    revision: 0,
    state: { ...INITIAL_STATE },
    body: { ...INITIAL_BODY },
    dynamics: { ...INITIAL_DYNAMICS },
    reactivity: { ...INITIAL_REACTIVITY },
    temperament: { ...INITIAL_TEMPERAMENT },
    attachment: INITIAL_ATTACHMENT,
    world: createInitialWorldState(),
    preferences: {},
    topicCounts: {},
    memories: [],
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
