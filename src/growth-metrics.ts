import {
  INITIAL_ATTACHMENT,
  INITIAL_BODY,
  INITIAL_REACTIVITY,
  INITIAL_STATE,
  INITIAL_TEMPERAMENT,
} from "./state.js";
import type { HachikaSnapshot } from "./types.js";
import type { ScenarioRun } from "./scenario-harness.js";

export interface GrowthMetrics {
  averageStateSaturationRatio: number;
  finalStateSaturationRatio: number;
  motiveDiversity: number;
  identityDriftVisibility: number;
  archiveReopenRate: number;
  stressRecoveryLag: number | null;
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

export function summarizeGrowthMetrics(run: ScenarioRun): GrowthMetrics {
  return {
    averageStateSaturationRatio: calculateAverageStateSaturationRatio(run),
    finalStateSaturationRatio: calculateStateSaturationRatio(run.finalSnapshot),
    motiveDiversity: calculateMotiveDiversity(run),
    identityDriftVisibility: calculateIdentityDriftVisibility(run),
    archiveReopenRate: calculateArchiveReopenRate(run),
    stressRecoveryLag: calculateStressRecoveryLag(run),
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

  return {
    baselineSaturationRatio: calculateStateSaturationRatio({
      version: 17,
      state: initial.state,
      body: initial.body,
      reactivity: initial.reactivity,
      temperament: initial.temperament,
      attachment: initial.attachment,
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
        summary: "",
        currentArc: "",
        traits: [],
        anchors: [],
        coherence: 0,
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
    }),
    baselineStressRecoveryLag: null,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
