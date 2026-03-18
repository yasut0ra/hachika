import type { DriveName, DriveState, HachikaSnapshot } from "./types.js";

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

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, round(value)));
}

export function clampSigned(value: number): number {
  return Math.min(1, Math.max(-1, round(value)));
}

export function createInitialSnapshot(): HachikaSnapshot {
  return {
    version: 1,
    state: { ...INITIAL_STATE },
    preferences: {},
    topicCounts: {},
    memories: [],
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
