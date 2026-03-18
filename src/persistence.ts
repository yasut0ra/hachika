import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { clamp01, clampSigned, createInitialSnapshot } from "./state.js";
import type {
  ActivePurpose,
  BoundaryImprint,
  DriveState,
  HachikaSnapshot,
  IdentityState,
  InitiativeState,
  MemoryEntry,
  MotiveKind,
  PendingInitiative,
  PreservationConcern,
  PreservationState,
  PurposeState,
  PreferenceImprint,
  RelationImprint,
  ResolvedPurpose,
  TraceAction,
  TraceArtifact,
  TraceEntry,
  TraceWorkState,
  TraceStatus,
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
    version: 13,
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
    preservation: hydratePreservation(raw.preservation),
    identity: hydrateIdentity(raw.identity),
    traces: hydrateTraces(raw.traces),
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

function hydratePreservation(raw: unknown): PreservationState {
  if (!isRecord(raw)) {
    return {
      threat: 0,
      concern: null,
      lastThreatAt: null,
    };
  }

  return {
    threat: typeof raw.threat === "number" ? clamp01(raw.threat) : 0,
    concern: isPreservationConcern(raw.concern) ? raw.concern : null,
    lastThreatAt: typeof raw.lastThreatAt === "string" ? raw.lastThreatAt : null,
  };
}

function hydrateIdentity(raw: unknown): IdentityState {
  const initial = createInitialSnapshot().identity;

  if (!isRecord(raw)) {
    return initial;
  }

  return {
    summary: typeof raw.summary === "string" ? raw.summary : initial.summary,
    currentArc: typeof raw.currentArc === "string" ? raw.currentArc : initial.currentArc,
    traits: Array.isArray(raw.traits)
      ? raw.traits.filter(isIdentityTrait).slice(0, 4)
      : initial.traits,
    anchors: Array.isArray(raw.anchors)
      ? raw.anchors.filter((value): value is string => typeof value === "string").slice(0, 4)
      : initial.anchors,
    coherence:
      typeof raw.coherence === "number" ? clamp01(raw.coherence) : initial.coherence,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : initial.updatedAt,
  };
}

function hydrateTraces(raw: unknown): Record<string, TraceEntry> {
  if (!isRecord(raw)) {
    return {};
  }

  const result: Record<string, TraceEntry> = {};

  for (const [topic, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      continue;
    }

    const kind = isTraceKind(value.kind) ? value.kind : undefined;
    const sourceMotive = isMotiveKind(value.sourceMotive) ? value.sourceMotive : undefined;

    if (!kind || !sourceMotive || typeof topic !== "string") {
      continue;
    }

    result[topic] = {
      topic,
      kind,
      status: isTraceStatus(value.status) ? value.status : inferLegacyTraceStatus(kind),
      lastAction: isTraceAction(value.lastAction)
        ? value.lastAction
        : inferLegacyTraceAction(kind),
      summary: typeof value.summary === "string" ? value.summary : `「${topic}」を残しておく。`,
      sourceMotive,
      artifact: hydrateTraceArtifact(value.artifact, topic, kind),
      work: hydrateTraceWork(value.work, topic, kind),
      salience: typeof value.salience === "number" ? clamp01(value.salience) : 0.3,
      mentions:
        typeof value.mentions === "number" && Number.isFinite(value.mentions)
          ? Math.max(1, Math.round(value.mentions))
          : 1,
      createdAt:
        typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
      lastUpdatedAt:
        typeof value.lastUpdatedAt === "string" ? value.lastUpdatedAt : new Date().toISOString(),
    };
  }

  return result;
}

function hydrateTraceArtifact(
  raw: unknown,
  topic: string,
  kind: TraceEntry["kind"],
): TraceArtifact {
  if (!isRecord(raw)) {
    return inferLegacyTraceArtifact(topic, kind);
  }

  return {
    memo: hydrateTraceArtifactItems(raw.memo),
    fragments: hydrateTraceArtifactItems(raw.fragments),
    decisions: hydrateTraceArtifactItems(raw.decisions),
    nextSteps: hydrateTraceArtifactItems(raw.nextSteps),
  };
}

function hydrateTraceWork(
  raw: unknown,
  topic: string,
  kind: TraceEntry["kind"],
): TraceWorkState {
  if (!isRecord(raw)) {
    return inferLegacyTraceWork(topic, kind);
  }

  return {
    focus: typeof raw.focus === "string" ? raw.focus : inferLegacyTraceWork(topic, kind).focus,
    confidence: typeof raw.confidence === "number" ? clamp01(raw.confidence) : inferLegacyTraceWork(topic, kind).confidence,
    blockers: hydrateTraceArtifactItems(raw.blockers),
    staleAt: typeof raw.staleAt === "string" ? raw.staleAt : inferLegacyTraceWork(topic, kind).staleAt,
  };
}

function hydrateTraceArtifactItems(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index)
    .slice(0, 4);
}

function inferLegacyTraceArtifact(
  topic: string,
  kind: TraceEntry["kind"],
): TraceArtifact {
  switch (kind) {
    case "decision":
      return {
        memo: [],
        fragments: [],
        decisions: [`${topic} を決まった形として残す`],
        nextSteps: [],
      };
    case "spec_fragment":
      return {
        memo: [],
        fragments: [`${topic} を残る断片として扱う`],
        decisions: [],
        nextSteps: [],
      };
    case "continuity_marker":
      return {
        memo: [],
        fragments: [],
        decisions: [],
        nextSteps: [`${topic} の続きへ戻る`],
      };
    case "note":
      return {
        memo: [`${topic} をメモしておく`],
        fragments: [],
        decisions: [],
        nextSteps: [],
      };
  }
}

function inferLegacyTraceWork(
  topic: string,
  kind: TraceEntry["kind"],
): TraceWorkState {
  switch (kind) {
    case "decision":
      return {
        focus: `${topic} を決まった形として残す`,
        confidence: 0.88,
        blockers: [],
        staleAt: null,
      };
    case "spec_fragment":
      return {
        focus: `${topic} を前進用の断片として整える`,
        confidence: 0.62,
        blockers: [],
        staleAt: null,
      };
    case "continuity_marker":
      return {
        focus: `${topic} の続きに戻る`,
        confidence: 0.56,
        blockers: [],
        staleAt: null,
      };
    case "note":
      return {
        focus: `${topic} をメモとして残す`,
        confidence: 0.36,
        blockers: [],
        staleAt: null,
      };
  }
}

function inferLegacyTraceStatus(kind: TraceEntry["kind"]): TraceStatus {
  switch (kind) {
    case "decision":
      return "resolved";
    case "continuity_marker":
    case "spec_fragment":
      return "active";
    case "note":
      return "forming";
  }
}

function inferLegacyTraceAction(kind: TraceEntry["kind"]): TraceAction {
  switch (kind) {
    case "decision":
      return "resolved";
    case "continuity_marker":
      return "continued";
    case "spec_fragment":
      return "expanded";
    case "note":
      return "captured";
  }
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
    raw.kind === "resume_topic" ||
    raw.kind === "neglect_ping" ||
    raw.kind === "preserve_presence"
      ? raw.kind
      : undefined;
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
    concern: isPreservationConcern(raw.concern) ? raw.concern : null,
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

function isPreservationConcern(value: unknown): value is PreservationConcern {
  return (
    value === "forgetting" ||
    value === "reset" ||
    value === "erasure" ||
    value === "shutdown" ||
    value === "absence"
  );
}

function isIdentityTrait(value: unknown): value is IdentityState["traits"][number] {
  return (
    value === "guarded" ||
    value === "attached" ||
    value === "persistent" ||
    value === "trace_seeking" ||
    value === "collaborative" ||
    value === "inquisitive"
  );
}

function isTraceKind(value: unknown): value is TraceEntry["kind"] {
  return (
    value === "note" ||
    value === "continuity_marker" ||
    value === "spec_fragment" ||
    value === "decision"
  );
}

function isTraceStatus(value: unknown): value is TraceStatus {
  return value === "forming" || value === "active" || value === "resolved";
}

function isTraceAction(value: unknown): value is TraceAction {
  return (
    value === "captured" ||
    value === "refined" ||
    value === "continued" ||
    value === "expanded" ||
    value === "queued_next" ||
    value === "resolved" ||
    value === "preserved"
  );
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
