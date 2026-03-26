import { readFile } from "node:fs/promises";

import { writeTextFileAtomic } from "./atomic-file.js";
import {
  extractTopics,
  isMeaningfulTopic,
  requiresConcreteTopicSupport,
  topicsLooselyMatch,
} from "./memory.js";
import { clamp01, clampSigned, createInitialSnapshot } from "./state.js";
import { isInformativeTraceClause } from "./traces.js";
import { syncWorldObjectTraceLinks, WORLD_PLACE_IDS } from "./world.js";
import type {
  ActivePurpose,
  BoundaryImprint,
  BodyState,
  GenerationHistoryEntry,
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
  TraceWorldContext,
  TraceStatus,
  WorldActionKind,
  WorldEvent,
  WorldObjectState,
  WorldPhase,
  WorldPlaceId,
  WorldPlaceState,
  WorldState,
} from "./types.js";

export interface SnapshotCommitResult {
  ok: boolean;
  conflict: boolean;
  snapshot: HachikaSnapshot;
}

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
): Promise<HachikaSnapshot> {
  const current = await loadSnapshot(filePath);
  const next = sanitizeSnapshot(structuredClone(snapshot));
  next.revision = Math.max(current.revision, next.revision) + 1;
  await writeTextFileAtomic(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function commitSnapshot(
  filePath: string,
  snapshot: HachikaSnapshot,
  expectedRevision = snapshot.revision,
): Promise<SnapshotCommitResult> {
  const current = await loadSnapshot(filePath);

  if (current.revision !== expectedRevision) {
    return {
      ok: false,
      conflict: true,
      snapshot: current,
    };
  }

  const next = sanitizeSnapshot(structuredClone(snapshot));
  next.revision = expectedRevision + 1;
  await writeTextFileAtomic(filePath, `${JSON.stringify(next, null, 2)}\n`);

  return {
    ok: true,
    conflict: false,
    snapshot: next,
  };
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
    version: 20,
    revision:
      typeof raw.revision === "number" && Number.isFinite(raw.revision)
        ? Math.max(0, Math.round(raw.revision))
        : initial.revision,
    state: hydrateState(raw.state),
    body: hydrateBody(raw.body),
    reactivity: hydrateReactivity(raw.reactivity),
    temperament: hydrateTemperament(raw.temperament),
    attachment:
      typeof raw.attachment === "number" ? clamp01(raw.attachment) : initial.attachment,
    world: hydrateWorld(raw.world),
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
    generationHistory: hydrateGenerationHistory(raw.generationHistory),
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
  snapshot.world = sanitizeWorld(snapshot.world);
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
  const supportedTopics = deriveSupportedSnapshotTopics(snapshot);
  snapshot.preferences = filterSupportedTopicRecord(snapshot.preferences, supportedTopics);
  snapshot.topicCounts = filterSupportedTopicRecord(snapshot.topicCounts, supportedTopics);
  snapshot.memories = snapshot.memories.map((memory) => ({
    ...memory,
    topics: memory.topics.filter((topic) => shouldKeepSupportedTopic(topic, supportedTopics)),
  }));
  snapshot.preferenceImprints = filterSupportedImprints(
    snapshot.preferenceImprints,
    supportedTopics,
  );
  snapshot.boundaryImprints = sanitizeBoundaryImprints(snapshot.boundaryImprints);
  snapshot.identity = sanitizeIdentity(snapshot.identity, supportedTopics);
  snapshot.traces = sanitizeTraces(snapshot.traces, supportedTopics);
  syncWorldObjectTraceLinks(snapshot);
  snapshot.purpose = sanitizePurpose(snapshot.purpose, supportedTopics);
  snapshot.initiative = sanitizeInitiative(snapshot.initiative, supportedTopics);
  snapshot.generationHistory = sanitizeGenerationHistory(
    snapshot.generationHistory,
    supportedTopics,
  );

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

function hydrateWorld(raw: unknown): WorldState {
  const initial = createInitialSnapshot().world;

  if (!isRecord(raw)) {
    return initial;
  }

  const clockHour =
    typeof raw.clockHour === "number" && Number.isFinite(raw.clockHour)
      ? normalizeWorldClock(raw.clockHour)
      : initial.clockHour;
  const phase = isWorldPhase(raw.phase) ? raw.phase : inferWorldPhase(clockHour);

  return {
    clockHour,
    phase,
    currentPlace: isWorldPlaceId(raw.currentPlace) ? raw.currentPlace : initial.currentPlace,
    places: hydrateWorldPlaces(raw.places),
    objects: hydrateWorldObjects(raw.objects),
    recentEvents: hydrateWorldEvents(raw.recentEvents),
    lastUpdatedAt: typeof raw.lastUpdatedAt === "string" ? raw.lastUpdatedAt : null,
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

function hydrateWorldPlaces(raw: unknown): Record<WorldPlaceId, WorldPlaceState> {
  const initial = createInitialSnapshot().world.places;

  return {
    threshold: hydrateWorldPlace(raw, "threshold", initial.threshold),
    studio: hydrateWorldPlace(raw, "studio", initial.studio),
    archive: hydrateWorldPlace(raw, "archive", initial.archive),
  };
}

function hydrateWorldPlace(
  raw: unknown,
  place: WorldPlaceId,
  fallback: WorldPlaceState,
): WorldPlaceState {
  const value = isRecord(raw) && isRecord(raw[place]) ? raw[place] : null;

  if (!value) {
    return fallback;
  }

  return {
    warmth: typeof value.warmth === "number" ? clamp01(value.warmth) : fallback.warmth,
    quiet: typeof value.quiet === "number" ? clamp01(value.quiet) : fallback.quiet,
    lastVisitedAt:
      typeof value.lastVisitedAt === "string" ? value.lastVisitedAt : fallback.lastVisitedAt,
  };
}

function hydrateWorldObjects(raw: unknown): Record<string, WorldObjectState> {
  const initial = createInitialSnapshot().world.objects;

  if (!isRecord(raw)) {
    return structuredClone(initial);
  }

  const result: Record<string, WorldObjectState> = {};

  for (const [key, fallback] of Object.entries(initial)) {
    const value = isRecord(raw[key]) ? raw[key] : null;
    result[key] = {
      place: value && isWorldPlaceId(value.place) ? value.place : fallback.place,
      state:
        value && typeof value.state === "string" && value.state.trim().length > 0
          ? value.state.trim()
          : fallback.state,
      lastChangedAt:
        value && typeof value.lastChangedAt === "string" ? value.lastChangedAt : fallback.lastChangedAt,
    };
  }

  return result;
}

function hydrateWorldEvents(raw: unknown): WorldEvent[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => hydrateWorldEvent(item))
    .filter((item): item is WorldEvent => item !== null)
    .slice(-8);
}

function hydrateWorldEvent(raw: unknown): WorldEvent | null {
  if (!isRecord(raw)) {
    return null;
  }

  if (!isWorldPlaceId(raw.place)) {
    return null;
  }

  const kind =
    raw.kind === "arrival" || raw.kind === "ambience" || raw.kind === "notice"
      ? raw.kind
      : null;
  const summary =
    typeof raw.summary === "string" && raw.summary.trim().length > 0
      ? raw.summary.trim()
      : null;

  if (!kind || !summary) {
    return null;
  }

  return {
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
    kind,
    place: raw.place,
    summary,
  };
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
      worldContext: hydrateTraceWorldContext(value.worldContext),
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

function hydrateTraceWorldContext(raw: unknown): TraceWorldContext {
  if (!isRecord(raw)) {
    return {
      place: null,
      objectId: null,
      linkedAt: null,
    };
  }

  return {
    place: isWorldPlaceId(raw.place) ? raw.place : null,
    objectId: sanitizeWorldObjectId(raw.objectId),
    linkedAt: typeof raw.linkedAt === "string" ? raw.linkedAt : null,
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
    place: isWorldPlaceId(raw.place) ? raw.place : null,
    worldAction: isWorldActionKind(raw.worldAction) ? raw.worldAction : null,
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
    place: isWorldPlaceId(raw.place) ? raw.place : null,
    worldAction: isWorldActionKind(raw.worldAction) ? raw.worldAction : null,
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

function sanitizeWorld(world: WorldState): WorldState {
  const initial = createInitialSnapshot().world;
  const clockHour = normalizeWorldClock(world.clockHour);
  const phase = inferWorldPhase(clockHour);
  const places = hydrateWorldPlaces(world.places);
  const currentPlace = isWorldPlaceId(world.currentPlace) ? world.currentPlace : initial.currentPlace;

  return {
    clockHour,
    phase,
    currentPlace,
    places: {
      threshold: sanitizeWorldPlace(places.threshold),
      studio: sanitizeWorldPlace(places.studio),
      archive: sanitizeWorldPlace(places.archive),
    },
    objects: sanitizeWorldObjects(world.objects),
    recentEvents: hydrateWorldEvents(world.recentEvents),
    lastUpdatedAt: typeof world.lastUpdatedAt === "string" ? world.lastUpdatedAt : null,
  };
}

function sanitizeWorldPlace(place: WorldPlaceState): WorldPlaceState {
  return {
    warmth: clamp01(place.warmth),
    quiet: clamp01(place.quiet),
    lastVisitedAt: typeof place.lastVisitedAt === "string" ? place.lastVisitedAt : null,
  };
}

function sanitizeWorldObjects(raw: Record<string, WorldObjectState>): Record<string, WorldObjectState> {
  const base = hydrateWorldObjects(raw);
  const result: Record<string, WorldObjectState> = {};

  for (const [key, object] of Object.entries(base)) {
    result[key] = {
      place: object.place,
      state: object.state.trim(),
      lastChangedAt: typeof object.lastChangedAt === "string" ? object.lastChangedAt : null,
      linkedTraceTopics: hydrateTraceArtifactItems(object.linkedTraceTopics),
    };
  }

  return result;
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

function deriveSupportedSnapshotTopics(snapshot: HachikaSnapshot): Set<string> {
  const topics = new Set<string>();
  const memoryWeights = new Map<string, number>();
  const substantiveMemoryWeights = new Map<string, number>();

  for (const memory of snapshot.memories) {
    for (const topic of memory.topics) {
      const baseWeight = Math.max(1, memory.weight ?? 1);
      memoryWeights.set(topic, (memoryWeights.get(topic) ?? 0) + baseWeight);
      substantiveMemoryWeights.set(
        topic,
        (substantiveMemoryWeights.get(topic) ?? 0) +
          estimateSupportedTopicMemoryWeight(memory, topic),
      );
    }
  }

  const candidates = new Set<string>([
    ...Object.keys(snapshot.preferences),
    ...Object.keys(snapshot.topicCounts),
    ...Object.keys(snapshot.preferenceImprints),
    ...Object.keys(snapshot.traces),
    ...snapshot.identity.anchors,
    ...snapshot.memories.flatMap((memory) => memory.topics),
    snapshot.purpose.active?.topic ?? "",
    snapshot.purpose.lastResolved?.topic ?? "",
    snapshot.initiative.pending?.topic ?? "",
    ...snapshot.initiative.history.flatMap((activity) => [
      activity.topic ?? "",
      activity.traceTopic ?? "",
    ]),
    ...snapshot.generationHistory.flatMap((entry) => [entry.focus ?? ""]),
  ]);

  for (const rawTopic of candidates) {
    const topic = rawTopic.trim();
    if (!isMeaningfulTopic(topic)) {
      continue;
    }

    if (!requiresConcreteTopicSupport(topic)) {
      topics.add(topic);
      continue;
    }

    const topicCount = snapshot.topicCounts[topic] ?? 0;
    const preferenceStrength = Math.abs(snapshot.preferences[topic] ?? 0);
    const imprint = snapshot.preferenceImprints[topic];
    const memoryWeight = memoryWeights.get(topic) ?? 0;
    const substantiveMemoryWeight = substantiveMemoryWeights.get(topic) ?? 0;
    const concreteTraceSupport = hasConcreteTraceSupport(snapshot.traces[topic], topic);
    const repeated = topicCount >= 3 || memoryWeight >= 3 || (imprint?.mentions ?? 0) >= 3;
    const strongSignal =
      preferenceStrength >= 0.24 ||
      (imprint?.salience ?? 0) >= 0.56 ||
      (imprint?.affinity !== undefined && Math.abs(imprint.affinity) >= 0.16) ||
      substantiveMemoryWeight >= 1.8 ||
      concreteTraceSupport;
    const durable =
      topicCount >= 4 ||
      substantiveMemoryWeight >= 2.8 ||
      concreteTraceSupport ||
      ((imprint?.mentions ?? 0) >= 3 && (imprint?.salience ?? 0) >= 0.42);
    const concreteAnchor = substantiveMemoryWeight >= 1.8 || concreteTraceSupport;

    if (concreteAnchor && (durable || (repeated && strongSignal))) {
      topics.add(topic);
    }
  }

  return topics;
}

function estimateSupportedTopicMemoryWeight(
  memory: MemoryEntry,
  topic: string,
): number {
  const baseWeight = Math.max(1, memory.weight ?? 1);

  if (!requiresConcreteTopicSupport(topic)) {
    return baseWeight;
  }

  const concreteCompanions = extractTopics(memory.text).filter(
    (candidate) =>
      candidate !== topic &&
      !requiresConcreteTopicSupport(candidate) &&
      !topicsLooselyMatch(candidate, topic),
  );

  if (concreteCompanions.length > 0) {
    return baseWeight * (1 + Math.min(0.5, concreteCompanions.length * 0.18));
  }

  const text = memory.text.normalize("NFKC");
  const isQuestionLike =
    /[?？]/u.test(text) || /(何|どこ|どう|どんな|なぜ|例えば|たとえば)/u.test(text);
  const isSelfWorldProbe = SUPPORTED_TOPIC_PROBE_PATTERNS.some((pattern) => pattern.test(text));

  if (isSelfWorldProbe) {
    return baseWeight * 0.18;
  }

  if (isQuestionLike && memory.role === "user") {
    return baseWeight * 0.32;
  }

  if (isQuestionLike && memory.role === "hachika") {
    return baseWeight * 0.42;
  }

  return baseWeight * 0.64;
}

function hasConcreteTraceSupport(trace: TraceEntry | undefined, topic: string): boolean {
  if (!trace) {
    return false;
  }

  if (trace.worldContext?.objectId) {
    return true;
  }

  const artifactItems = [
    ...trace.artifact.memo,
    ...trace.artifact.fragments,
    ...trace.artifact.decisions,
    ...trace.artifact.nextSteps,
  ];

  return artifactItems
    .filter((item) => isInformativeTraceClause(item, topic))
    .some((item) =>
      extractTopics(item).some(
        (candidate) =>
          candidate !== topic &&
          candidate.length >= 2 &&
          !requiresConcreteTopicSupport(candidate) &&
          !topicsLooselyMatch(candidate, topic),
      ),
    );
}

const SUPPORTED_TOPIC_PROBE_PATTERNS = [
  /どんな存在/u,
  /どういう存在/u,
  /今どこにいる/u,
  /どこにいる/u,
  /周りはどんな/u,
  /棚には何が残/u,
  /最近何を気にしてる/u,
  /今の目的/u,
] as const;

function shouldKeepSupportedTopic(topic: string, supportedTopics: Set<string>): boolean {
  return !requiresConcreteTopicSupport(topic) || supportedTopics.has(topic);
}

function filterSupportedTopicRecord<T extends number>(
  record: Record<string, T>,
  supportedTopics: Set<string>,
): Record<string, T> {
  const next: Record<string, T> = {};

  for (const [topic, value] of Object.entries(record)) {
    if (shouldKeepSupportedTopic(topic, supportedTopics)) {
      next[topic] = value;
    }
  }

  return next;
}

function filterSupportedImprints(
  record: Record<string, PreferenceImprint>,
  supportedTopics: Set<string>,
): Record<string, PreferenceImprint> {
  const next: Record<string, PreferenceImprint> = {};

  for (const [topic, imprint] of Object.entries(record)) {
    if (shouldKeepSupportedTopic(topic, supportedTopics)) {
      next[topic] = imprint;
    }
  }

  return next;
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

function sanitizeIdentity(
  identity: IdentityState,
  supportedTopics: Set<string>,
): IdentityState {
  return {
    ...identity,
    anchors: unique(
      identity.anchors.filter(
        (anchor) => isMeaningfulTopic(anchor) && shouldKeepSupportedTopic(anchor, supportedTopics),
      ),
    ).slice(0, 4),
  };
}

function sanitizePurpose(
  purpose: PurposeState,
  supportedTopics: Set<string>,
): PurposeState {
  return {
    ...purpose,
    active: purpose.active ? sanitizeActivePurpose(purpose.active, supportedTopics) : null,
    lastResolved: purpose.lastResolved
      ? sanitizeResolvedPurpose(purpose.lastResolved, supportedTopics)
      : null,
  };
}

function sanitizeInitiative(
  initiative: InitiativeState,
  supportedTopics: Set<string>,
): InitiativeState {
  return {
    ...initiative,
    pending: initiative.pending
      ? {
          ...initiative.pending,
          topic:
            initiative.pending.topic &&
            isMeaningfulTopic(initiative.pending.topic) &&
            shouldKeepSupportedTopic(initiative.pending.topic, supportedTopics)
              ? initiative.pending.topic
              : null,
          blocker: sanitizeLooseText(initiative.pending.blocker),
          place: isWorldPlaceId(initiative.pending.place) ? initiative.pending.place : null,
          worldAction: isWorldActionKind(initiative.pending.worldAction)
            ? initiative.pending.worldAction
            : null,
        }
      : null,
    history: initiative.history
      .map((activity) => ({
        ...activity,
        topic:
          activity.topic &&
          isMeaningfulTopic(activity.topic) &&
          shouldKeepSupportedTopic(activity.topic, supportedTopics)
            ? activity.topic
            : null,
        traceTopic:
          activity.traceTopic && isMeaningfulTopic(activity.traceTopic)
            ? shouldKeepSupportedTopic(activity.traceTopic, supportedTopics)
              ? activity.traceTopic
              : null
            : null,
        blocker: sanitizeLooseText(activity.blocker),
        place: isWorldPlaceId(activity.place) ? activity.place : null,
        worldAction: isWorldActionKind(activity.worldAction) ? activity.worldAction : null,
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

function hydrateGenerationHistory(raw: unknown): GenerationHistoryEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter(isRecord)
    .map((entry) => ({
      timestamp:
        typeof entry.timestamp === "string" && entry.timestamp.trim().length > 0
          ? entry.timestamp
          : new Date().toISOString(),
      mode: entry.mode === "proactive" ? "proactive" : "reply",
      source: entry.source === "llm" ? "llm" : "rule",
      provider: typeof entry.provider === "string" ? entry.provider : null,
      model: typeof entry.model === "string" ? entry.model : null,
      fallbackUsed: entry.fallbackUsed === true,
      focus:
        typeof entry.focus === "string" && entry.focus.trim().length > 0
          ? entry.focus.trim()
          : null,
      fallbackOverlap:
        typeof entry.fallbackOverlap === "number" ? clamp01(entry.fallbackOverlap) : 0,
      openerEcho: entry.openerEcho === true,
      abstractTermRatio:
        typeof entry.abstractTermRatio === "number" ? clamp01(entry.abstractTermRatio) : 0,
      concreteDetailScore:
        typeof entry.concreteDetailScore === "number"
          ? clamp01(entry.concreteDetailScore)
          : 0,
      focusMentioned:
        typeof entry.focusMentioned === "boolean" ? entry.focusMentioned : null,
      summary:
        typeof entry.summary === "string" && entry.summary.trim().length > 0
          ? entry.summary.trim()
          : "generated quality",
    }));
}

function sanitizeGenerationHistory(
  history: GenerationHistoryEntry[],
  supportedTopics: Set<string>,
): GenerationHistoryEntry[] {
  return history
    .map((entry) => ({
      ...entry,
      focus:
        entry.focus &&
        isMeaningfulTopic(entry.focus) &&
        shouldKeepSupportedTopic(entry.focus, supportedTopics)
          ? entry.focus
          : null,
      fallbackOverlap: clamp01(entry.fallbackOverlap),
      abstractTermRatio: clamp01(entry.abstractTermRatio),
      concreteDetailScore: clamp01(entry.concreteDetailScore),
      summary:
        typeof entry.summary === "string" && entry.summary.trim().length > 0
          ? entry.summary.trim()
          : "generated quality",
    }))
    .slice(-24);
}

function sanitizeActivePurpose(
  active: ActivePurpose,
  supportedTopics: Set<string>,
): ActivePurpose {
  return {
    ...active,
    topic:
      active.topic &&
      isMeaningfulTopic(active.topic) &&
      shouldKeepSupportedTopic(active.topic, supportedTopics)
        ? active.topic
        : null,
  };
}

function sanitizeResolvedPurpose(
  resolved: ResolvedPurpose,
  supportedTopics: Set<string>,
): ResolvedPurpose {
  return {
    ...sanitizeActivePurpose(resolved, supportedTopics),
    outcome: resolved.outcome,
    resolution: resolved.resolution,
    resolvedAt: resolved.resolvedAt,
  };
}

function sanitizeTraces(
  record: Record<string, TraceEntry>,
  supportedTopics: Set<string>,
): Record<string, TraceEntry> {
  const result: Record<string, TraceEntry> = {};

  for (const [topic, trace] of Object.entries(record)) {
    if (!isMeaningfulTopic(topic) || !shouldKeepSupportedTopic(topic, supportedTopics)) {
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
      worldContext: sanitizeTraceWorldContext(trace.worldContext),
    };
  }

  return result;
}

function sanitizeTraceWorldContext(
  worldContext: TraceWorldContext | undefined,
): TraceWorldContext {
  return {
    place: isWorldPlaceId(worldContext?.place) ? worldContext.place : null,
    objectId: sanitizeWorldObjectId(worldContext?.objectId),
    linkedAt: typeof worldContext?.linkedAt === "string" ? worldContext.linkedAt : null,
  };
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

function sanitizeWorldObjectId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.normalize("NFKC").trim();
  return normalized.length > 0 ? normalized.slice(0, 32) : null;
}

function normalizeWorldClock(value: number): number {
  const wrapped = value % 24;
  const normalized = wrapped < 0 ? wrapped + 24 : wrapped;
  return Math.round(normalized * 1000) / 1000;
}

function inferWorldPhase(clockHour: number): WorldPhase {
  const normalized = normalizeWorldClock(clockHour);

  if (normalized >= 5 && normalized < 8) {
    return "dawn";
  }

  if (normalized >= 8 && normalized < 17) {
    return "day";
  }

  if (normalized >= 17 && normalized < 21) {
    return "dusk";
  }

  return "night";
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

function isWorldPhase(value: unknown): value is WorldPhase {
  return value === "dawn" || value === "day" || value === "dusk" || value === "night";
}

function isWorldPlaceId(value: unknown): value is WorldPlaceId {
  return typeof value === "string" && (WORLD_PLACE_IDS as readonly string[]).includes(value);
}

function isWorldActionKind(value: unknown): value is WorldActionKind {
  return value === "observe" || value === "touch" || value === "leave";
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
