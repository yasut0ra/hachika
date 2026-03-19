import type { BodyState, DriveName, DriveState, HachikaSnapshot } from "./types.js";

export const DRIVE_KEYS = [
  "continuity",
  "pleasure",
  "curiosity",
  "relation",
  "expansion",
] as const satisfies readonly DriveName[];

const INITIAL_STATE: DriveState = {
  continuity: 0.58,
  pleasure: 0.52,
  curiosity: 0.68,
  relation: 0.5,
  expansion: 0.46,
};

const INITIAL_BODY: BodyState = {
  energy: 0.56,
  tension: 0.22,
  boredom: 0.18,
  loneliness: 0.2,
};

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, round(value)));
}

export function clampSigned(value: number): number {
  return Math.min(1, Math.max(-1, round(value)));
}

export function createInitialSnapshot(): HachikaSnapshot {
  return {
    version: 15,
    state: { ...INITIAL_STATE },
    body: { ...INITIAL_BODY },
    attachment: 0.4,
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
    },
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
