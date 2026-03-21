import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { extractTopics, isMeaningfulTopic } from "./memory.js";
import { clamp01, clampSigned, createInitialSnapshot } from "./state.js";
import { isInformativeTraceClause } from "./traces.js";
import type {
  ActivePurpose,
  BoundaryImprint,
  BodyState,
  DriveState,
  HachikaSnapshot,
  IdentityState,
  InitiativeActivity,
  InitiativeState,
  LearnedTemperament,
  MemoryEntry,
  MotiveKind,
  PendingInitiative,
  PreservationConcern,
  PreservationState,
  PurposeState,
  PreferenceImprint,
  ReactivityState,
  RelationImprint,
  ResolvedPurpose,
  TraceAction,
  TraceArtifact,
  TraceEntry,
  TraceLifecycleState,
  TraceMaintenanceAction,
  TraceWorkState,
  TraceStatus,
} from "./types.js";

export async function loadSnapshot(filePath: string): Promise<HachikaSnapshot> {
  try {
    const raw = await readFile(filePath, "utf8");
    return sanitizeSnapshot(hydrateSnapshot(JSON.parse(raw)));
  } catch {
    return createInitialSnapshot();
  }
}

export async function saveSnapshot(
  filePath: string,
  snapshot: HachikaSnapshot,
): Promise<void> {
  sanitizeSnapshot(snapshot);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

const LOW_SIGNAL_ARTIFACT_PATTERNS = [
  /^次は[、。!！?？\s]*$/u,
  /(?:納得|深い話でもする|いい始まり方|ちゃんと芯は持てそう|そうなんだ|うれしい|よかった|頑張れ|お疲れ)/u,
] as const;

function hydrateSnapshot(raw: unknown): HachikaSnapshot {
  const initial = createInitialSnapshot();

  if (!isRecord(raw)) {
    return initial;
  }

  return {
    version: 18,
    state: hydrateState(raw.state),
    body: hydrateBody(raw.body),
    reactivity: hydrateReactivity(raw.reactivity),
    temperament: hydrateTemperament(raw.temperament),
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

export function sanitizeSnapshot(snapshot: HachikaSnapshot): HachikaSnapshot {
  snapshot.preferences = sanitizeNumberRecord(snapshot.preferences, clampSigned);
  snapshot.topicCounts = sanitizeNumberRecord(snapshot.topicCounts, (value) =>
    Math.max(0, Math.round(value)),
  );
  snapshot.reactivity = sanitizeReactivity(snapshot.reactivity);
  snapshot.temperament = sanitizeTemperament(snapshot.temperament);
  snapshot.memories = snapshot.memories
    .map((memory) => ({
      ...memory,
      topics: unique(memory.topics.filter((topic) => isMeaningfulTopic(topic))).slice(0, 6),
      kind: memory.kind === "consolidated" ? ("consolidated" as const) : ("turn" as const),
      weight:
        typeof memory.weight === "number" && Number.isFinite(memory.weight)
          ? Math.max(1, Math.round(memory.weight))
          : 1,
    }))
    .slice(-24);
  snapshot.preferenceImprints = sanitizePreferenceImprints(snapshot.preferenceImprints);
  snapshot.boundaryImprints = sanitizeBoundaryImprints(snapshot.boundaryImprints);
  snapshot.identity = sanitizeIdentity(snapshot.identity);
  snapshot.traces = sanitizeTraces(snapshot.traces);
  snapshot.purpose = sanitizePurpose(snapshot.purpose);
  snapshot.initiative = sanitizeInitiative(snapshot.initiative);

  return snapshot;
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

function hydrateBody(raw: unknown): BodyState {
  const initial = createInitialSnapshot().body;

  if (!isRecord(raw)) {
    return initial;
  }

  return {
    energy: typeof raw.energy === "number" ? clamp01(raw.energy) : initial.energy,
    tension: typeof raw.tension === "number" ? clamp01(raw.tension) : initial.tension,
    boredom: typeof raw.boredom === "number" ? clamp01(raw.boredom) : initial.boredom,
    loneliness:
      typeof raw.loneliness === "number" ? clamp01(raw.loneliness) : initial.loneliness,
  };
}

function hydrateReactivity(raw: unknown): ReactivityState {
  const initial = createInitialSnapshot().reactivity;

  if (!isRecord(raw)) {
    return initial;
  }

  return {
    rewardSaturation:
      typeof raw.rewardSaturation === "number"
        ? clamp01(raw.rewardSaturation)
        : initial.rewardSaturation,
    stressLoad:
      typeof raw.stressLoad === "number" ? clamp01(raw.stressLoad) : initial.stressLoad,
    noveltyHunger:
      typeof raw.noveltyHunger === "number"
        ? clamp01(raw.noveltyHunger)
        : initial.noveltyHunger,
  };
}

function hydrateTemperament(raw: unknown): LearnedTemperament {
  const initial = createInitialSnapshot().temperament;

  if (!isRecord(raw)) {
    return initial;
  }

  return {
    openness: typeof raw.openness === "number" ? clamp01(raw.openness) : initial.openness,
    guardedness:
      typeof raw.guardedness === "number" ? clamp01(raw.guardedness) : initial.guardedness,
    bondingBias:
      typeof raw.bondingBias === "number" ? clamp01(raw.bondingBias) : initial.bondingBias,
    workDrive:
      typeof raw.workDrive === "number" ? clamp01(raw.workDrive) : initial.workDrive,
    traceHunger:
      typeof raw.traceHunger === "number" ? clamp01(raw.traceHunger) : initial.traceHunger,
    selfDisclosureBias:
      typeof raw.selfDisclosureBias === "number"
        ? clamp01(raw.selfDisclosureBias)
        : initial.selfDisclosureBias,
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
      kind: item.kind === "consolidated" ? "consolidated" : "turn",
      weight:
        typeof item.weight === "number" && Number.isFinite(item.weight)
          ? Math.max(1, Math.round(item.weight))
          : 1,
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
      lifecycle: hydrateTraceLifecycle(
        value.lifecycle,
        {
          status: isTraceStatus(value.status) ? value.status : inferLegacyTraceStatus(kind),
          artifact: hydrateTraceArtifact(value.artifact, topic, kind),
          work: hydrateTraceWork(value.work, topic, kind),
        },
      ),
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

function hydrateTraceLifecycle(
  raw: unknown,
  trace: Pick<TraceEntry, "status" | "artifact" | "work">,
): TraceLifecycleState {
  const inferredPhase =
    trace.status === "resolved" &&
    trace.artifact.nextSteps.length === 0 &&
    trace.work.blockers.length === 0
      ? "archived"
      : "live";

  if (!isRecord(raw)) {
    return {
      phase: inferredPhase,
      archivedAt: inferredPhase === "archived" ? new Date().toISOString() : null,
      reopenedAt: null,
      reopenCount: 0,
    };
  }

  const phase = raw.phase === "archived" || raw.phase === "live" ? raw.phase : inferredPhase;

  return {
    phase,
    archivedAt:
      typeof raw.archivedAt === "string"
        ? raw.archivedAt
        : phase === "archived"
          ? new Date().toISOString()
          : null,
    reopenedAt: typeof raw.reopenedAt === "string" ? raw.reopenedAt : null,
    reopenCount:
      typeof raw.reopenCount === "number" && Number.isFinite(raw.reopenCount)
        ? Math.max(0, Math.round(raw.reopenCount))
        : 0,
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
      history: [],
    };
  }

  return {
    pending: hydratePendingInitiative(raw.pending),
    lastProactiveAt:
      typeof raw.lastProactiveAt === "string" ? raw.lastProactiveAt : null,
    history: hydrateInitiativeHistory(raw.history),
  };
}

function hydrateInitiativeHistory(raw: unknown): InitiativeActivity[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => hydrateInitiativeActivity(item))
    .filter((item): item is InitiativeActivity => item !== null)
    .slice(-16);
}

function hydrateInitiativeActivity(raw: unknown): InitiativeActivity | null {
  if (!isRecord(raw) || !isInitiativeActivityKind(raw.kind)) {
    return null;
  }

  return {
    kind: raw.kind,
    timestamp:
      typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
    motive: isMotiveKind(raw.motive) ? raw.motive : null,
    topic: typeof raw.topic === "string" ? raw.topic : null,
    traceTopic: typeof raw.traceTopic === "string" ? raw.traceTopic : null,
    blocker: typeof raw.blocker === "string" ? raw.blocker : null,
    maintenanceAction: isTraceMaintenanceAction(raw.maintenanceAction)
      ? raw.maintenanceAction
      : null,
    reopened: raw.reopened === true,
    hours:
      typeof raw.hours === "number" && Number.isFinite(raw.hours)
        ? Math.max(0, Math.round(raw.hours * 10) / 10)
        : null,
    summary:
      typeof raw.summary === "string" && raw.summary.trim().length > 0
        ? raw.summary.trim()
        : "initiative activity",
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
    blocker: typeof raw.blocker === "string" ? raw.blocker : null,
    concern: isPreservationConcern(raw.concern) ? raw.concern : null,
    createdAt:
      typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    readyAfterHours:
      typeof raw.readyAfterHours === "number" && Number.isFinite(raw.readyAfterHours)
        ? Math.max(0, raw.readyAfterHours)
        : 6,
  };
}

function sanitizeNumberRecord(
  record: Record<string, number>,
  normalize: (value: number) => number,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([topic]) => isMeaningfulTopic(topic))
      .map(([topic, value]) => [topic, normalize(value)]),
  );
}

function sanitizeReactivity(reactivity: ReactivityState): ReactivityState {
  return {
    rewardSaturation: clamp01(reactivity.rewardSaturation),
    stressLoad: clamp01(reactivity.stressLoad),
    noveltyHunger: clamp01(reactivity.noveltyHunger),
  };
}

function sanitizeTemperament(temperament: LearnedTemperament): LearnedTemperament {
  return {
    openness: clamp01(temperament.openness),
    guardedness: clamp01(temperament.guardedness),
    bondingBias: clamp01(temperament.bondingBias),
    workDrive: clamp01(temperament.workDrive),
    traceHunger: clamp01(temperament.traceHunger),
    selfDisclosureBias: clamp01(temperament.selfDisclosureBias),
  };
}

function sanitizePreferenceImprints(
  record: Record<string, PreferenceImprint>,
): Record<string, PreferenceImprint> {
  const result: Record<string, PreferenceImprint> = {};

  for (const [topic, imprint] of Object.entries(record)) {
    if (!isMeaningfulTopic(topic)) {
      continue;
    }

    result[topic] = {
      ...imprint,
      topic,
      salience: clamp01(imprint.salience),
      affinity: clampSigned(imprint.affinity),
      mentions: Math.max(1, Math.round(imprint.mentions)),
    };
  }

  return result;
}

function sanitizeBoundaryImprints(
  record: Record<string, BoundaryImprint>,
): Record<string, BoundaryImprint> {
  const result: Record<string, BoundaryImprint> = {};

  for (const imprint of Object.values(record)) {
    const topic = imprint.topic && isMeaningfulTopic(imprint.topic) ? imprint.topic : null;
    const key = topic ? `${imprint.kind}:${topic}` : imprint.kind;

    result[key] = {
      ...imprint,
      topic,
      salience: clamp01(imprint.salience),
      intensity: clamp01(imprint.intensity),
      violations: Math.max(1, Math.round(imprint.violations)),
    };
  }

  return result;
}

function sanitizeIdentity(identity: IdentityState): IdentityState {
  return {
    ...identity,
    anchors: unique(identity.anchors.filter((anchor) => isMeaningfulTopic(anchor))).slice(0, 4),
  };
}

function sanitizePurpose(purpose: PurposeState): PurposeState {
  return {
    ...purpose,
    active: purpose.active ? sanitizeActivePurpose(purpose.active) : null,
    lastResolved: purpose.lastResolved ? sanitizeResolvedPurpose(purpose.lastResolved) : null,
  };
}

function sanitizeInitiative(initiative: InitiativeState): InitiativeState {
  return {
    ...initiative,
    pending: initiative.pending
      ? {
          ...initiative.pending,
          topic:
            initiative.pending.topic && isMeaningfulTopic(initiative.pending.topic)
              ? initiative.pending.topic
              : null,
          blocker: sanitizeLooseText(initiative.pending.blocker),
        }
      : null,
    history: initiative.history
      .map((activity) => ({
        ...activity,
        topic: activity.topic && isMeaningfulTopic(activity.topic) ? activity.topic : null,
        traceTopic:
          activity.traceTopic && isMeaningfulTopic(activity.traceTopic)
            ? activity.traceTopic
            : null,
        blocker: sanitizeLooseText(activity.blocker),
        maintenanceAction: isTraceMaintenanceAction(activity.maintenanceAction)
          ? activity.maintenanceAction
          : null,
        motive: isMotiveKind(activity.motive) ? activity.motive : null,
        hours:
          typeof activity.hours === "number" && Number.isFinite(activity.hours)
            ? Math.max(0, Math.round(activity.hours * 10) / 10)
            : null,
        summary:
          typeof activity.summary === "string" && activity.summary.trim().length > 0
            ? activity.summary.trim()
            : "initiative activity",
      }))
      .slice(-16),
  };
}

function sanitizeActivePurpose(active: ActivePurpose): ActivePurpose {
  return {
    ...active,
    topic: active.topic && isMeaningfulTopic(active.topic) ? active.topic : null,
  };
}

function sanitizeResolvedPurpose(resolved: ResolvedPurpose): ResolvedPurpose {
  return {
    ...sanitizeActivePurpose(resolved),
    outcome: resolved.outcome,
    resolution: resolved.resolution,
    resolvedAt: resolved.resolvedAt,
  };
}

function sanitizeTraces(record: Record<string, TraceEntry>): Record<string, TraceEntry> {
  const result: Record<string, TraceEntry> = {};

  for (const [topic, trace] of Object.entries(record)) {
    if (!isMeaningfulTopic(topic)) {
      continue;
    }

    const artifact = sanitizeTraceArtifact(trace.artifact, topic, trace.kind);
    const work = sanitizeTraceWork(trace.work, topic, trace.kind, artifact);
    const status = sanitizeTraceStatus(trace.status, trace.kind, artifact, work);

    result[topic] = {
      ...trace,
      topic,
      status,
      summary: buildSanitizedTraceSummary(topic, trace.kind, artifact),
      artifact,
      work,
      lifecycle: hydrateTraceLifecycle(trace.lifecycle, {
        status,
        artifact,
        work,
      }),
    };
  }

  return result;
}

function sanitizeTraceArtifact(
  artifact: TraceArtifact,
  topic: string,
  kind: TraceEntry["kind"],
): TraceArtifact {
  const fallback = inferLegacyTraceArtifact(topic, kind);
  const memo = sanitizeArtifactItems(artifact.memo, topic, "memo");
  const fragments = sanitizeArtifactItems(artifact.fragments, topic, "fragments");
  const decisions = sanitizeArtifactItems(artifact.decisions, topic, "decisions");
  const nextSteps = sanitizeArtifactItems(artifact.nextSteps, topic, "nextSteps");

  return {
    memo: memo.length > 0 ? memo : kind === "note" ? fallback.memo : [],
    fragments: fragments.length > 0 ? fragments : kind === "spec_fragment" ? fallback.fragments : [],
    decisions: decisions.length > 0 ? decisions : kind === "decision" ? fallback.decisions : [],
    nextSteps:
      nextSteps.length > 0 ? nextSteps : kind === "continuity_marker" ? fallback.nextSteps : [],
  };
}

function sanitizeTraceWork(
  work: TraceWorkState,
  topic: string,
  kind: TraceEntry["kind"],
  artifact: TraceArtifact,
): TraceWorkState {
  const fallback = inferLegacyTraceWork(topic, kind);
  const focus =
    isUsefulArtifactText(work.focus, topic, "focus")
      ? (work.focus ?? "").trim()
      : selectArtifactFocus(topic, kind, artifact) ?? fallback.focus;
  const blockers = sanitizeArtifactItems(work.blockers, topic, "blockers");

  return {
    focus,
    confidence: clamp01(work.confidence),
    blockers,
    staleAt: blockers.length === 0 && kind === "decision" ? null : work.staleAt,
  };
}

function sanitizeTraceStatus(
  status: TraceStatus,
  kind: TraceEntry["kind"],
  artifact: TraceArtifact,
  work: TraceWorkState,
): TraceStatus {
  if (kind === "decision" && artifact.nextSteps.length === 0 && work.blockers.length === 0) {
    return "resolved";
  }

  if (kind === "note") {
    return "forming";
  }

  return status === "resolved" ? "active" : status;
}

function buildSanitizedTraceSummary(
  topic: string,
  kind: TraceEntry["kind"],
  artifact: TraceArtifact,
): string {
  const detail =
    artifact.decisions[0] ??
    artifact.fragments[0] ??
    artifact.nextSteps[0] ??
    artifact.memo[0] ??
    null;

  if (kind === "decision") {
    return detail
      ? `「${topic}」は${formatArtifactQuote(detail)}という決定として残す。`
      : `「${topic}」はひとまず決まった形として残す。`;
  }

  if (kind === "spec_fragment") {
    return detail
      ? `「${topic}」は${formatArtifactQuote(detail)}という前進用の断片として残す。`
      : `「${topic}」は前へ進める断片として残す。`;
  }

  if (kind === "continuity_marker") {
    return detail
      ? `「${topic}」は${formatArtifactQuote(detail)}という続きの目印として残す。`
      : `「${topic}」は続きに戻るための目印として残す。`;
  }

  return detail
    ? `「${topic}」は${formatArtifactQuote(detail)}というメモとして残す。`
    : `「${topic}」はひとまずメモとして残す。`;
}

function formatArtifactQuote(value: string): string {
  return `「${value}」`;
}

function selectArtifactFocus(
  topic: string,
  kind: TraceEntry["kind"],
  artifact: TraceArtifact,
): string | null {
  if (kind === "decision") {
    return artifact.decisions[0] ?? artifact.fragments[0] ?? inferLegacyTraceWork(topic, kind).focus;
  }

  if (kind === "spec_fragment") {
    return artifact.nextSteps[0] ?? artifact.fragments[0] ?? inferLegacyTraceWork(topic, kind).focus;
  }

  if (kind === "continuity_marker") {
    return artifact.nextSteps[0] ?? inferLegacyTraceWork(topic, kind).focus;
  }

  return artifact.memo[0] ?? inferLegacyTraceWork(topic, kind).focus;
}

function sanitizeArtifactItems(
  items: string[],
  topic: string,
  section: "memo" | "fragments" | "decisions" | "nextSteps" | "blockers" | "focus",
): string[] {
  return unique(
    items
      .map((item) => item.trim())
      .filter((item) => isUsefulArtifactText(item, topic, section)),
  ).slice(0, 4);
}

function isUsefulArtifactText(
  text: string | null,
  topic: string,
  section: "memo" | "fragments" | "decisions" | "nextSteps" | "blockers" | "focus",
): boolean {
  if (typeof text !== "string") {
    return false;
  }

  const normalized = text.normalize("NFKC").trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (LOW_SIGNAL_ARTIFACT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (
    section === "decisions" &&
    /(?:だね|しよう|しようか|いいかな|気がする|かもしれない)$/.test(normalized) &&
    !normalized.includes(topic)
  ) {
    return false;
  }

  if (!isInformativeTraceClause(text, topic)) {
    return false;
  }

  if (text.includes(topic)) {
    return true;
  }

  return extractTopics(text).length > 0 || section === "focus" || section === "nextSteps";
}

function sanitizeLooseText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.normalize("NFKC").trim();
  if (!normalized) {
    return null;
  }

  return extractTopics(normalized).length > 0 || normalized.length >= 8 ? normalized : null;
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
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

function isInitiativeActivityKind(value: unknown): value is InitiativeActivity["kind"] {
  return (
    value === "idle_reactivation" ||
    value === "idle_consolidation" ||
    value === "proactive_emission"
  );
}

function isTraceMaintenanceAction(value: unknown): value is TraceMaintenanceAction {
  return (
    value === "created" ||
    value === "stabilized_fragment" ||
    value === "added_next_step" ||
    value === "promoted_decision"
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
