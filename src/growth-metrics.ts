import {
  createInitialSnapshot,
  INITIAL_ATTACHMENT,
  INITIAL_BODY,
  INITIAL_REACTIVITY,
  INITIAL_STATE,
  INITIAL_TEMPERAMENT,
} from "./state.js";
import type { HachikaSnapshot, InitiativeActivity } from "./types.js";
import type { ScenarioEvent, ScenarioRun } from "./scenario-harness.js";

export interface GrowthMetrics {
  averageStateSaturationRatio: number;
  finalStateSaturationRatio: number;
  motiveDiversity: number;
  identityDriftVisibility: number;
  archiveReopenRate: number;
  autonomousActivityVisibility: number;
  idleConsolidationCoverage: number;
  proactiveMaintenanceRate: number;
  stressRecoveryLag: number | null;
}

export interface LiveGrowthMetrics {
  stateSaturationRatio: number;
  archiveReopenRate: number;
  archivedTraceShare: number;
  autonomousActivityCount: number;
  recentAutonomousActivityCount: number;
  idleConsolidationShare: number;
  proactiveMaintenanceRate: number;
  recentGeneratedCount: number;
  generationFallbackRate: number;
  generationAverageOverlap: number;
  generationAbstractRatio: number;
  generationConcreteDetail: number;
  generationOpenerEchoRate: number;
  generationFocusMentionRate: number | null;
}

export function collectScenarioSnapshots(run: ScenarioRun): HachikaSnapshot[] {
  return [run.initialSnapshot, ...run.events.map((event) => event.snapshot)];
}

export function calculateStateSaturationRatio(snapshot: HachikaSnapshot): number {
  const values = [
    snapshot.state.continuity,
    snapshot.state.pleasure,
    snapshot.state.curiosity,
    snapshot.state.relation,
    snapshot.state.expansion,
    snapshot.body.energy,
    snapshot.body.tension,
    snapshot.body.boredom,
    snapshot.body.loneliness,
    snapshot.attachment,
  ];
  const saturated = values.filter((value) => value <= 0.05 || value >= 0.95).length;

  return round(saturated / values.length);
}

export function calculateAverageStateSaturationRatio(run: ScenarioRun): number {
  const snapshots = collectScenarioSnapshots(run);
  const total = snapshots.reduce(
    (sum, snapshot) => sum + calculateStateSaturationRatio(snapshot),
    0,
  );

  return round(total / snapshots.length);
}

export function calculateMotiveDiversity(run: ScenarioRun): number {
  const motives = new Set(
    run.events
      .map((event) => event.selfModel.topMotives[0]?.kind ?? null)
      .filter((kind): kind is NonNullable<typeof kind> => kind !== null),
  );

  return motives.size;
}

export function calculateIdentityDriftVisibility(run: ScenarioRun): number {
  const snapshots = collectScenarioSnapshots(run);

  if (snapshots.length <= 1) {
    return 0;
  }

  let changed = 0;

  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1]!;
    const current = snapshots[index]!;

    if (
      previous.identity.summary !== current.identity.summary ||
      previous.identity.currentArc !== current.identity.currentArc ||
      previous.identity.anchors.join("|") !== current.identity.anchors.join("|")
    ) {
      changed += 1;
    }
  }

  return round(changed / (snapshots.length - 1));
}

export function calculateArchiveReopenRate(run: ScenarioRun): number {
  const traces = new Map<
    string,
    {
      archived: boolean;
      reopened: boolean;
    }
  >();

  for (const snapshot of collectScenarioSnapshots(run)) {
    for (const trace of Object.values(snapshot.traces)) {
      const entry = traces.get(trace.topic) ?? { archived: false, reopened: false };
      if (trace.lifecycle?.archivedAt) {
        entry.archived = true;
      }
      if ((trace.lifecycle?.reopenCount ?? 0) > 0) {
        entry.reopened = true;
      }
      traces.set(trace.topic, entry);
    }
  }

  const archived = [...traces.values()].filter((entry) => entry.archived || entry.reopened);
  if (archived.length === 0) {
    return 0;
  }

  const reopened = archived.filter((entry) => entry.reopened).length;
  return round(reopened / archived.length);
}

export function calculateStressRecoveryLag(run: ScenarioRun): number | null {
  const snapshots = collectScenarioSnapshots(run);
  const initial = snapshots[0];

  if (!initial) {
    return null;
  }

  const stressThreshold = initial.reactivity.stressLoad + 0.12;
  const tensionThreshold = initial.body.tension + 0.12;
  let spikeIndex = -1;

  for (let index = 1; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index]!;

    if (
      snapshot.reactivity.stressLoad >= stressThreshold ||
      snapshot.body.tension >= tensionThreshold
    ) {
      spikeIndex = index;
      break;
    }
  }

  if (spikeIndex === -1) {
    return null;
  }

  for (let index = spikeIndex + 1; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index]!;

    if (
      snapshot.reactivity.stressLoad <= initial.reactivity.stressLoad + 0.04 &&
      snapshot.body.tension <= initial.body.tension + 0.05
    ) {
      return index - spikeIndex;
    }
  }

  return null;
}

export function calculateAutonomousActivityVisibility(run: ScenarioRun): number {
  const deltas = collectScenarioActivityDeltas(run).filter(
    ({ event }) => event.kind === "idle" || event.kind === "proactive",
  );

  if (deltas.length === 0) {
    return 0;
  }

  const visible = deltas.filter(({ activities }) => activities.length > 0).length;
  return round(visible / deltas.length);
}

export function calculateIdleConsolidationCoverage(run: ScenarioRun): number {
  const deltas = collectScenarioActivityDeltas(run).filter(
    ({ event }) => event.kind === "idle",
  );

  if (deltas.length === 0) {
    return 0;
  }

  const covered = deltas.filter(({ activities }) =>
    activities.some(
      (activity) =>
        activity.kind === "idle_consolidation" ||
        activity.kind === "idle_reactivation",
    ),
  ).length;
  return round(covered / deltas.length);
}

export function calculateProactiveMaintenanceRate(run: ScenarioRun): number {
  const deltas = collectScenarioActivityDeltas(run).filter(
    ({ event }) => event.kind === "proactive",
  );

  if (deltas.length === 0) {
    return 0;
  }

  const maintained = deltas.filter(({ activities }) =>
    activities.some(
      (activity) =>
        activity.kind === "proactive_emission" &&
        (activity.maintenanceAction !== null ||
          activity.reopened ||
          activity.traceTopic !== null),
    ),
  ).length;
  return round(maintained / deltas.length);
}

export function summarizeGrowthMetrics(run: ScenarioRun): GrowthMetrics {
  return {
    averageStateSaturationRatio: calculateAverageStateSaturationRatio(run),
    finalStateSaturationRatio: calculateStateSaturationRatio(run.finalSnapshot),
    motiveDiversity: calculateMotiveDiversity(run),
    identityDriftVisibility: calculateIdentityDriftVisibility(run),
    archiveReopenRate: calculateArchiveReopenRate(run),
    autonomousActivityVisibility: calculateAutonomousActivityVisibility(run),
    idleConsolidationCoverage: calculateIdleConsolidationCoverage(run),
    proactiveMaintenanceRate: calculateProactiveMaintenanceRate(run),
    stressRecoveryLag: calculateStressRecoveryLag(run),
  };
}

export function calculateSnapshotArchiveReopenRate(snapshot: HachikaSnapshot): number {
  const traces = Object.values(snapshot.traces);
  const archived = traces.filter(
    (trace) => trace.lifecycle?.archivedAt || (trace.lifecycle?.reopenCount ?? 0) > 0,
  );

  if (archived.length === 0) {
    return 0;
  }

  const reopened = archived.filter((trace) => (trace.lifecycle?.reopenCount ?? 0) > 0).length;
  return round(reopened / archived.length);
}

export function calculateArchivedTraceShare(snapshot: HachikaSnapshot): number {
  const traces = Object.values(snapshot.traces);

  if (traces.length === 0) {
    return 0;
  }

  const archived = traces.filter((trace) => trace.lifecycle?.phase === "archived").length;
  return round(archived / traces.length);
}

export function calculateIdleConsolidationShare(snapshot: HachikaSnapshot): number {
  const history = snapshot.initiative.history ?? [];

  if (history.length === 0) {
    return 0;
  }

  const idleRelated = history.filter(
    (activity) =>
      activity.kind === "idle_consolidation" || activity.kind === "idle_reactivation",
  ).length;
  return round(idleRelated / history.length);
}

export function calculateProactiveMaintenanceRateFromSnapshot(
  snapshot: HachikaSnapshot,
): number {
  const proactive = (snapshot.initiative.history ?? []).filter(
    (activity) => activity.kind === "proactive_emission",
  );

  if (proactive.length === 0) {
    return 0;
  }

  const maintained = proactive.filter(
    (activity) =>
      activity.maintenanceAction !== null ||
      activity.reopened ||
      activity.traceTopic !== null,
  ).length;
  return round(maintained / proactive.length);
}

export function summarizeLiveGrowthMetrics(snapshot: HachikaSnapshot): LiveGrowthMetrics {
  const history = snapshot.initiative.history ?? [];
  const generation = snapshot.generationHistory.slice(-12);
  const focusSamples = generation.filter((entry) => entry.focusMentioned !== null);

  return {
    stateSaturationRatio: calculateStateSaturationRatio(snapshot),
    archiveReopenRate: calculateSnapshotArchiveReopenRate(snapshot),
    archivedTraceShare: calculateArchivedTraceShare(snapshot),
    autonomousActivityCount: history.length,
    recentAutonomousActivityCount: history.slice(-12).length,
    idleConsolidationShare: calculateIdleConsolidationShare(snapshot),
    proactiveMaintenanceRate: calculateProactiveMaintenanceRateFromSnapshot(snapshot),
    recentGeneratedCount: generation.length,
    generationFallbackRate: averageGenerationMetric(
      generation,
      (entry) => (entry.fallbackUsed ? 1 : 0),
    ),
    generationAverageOverlap: averageGenerationMetric(
      generation,
      (entry) => entry.fallbackOverlap,
    ),
    generationAbstractRatio: averageGenerationMetric(
      generation,
      (entry) => entry.abstractTermRatio,
    ),
    generationConcreteDetail: averageGenerationMetric(
      generation,
      (entry) => entry.concreteDetailScore,
    ),
    generationOpenerEchoRate: averageGenerationMetric(
      generation,
      (entry) => (entry.openerEcho ? 1 : 0),
    ),
    generationFocusMentionRate:
      focusSamples.length === 0
        ? null
        : averageGenerationMetric(
            focusSamples,
            (entry) => (entry.focusMentioned ? 1 : 0),
          ),
  };
}

export function describeGrowthMetricBaselines(): Record<string, number | null> {
  const initial = {
    state: INITIAL_STATE,
    body: INITIAL_BODY,
    attachment: INITIAL_ATTACHMENT,
    reactivity: INITIAL_REACTIVITY,
    temperament: INITIAL_TEMPERAMENT,
  };
  const baselineSnapshot = createInitialSnapshot();
  baselineSnapshot.state = initial.state;
  baselineSnapshot.body = initial.body;
  baselineSnapshot.attachment = initial.attachment;
  baselineSnapshot.reactivity = initial.reactivity;
  baselineSnapshot.temperament = initial.temperament;

  return {
    baselineSaturationRatio: calculateStateSaturationRatio(baselineSnapshot),
    baselineAutonomousActivityVisibility: 0,
    baselineIdleConsolidationCoverage: 0,
    baselineProactiveMaintenanceRate: 0,
    baselineStressRecoveryLag: null,
  };
}

function collectScenarioActivityDeltas(
  run: ScenarioRun,
): Array<{ event: ScenarioEvent; activities: InitiativeActivity[] }> {
  const deltas: Array<{ event: ScenarioEvent; activities: InitiativeActivity[] }> = [];
  let previousHistory = run.initialSnapshot.initiative.history ?? [];

  for (const event of run.events) {
    const currentHistory = event.snapshot.initiative.history ?? [];
    deltas.push({
      event,
      activities: diffInitiativeHistory(previousHistory, currentHistory),
    });
    previousHistory = currentHistory;
  }

  return deltas;
}

function diffInitiativeHistory(
  previous: InitiativeActivity[],
  current: InitiativeActivity[],
): InitiativeActivity[] {
  if (current.length === 0) {
    return [];
  }

  if (
    previous.length <= current.length &&
    previous.every((activity, index) => initiativeActivityKey(activity) === initiativeActivityKey(current[index]!))
  ) {
    return current.slice(previous.length);
  }

  const previousKeys = new Set(previous.map(initiativeActivityKey));
  return current.filter((activity) => !previousKeys.has(initiativeActivityKey(activity)));
}

function initiativeActivityKey(activity: InitiativeActivity): string {
  return [
    activity.kind,
    activity.timestamp,
    activity.motive ?? "",
    activity.topic ?? "",
    activity.traceTopic ?? "",
    activity.blocker ?? "",
    activity.maintenanceAction ?? "",
    activity.reopened ? "1" : "0",
    activity.hours ?? "",
    activity.summary,
  ].join("|");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function averageGenerationMetric<T>(
  entries: T[],
  read: (entry: T) => number,
): number {
  if (entries.length === 0) {
    return 0;
  }

  return round(entries.reduce((sum, entry) => sum + read(entry), 0) / entries.length);
}
