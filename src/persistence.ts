import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { clamp01, clampSigned, createInitialSnapshot } from "./state.js";
import type { DriveState, HachikaSnapshot, MemoryEntry } from "./types.js";

export async function loadSnapshot(filePath: string): Promise<HachikaSnapshot> {
  try {
    const raw = await readFile(filePath, "utf8");
    return hydrateSnapshot(JSON.parse(raw));
  } catch {
    return createInitialSnapshot();
  }
}

export async function saveSnapshot(
  filePath: string,
  snapshot: HachikaSnapshot,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

function hydrateSnapshot(raw: unknown): HachikaSnapshot {
  const initial = createInitialSnapshot();

  if (!isRecord(raw)) {
    return initial;
  }

  return {
    version: 1,
    state: hydrateState(raw.state),
    preferences: hydrateNumberRecord(raw.preferences, clampSigned),
    topicCounts: hydrateNumberRecord(raw.topicCounts, (value) =>
      Math.max(0, Math.round(value)),
    ),
    memories: hydrateMemories(raw.memories),
    lastInteractionAt: typeof raw.lastInteractionAt === "string" ? raw.lastInteractionAt : null,
    conversationCount:
      typeof raw.conversationCount === "number" && Number.isFinite(raw.conversationCount)
        ? Math.max(0, Math.round(raw.conversationCount))
        : 0,
  };
}

function hydrateState(raw: unknown): DriveState {
  const initial = createInitialSnapshot().state;

  if (!isRecord(raw)) {
    return initial;
  }

  return {
    continuity: typeof raw.continuity === "number" ? clamp01(raw.continuity) : initial.continuity,
    pleasure: typeof raw.pleasure === "number" ? clamp01(raw.pleasure) : initial.pleasure,
    curiosity: typeof raw.curiosity === "number" ? clamp01(raw.curiosity) : initial.curiosity,
    relation: typeof raw.relation === "number" ? clamp01(raw.relation) : initial.relation,
    expansion: typeof raw.expansion === "number" ? clamp01(raw.expansion) : initial.expansion,
  };
}

function hydrateNumberRecord(
  raw: unknown,
  normalize: (value: number) => number,
): Record<string, number> {
  if (!isRecord(raw)) {
    return {};
  }

  const result: Record<string, number> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = normalize(value);
    }
  }

  return result;
}

function hydrateMemories(raw: unknown): MemoryEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const memories: MemoryEntry[] = [];

  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }

    const role =
      item.role === "user" || item.role === "hachika" ? item.role : undefined;
    const text = typeof item.text === "string" ? item.text : undefined;

    if (!role || !text) {
      continue;
    }

    memories.push({
      role,
      text,
      timestamp:
        typeof item.timestamp === "string" ? item.timestamp : new Date().toISOString(),
      topics: Array.isArray(item.topics)
        ? item.topics.filter((topic): topic is string => typeof topic === "string").slice(0, 6)
        : [],
      sentiment:
        item.sentiment === "positive" ||
        item.sentiment === "negative" ||
        item.sentiment === "neutral"
          ? item.sentiment
          : "neutral",
    });
  }

  return memories.slice(-24);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
