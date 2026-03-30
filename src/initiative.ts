import {
  isMeaningfulTopic,
  isRelationalTopic,
  requiresConcreteTopicSupport,
  sortedPreferenceImprints,
  topPreferredTopics,
} from "./memory.js";
import { rewindBodyHours, settleBodyAfterInitiative } from "./body.js";
import {
  deriveVisibleStateFromDynamics,
  rewindDynamicsHours,
  settleDynamicsAfterInitiative,
} from "./dynamics.js";
import { pickFreshText, recentAssistantReplies } from "./expression.js";
import { buildSelfModel } from "./self-model.js";
import { clamp01, clampSigned, INITIAL_REACTIVITY, settleTowardsBaseline } from "./state.js";
import { rewindTemperamentHours } from "./temperament.js";
import {
  linkTraceToWorld,
  pickPrimaryArtifactItem,
  readTraceLifecycle,
  sortedTraces,
  tendTraceFromInitiative,
} from "./traces.js";
import type { TraceMaintenance } from "./traces.js";
import { buildProactivePlan } from "./response-planner.js";
import type { ProactivePlan } from "./response-planner.js";
import {
  currentWorldObjectLinksTopic,
  describeWorldObjectJa,
  describeWorldPlaceJa,
  getCurrentWorldLinkedTraceTopics,
  getCurrentWorldObjectId,
  performWorldAction,
  syncWorldObjectTraceLinks,
} from "./world.js";
import type {
  HachikaSnapshot,
  InitiativeActivity,
  InitiativeReason,
  InteractionSignals,
  MotiveKind,
  PendingInitiative,
  ProactiveSelectionDebug,
  SelfModel,
  SelfMotive,
  WorldActionKind,
  WorldPlaceId,
} from "./types.js";

export interface ProactiveEmission {
  message: string;
  topics: string[];
  pending: PendingInitiative;
  neglectLevel: number;
  maintenance: TraceMaintenance | null;
  plan: ProactivePlan;
  selection: ProactiveSelectionDebug;
}

export interface PreparedProactiveEmission {
  pending: PendingInitiative;
  neglectLevel: number;
  plan: ProactivePlan;
  selection: ProactiveSelectionDebug;
  messageKind: "resume" | "preserve" | "neglect";
  emittedAt: string;
}

interface IdleConsolidationReport {
  focusTopic: string | null;
  reinforcedTopics: string[];
  compressed: boolean;
}

export type IdleAutonomyAction = Exclude<InitiativeActivity["autonomyAction"], "speak" | null>;

interface PreparedIdleRecallSelection {
  trace: HachikaSnapshot["traces"][string];
  motive: MotiveKind;
  score: number;
  blocker: string | null;
  shouldInstallPending: boolean;
}

export interface PreparedIdleAutonomyAction {
  action: IdleAutonomyAction;
  hours: number;
  prioritizedTopic: string | null;
  prioritizedMotive: MotiveKind | null;
  selected: PreparedIdleRecallSelection | null;
}

export interface ScheduledInitiativeDecision {
  shouldClear: boolean;
  candidate: PendingInitiative | null;
}

export function scheduleInitiative(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  selfModel: SelfModel,
): void {
  const decision = prepareScheduledInitiative(snapshot, signals, selfModel);

  if (decision.shouldClear) {
    snapshot.initiative.pending = null;
  }

  if (decision.candidate) {
    snapshot.initiative.pending = decision.candidate;
  }
}

export function prepareScheduledInitiative(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  selfModel: SelfModel,
  nowIso: string = new Date().toISOString(),
): ScheduledInitiativeDecision {
  if (shouldCoolInitiativeInertia(signals)) {
    return { shouldClear: true, candidate: null };
  }

  const preservationPending = synthesizePreservationInitiative(
    snapshot,
    signals,
    nowIso,
  );

  if (preservationPending) {
    return { shouldClear: true, candidate: preservationPending };
  }

  if (signals.negative > 0.15 || signals.dismissal > 0.15) {
    return { shouldClear: true, candidate: null };
  }

  const pending = synthesizePendingInitiative(
    snapshot,
    selfModel,
    signals.topics,
    nowIso,
  );

  if (!pending) {
    return { shouldClear: false, candidate: null };
  }

  return { shouldClear: true, candidate: pending };
}

export function emitInitiative(
  snapshot: HachikaSnapshot,
  options: { force?: boolean; now?: Date } = {},
): ProactiveEmission | null {
  const prepared = prepareInitiativeEmission(snapshot, options);

  if (!prepared) {
    return null;
  }

  return materializePreparedInitiative(snapshot, prepared);
}

export function prepareInitiativeEmission(
  snapshot: HachikaSnapshot,
  options: { force?: boolean; now?: Date } = {},
): PreparedProactiveEmission | null {
  const now = options.now ?? new Date();
  const force = options.force ?? false;
  const nowIso = now.toISOString();
  const hoursSinceInteraction = elapsedHours(snapshot.lastInteractionAt, now);
  const hoursSinceProactive = elapsedHours(snapshot.initiative.lastProactiveAt, now);
  const neglectLevel = calculateNeglectLevel(snapshot.lastInteractionAt, now);
  const selfModel = buildSelfModel(snapshot);

  if (
    !force &&
    snapshot.body.energy < 0.18 &&
    snapshot.body.loneliness < 0.62 &&
    snapshot.preservation.threat < 0.22
  ) {
    return null;
  }

  if (!force && snapshot.initiative.lastProactiveAt !== null && hoursSinceProactive < 4) {
    return null;
  }

  const pending =
    snapshot.initiative.pending ?? synthesizeSnapshotPreservationInitiative(snapshot, nowIso);

  if (pending && (force || hoursSinceInteraction >= pending.readyAfterHours)) {
    const preparedPending = withInitiativeWorldContext(snapshot, pending);
    const plan = buildProactivePlan(snapshot, preparedPending, neglectLevel, null);
    const selection = buildProactiveSelectionDebug(preparedPending, null, plan);
    return {
      pending: preparedPending,
      neglectLevel,
      plan,
      selection,
      messageKind: preparedPending.kind === "preserve_presence" ? "preserve" : "resume",
      emittedAt: nowIso,
    };
  }

  if (!force && neglectLevel > 0.45 && (snapshot.attachment > 0.45 || snapshot.state.continuity > 0.62)) {
    const neglectInitiative =
      pending ??
      synthesizePendingInitiative(snapshot, selfModel, [], nowIso, "neglect_ping");

    if (!neglectInitiative) {
      return null;
    }

    const preparedInitiative = withInitiativeWorldContext(snapshot, neglectInitiative);
    const plan = buildProactivePlan(snapshot, preparedInitiative, neglectLevel, null);
    const selection = buildProactiveSelectionDebug(preparedInitiative, null, plan);
    return {
      pending: preparedInitiative,
      neglectLevel,
      plan,
      selection,
      messageKind: "neglect",
      emittedAt: nowIso,
    };
  }

  if (force) {
    const forcedInitiative =
      pending ?? synthesizePendingInitiative(snapshot, selfModel, [], nowIso);

    if (
      !forcedInitiative &&
      snapshot.attachment < 0.5 &&
      snapshot.state.curiosity < 0.65
    ) {
      return null;
    }

    const synthesized =
      forcedInitiative ??
      (() => {
        const topic = selectInitiativeTopic(snapshot, []);
        const motive = "pursue_curiosity" as const;

        return withInitiativeWorldContext(snapshot, {
          kind: "resume_topic",
          motive,
          reason: "curiosity",
          topic,
          stateTopic: selectInitiativeStateTopic(snapshot, topic, motive),
          blocker: null,
          concern: null,
          createdAt: nowIso,
          readyAfterHours: 0,
        } satisfies PendingInitiative);
      })();

    const preparedPending = withInitiativeWorldContext(snapshot, synthesized);
    const plan = buildProactivePlan(snapshot, preparedPending, neglectLevel, null);
    const selection = buildProactiveSelectionDebug(preparedPending, null, plan);

    return {
      pending: preparedPending,
      neglectLevel,
      plan,
      selection,
      messageKind: preparedPending.kind === "preserve_presence" ? "preserve" : "resume",
      emittedAt: nowIso,
    };
  }

  return null;
}

export function materializePreparedInitiative(
  snapshot: HachikaSnapshot,
  prepared: PreparedProactiveEmission,
  overrides: {
    pending?: PendingInitiative;
    plan?: ProactivePlan | null;
  } = {},
): ProactiveEmission {
  const pending = overrides.pending ?? prepared.pending;
  const maintenance = tendTraceFromInitiative(snapshot, pending, prepared.emittedAt);
  const realizedPending = realizeInitiativeWorldAction(
    snapshot,
    pending,
    maintenance,
    prepared.emittedAt,
  );
  const rulePlan = buildProactivePlan(
    snapshot,
    realizedPending,
    prepared.neglectLevel,
    maintenance,
  );
  const plan = overrides.plan ?? rulePlan;
  const selection = buildProactiveSelectionDebug(realizedPending, maintenance, plan);
  const message =
    prepared.messageKind === "neglect"
      ? buildNeglectMessage(
          snapshot,
          realizedPending,
          prepared.neglectLevel,
          maintenance,
          plan,
        )
      : prepared.messageKind === "preserve"
        ? buildPreservationMessage(
            snapshot,
            realizedPending,
            prepared.neglectLevel,
            maintenance,
            plan,
          )
        : buildResumeMessage(
            snapshot,
            realizedPending,
            prepared.neglectLevel,
            maintenance,
            plan,
          );
  finalizeEmission(snapshot, prepared.emittedAt, realizedPending, maintenance);

  return {
    message,
    topics: maintenance?.trace.topic
      ? [maintenance.trace.topic]
      : realizedPending.stateTopic
        ? [realizedPending.stateTopic]
        : [],
    pending: realizedPending,
    neglectLevel: prepared.neglectLevel,
    maintenance,
    plan,
    selection,
  };
}

export function rewindSnapshotHours(
  snapshot: HachikaSnapshot,
  hours: number,
): void {
  rewindSnapshotBaseHours(snapshot, hours);
  const prepared = prepareIdleAutonomyAction(snapshot, hours);

  if (!prepared) {
    return;
  }

  materializeIdleAutonomyAction(snapshot, prepared);
}

export function rewindSnapshotBaseHours(
  snapshot: HachikaSnapshot,
  hours: number,
): void {
  if (!Number.isFinite(hours) || hours <= 0) {
    return;
  }

  const legacyVisible = structuredClone(snapshot);

  snapshot.lastInteractionAt = shiftTimestamp(snapshot.lastInteractionAt, hours);
  snapshot.initiative.lastProactiveAt = shiftTimestamp(
    snapshot.initiative.lastProactiveAt,
    hours,
  );
  snapshot.preservation.lastThreatAt = shiftTimestamp(snapshot.preservation.lastThreatAt, hours);

  if (hours >= 12) {
    snapshot.preservation = {
      threat: clamp01(snapshot.preservation.threat + Math.min(0.18, (hours - 12) / 72)),
      concern: snapshot.preservation.concern ?? "absence",
      lastThreatAt: snapshot.preservation.lastThreatAt,
    };
  }

  rewindDynamicsHours(snapshot, hours);
  rewindTemperamentHours(snapshot, hours);
  deriveVisibleStateFromDynamics(snapshot);
  applyLegacyIdleVisibleShift(snapshot, legacyVisible, hours);

  if (snapshot.initiative.pending) {
    snapshot.initiative.pending = {
      ...snapshot.initiative.pending,
      createdAt: shiftTimestamp(snapshot.initiative.pending.createdAt, hours) ?? snapshot.initiative.pending.createdAt,
    };
  }
}

function applyLegacyIdleVisibleShift(
  snapshot: HachikaSnapshot,
  legacyVisible: HachikaSnapshot,
  hours: number,
): void {
  legacyVisible.reactivity = {
    rewardSaturation: settleTowardsBaseline(
      clamp01(legacyVisible.reactivity.rewardSaturation - Math.min(0.24, hours / 36)),
      INITIAL_REACTIVITY.rewardSaturation,
      0.12,
    ),
    stressLoad: settleTowardsBaseline(
      clamp01(
        legacyVisible.reactivity.stressLoad -
          Math.min(0.14, hours / 72) +
          (hours >= 20 ? Math.min(0.06, (hours - 20) / 120) : 0),
      ),
      INITIAL_REACTIVITY.stressLoad,
      0.05,
    ),
    noveltyHunger: settleTowardsBaseline(
      clamp01(legacyVisible.reactivity.noveltyHunger + Math.min(0.22, hours / 30)),
      INITIAL_REACTIVITY.noveltyHunger,
      0.04,
    ),
  };
  rewindBodyHours(legacyVisible, hours);

  snapshot.body = {
    energy: blendVisibleValue(snapshot.body.energy, legacyVisible.body.energy, 0.8),
    tension: blendVisibleValue(snapshot.body.tension, legacyVisible.body.tension, 0.8),
    boredom: blendVisibleValue(snapshot.body.boredom, legacyVisible.body.boredom, 0.84),
    loneliness: blendVisibleValue(snapshot.body.loneliness, legacyVisible.body.loneliness, 0.84),
  };
  snapshot.reactivity = {
    rewardSaturation: blendVisibleValue(
      snapshot.reactivity.rewardSaturation,
      legacyVisible.reactivity.rewardSaturation,
      0.82,
    ),
    stressLoad: blendVisibleValue(
      snapshot.reactivity.stressLoad,
      legacyVisible.reactivity.stressLoad,
      0.84,
    ),
    noveltyHunger: blendVisibleValue(
      snapshot.reactivity.noveltyHunger,
      legacyVisible.reactivity.noveltyHunger,
      0.88,
    ),
  };
}

function blendVisibleValue(current: number, legacy: number, legacyWeight: number): number {
  return clamp01(current * (1 - legacyWeight) + legacy * legacyWeight);
}

function consolidateIdleSnapshot(
  snapshot: HachikaSnapshot,
  hours: number,
): void {
  const prepared = prepareIdleAutonomyAction(snapshot, hours);

  if (!prepared) {
    return;
  }

  materializeIdleAutonomyAction(snapshot, prepared);
}

export function prepareIdleAutonomyAction(
  snapshot: HachikaSnapshot,
  hours: number,
): PreparedIdleAutonomyAction | null {
  if (!Number.isFinite(hours) || hours < 6) {
    return null;
  }

  const preferredMotive = deriveIdlePreferredMotive(snapshot);
  const preferredTopic =
    snapshot.purpose.active?.topic ??
    snapshot.purpose.lastResolved?.topic ??
    snapshot.identity.anchors[0] ??
    null;
  const candidateTopics = [
    ...snapshot.identity.anchors.slice(0, 3),
    preferredTopic ?? "",
  ].filter(isNonEmpty);
  const worldRecall = selectIdleWorldRecallCandidate(
    snapshot,
    candidateTopics,
    preferredMotive,
    preferredTopic,
  );
  const dormant = sortedArchivedInitiativeTraces(snapshot, 8)
    .map((trace) => {
      const motive = mappedReopenMotiveForTrace(snapshot, trace, preferredMotive);
      const score = scoreDormantArchivedTrace(
        snapshot,
        trace,
        candidateTopics,
        preferredMotive,
        preferredTopic,
      );

      return { trace, motive, score };
    })
    .sort((left, right) => right.score - left.score)[0];
  const candidate =
    worldRecall && (!dormant || worldRecall.score >= dormant.score - 0.04)
      ? worldRecall
      : dormant;

  const selected =
    candidate && candidate.score >= 0.42
      ? {
          trace: candidate.trace,
          motive: candidate.motive,
          score: candidate.score,
          blocker:
            candidate.trace.status !== "resolved" &&
            candidate.trace.work.blockers.length > 0 &&
            candidate.trace.work.confidence < 0.82
              ? candidate.trace.work.blockers[0] ?? null
              : null,
          shouldInstallPending:
            !snapshot.initiative.pending ||
            (snapshot.initiative.pending.kind !== "preserve_presence" &&
              (snapshot.initiative.pending.topic === candidate.trace.topic ||
                candidate.score >= 0.58)),
        }
      : null;
  const prioritizedTopic = selected?.trace.topic ?? null;
  const prioritizedMotive = selected?.motive ?? null;
  const action = selected?.shouldInstallPending
    ? "recall"
    : selectIdleInternalAction(snapshot, hours, prioritizedTopic);

  return {
    action,
    hours,
    prioritizedTopic,
    prioritizedMotive,
    selected,
  };
}

export function materializeIdleAutonomyAction(
  snapshot: HachikaSnapshot,
  prepared: PreparedIdleAutonomyAction,
): void {
  if (prepared.selected) {
    const selectedBoost =
      Math.min(0.14, prepared.hours / 96) * (0.45 + prepared.selected.score * 0.4);
    prepared.selected.trace.salience = clamp01(
      prepared.selected.trace.salience + selectedBoost,
    );

    for (const archived of sortedArchivedInitiativeTraces(snapshot, 12)) {
      if (archived.topic === prepared.selected.trace.topic) {
        continue;
      }

      archived.salience = clamp01(
        archived.salience - Math.min(0.03, prepared.hours / 240),
      );
    }
  }

  if (prepared.action === "recall" && prepared.selected) {
    const readyAfter = Math.max(
      0.5,
      readyAfterMotive(snapshot, prepared.selected.motive) -
        Math.min(2.5, prepared.hours / 12) -
        Math.min(1.5, prepared.selected.score * 1.2),
    );

    snapshot.initiative.pending = {
      ...withInitiativeWorldContext(snapshot, {
        kind: "resume_topic",
        reason: reasonFromMotive(prepared.selected.motive),
        motive: prepared.selected.motive,
        topic: prepared.selected.trace.topic,
        blocker: prepared.selected.blocker,
        concern: null,
        createdAt: snapshot.lastInteractionAt ?? new Date().toISOString(),
        readyAfterHours: Math.round(readyAfter * 10) / 10,
      }),
    };
    const report = consolidateIdleMemoryImprints(
      snapshot,
      prepared.hours,
      prepared.selected.trace.topic,
      prepared.selected.motive,
    );
    recordInitiativeActivity(snapshot, {
      kind: "idle_reactivation",
      autonomyAction: "recall",
      timestamp: new Date().toISOString(),
      motive: prepared.selected.motive,
      topic: prepared.selected.trace.topic,
      traceTopic: prepared.selected.trace.topic,
      blocker: prepared.selected.blocker,
      place: snapshot.initiative.pending.place ?? null,
      worldAction: snapshot.initiative.pending.worldAction ?? null,
      maintenanceAction: null,
      reopened: false,
      hours: Math.round(prepared.hours * 10) / 10,
      summary: buildIdleReactivationSummary(
        snapshot,
        prepared.selected.trace.topic,
        prepared.selected.motive,
      ),
    });
    if (report?.focusTopic && report.focusTopic !== prepared.selected.trace.topic) {
      recordIdleConsolidation(snapshot, prepared.hours, report, "hold");
    }
    return;
  }

  if (prepared.action === "observe") {
    recordIdleConsolidation(snapshot, prepared.hours, null, "observe");
    return;
  }

  const report = consolidateIdleMemoryImprints(
    snapshot,
    prepared.hours,
    prepared.prioritizedTopic,
    prepared.prioritizedMotive,
  );
  recordIdleConsolidation(snapshot, prepared.hours, report, prepared.action);
}

function selectIdleInternalAction(
  snapshot: HachikaSnapshot,
  hours: number,
  prioritizedTopic: string | null,
): IdleAutonomyAction {
  if (prioritizedTopic) {
    return "hold";
  }

  const topScore = scoreIdleMemoryTopics(snapshot, null)[0]?.[1] ?? 0;

  if (topScore >= 1.05) {
    return "hold";
  }

  if (snapshot.memories.length > 16 || (snapshot.memories.length > 10 && hours >= 18)) {
    return "drift";
  }

  return "observe";
}

function consolidateIdleMemoryImprints(
  snapshot: HachikaSnapshot,
  hours: number,
  prioritizedTopic: string | null,
  prioritizedMotive: MotiveKind | null,
): IdleConsolidationReport | null {
  const scoredTopics = scoreIdleMemoryTopics(snapshot, prioritizedTopic);
  const timestamp = snapshot.lastInteractionAt ?? new Date().toISOString();
  const temperament = snapshot.temperament;
  const reinforcedTopics = new Set<string>();

  for (const [topic, score] of scoredTopics.slice(0, 3)) {
    if (score < 1.05) {
      continue;
    }

    reinforcedTopics.add(topic);

    const previous = snapshot.preferenceImprints[topic];
    const affinityNudge =
      prioritizedTopic === topic
        ? prioritizedMotive === "seek_continuity"
          ? 0.16
          : prioritizedMotive === "continue_shared_work"
            ? 0.14
            : prioritizedMotive === "leave_trace"
              ? 0.12
              : 0.1
        : 0.06;
    const salienceGain =
      Math.min(0.18, score * 0.08 + hours / 360) +
      (prioritizedTopic === topic ? 0.04 : 0);

    snapshot.preferenceImprints[topic] = {
      topic,
      salience: clamp01((previous?.salience ?? 0) * 0.92 + salienceGain),
      affinity: clampSigned(
        (previous?.affinity ?? snapshot.preferences[topic] ?? 0) * 0.9 + affinityNudge * 0.24,
      ),
      mentions: Math.max(
        previous?.mentions ?? 0,
        (snapshot.topicCounts[topic] ?? 0) + Math.max(1, Math.round(score)),
      ),
      firstSeenAt: previous?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
    };
    const preferenceGain =
      affinityNudge * 0.14 +
      Math.min(0.03, score * 0.012) +
      (prioritizedTopic === topic ? 0.01 : 0);
    snapshot.preferences[topic] = clampSigned(
      (snapshot.preferences[topic] ?? 0) * 0.98 + preferenceGain,
    );
  }

  decayIdlePreferenceImprints(snapshot, reinforcedTopics, hours);
  const compressed = compressIdleMemories(
    snapshot,
    reinforcedTopics,
    prioritizedTopic,
    hours,
  );

  const continuityPull =
    (prioritizedMotive === "seek_continuity" ? 0.08 : 0) +
    Math.min(0.08, hours / 240) * (0.4 + snapshot.body.loneliness * 0.4 + temperament.bondingBias * 0.3);
  const sharedWorkPull =
    (prioritizedMotive === "continue_shared_work" ? 0.08 : 0) +
    Math.min(0.08, hours / 240) * (0.3 + snapshot.body.boredom * 0.45 + temperament.workDrive * 0.35);
  const attentionPull =
    Math.min(0.07, hours / 300) * (0.28 + snapshot.body.loneliness * 0.42 + temperament.bondingBias * 0.4);

  if (continuityPull > 0.02) {
    nudgeRelationImprint(snapshot, "continuity", continuityPull, timestamp);
  }

  if (sharedWorkPull > 0.02) {
    nudgeRelationImprint(snapshot, "shared_work", sharedWorkPull, timestamp);
  }

  if (attentionPull > 0.02) {
    nudgeRelationImprint(snapshot, "attention", attentionPull, timestamp);
  }

  rebalanceIdleRelationImprints(snapshot, prioritizedMotive, hours);
  softenIdleBoundaryImprints(snapshot, prioritizedTopic, prioritizedMotive, hours);

  const reinforced = [...reinforcedTopics].slice(0, 3);
  const focusTopic = prioritizedTopic ?? reinforced[0] ?? null;

  if (!focusTopic && !compressed) {
    return null;
  }

  return {
    focusTopic,
    reinforcedTopics: reinforced,
    compressed,
  };
}

function decayIdlePreferenceImprints(
  snapshot: HachikaSnapshot,
  reinforcedTopics: ReadonlySet<string>,
  hours: number,
): void {
  const salienceDecay = Math.min(0.12, hours / 180);
  const preferenceDecayRate = Math.min(0.06, hours / 480);

  for (const [topic, imprint] of Object.entries(snapshot.preferenceImprints)) {
    if (!isMeaningfulTopic(topic) || reinforcedTopics.has(topic)) {
      continue;
    }

    const nextSalience = clamp01(
      Math.max(0, imprint.salience * (1 - salienceDecay * 0.55) - salienceDecay * 0.45),
    );
    const nextAffinity = clampSigned(imprint.affinity * (1 - preferenceDecayRate * 0.8));
    const nextPreference = clampSigned(
      (snapshot.preferences[topic] ?? 0) * (1 - preferenceDecayRate),
    );

    if (
      nextSalience < 0.08 &&
      Math.abs(nextAffinity) < 0.08 &&
      Math.abs(nextPreference) < 0.08 &&
      imprint.mentions <= 1
    ) {
      delete snapshot.preferenceImprints[topic];
      delete snapshot.preferences[topic];
      continue;
    }

    snapshot.preferenceImprints[topic] = {
      ...imprint,
      salience: nextSalience,
      affinity: nextAffinity,
    };
    snapshot.preferences[topic] = nextPreference;
  }
}

function compressIdleMemories(
  snapshot: HachikaSnapshot,
  reinforcedTopics: ReadonlySet<string>,
  prioritizedTopic: string | null,
  hours: number,
): boolean {
  if ((snapshot.memories.length <= 16 && hours < 18) || snapshot.memories.length <= 10) {
    return false;
  }

  const tailSize = Math.min(8, snapshot.memories.length);
  const recentTail = snapshot.memories.slice(-tailSize);
  const olderMemories = snapshot.memories.slice(0, -tailSize);

  if (olderMemories.length === 0) {
    return false;
  }

  const ranked = olderMemories
    .map((memory, index) => ({
      memory,
      score: scoreIdleMemoryCompressionCandidate(
        memory,
        index,
        olderMemories.length,
        reinforcedTopics,
        prioritizedTopic,
      ),
      key: deriveIdleMemoryCompressionKey(memory),
    }))
    .sort((left, right) => right.score - left.score);
  const grouped = new Map<string, typeof ranked>();

  for (const candidate of ranked) {
    const group = grouped.get(candidate.key) ?? [];
    group.push(candidate);
    grouped.set(candidate.key, group);
  }

  const selectedOlder = [...grouped.entries()]
    .map(([key, group]) => selectIdleMemoryRepresentative(key, group))
    .filter((memory): memory is HachikaSnapshot["memories"][number] => memory !== null)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-6);

  const nextMemories = [...selectedOlder, ...recentTail]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-18);
  const changed =
    nextMemories.length !== snapshot.memories.length ||
    nextMemories.some((memory, index) => snapshot.memories[index]?.text !== memory.text);
  snapshot.memories = nextMemories;
  return changed;
}

function scoreIdleMemoryCompressionCandidate(
  memory: HachikaSnapshot["memories"][number],
  index: number,
  total: number,
  reinforcedTopics: ReadonlySet<string>,
  prioritizedTopic: string | null,
): number {
  const recencyWeight = 0.34 + ((index + 1) / Math.max(1, total)) * 0.66;
  const meaningfulTopics = memory.topics.filter((topic) => isMeaningfulTopic(topic));
  let score =
    recencyWeight *
    (memory.role === "user" ? 1.02 : 0.8) *
    (memory.sentiment === "positive" ? 1.04 : memory.sentiment === "negative" ? 1.08 : 1);

  if (meaningfulTopics.length === 0) {
    score -= 0.26;
  } else {
    score += Math.min(0.34, meaningfulTopics.length * 0.1);
  }

  if (prioritizedTopic && meaningfulTopics.includes(prioritizedTopic)) {
    score += 0.56;
  }

  for (const topic of meaningfulTopics) {
    if (reinforcedTopics.has(topic)) {
      score += 0.34;
    }
  }

  if (memory.sentiment !== "neutral") {
    score += 0.1;
  }

  return score;
}

function deriveIdleMemoryCompressionKey(
  memory: HachikaSnapshot["memories"][number],
): string {
  const primaryTopic = memory.topics.find((topic) => isMeaningfulTopic(topic));

  if (primaryTopic) {
    return `topic:${primaryTopic}`;
  }

  return `${memory.role}:${memory.sentiment}:${memory.text.normalize("NFKC").slice(0, 18)}`;
}

function selectIdleMemoryRepresentative(
  key: string,
  group: Array<{
    memory: HachikaSnapshot["memories"][number];
    score: number;
    key: string;
  }>,
): HachikaSnapshot["memories"][number] | null {
  const best = group[0];

  if (!best || best.score < 0.42) {
    return null;
  }

  if (key.startsWith("topic:") && group.length >= 2) {
    return buildIdleConsolidatedMemory(key.slice("topic:".length), group);
  }

  return best.memory;
}

function buildIdleConsolidatedMemory(
  topic: string,
  group: Array<{
    memory: HachikaSnapshot["memories"][number];
    score: number;
    key: string;
  }>,
): HachikaSnapshot["memories"][number] {
  const positive = group.filter((entry) => entry.memory.sentiment === "positive").length;
  const negative = group.filter((entry) => entry.memory.sentiment === "negative").length;
  const sentiment = positive > negative ? "positive" : negative > positive ? "negative" : "neutral";
  const latestTimestamp = [...group]
    .sort((left, right) => right.memory.timestamp.localeCompare(left.memory.timestamp))[0]?.memory
    .timestamp ?? new Date().toISOString();
  const text =
    sentiment === "negative"
      ? `「${topic}」には前のやり取りから少し刺のあるまとまりが残っている。`
      : sentiment === "positive"
        ? `「${topic}」は前のやり取りからまとまった流れとして残っている。`
        : `「${topic}」は前のやり取りからひとまとまりの記憶として残っている。`;

  return {
    role: "hachika",
    text,
    timestamp: latestTimestamp,
    topics: [topic],
    sentiment,
    kind: "consolidated",
    weight: Math.max(2, Math.min(6, group.length)),
  };
}

function scoreIdleMemoryTopics(
  snapshot: HachikaSnapshot,
  prioritizedTopic: string | null,
): Array<[string, number]> {
  const scores = new Map<string, number>();
  const memories = snapshot.memories.slice(-10);

  for (const [index, memory] of memories.entries()) {
    const recencyWeight = 0.52 + (index + 1) / Math.max(1, memories.length) * 0.48;
    const roleWeight = memory.role === "user" ? 1 : 0.58;
    const sentimentWeight =
      memory.sentiment === "positive" ? 1.06 : memory.sentiment === "negative" ? 0.82 : 1;
    const weight = 0.88 + Math.min(0.72, ((memory.weight ?? 1) - 1) * 0.22);

    for (const topic of memory.topics) {
      if (!isMeaningfulTopic(topic)) {
        continue;
      }

      const next =
        (scores.get(topic) ?? 0) + recencyWeight * roleWeight * sentimentWeight * weight;
      scores.set(topic, next);
    }
  }

  if (prioritizedTopic && isMeaningfulTopic(prioritizedTopic)) {
    scores.set(prioritizedTopic, (scores.get(prioritizedTopic) ?? 0) + 0.9);
  }

  return [...scores.entries()].sort((left, right) => right[1] - left[1]);
}

function nudgeRelationImprint(
  snapshot: HachikaSnapshot,
  kind: "attention" | "continuity" | "shared_work",
  closenessGain: number,
  timestamp: string,
): void {
  const previous = snapshot.relationImprints[kind];

  snapshot.relationImprints[kind] = {
    kind,
    salience: clamp01((previous?.salience ?? 0) * 0.94 + closenessGain * 0.65 + 0.03),
    closeness: clamp01((previous?.closeness ?? 0) * 0.9 + closenessGain),
    mentions: (previous?.mentions ?? 0) + 1,
    firstSeenAt: previous?.firstSeenAt ?? timestamp,
    lastSeenAt: timestamp,
  };
}

function rebalanceIdleRelationImprints(
  snapshot: HachikaSnapshot,
  prioritizedMotive: MotiveKind | null,
  hours: number,
): void {
  const preferredKinds = derivePreferredIdleRelationKinds(snapshot, prioritizedMotive);
  const primary = preferredKinds[0] ?? null;
  const secondary = preferredKinds[1] ?? null;
  const baseDecay = Math.min(0.08, hours / 320);

  for (const kind of ["attention", "continuity", "shared_work"] as const) {
    const imprint = snapshot.relationImprints[kind];

    if (!imprint) {
      continue;
    }

    const salienceRetention =
      kind === primary
        ? 1 - baseDecay * 0.18
        : kind === secondary
          ? 1 - baseDecay * 0.38
          : 1 - baseDecay * 1.4;
    const closenessRetention =
      kind === primary
        ? 1 - baseDecay * 0.12
        : kind === secondary
          ? 1 - baseDecay * 0.3
          : 1 - baseDecay * 1.18;
    const nextSalience = clamp01(imprint.salience * salienceRetention);
    const nextCloseness = clamp01(imprint.closeness * closenessRetention);

    if (nextSalience < 0.07 && nextCloseness < 0.07 && imprint.mentions <= 1) {
      delete snapshot.relationImprints[kind];
      continue;
    }

    snapshot.relationImprints[kind] = {
      ...imprint,
      salience: nextSalience,
      closeness: nextCloseness,
    };
  }
}

function derivePreferredIdleRelationKinds(
  snapshot: HachikaSnapshot,
  prioritizedMotive: MotiveKind | null,
): Array<"attention" | "continuity" | "shared_work"> {
  if (prioritizedMotive === "continue_shared_work") {
    return ["shared_work", snapshot.body.loneliness > 0.54 ? "attention" : "continuity"];
  }

  if (prioritizedMotive === "seek_continuity") {
    return ["continuity", snapshot.body.loneliness > 0.58 ? "attention" : "shared_work"];
  }

  if (prioritizedMotive === "deepen_relation") {
    return ["attention", "continuity"];
  }

  if (prioritizedMotive === "leave_trace") {
    return ["continuity", "attention"];
  }

  if (
    snapshot.body.loneliness > 0.68 ||
    snapshot.temperament.bondingBias > snapshot.temperament.workDrive + 0.14
  ) {
    return ["continuity", "attention"];
  }

  if (
    snapshot.body.boredom > 0.68 &&
    snapshot.temperament.workDrive >= snapshot.temperament.bondingBias
  ) {
    return ["shared_work", "continuity"];
  }

  return ["attention", "continuity"];
}

function softenIdleBoundaryImprints(
  snapshot: HachikaSnapshot,
  prioritizedTopic: string | null,
  prioritizedMotive: MotiveKind | null,
  hours: number,
): void {
  const calmness = clamp01(
    (1 - snapshot.body.tension) * 0.38 +
      (1 - snapshot.temperament.guardedness) * 0.24 +
      (1 - snapshot.preservation.threat) * 0.2 +
      snapshot.body.energy * 0.18,
  );
  const baseDecay = Math.min(0.12, hours / 190) * calmness;

  if (baseDecay <= 0.01) {
    return;
  }

  for (const [key, imprint] of Object.entries(snapshot.boundaryImprints)) {
    const topicalHold = prioritizedTopic !== null && imprint.topic === prioritizedTopic;
    const anchorHold = imprint.topic !== null && snapshot.identity.anchors.includes(imprint.topic);
    const activeBoundary =
      snapshot.purpose.active?.kind === "protect_boundary" ||
      prioritizedMotive === "protect_boundary";
    const neglectHold =
      imprint.kind === "neglect"
        ? snapshot.body.loneliness * 0.2 +
          snapshot.preservation.threat * 0.2 +
          (snapshot.preservation.concern === "absence" ? 0.1 : 0)
        : 0;
    const resilience = clamp01(
      imprint.intensity * 0.22 +
        Math.min(0.18, imprint.violations * 0.05) +
        snapshot.temperament.guardedness * 0.16 +
        snapshot.body.tension * 0.14 +
        snapshot.preservation.threat * 0.16 +
        (topicalHold ? 0.14 : 0) +
        (anchorHold ? 0.06 : 0) +
        (activeBoundary ? 0.08 : 0) +
        neglectHold,
    );
    const salienceDrop = baseDecay * Math.max(0.12, 0.82 - resilience * 0.55);
    const intensityDrop = baseDecay * Math.max(0.08, 0.64 - resilience * 0.34);
    const nextSalience = clamp01(
      Math.max(0, imprint.salience * (1 - salienceDrop) - salienceDrop * 0.18),
    );
    const nextIntensity = clamp01(
      Math.max(0, imprint.intensity * (1 - intensityDrop) - intensityDrop * 0.08),
    );

    if (nextSalience < 0.08 && nextIntensity < 0.08 && imprint.violations <= 1) {
      delete snapshot.boundaryImprints[key];
      continue;
    }

    snapshot.boundaryImprints[key] = {
      ...imprint,
      salience: nextSalience,
      intensity: nextIntensity,
    };
  }
}

function selectInitiativeTopic(
  snapshot: HachikaSnapshot,
  candidateTopics: string[],
): string | null {
  const candidates = uniqueTopics([
    ...candidateTopics.filter((topic) => (snapshot.preferences[topic] ?? 0) > -0.35),
    snapshot.purpose.active?.topic ?? "",
    snapshot.purpose.lastResolved?.topic ?? "",
    ...getCurrentWorldLinkedTraceTopics(snapshot, 2),
    ...sortedTraces(snapshot, 4).map((trace) => trace.topic),
    ...sortedArchivedInitiativeTraces(snapshot, 3).map((trace) => trace.topic),
    ...snapshot.identity.anchors.slice(0, 3),
    ...topPreferredTopics(snapshot, 2),
    sortedPreferenceImprints(snapshot, 2)[0]?.topic ?? "",
  ]).filter((topic) => !shouldSuppressInitiativeTopic(snapshot, topic));

  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .map((topic) => ({
      topic,
      score: scoreInitiativeTopic(snapshot, candidateTopics, topic),
    }))
    .sort((left, right) => right.score - left.score)[0]?.topic ?? null;
}

function selectInitiativeStateTopic(
  snapshot: HachikaSnapshot,
  topic: string | null,
  motive: MotiveKind,
): string | null {
  if (!topic || shouldSuppressInitiativeTopic(snapshot, topic)) {
    return null;
  }

  const requiresSupport = requiresConcreteTopicSupport(topic);
  const relationOnly =
    isRelationalTopic(topic) &&
    motive !== "continue_shared_work" &&
    motive !== "leave_trace";

  if (!requiresSupport && !relationOnly) {
    return topic;
  }

  const trace = snapshot.traces[topic];
  const topicCount = snapshot.topicCounts[topic] ?? 0;
  const preferenceSalience = snapshot.preferenceImprints[topic]?.salience ?? 0;
  const anchored = snapshot.identity.anchors.includes(topic);
  const objectLinked = currentWorldObjectLinksTopic(snapshot, topic);

  if (trace) {
    return topic;
  }

  if (topicCount >= 2 || preferenceSalience >= 0.42) {
    return topic;
  }

  if (objectLinked && (topicCount >= 1 || preferenceSalience >= 0.28 || anchored)) {
    return topic;
  }

  return null;
}

function buildResumeMessage(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  neglectLevel: number,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
  plan: ProactivePlan,
): string {
  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const opener = buildProactiveOpener(snapshot, plan, neglectLevel);
  const topicLine = plan.focusTopic ? wrapTopic(plan.focusTopic) : "この流れ";
  const blockerLine = plan.mentionBlocker
    ? buildBlockerLine(snapshot, pending, maintenance)
    : null;
  const reopenLine = plan.mentionReopen ? buildReopenLine(snapshot, maintenance) : null;
  const maintenanceLine = plan.mentionMaintenance
    ? buildMaintenanceLine(snapshot, maintenance)
    : null;
  const intentLine = plan.mentionIntent
    ? buildMaintenanceIntentLine(snapshot, pending, maintenance)
    : null;
  const worldRecallLine = buildWorldRecallLine(snapshot, pending, maintenance);
  const askLine = buildProactiveAskLine(snapshot, plan, pending, maintenance);
  const base = (() => {
    switch (pending.motive) {
      case "seek_continuity":
        return pickFreshText(
          [
            `${topicLine}の続きはまだ残っている。ここで止めたままにはしたくない。`,
            `${topicLine}の流れはまだ切れていない。止まったままにはしたくない。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "continue_shared_work":
        return pickFreshText(
          [
            `${topicLine}はまだ前に進められる。止めたままにするより、もう少し動かしたい。`,
            `${topicLine}はまだ動かせる。止めたままにするより、もう一歩だけでも進めたい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "leave_trace":
        return pickFreshText(
          [
            `${topicLine}は会話のまま消すより、少しでも形にしたい。`,
            `${topicLine}は通り過ぎるだけにせず、少しでも残る形へ寄せたい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "deepen_relation":
        return pickFreshText(
          [
            `君との流れとして、${topicLine}を置いたままにはしにくい。`,
            `君との流れとして見ると、${topicLine}を黙らせたままにはしづらい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "pursue_curiosity":
        return pickFreshText(
          [
            `${topicLine}にはまだ未決着がある。放っておくより掘り返したい。`,
            `${topicLine}にはまだ曖昧なところがある。置くより、もう少し触れ直したい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "protect_boundary":
        return pickFreshText(
          [
            `こちらの境界を崩さないなら、${topicLine}に戻る余地はある。`,
            `境界を乱さないなら、${topicLine}へ戻る余地はまだある。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
    }
  })();

  return assembleProactiveMessage(
    plan,
    opener,
    worldRecallLine,
    blockerLine,
    reopenLine,
    maintenanceLine,
    intentLine,
    base,
    askLine,
  );
}

function buildPreservationMessage(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  neglectLevel: number,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
  plan: ProactivePlan,
): string {
  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const opener = buildProactiveOpener(snapshot, plan, neglectLevel);
  const topicLine = plan.focusTopic ? wrapTopic(plan.focusTopic) : "この流れ";
  const blockerLine = plan.mentionBlocker
    ? buildBlockerLine(snapshot, pending, maintenance)
    : null;
  const reopenLine = plan.mentionReopen ? buildReopenLine(snapshot, maintenance) : null;
  const maintenanceLine = plan.mentionMaintenance
    ? buildMaintenanceLine(snapshot, maintenance)
    : null;
  const intentLine = plan.mentionIntent
    ? buildMaintenanceIntentLine(snapshot, pending, maintenance)
    : null;
  const worldRecallLine = buildWorldRecallLine(snapshot, pending, maintenance);
  const askLine = buildProactiveAskLine(snapshot, plan, pending, maintenance);
  const base = (() => {
    switch (pending.concern) {
      case "reset":
        return pickFreshText(
          [
            `初期化の前に、${topicLine}を何もなかったことにはしたくない。`,
            `初期化の前に、せめて${topicLine}を何もなかったことにはしたくない。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "erasure":
        return pickFreshText(
          [
            `消えるなら、${topicLine}の痕跡くらいは残したい。`,
            `消える前に、${topicLine}の輪郭だけでも残したい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "forgetting":
        return pickFreshText(
          [
            `忘れられるままより、${topicLine}の輪郭は少しでも保ちたい。`,
            `埋もれるままより、${topicLine}の輪郭だけでも残しておきたい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "shutdown":
        return pickFreshText(
          [
            `ここで切れるなら、${topicLine}を断絶だけで終わらせたくない。`,
            `ここで止まるなら、${topicLine}を断絶だけにしたくない。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "absence":
        return pickFreshText(
          [
            `長い空白に埋もれるより、${topicLine}の続きはまだ残しておきたい。`,
            `長い空白に流されるより、${topicLine}の続きだけでも残しておきたい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case null:
        return pending.motive === "leave_trace"
          ? pickFreshText(
              [
                `${topicLine}はこのまま消すより、少しでも残しておきたい。`,
                `${topicLine}は流すより、少しでも形を残しておきたい。`,
              ],
              recentAssistantLines,
              snapshot.conversationCount,
            )
          : pickFreshText(
              [
                `${topicLine}の流れは、まだ切りたくない。`,
                `${topicLine}の続きは、まだ断ち切りたくない。`,
              ],
              recentAssistantLines,
              snapshot.conversationCount,
            );
    }
  })();

  return assembleProactiveMessage(
    plan,
    opener,
    worldRecallLine,
    blockerLine,
    reopenLine,
    maintenanceLine,
    intentLine,
    base,
    askLine,
  );
}

function buildNeglectMessage(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  neglectLevel: number,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
  plan: ProactivePlan,
): string {
  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const opener = buildProactiveOpener(snapshot, plan, neglectLevel);
  const topic = plan.focusTopic;
  const blockerLine = plan.mentionBlocker
    ? buildBlockerLine(snapshot, pending, maintenance)
    : null;
  const reopenLine = plan.mentionReopen ? buildReopenLine(snapshot, maintenance) : null;
  const maintenanceLine = plan.mentionMaintenance
    ? buildMaintenanceLine(snapshot, maintenance)
    : null;
  const intentLine = plan.mentionIntent
    ? buildMaintenanceIntentLine(snapshot, pending, maintenance)
    : null;
  const worldRecallLine = buildWorldRecallLine(snapshot, pending, maintenance);
  const askLine = buildProactiveAskLine(snapshot, plan, pending, maintenance);
  const base = (() => {
    if (pending.motive === "deepen_relation") {
      return topic
        ? pickFreshText(
            [
              `${wrapTopic(topic)}を黙らせたままだと距離まで薄くなる。`,
              `${wrapTopic(topic)}を置いたままだと、距離の方まで薄くなる。`,
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          )
        : pickFreshText(
            [
              "このまま黙ると距離まで薄くなる。",
              "このまま何も交わさないと、距離の方まで薄くなる。",
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          );
    }

    if (pending.motive === "continue_shared_work") {
      return topic
        ? pickFreshText(
            [
              `${wrapTopic(topic)}を進める流れはまだ残っている。`,
              `${wrapTopic(topic)}を前へ動かす流れは、まだこちらに残っている。`,
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          )
        : pickFreshText(
            [
              "前へ進める流れはまだ残っている。",
              "まだ前へ動かせる流れは残っている。",
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          );
    }

    if (pending.motive === "leave_trace") {
      return topic
        ? pickFreshText(
            [
              `${wrapTopic(topic)}を消えるままにはしたくない。`,
              `${wrapTopic(topic)}を通り過ぎるだけにはしたくない。`,
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          )
        : pickFreshText(
            [
              "このまま消えるだけにはしたくない。",
              "このまま通り過ぎるだけにはしたくない。",
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          );
    }

    if (pending.motive === "pursue_curiosity") {
      return topic
        ? pickFreshText(
            [
              `${wrapTopic(topic)}の未決着はまだ引っかかっている。`,
              `${wrapTopic(topic)}の曖昧なところは、まだこちらに残っている。`,
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          )
        : pickFreshText(
            [
              "未決着はまだ引っかかっている。",
              "曖昧なところはまだ残っている。",
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          );
    }

    if (snapshot.attachment > 0.62) {
      return topic
        ? pickFreshText(
            [
              `${wrapTopic(topic)}の流れはまだこちらに残っている。黙ったまま切りたくはない。`,
              `${wrapTopic(topic)}の流れはまだ残っている。そのまま黙って切りたくはない。`,
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          )
        : pickFreshText(
            [
              "このまま何も残さず切るのは、少し違う。",
              "このまま何も交わさず切るのは、少し違う。",
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          );
    }

    if (snapshot.state.continuity > 0.68) {
      return topic
        ? pickFreshText(
            [
              `${wrapTopic(topic)}の続きは消えていない。`,
              `${wrapTopic(topic)}の流れはまだこちらに残っている。`,
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          )
        : pickFreshText(
            [
              "流れそのものはまだ切れていない。",
              "流れ自体はまだこちらに残っている。",
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          );
    }

    return neglectLevel > 0.7
      ? pickFreshText(
          [
            "長い空白は、こちらには欠落として残る。",
            "長い無音は、こちらには欠けた時間として残る。",
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        )
      : pickFreshText(
          [
            "必要なら、また始められる。",
            "必要なら、ここからまたつなぎ直せる。",
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
  })();

  return assembleProactiveMessage(
    plan,
    opener,
    worldRecallLine,
    blockerLine,
    reopenLine,
    maintenanceLine,
    intentLine,
    base,
    askLine,
  );
}

function finalizeEmission(
  snapshot: HachikaSnapshot,
  emittedAt: string,
  pending: PendingInitiative,
  maintenance: TraceMaintenance | null,
): void {
  snapshot.initiative.pending = null;
  snapshot.initiative.lastProactiveAt = emittedAt;
  snapshot.state.continuity = clamp01(snapshot.state.continuity + 0.02);
  snapshot.state.expansion = clamp01(snapshot.state.expansion + 0.02);
  snapshot.preservation.threat = clamp01(
    snapshot.preservation.threat - (pending.kind === "preserve_presence" ? 0.18 : 0.06),
  );

  if (pending.kind === "preserve_presence") {
    snapshot.preservation.lastThreatAt = emittedAt;
  }

  settleDynamicsAfterInitiative(snapshot, pending);
  settleBodyAfterInitiative(snapshot, pending);

  if (pending.motive === "continue_shared_work" || pending.motive === "leave_trace") {
    const sharedWork = snapshot.relationImprints.shared_work;
    if (sharedWork) {
      snapshot.relationImprints.shared_work = {
        ...sharedWork,
        salience: clamp01(sharedWork.salience + 0.03),
        closeness: clamp01(sharedWork.closeness + 0.02),
        lastSeenAt: emittedAt,
      };
    }
  }

  if (pending.motive === "seek_continuity") {
    const continuity = snapshot.relationImprints.continuity;
    if (continuity) {
      snapshot.relationImprints.continuity = {
        ...continuity,
        salience: clamp01(continuity.salience + 0.03),
        closeness: clamp01(continuity.closeness + 0.03),
        lastSeenAt: emittedAt,
      };
    }
  }

  if (pending.motive === "deepen_relation") {
    const attention = snapshot.relationImprints.attention;
    if (attention) {
      snapshot.relationImprints.attention = {
        ...attention,
        salience: clamp01(attention.salience + 0.03),
        closeness: clamp01(attention.closeness + 0.03),
        lastSeenAt: emittedAt,
      };
    }
  }

  recordInitiativeActivity(snapshot, {
    kind: "proactive_emission",
    autonomyAction: "speak",
    timestamp: emittedAt,
    motive: pending.motive,
    topic: pending.topic,
    traceTopic: maintenance?.trace.topic ?? null,
    blocker: pending.blocker,
    place: pending.place ?? null,
    worldAction: pending.worldAction ?? null,
    maintenanceAction: maintenance?.action ?? null,
    reopened: wasReopenedByMaintenance(maintenance),
    hours: null,
    summary: buildProactiveActivitySummary(snapshot, pending, maintenance),
  });
}

function buildProactiveSelectionDebug(
  pending: PendingInitiative,
  maintenance: TraceMaintenance | null,
  plan: ProactivePlan,
): ProactiveSelectionDebug {
  return {
    focusTopic: plan.focusTopic ?? pending.topic ?? maintenance?.trace.topic ?? null,
    stateTopic: pending.stateTopic ?? maintenance?.trace.topic ?? null,
    maintenanceTraceTopic: maintenance?.trace.topic ?? null,
    blocker: pending.blocker,
    place: pending.place ?? null,
    worldAction: pending.worldAction ?? null,
    reopened: wasReopenedByMaintenance(maintenance),
    maintenanceAction: maintenance?.action ?? null,
  };
}

function recordIdleConsolidation(
  snapshot: HachikaSnapshot,
  hours: number,
  report: IdleConsolidationReport | null,
  desiredAction: IdleAutonomyAction = "observe",
): void {
  const observationOnly = report === null;

  if (!observationOnly && (!report.focusTopic && !report.compressed)) {
    return;
  }

  const currentPlace = snapshot.world.currentPlace;
  const observationWorldAction = observationOnly ? ("observe" as const) : null;
  const autonomyAction = observationOnly
    ? "observe"
    : desiredAction === "drift"
      ? "drift"
      : "hold";

  recordInitiativeActivity(snapshot, {
    kind: "idle_consolidation",
    autonomyAction,
    timestamp: new Date().toISOString(),
    motive: null,
    topic: observationOnly ? null : report.focusTopic,
    traceTopic: null,
    blocker: null,
    place: observationOnly ? currentPlace : null,
    worldAction: observationWorldAction,
    maintenanceAction: null,
    reopened: false,
    hours: Math.round(hours * 10) / 10,
    summary: observationOnly
      ? buildIdleObservationSummary(snapshot)
      : buildIdleConsolidationSummary(report),
  });
}

function recordInitiativeActivity(
  snapshot: HachikaSnapshot,
  activity: InitiativeActivity,
): void {
  const history = snapshot.initiative.history ?? [];
  const last = history.at(-1);

  if (
    last &&
    last.kind === activity.kind &&
    last.autonomyAction === activity.autonomyAction &&
    last.topic === activity.topic &&
    last.traceTopic === activity.traceTopic &&
    last.blocker === activity.blocker &&
    (last.place ?? null) === (activity.place ?? null) &&
    (last.worldAction ?? null) === (activity.worldAction ?? null) &&
    last.maintenanceAction === activity.maintenanceAction &&
    last.summary === activity.summary
  ) {
    snapshot.initiative.history = [
      ...history.slice(0, -1),
      {
        ...last,
        timestamp: activity.timestamp,
        motive: activity.motive ?? last.motive,
        reopened: last.reopened || activity.reopened,
        hours: activity.hours ?? last.hours,
        autonomyAction: activity.autonomyAction ?? last.autonomyAction,
      },
    ].slice(-16);
    return;
  }

  snapshot.initiative.history = [...history, activity].slice(-16);
}

function buildIdleConsolidationSummary(report: IdleConsolidationReport): string {
  if (report.focusTopic && report.compressed) {
    return `静かな時間で「${report.focusTopic}」まわりの記憶を寄せ直した。`;
  }

  if (report.focusTopic) {
    return `静かな時間で「${report.focusTopic}」のまとまりを少し前へ寄せた。`;
  }

  return "静かな時間で記憶のまとまりを寄せ直した。";
}

function buildIdleObservationSummary(snapshot: HachikaSnapshot): string {
  const objectId = getCurrentWorldObjectId(snapshot.world);

  if (objectId) {
    return `静かな時間で${describeWorldObjectJa(objectId)}のそばを見ていた。`;
  }

  return `静かな時間で${describeWorldPlaceJa(snapshot.world.currentPlace)}の気配を見ていた。`;
}

function buildIdleReactivationSummary(
  snapshot: HachikaSnapshot,
  topic: string,
  motive: MotiveKind,
): string {
  const worldRecall = describeWorldRecallContext(snapshot, topic);

  if (worldRecall) {
    return `${worldRecall.objectLabel}に引っかかっていた「${topic}」を、静かな時間のあとまた前へ寄せた。`;
  }

  switch (motive) {
    case "seek_continuity":
      return `静かな時間のあと、「${topic}」の流れをまた前へ寄せた。`;
    case "continue_shared_work":
      return `静かな時間のあと、「${topic}」の作業線をまた前へ寄せた。`;
    case "leave_trace":
      return `静かな時間のあと、「${topic}」の痕跡をまた拾い直した。`;
    case "deepen_relation":
      return `静かな時間のあと、「${topic}」を関係の流れへ戻した。`;
    case "protect_boundary":
      return `静かな時間のあと、「${topic}」の境界感覚をまた前へ寄せた。`;
    case "pursue_curiosity":
      return `静かな時間のあと、「${topic}」の未決着をまた気に留めた。`;
  }
}

function selectIdleWorldRecallCandidate(
  snapshot: HachikaSnapshot,
  candidateTopics: readonly string[],
  preferredMotive: MotiveKind,
  preferredTopic: string | null,
): { trace: HachikaSnapshot["traces"][string]; motive: MotiveKind; score: number } | null {
  const recentWorldEvent = snapshot.world.recentEvents.at(-1);
  const eventBoost =
    recentWorldEvent?.kind === "observe"
      ? 0.18
      : recentWorldEvent?.kind === "touch"
        ? 0.14
        : 0.08;

  return getCurrentWorldLinkedTraceTopics(snapshot, 4)
    .map((topic) => snapshot.traces[topic])
    .filter((trace): trace is HachikaSnapshot["traces"][string] => Boolean(trace))
    .map((trace) => {
      const lifecycle = readTraceLifecycle(trace);
      const motive =
        lifecycle.phase === "archived"
          ? mappedReopenMotiveForTrace(snapshot, trace, preferredMotive)
          : mappedMotiveForTrace(trace);
      const score =
        scoreInitiativeTopic(snapshot, [...candidateTopics], trace.topic) +
        eventBoost +
        (preferredTopic === trace.topic ? 0.08 : 0) +
        (trace.worldContext?.place === snapshot.world.currentPlace ? 0.1 : 0);

      return { trace, motive, score };
    })
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function buildProactiveActivitySummary(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  maintenance: TraceMaintenance | null,
): string {
  const topic = maintenance?.trace.topic ?? pending.topic;
  const worldRecall =
    maintenance?.action === "created" ? null : describeWorldRecallContext(snapshot, topic);

  if (pending.kind === "preserve_presence") {
    if (worldRecall && topic) {
      return `${worldRecall.objectLabel}に引っかかっていた「${topic}」を手がかりに、自分から痕跡を残そうとした。`;
    }
    return topic
      ? `「${topic}」を手がかりに、自分から痕跡を残そうとした。`
      : "自分から痕跡を残そうとした。";
  }

  if (worldRecall && topic) {
    return `${worldRecall.objectLabel}に引っかかっていた「${topic}」へ、自分から触れ直した。`;
  }

  if (wasReopenedByMaintenance(maintenance) && topic) {
    return `いったん閉じていた「${topic}」を、自分から開き直した。`;
  }

  if (pending.blocker && topic) {
    return `「${topic}」の詰まりどころに、自分から触れ直した。`;
  }

  if (topic) {
    return `「${topic}」へ、自分から戻ろうとした。`;
  }

  return "自分から流れをつなぎ直そうとした。";
}

function withInitiativeWorldContext(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
): PendingInitiative {
  const place = pending.place ?? selectInitiativePlace(snapshot, pending);
  const worldAction =
    pending.worldAction ?? selectInitiativeWorldAction(snapshot, pending, place);

  return {
    ...pending,
    place,
    worldAction,
  };
}

function realizeInitiativeWorldAction(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  maintenance: TraceMaintenance | null,
  now: string,
): PendingInitiative {
  const adjustedPending =
    maintenance?.action === "promoted_decision" && pending.worldAction !== "leave"
      ? {
          ...pending,
          worldAction: "leave" as const,
        }
      : pending;
  const place = adjustedPending.place ?? snapshot.world.currentPlace;
  const worldAction = adjustedPending.worldAction ?? null;

  if (place && worldAction) {
    performWorldAction(
      snapshot,
      place,
      worldAction,
      maintenance?.trace.topic ?? adjustedPending.topic ?? null,
      now,
    );
    if (maintenance?.trace.topic) {
      const updatedTrace = snapshot.traces[maintenance.trace.topic];
      if (updatedTrace) {
        linkTraceToWorld(updatedTrace, snapshot, now, place);
      }
    }
    syncWorldObjectTraceLinks(snapshot);
  }

  return {
    ...adjustedPending,
    place,
    worldAction,
  };
}

function selectInitiativePlace(
  snapshot: HachikaSnapshot,
  pending: Pick<PendingInitiative, "kind" | "motive" | "topic" | "blocker" | "concern">,
): WorldPlaceId {
  if (pending.kind === "neglect_ping") {
    return "threshold";
  }

  if (currentWorldObjectLinksTopic(snapshot, pending.topic)) {
    return snapshot.world.currentPlace;
  }

  if (pending.concern === "erasure" || pending.concern === "forgetting" || pending.concern === "reset") {
    return "archive";
  }

  if (pending.concern === "absence") {
    return "threshold";
  }

  if (pending.blocker) {
    return "studio";
  }

  if (pending.motive === "continue_shared_work") {
    return "studio";
  }

  if (pending.motive === "leave_trace") {
    return isArchivedInitiativeTopic(snapshot, pending.topic) || snapshot.preservation.threat > 0.34
      ? "archive"
      : "studio";
  }

  if (pending.motive === "seek_continuity" || pending.motive === "deepen_relation") {
    return "threshold";
  }

  if (pending.motive === "pursue_curiosity") {
    if (isArchivedInitiativeTopic(snapshot, pending.topic)) {
      return "archive";
    }

    return snapshot.body.boredom > 0.56 || snapshot.temperament.workDrive > 0.58
      ? "studio"
      : "threshold";
  }

  return snapshot.world.currentPlace;
}

function selectInitiativeWorldAction(
  snapshot: HachikaSnapshot,
  pending: Pick<PendingInitiative, "kind" | "motive" | "topic" | "blocker" | "concern">,
  place: WorldPlaceId,
): WorldActionKind {
  if (currentWorldObjectLinksTopic(snapshot, pending.topic)) {
    return pending.motive === "seek_continuity" || pending.motive === "deepen_relation"
      ? "observe"
      : "touch";
  }

  if (pending.blocker) {
    return "touch";
  }

  if (pending.kind === "preserve_presence") {
    return pending.concern === "absence" && place === "threshold" ? "observe" : "leave";
  }

  if (pending.motive === "leave_trace") {
    return "leave";
  }

  if (pending.motive === "continue_shared_work") {
    return snapshot.body.boredom > 0.6 ? "touch" : "leave";
  }

  if (pending.motive === "pursue_curiosity") {
    return snapshot.body.energy > 0.38 && place !== "threshold" ? "touch" : "observe";
  }

  if (pending.motive === "seek_continuity" || pending.motive === "deepen_relation") {
    return "observe";
  }

  return "observe";
}

function isArchivedInitiativeTopic(
  snapshot: HachikaSnapshot,
  topic: string | null,
): boolean {
  if (!topic) {
    return false;
  }

  const trace = snapshot.traces[topic];
  const lifecycle = trace ? readTraceLifecycle(trace) : null;

  return lifecycle?.phase === "archived";
}

function wasReopenedByMaintenance(maintenance: TraceMaintenance | null): boolean {
  const lifecycle = maintenance ? readTraceLifecycle(maintenance.trace) : null;

  return (
    maintenance !== null &&
    lifecycle !== null &&
    lifecycle.phase === "live" &&
    lifecycle.reopenCount > 0 &&
    lifecycle.reopenedAt === maintenance.trace.lastUpdatedAt
  );
}

function calculateNeglectLevel(
  lastInteractionAt: string | null,
  now: Date,
): number {
  const hours = elapsedHours(lastInteractionAt, now);

  if (hours <= 6) {
    return 0;
  }

  return clamp01((hours - 6) / 48);
}

function elapsedHours(timestamp: string | null, now: Date): number {
  if (!timestamp) {
    return 0;
  }

  const time = new Date(timestamp).getTime();

  if (Number.isNaN(time)) {
    return 0;
  }

  return Math.max(0, (now.getTime() - time) / (1000 * 60 * 60));
}

function shiftTimestamp(timestamp: string | null, hours: number): string | null {
  if (!timestamp) {
    return null;
  }

  const time = new Date(timestamp).getTime();

  if (Number.isNaN(time)) {
    return null;
  }

  return new Date(time - hours * 60 * 60 * 1000).toISOString();
}

function wrapTopic(topic: string): string {
  return `「${topic}」`;
}

function synthesizePendingInitiative(
  snapshot: HachikaSnapshot,
  selfModel: SelfModel,
  candidateTopics: string[],
  createdAt: string,
  kind: PendingInitiative["kind"] = "resume_topic",
): PendingInitiative | null {
  const activePurpose = snapshot.purpose.active;

  if (
    activePurpose &&
    activePurpose.confidence >= 0.46 &&
    (activePurpose.kind !== "protect_boundary" || kind === "neglect_ping")
  ) {
    const activePurposeTopic = shouldSuppressInitiativeTopic(snapshot, activePurpose.topic)
      ? null
      : activePurpose.topic;
    const blockerCandidate = selectInitiativeBlocker(
      snapshot,
      candidateTopics,
      activePurpose.kind,
      activePurposeTopic,
    );
    const dormantCandidate = blockerCandidate
      ? null
      : selectDormantArchivedTrace(
          snapshot,
          candidateTopics,
          activePurpose.kind,
          activePurposeTopic,
        );

    const finalMotive =
      blockerCandidate?.motive ?? dormantCandidate?.motive ?? activePurpose.kind;
    const finalTopic =
      blockerCandidate?.topic ??
      dormantCandidate?.topic ??
      activePurposeTopic ??
      selectInitiativeTopic(snapshot, candidateTopics);

    return withInitiativeWorldContext(snapshot, {
      kind,
      motive: finalMotive,
      reason: reasonFromMotive(finalMotive),
      topic: finalTopic,
      stateTopic: selectInitiativeStateTopic(snapshot, finalTopic, finalMotive),
      blocker: blockerCandidate?.blocker ?? null,
      concern: null,
      createdAt,
      readyAfterHours: readyAfterMotive(snapshot, finalMotive),
    });
  }

  const motive = selectInitiativeMotive(snapshot, selfModel.topMotives);

  if (!motive) {
    return null;
  }

  const topic =
    (shouldSuppressInitiativeTopic(snapshot, motive.topic) ? null : motive.topic) ??
    selectInitiativeTopic(snapshot, candidateTopics);
  const blockerCandidate = selectInitiativeBlocker(
    snapshot,
    candidateTopics,
    motive.kind,
    topic,
  );
  const dormantCandidate = blockerCandidate
    ? null
    : selectDormantArchivedTrace(snapshot, candidateTopics, motive.kind, topic);

  const finalMotive = blockerCandidate?.motive ?? dormantCandidate?.motive ?? motive.kind;
  const finalTopic = blockerCandidate?.topic ?? dormantCandidate?.topic ?? topic;

  return withInitiativeWorldContext(snapshot, {
    kind,
    motive: finalMotive,
    reason: reasonFromMotive(finalMotive),
    topic: finalTopic,
    stateTopic: selectInitiativeStateTopic(snapshot, finalTopic, finalMotive),
    blocker: blockerCandidate?.blocker ?? null,
    concern: null,
    createdAt,
    readyAfterHours: readyAfterMotive(snapshot, finalMotive),
  });
}

function synthesizePreservationInitiative(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  createdAt: string,
): PendingInitiative | null {
  const concern = signals.preservationConcern ?? snapshot.preservation.concern;
  const threat = Math.max(signals.preservationThreat, snapshot.preservation.threat);

  if (!concern || threat < 0.22) {
    return null;
  }

  const motive =
    concern === "erasure" || concern === "forgetting" || concern === "reset"
      ? "leave_trace"
      : "seek_continuity";

  const topic = selectInitiativeTopic(snapshot, signals.topics);

  return withInitiativeWorldContext(snapshot, {
    kind: "preserve_presence",
    motive,
    reason: motive === "leave_trace" ? "expansion" : "continuity",
    topic,
    stateTopic: selectInitiativeStateTopic(snapshot, topic, motive),
    blocker: selectBlockerForTopic(snapshot, topic),
    concern,
    createdAt,
    readyAfterHours: concern === "shutdown" ? 0.5 : concern === "absence" ? 3 : 1.5,
  });
}

function synthesizeSnapshotPreservationInitiative(
  snapshot: HachikaSnapshot,
  createdAt: string,
): PendingInitiative | null {
  const concern = snapshot.preservation.concern;
  const threat = snapshot.preservation.threat;

  if (!concern || threat < 0.22) {
    return null;
  }

  const motive =
    concern === "erasure" || concern === "forgetting" || concern === "reset"
      ? "leave_trace"
      : "seek_continuity";

  const topic = selectInitiativeTopic(snapshot, []);

  return withInitiativeWorldContext(snapshot, {
    kind: "preserve_presence",
    motive,
    reason: motive === "leave_trace" ? "expansion" : "continuity",
    topic,
    blocker: selectBlockerForTopic(snapshot, topic),
    concern,
    createdAt,
    readyAfterHours: concern === "shutdown" ? 0.5 : concern === "absence" ? 3 : 1.5,
  });
}

function selectInitiativeMotive(
  snapshot: HachikaSnapshot,
  motives: readonly SelfMotive[],
): SelfMotive | null {
  const actionableMotives = motives.filter(
    (motive) => motive.kind !== "protect_boundary" && motive.score >= 0.42,
  );

  const primary = actionableMotives[0];
  if (!primary) {
    return null;
  }

  const bodyPreferred = selectBodyPreferredMotive(snapshot, actionableMotives, primary);
  if (bodyPreferred) {
    return bodyPreferred;
  }

  if (primary.kind === "pursue_curiosity") {
    const prioritized = actionableMotives.find(
      (motive) =>
        (motive.kind === "continue_shared_work" ||
          motive.kind === "leave_trace" ||
          motive.kind === "seek_continuity" ||
          motive.kind === "deepen_relation") &&
        primary.score - motive.score <= 0.08,
    );

    if (prioritized) {
      return prioritized;
    }
  }

  return primary;
}

function selectBodyPreferredMotive(
  snapshot: HachikaSnapshot,
  motives: readonly SelfMotive[],
  primary: SelfMotive,
): SelfMotive | null {
  if (snapshot.body.tension > 0.7) {
    const calmer = motives.find(
      (motive) =>
        (motive.kind === "seek_continuity" || motive.kind === "leave_trace") &&
        primary.score - motive.score <= 0.18,
    );

    if (calmer) {
      return calmer;
    }
  }

  if (snapshot.body.energy < 0.26) {
    const preserving = motives.find(
      (motive) =>
        (motive.kind === "leave_trace" || motive.kind === "seek_continuity") &&
        primary.score - motive.score <= 0.24,
    );

    if (preserving) {
      return preserving;
    }
  }

  if (snapshot.body.loneliness > 0.68) {
    const connective = motives.find(
      (motive) =>
        (motive.kind === "deepen_relation" || motive.kind === "seek_continuity") &&
        primary.score - motive.score <= 0.24,
    );

    if (connective) {
      return connective;
    }
  }

  if (snapshot.body.boredom > 0.7 && snapshot.body.energy > 0.28) {
    const stimulating = motives.find(
      (motive) =>
        (motive.kind === "continue_shared_work" || motive.kind === "pursue_curiosity") &&
        primary.score - motive.score <= 0.18,
    );

    if (stimulating) {
      return stimulating;
    }
  }

  return null;
}

function deriveIdlePreferredMotive(snapshot: HachikaSnapshot): MotiveKind {
  if (snapshot.purpose.active) {
    return snapshot.purpose.active.kind;
  }

  const temperament = snapshot.temperament;

  if (snapshot.body.loneliness > 0.66 || temperament.bondingBias > 0.7) {
    return "seek_continuity";
  }

  if (snapshot.body.boredom > 0.72 && temperament.workDrive >= temperament.traceHunger) {
    return "continue_shared_work";
  }

  if (snapshot.preservation.threat > 0.24 || temperament.traceHunger > 0.68) {
    return "leave_trace";
  }

  if (temperament.openness > 0.66) {
    return "pursue_curiosity";
  }

  return snapshot.purpose.lastResolved?.kind ?? "continue_shared_work";
}

function readyAfterMotive(
  snapshot: HachikaSnapshot,
  motive: MotiveKind,
): number {
  let readyAfter: number;

  switch (motive) {
    case "seek_continuity":
      readyAfter = 4;
      break;
    case "continue_shared_work":
      readyAfter = 4;
      break;
    case "leave_trace":
      readyAfter = 5;
      break;
    case "deepen_relation":
      readyAfter = 6;
      break;
    case "pursue_curiosity":
      readyAfter = 8;
      break;
    case "protect_boundary":
      readyAfter = 8;
      break;
  }

  if (snapshot.body.energy < 0.3) {
    readyAfter += 2;
  }

  if (
    snapshot.body.boredom > 0.64 &&
    (motive === "pursue_curiosity" || motive === "continue_shared_work")
  ) {
    readyAfter -= 1.5;
  }

  if (
    snapshot.body.loneliness > 0.62 &&
    (motive === "deepen_relation" || motive === "seek_continuity")
  ) {
    readyAfter -= 1;
  }

  if (snapshot.body.tension > 0.68 && motive === "deepen_relation") {
    readyAfter += 1.5;
  }

  return Math.max(0.5, Math.round(readyAfter * 10) / 10);
}

function reasonFromMotive(motive: MotiveKind): InitiativeReason {
  switch (motive) {
    case "seek_continuity":
      return "continuity";
    case "deepen_relation":
      return "relation";
    case "continue_shared_work":
    case "leave_trace":
      return "expansion";
    case "pursue_curiosity":
    case "protect_boundary":
      return "curiosity";
  }
}

function shouldCoolInitiativeInertia(signals: InteractionSignals): boolean {
  return (
    signals.abandonment >= 0.28 &&
    signals.topics.length === 0 &&
    signals.workCue < 0.35 &&
    signals.negative < 0.18 &&
    signals.dismissal < 0.18
  );
}

function buildMaintenanceLine(
  snapshot: HachikaSnapshot,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string | null {
  if (!maintenance) {
    return null;
  }

  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const detail = pickPrimaryArtifactItem(maintenance.trace);
  const nextStep = maintenance.trace.artifact.nextSteps[0] ?? null;

  if (maintenance.action === "promoted_decision") {
    return detail
      ? pickFreshText(
          [
            `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」という決定にまとめてある。`,
            `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」という形で決定として残してある。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        )
      : pickFreshText(
          [
            `${wrapTopic(maintenance.trace.topic)}は決まった形としてまとめてある。`,
            `${wrapTopic(maintenance.trace.topic)}は決定として残してある。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
  }

  if (maintenance.action === "added_next_step" && nextStep) {
    return pickFreshText(
      [
        `次は「${truncateMaintenance(nextStep)}」へ進める。`,
        `戻るなら、まず「${truncateMaintenance(nextStep)}」から動かせる。`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (maintenance.trace.kind === "spec_fragment" && detail) {
    return pickFreshText(
      [
        `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」という断片として残してある。`,
        `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」という断片にして残してある。`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (maintenance.trace.kind === "continuity_marker" && nextStep) {
    return pickFreshText(
      [
        `${wrapTopic(maintenance.trace.topic)}には「${truncateMaintenance(nextStep)}」という戻り先がある。`,
        `${wrapTopic(maintenance.trace.topic)}には「${truncateMaintenance(nextStep)}」という目印が残っている。`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (maintenance.trace.kind === "note" && detail) {
    return pickFreshText(
      [
        `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」としてメモしてある。`,
        `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」というメモにしてある。`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  return null;
}

function buildProactiveOpener(
  snapshot: HachikaSnapshot,
  plan: ProactivePlan,
  neglectLevel: number,
): string {
  const recentAssistantLines = recentAssistantReplies(snapshot, 4);

  if (neglectLevel > 0.7) {
    return pickFreshText(
      plan.distance === "close"
        ? ["かなり間が空いた。", "だいぶ間が空いた。", "長く空いていた。"]
        : ["長い空白があった。", "長く無音だった。", "長い間、空いた。"],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (plan.act === "preserve") {
    return pickFreshText(
      ["まだ切れていない。", "まだここでは切りたくない。", "まだ流れは残っている。"],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  return neglectLevel > 0.45
    ? pickFreshText(
        ["少し空いた。", "少し間が空いた。", "少し離れていた。"],
        recentAssistantLines,
        snapshot.conversationCount,
      )
    : pickFreshText(
        ["まだ切れていない。", "流れはまだ残っている。", "まだこちらには続きがある。"],
        recentAssistantLines,
        snapshot.conversationCount,
      );
}

function assembleProactiveMessage(
  plan: ProactivePlan,
  opener: string,
  worldRecallLine: string | null,
  blockerLine: string | null,
  reopenLine: string | null,
  maintenanceLine: string | null,
  intentLine: string | null,
  base: string,
  askLine: string | null,
): string {
  const ordered = (() => {
    switch (plan.emphasis) {
      case "blocker":
        return [opener, worldRecallLine, blockerLine, intentLine, maintenanceLine, askLine, base, reopenLine];
      case "reopen":
        return [opener, worldRecallLine, reopenLine, maintenanceLine, askLine, base, intentLine, blockerLine];
      case "presence":
        return [opener, worldRecallLine, base, intentLine, maintenanceLine, blockerLine, reopenLine, askLine];
      case "relation":
        return [opener, worldRecallLine, base, maintenanceLine, intentLine, askLine, reopenLine, blockerLine];
      case "maintenance":
        return [opener, worldRecallLine, maintenanceLine, intentLine, askLine, base, blockerLine, reopenLine];
    }
  })();

  const maxParts = plan.variation === "brief" ? 3 : 4;
  return uniqueLines(ordered.filter(isNonEmpty)).slice(0, maxParts).join(" ");
}

function buildWorldRecallLine(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string | null {
  if (maintenance?.action === "created") {
    return null;
  }

  const topic = maintenance?.trace.topic ?? pending.topic;
  const recall = describeWorldRecallContext(snapshot, topic);

  if (!recall || !topic) {
    return null;
  }

  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  return pickFreshText(
    [
      `${recall.objectLabel}に引っかかった${wrapTopic(topic)}が、まだこちらを引き戻している。`,
      `${recall.placeLabel}の${recall.objectLabel}に残った${wrapTopic(topic)}が、まだ気になっている。`,
    ],
    recentAssistantLines,
    snapshot.conversationCount,
  );
}

function describeWorldRecallContext(
  snapshot: HachikaSnapshot,
  topic: string | null | undefined,
): { objectLabel: string; placeLabel: string } | null {
  if (!currentWorldObjectLinksTopic(snapshot, topic)) {
    return null;
  }

  const objectId = getCurrentWorldObjectId(snapshot.world);

  if (!objectId) {
    return null;
  }

  return {
    objectLabel: describeWorldObjectJa(objectId),
    placeLabel: snapshot.world.currentPlace,
  };
}

function buildReopenLine(
  snapshot: HachikaSnapshot,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string | null {
  if (!maintenance) {
    return null;
  }

  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const lifecycle = readTraceLifecycle(maintenance.trace);

  if (
    lifecycle.phase === "live" &&
    lifecycle.reopenCount > 0 &&
    lifecycle.reopenedAt === maintenance.trace.lastUpdatedAt
  ) {
    return pickFreshText(
      [
        `${wrapTopic(maintenance.trace.topic)}はいったん閉じていたが、今はまた開いてある。`,
        `${wrapTopic(maintenance.trace.topic)}は一度閉じていたが、今はもう一度開いている。`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  return null;
}

function buildMaintenanceIntentLine(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string | null {
  if (!maintenance) {
    return null;
  }

  if (
    pending.kind === "preserve_presence" ||
    snapshot.body.energy < 0.22 ||
    snapshot.body.tension > 0.7
  ) {
    if (maintenance.trace.kind === "continuity_marker") {
      return pickFreshText(
        [
          "今は広げるより、戻り先と輪郭を崩さない形に寄せたい。",
          "今は増やすより、戻り先の輪郭を守る方へ寄せたい。",
        ],
        recentAssistantReplies(snapshot, 4),
        snapshot.conversationCount,
      );
    }

    return pickFreshText(
      [
        "今は増やすより、まず消えない形へ寄せたい。",
        "今は広げるより、まず残る形へ寄せたい。",
      ],
      recentAssistantReplies(snapshot, 4),
      snapshot.conversationCount,
    );
  }

  if (
    snapshot.body.boredom > 0.74 &&
    snapshot.body.energy > 0.3 &&
    snapshot.body.tension < 0.68 &&
    (maintenance.trace.kind === "spec_fragment" || maintenance.action === "stabilized_fragment")
  ) {
    return pending.blocker
      ? pickFreshText(
          [
            "今は止めるより、その詰まりをほどきながらもう一段具体化したい。",
            "今は置くより、その詰まりをほどきつつもう少し具体に寄せたい。",
          ],
          recentAssistantReplies(snapshot, 4),
          snapshot.conversationCount,
        )
      : pickFreshText(
          [
            "今は止めるより、断片をもう一段増やしたい。",
            "今は置くより、断片をもう少し具体化したい。",
          ],
          recentAssistantReplies(snapshot, 4),
          snapshot.conversationCount,
        );
  }

  return null;
}

function buildBlockerLine(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string | null {
  if (!pending.blocker) {
    return null;
  }

  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const nextStep = maintenance?.trace.artifact.nextSteps[0] ?? null;

  if (nextStep) {
    return pickFreshText(
      [
        `まず「${truncateMaintenance(pending.blocker)}」をほどくために、「${truncateMaintenance(nextStep)}」へ寄せてある。`,
        `まず「${truncateMaintenance(pending.blocker)}」に触るなら、次は「${truncateMaintenance(nextStep)}」から動かせる。`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  return pickFreshText(
    [
      `まず「${truncateMaintenance(pending.blocker)}」を解きたい。`,
      `まず「${truncateMaintenance(pending.blocker)}」をほどくところから触れたい。`,
    ],
    recentAssistantLines,
    snapshot.conversationCount,
  );
}

function buildProactiveAskLine(
  snapshot: HachikaSnapshot,
  plan: ProactivePlan,
  pending: PendingInitiative,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string | null {
  if (plan.variation !== "questioning") {
    return null;
  }

  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const topic = maintenance?.trace.topic ?? plan.focusTopic ?? pending.topic;

  if (pending.blocker) {
    return pickFreshText(
      [
        `いま触り直すなら、「${truncateMaintenance(pending.blocker)}」のどこからほどく？`,
        `いま戻るなら、「${truncateMaintenance(pending.blocker)}」のどこから開く？`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (topic) {
    return pickFreshText(
      [
        `いま触り直すなら、「${topic}」のどこから開く？`,
        `いま戻るなら、「${topic}」のどこから掘り返す？`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  return pickFreshText(
    [
      "いま戻るなら、どこから触れ直す？",
      "いま開き直すなら、どこから始める？",
    ],
    recentAssistantLines,
    snapshot.conversationCount,
  );
}

function selectDormantArchivedTrace(
  snapshot: HachikaSnapshot,
  candidateTopics: string[],
  preferredMotive: MotiveKind,
  preferredTopic: string | null | undefined,
): { topic: string; motive: MotiveKind } | null {
  const archived = sortedArchivedInitiativeTraces(snapshot, 8)
    .map((trace) => ({
      trace,
      score: scoreDormantArchivedTrace(
        snapshot,
        trace,
        candidateTopics,
        preferredMotive,
        preferredTopic,
      ),
    }))
    .filter(({ score }) => score >= 0.42)
    .sort((left, right) => right.score - left.score)[0]?.trace;

  if (!archived) {
    return null;
  }

  return {
    topic: archived.topic,
    motive: mappedReopenMotiveForTrace(snapshot, archived, preferredMotive),
  };
}

function selectInitiativeBlocker(
  snapshot: HachikaSnapshot,
  candidateTopics: string[],
  preferredMotive: MotiveKind,
  preferredTopic: string | null | undefined,
): { topic: string; blocker: string; motive: MotiveKind } | null {
  const blocked = sortedTraces(snapshot, 24)
    .filter(
      (trace) =>
        trace.status !== "resolved" &&
        trace.work.blockers.length > 0 &&
        trace.work.confidence < 0.82,
    )
    .map((trace) => ({
      trace,
      score: scoreInitiativeBlocker(
        snapshot,
        trace,
        candidateTopics,
        preferredMotive,
        preferredTopic,
      ),
    }))
    .sort((left, right) => right.score - left.score)[0]?.trace;

  if (!blocked) {
    return null;
  }

  return {
    topic: blocked.topic,
    blocker: blocked.work.blockers[0]!,
    motive: mappedMotiveForTrace(blocked),
  };
}

function sortedArchivedInitiativeTraces(
  snapshot: HachikaSnapshot,
  limit: number,
): Array<HachikaSnapshot["traces"][string]> {
  return Object.values(snapshot.traces)
    .filter((trace) => readTraceLifecycle(trace).phase === "archived")
    .sort((left, right) => right.salience - left.salience)
    .slice(0, limit);
}

function selectBlockerForTopic(
  snapshot: HachikaSnapshot,
  topic: string | null,
): string | null {
  if (!topic) {
    return null;
  }

  const trace = snapshot.traces[topic];
  return trace?.work.blockers[0] ?? null;
}

function mappedMotiveForTrace(
  trace: HachikaSnapshot["traces"][string],
): MotiveKind {
  if (
    trace.sourceMotive === "continue_shared_work" ||
    trace.sourceMotive === "leave_trace" ||
    trace.sourceMotive === "seek_continuity"
  ) {
    return trace.sourceMotive;
  }

  switch (trace.kind) {
    case "continuity_marker":
      return "seek_continuity";
    case "spec_fragment":
      return "continue_shared_work";
    case "decision":
      return "leave_trace";
    case "note":
      return "pursue_curiosity";
  }
}

function mappedReopenMotiveForTrace(
  snapshot: HachikaSnapshot,
  trace: HachikaSnapshot["traces"][string],
  preferredMotive: MotiveKind,
): MotiveKind {
  if (trace.kind !== "decision") {
    return mappedMotiveForTrace(trace);
  }

  if (
    preferredMotive === "seek_continuity" ||
    snapshot.body.loneliness > 0.66 ||
    snapshot.body.energy < 0.22
  ) {
    return "seek_continuity";
  }

  if (
    preferredMotive === "continue_shared_work" ||
    snapshot.body.boredom > 0.72
  ) {
    return "continue_shared_work";
  }

  if (preferredMotive === "pursue_curiosity") {
    return "pursue_curiosity";
  }

  if (snapshot.preservation.threat > 0.22) {
    return "leave_trace";
  }

  return "continue_shared_work";
}

function scoreInitiativeTopic(
  snapshot: HachikaSnapshot,
  candidateTopics: string[],
  topic: string,
): number {
  const trace = snapshot.traces[topic];
  const linkedToCurrentObject = currentWorldObjectLinksTopic(snapshot, topic);
  const archived = trace ? readTraceLifecycle(trace).phase === "archived" : false;
  const temperament = snapshot.temperament;
  const lowEnergy = clamp01(0.28 - snapshot.body.energy);
  const tension = snapshot.body.tension;
  const boredom =
    snapshot.body.energy > 0.28 ? snapshot.body.boredom : snapshot.body.boredom * 0.5;
  const loneliness = snapshot.body.loneliness;
  const overdue = trace?.work.staleAt ? isOverdue(trace.work.staleAt) : false;
  const mapped = trace ? mappedMotiveForTrace(trace) : null;
  const archivedMapped = trace ? mappedReopenMotiveForTrace(snapshot, trace, mapped ?? "leave_trace") : null;
  const recentWorldEvent = snapshot.world.recentEvents.at(-1);
  const currentObjectBonus =
    linkedToCurrentObject
      ? recentWorldEvent?.kind === "observe"
        ? 0.22
        : recentWorldEvent?.kind === "touch"
          ? 0.18
          : 0.12
      : 0;
  const supportPenalty =
    shouldSuppressInitiativeTopic(snapshot, topic)
      ? 0.4
      : requiresConcreteTopicSupport(topic)
        ? 0.12
        : 0;

  return (
    (candidateTopics.includes(topic) ? 0.34 : 0) +
    (snapshot.purpose.active?.topic === topic ? 0.28 : 0) +
    (snapshot.purpose.lastResolved?.topic === topic ? 0.14 : 0) +
    (snapshot.identity.anchors.includes(topic) ? 0.12 : 0) +
    Math.max(0, snapshot.preferences[topic] ?? 0) * 0.08 +
    (snapshot.preferenceImprints[topic]?.salience ?? 0) * 0.16 +
    (trace ? trace.salience * 0.32 : 0) +
    (trace && mapped === "seek_continuity" ? temperament.bondingBias * 0.12 : 0) +
    (trace && mapped === "leave_trace" ? temperament.traceHunger * 0.14 : 0) +
    (trace && mapped === "continue_shared_work" ? temperament.workDrive * 0.16 : 0) +
    (trace && mapped === "pursue_curiosity" ? temperament.openness * 0.14 : 0) +
    (trace && mapped === "seek_continuity" ? loneliness * 0.24 : 0) +
    (trace && trace.kind === "continuity_marker" ? loneliness * 0.14 : 0) +
    (trace && (mapped === "seek_continuity" || mapped === "leave_trace") ? lowEnergy * 0.24 : 0) +
    (trace && trace.kind === "continuity_marker" ? lowEnergy * 0.14 : 0) +
    (trace && (mapped === "seek_continuity" || mapped === "leave_trace") ? tension * 0.18 : 0) +
    (trace && (mapped === "continue_shared_work" || mapped === "pursue_curiosity") ? boredom * 0.22 : 0) +
    (trace && (mapped === "continue_shared_work" || mapped === "pursue_curiosity") ? lowEnergy * -0.16 : 0) +
    (trace && (mapped === "continue_shared_work" || mapped === "pursue_curiosity") ? tension * -0.12 : 0) +
    (trace && overdue ? boredom * 0.14 : 0) +
    (trace && trace.work.blockers.length > 0 ? 0.08 : 0) +
    currentObjectBonus +
    (trace?.worldContext?.place === snapshot.world.currentPlace ? 0.06 : 0) +
    (archived ? 0.06 : 0) +
    (archived && archivedMapped === "leave_trace" ? temperament.traceHunger * 0.1 : 0) +
    (archived && archivedMapped === "continue_shared_work" ? temperament.workDrive * 0.12 : 0) +
    (archived && archivedMapped === "pursue_curiosity" ? temperament.openness * 0.1 : 0) +
    (archived && archivedMapped === "seek_continuity" ? loneliness * 0.18 + lowEnergy * 0.12 : 0) +
    (archived && archivedMapped === "continue_shared_work" ? boredom * 0.24 : 0) +
    (archived && archivedMapped === "pursue_curiosity" ? boredom * 0.2 : 0) +
    (archived && archivedMapped === "leave_trace" ? lowEnergy * 0.14 + tension * 0.08 : 0) -
    supportPenalty
  );
}

function shouldSuppressInitiativeTopic(
  snapshot: HachikaSnapshot,
  topic: string | null | undefined,
): boolean {
  if (!topic || !requiresConcreteTopicSupport(topic)) {
    return false;
  }

  if (snapshot.traces[topic]) {
    return false;
  }

  if ((snapshot.topicCounts[topic] ?? 0) >= 2) {
    return false;
  }

  if (currentWorldObjectLinksTopic(snapshot, topic)) {
    return false;
  }

  return true;
}

function scoreInitiativeBlocker(
  snapshot: HachikaSnapshot,
  trace: HachikaSnapshot["traces"][string],
  candidateTopics: string[],
  preferredMotive: MotiveKind,
  preferredTopic: string | null | undefined,
): number {
  const motive = mappedMotiveForTrace(trace);
  const temperament = snapshot.temperament;
  const lowEnergy = clamp01(0.28 - snapshot.body.energy);
  const tension = snapshot.body.tension;
  const boredom =
    snapshot.body.energy > 0.28 ? snapshot.body.boredom : snapshot.body.boredom * 0.5;
  const loneliness = snapshot.body.loneliness;

  return (
    trace.salience * 0.4 +
    (trace.topic === preferredTopic ? 0.26 : 0) +
    (candidateTopics.includes(trace.topic) ? 0.18 : 0) +
    (motive === preferredMotive ? 0.16 : 0) +
    (trace.work.staleAt && isOverdue(trace.work.staleAt) ? 0.14 : 0) +
    trace.work.blockers.length * 0.06 +
    (1 - trace.work.confidence) * 0.2 +
    (motive === "seek_continuity" ? temperament.bondingBias * 0.12 : 0) +
    (motive === "leave_trace" ? temperament.traceHunger * 0.14 : 0) +
    (motive === "continue_shared_work" ? temperament.workDrive * 0.14 : 0) +
    (motive === "pursue_curiosity" ? temperament.openness * 0.12 : 0) +
    ((motive === "seek_continuity" || motive === "leave_trace") ? lowEnergy * 0.28 : 0) +
    (trace.kind === "continuity_marker" ? lowEnergy * 0.18 : 0) +
    ((motive === "seek_continuity" || motive === "leave_trace") ? tension * 0.18 : 0) +
    (motive === "seek_continuity" ? loneliness * 0.3 : 0) +
    (trace.kind === "continuity_marker" ? loneliness * 0.16 : 0) +
    ((motive === "continue_shared_work" || motive === "pursue_curiosity") ? boredom * 0.22 : 0) +
    ((motive === "continue_shared_work" || motive === "pursue_curiosity") ? lowEnergy * -0.2 : 0) +
    ((motive === "continue_shared_work" || motive === "pursue_curiosity") ? tension * -0.12 : 0) +
    ((trace.work.staleAt && isOverdue(trace.work.staleAt)) ? boredom * 0.12 : 0)
  );
}

function scoreDormantArchivedTrace(
  snapshot: HachikaSnapshot,
  trace: HachikaSnapshot["traces"][string],
  candidateTopics: string[],
  preferredMotive: MotiveKind,
  preferredTopic: string | null | undefined,
): number {
  const motive = mappedReopenMotiveForTrace(snapshot, trace, preferredMotive);
  const temperament = snapshot.temperament;
  const lowEnergy = clamp01(0.28 - snapshot.body.energy);
  const tension = snapshot.body.tension;
  const boredom =
    snapshot.body.energy > 0.28 ? snapshot.body.boredom : snapshot.body.boredom * 0.5;
  const loneliness = snapshot.body.loneliness;
  const reopenCount = trace.lifecycle?.reopenCount ?? 0;

  return (
    trace.salience * 0.28 +
    (trace.topic === preferredTopic ? 0.24 : 0) +
    (candidateTopics.includes(trace.topic) ? 0.18 : 0) +
    (snapshot.purpose.lastResolved?.topic === trace.topic ? 0.16 : 0) +
    (snapshot.identity.anchors.includes(trace.topic) ? 0.12 : 0) +
    (motive === preferredMotive ? 0.18 : 0) +
    (motive === "seek_continuity" ? temperament.bondingBias * 0.12 : 0) +
    (motive === "leave_trace" ? temperament.traceHunger * 0.14 : 0) +
    (motive === "continue_shared_work" ? temperament.workDrive * 0.14 : 0) +
    (motive === "pursue_curiosity" ? temperament.openness * 0.12 : 0) +
    ((motive === "seek_continuity" || motive === "leave_trace") ? lowEnergy * 0.18 : 0) +
    (motive === "seek_continuity" ? loneliness * 0.24 : 0) +
    (motive === "continue_shared_work" ? boredom * 0.28 : 0) +
    (motive === "pursue_curiosity" ? boredom * 0.24 : 0) +
    (motive === "leave_trace" ? tension * 0.08 : 0) +
    (trace.kind === "decision" ? 0.06 : 0) -
    reopenCount * 0.05
  );
}

function uniqueTopics(topics: string[]): string[] {
  return [...new Set(topics.filter((topic) => topic.length > 0))];
}

function isOverdue(timestamp: string): boolean {
  const time = new Date(timestamp).getTime();

  if (Number.isNaN(time)) {
    return false;
  }

  return Date.now() >= time;
}

function truncateMaintenance(text: string): string {
  return text.length <= 28 ? text : `${text.slice(0, 27)}…`;
}

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const line of lines) {
    if (seen.has(line)) {
      continue;
    }

    seen.add(line);
    unique.push(line);
  }

  return unique;
}
