import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { clamp01, clampSigned, createInitialSnapshot } from "./state.js";
import type {
  ActivePurpose,
  BoundaryImprint,
  DriveState,
  HachikaSnapshot,
  InitiativeState,
  MemoryEntry,
  MotiveKind,
  PendingInitiative,
  PurposeState,
  PreferenceImprint,
  RelationImprint,
  ResolvedPurpose,
} from "./types.js";

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
    version: 7,
    state: hydrateState(raw.state),
    attachment:
      typeof raw.attachment === "number" ? clamp01(raw.attachment) : initial.attachment,
    preferences: hydrateNumberRecord(raw.preferences, clampSigned),
    topicCounts: hydrateNumberRecord(raw.topicCounts, (value) =>
      Math.max(0, Math.round(value)),
    ),
    memories: hydrateMemories(raw.memories),
    preferenceImprints: hydratePreferenceImprints(raw.preferenceImprints, raw.imprints),
    boundaryImprints: hydrateBoundaryImprints(raw.boundaryImprints),
    relationImprints: hydrateRelationImprints(raw.relationImprints),
    purpose: hydratePurpose(raw.purpose),
    initiative: hydrateInitiative(raw.initiative),
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

function hydratePreferenceImprints(
  raw: unknown,
  legacyRaw?: unknown,
): Record<string, PreferenceImprint> {
  if (isRecord(raw)) {
    return hydratePreferenceImprintRecord(raw);
  }

  if (isRecord(legacyRaw)) {
    return hydrateLegacyPreferenceImprints(legacyRaw);
  }

  return {};
}

function hydratePreferenceImprintRecord(raw: Record<string, unknown>): Record<string, PreferenceImprint> {
  const result: Record<string, PreferenceImprint> = {};

  for (const [topic, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      continue;
    }

    result[topic] = {
      topic,
      salience: typeof value.salience === "number" ? clamp01(value.salience) : 0.3,
      affinity: typeof value.affinity === "number" ? clampSigned(value.affinity) : 0,
      mentions:
        typeof value.mentions === "number" && Number.isFinite(value.mentions)
          ? Math.max(1, Math.round(value.mentions))
          : 1,
      firstSeenAt:
        typeof value.firstSeenAt === "string" ? value.firstSeenAt : new Date().toISOString(),
      lastSeenAt:
        typeof value.lastSeenAt === "string" ? value.lastSeenAt : new Date().toISOString(),
    };
  }

  return result;
}

function hydrateLegacyPreferenceImprints(
  raw: Record<string, unknown>,
): Record<string, PreferenceImprint> {
  const result: Record<string, PreferenceImprint> = {};

  for (const [topic, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      continue;
    }

    result[topic] = {
      topic,
      salience: typeof value.salience === "number" ? clamp01(value.salience) : 0.3,
      affinity:
        typeof value.valence === "number"
          ? clampSigned(value.valence)
          : typeof value.affinity === "number"
            ? clampSigned(value.affinity)
            : 0,
      mentions:
        typeof value.mentions === "number" && Number.isFinite(value.mentions)
          ? Math.max(1, Math.round(value.mentions))
          : 1,
      firstSeenAt:
        typeof value.firstSeenAt === "string" ? value.firstSeenAt : new Date().toISOString(),
      lastSeenAt:
        typeof value.lastSeenAt === "string" ? value.lastSeenAt : new Date().toISOString(),
    };
  }

  return result;
}

function hydrateBoundaryImprints(raw: unknown): Record<string, BoundaryImprint> {
  if (!isRecord(raw)) {
    return {};
  }

  const result: Record<string, BoundaryImprint> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      continue;
    }

    const kind =
      value.kind === "hostility" || value.kind === "dismissal" || value.kind === "neglect"
        ? value.kind
        : undefined;

    if (!kind) {
      continue;
    }

    result[key] = {
      kind,
      topic: typeof value.topic === "string" ? value.topic : null,
      salience: typeof value.salience === "number" ? clamp01(value.salience) : 0.3,
      intensity: typeof value.intensity === "number" ? clamp01(value.intensity) : 0.3,
      violations:
        typeof value.violations === "number" && Number.isFinite(value.violations)
          ? Math.max(1, Math.round(value.violations))
          : 1,
      firstSeenAt:
        typeof value.firstSeenAt === "string" ? value.firstSeenAt : new Date().toISOString(),
      lastSeenAt:
        typeof value.lastSeenAt === "string" ? value.lastSeenAt : new Date().toISOString(),
    };
  }

  return result;
}

function hydrateRelationImprints(raw: unknown): Record<string, RelationImprint> {
  if (!isRecord(raw)) {
    return {};
  }

  const result: Record<string, RelationImprint> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      continue;
    }

    const kind =
      value.kind === "attention" ||
      value.kind === "continuity" ||
      value.kind === "shared_work"
        ? value.kind
        : undefined;

    if (!kind) {
      continue;
    }

    result[key] = {
      kind,
      salience: typeof value.salience === "number" ? clamp01(value.salience) : 0.3,
      closeness: typeof value.closeness === "number" ? clamp01(value.closeness) : 0.3,
      mentions:
        typeof value.mentions === "number" && Number.isFinite(value.mentions)
          ? Math.max(1, Math.round(value.mentions))
          : 1,
      firstSeenAt:
        typeof value.firstSeenAt === "string" ? value.firstSeenAt : new Date().toISOString(),
      lastSeenAt:
        typeof value.lastSeenAt === "string" ? value.lastSeenAt : new Date().toISOString(),
    };
  }

  return result;
}

function hydratePurpose(raw: unknown): PurposeState {
  if (!isRecord(raw)) {
    return {
      active: null,
      lastResolved: null,
      lastShiftAt: null,
    };
  }

  return {
    active: hydrateActivePurpose(raw.active),
    lastResolved: hydrateResolvedPurpose(raw.lastResolved),
    lastShiftAt: typeof raw.lastShiftAt === "string" ? raw.lastShiftAt : null,
  };
}

function hydrateInitiative(raw: unknown): InitiativeState {
  if (!isRecord(raw)) {
    return {
      pending: null,
      lastProactiveAt: null,
    };
  }

  return {
    pending: hydratePendingInitiative(raw.pending),
    lastProactiveAt:
      typeof raw.lastProactiveAt === "string" ? raw.lastProactiveAt : null,
  };
}

function hydrateActivePurpose(raw: unknown): ActivePurpose | null {
  if (!isRecord(raw)) {
    return null;
  }

  const kind = isMotiveKind(raw.kind) ? raw.kind : undefined;
  if (!kind) {
    return null;
  }

  return {
    kind,
    topic: typeof raw.topic === "string" ? raw.topic : null,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    confidence:
      typeof raw.confidence === "number" ? clamp01(raw.confidence) : 0.5,
    progress:
      typeof raw.progress === "number"
        ? clamp01(raw.progress)
        : clamp01(Math.max(0.2, (typeof raw.confidence === "number" ? raw.confidence : 0.5) * 0.48)),
    createdAt:
      typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    lastUpdatedAt:
      typeof raw.lastUpdatedAt === "string" ? raw.lastUpdatedAt : new Date().toISOString(),
    turnsActive:
      typeof raw.turnsActive === "number" && Number.isFinite(raw.turnsActive)
        ? Math.max(1, Math.round(raw.turnsActive))
        : 1,
  };
}

function hydrateResolvedPurpose(raw: unknown): ResolvedPurpose | null {
  if (!isRecord(raw)) {
    return null;
  }

  const active = hydrateActivePurpose(raw);
  const outcome = isPurposeOutcome(raw.outcome) ? raw.outcome : undefined;

  if (!active || !outcome) {
    return null;
  }

  return {
    ...active,
    outcome,
    resolution: typeof raw.resolution === "string" ? raw.resolution : active.summary,
    resolvedAt:
      typeof raw.resolvedAt === "string" ? raw.resolvedAt : new Date().toISOString(),
  };
}

function hydratePendingInitiative(raw: unknown): PendingInitiative | null {
  if (!isRecord(raw)) {
    return null;
  }

  const kind =
    raw.kind === "resume_topic" || raw.kind === "neglect_ping" ? raw.kind : undefined;
  const reason =
    raw.reason === "curiosity" ||
    raw.reason === "continuity" ||
    raw.reason === "relation" ||
    raw.reason === "expansion"
      ? raw.reason
      : undefined;
  const motive = isMotiveKind(raw.motive)
    ? raw.motive
    : reason
      ? inferLegacyMotive(reason)
      : undefined;

  if (!kind || !reason || !motive) {
    return null;
  }

  return {
    kind,
    reason,
    motive,
    topic: typeof raw.topic === "string" ? raw.topic : null,
    createdAt:
      typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    readyAfterHours:
      typeof raw.readyAfterHours === "number" && Number.isFinite(raw.readyAfterHours)
        ? Math.max(0, raw.readyAfterHours)
        : 6,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMotiveKind(value: unknown): value is MotiveKind {
  return (
    value === "protect_boundary" ||
    value === "seek_continuity" ||
    value === "pursue_curiosity" ||
    value === "deepen_relation" ||
    value === "continue_shared_work" ||
    value === "leave_trace"
  );
}

function isPurposeOutcome(value: unknown): value is ResolvedPurpose["outcome"] {
  return value === "fulfilled" || value === "abandoned" || value === "superseded";
}

function inferLegacyMotive(reason: PendingInitiative["reason"]): MotiveKind {
  switch (reason) {
    case "continuity":
      return "seek_continuity";
    case "relation":
      return "deepen_relation";
    case "expansion":
      return "leave_trace";
    case "curiosity":
      return "pursue_curiosity";
  }
}
