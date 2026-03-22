import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateArchivedTraceShare,
  calculateArchiveReopenRate,
  calculateAutonomousActivityVisibility,
  calculateIdentityDriftVisibility,
  calculateIdleConsolidationCoverage,
  calculateProactiveMaintenanceRateFromSnapshot,
  calculateSnapshotArchiveReopenRate,
  calculateProactiveMaintenanceRate,
  calculateStateSaturationRatio,
  calculateStressRecoveryLag,
  summarizeLiveGrowthMetrics,
  summarizeGrowthMetrics,
} from "./growth-metrics.js";
import { runScenario } from "./scenario-harness.js";
import { createInitialSnapshot } from "./state.js";
import type { HachikaSnapshot } from "./types.js";

test("calculateStateSaturationRatio counts extreme drive/body/attachment values", () => {
  const snapshot = createInitialSnapshot();
  snapshot.state.continuity = 1;
  snapshot.state.pleasure = 0;
  snapshot.body.energy = 0.99;
  snapshot.body.boredom = 0.01;
  snapshot.attachment = 0.97;

  assert.equal(calculateStateSaturationRatio(snapshot), 0.5);
});

test("growth metrics surface identity drift across a multi-turn work scenario", () => {
  const run = runScenario([
    {
      kind: "user",
      label: "start",
      input: "設計を一緒に進めて、記録として残したい。",
    },
    {
      kind: "user",
      label: "align",
      input: "その設計の責務を切り分けて、もう少し前に進めよう。",
    },
    {
      kind: "user",
      label: "complete",
      input: "その設計はまとまった。記録として保存した。",
    },
  ]);

  const metrics = summarizeGrowthMetrics(run);

  assert.ok(metrics.motiveDiversity >= 1);
  assert.ok(metrics.identityDriftVisibility > 0);
  assert.ok(metrics.averageStateSaturationRatio < 1);
});

test("growth metrics detect archive reopen behavior", () => {
  const run = runScenario(
    [
      {
        kind: "user",
        label: "nudge",
        input: "？",
      },
      {
        kind: "proactive",
        label: "reopen",
        force: true,
      },
    ],
    createArchivedMetricSnapshot(),
  );

  assert.ok(calculateArchiveReopenRate(run) > 0);
});

test("growth metrics can estimate stress recovery lag from scenario snapshots", () => {
  const run = runScenario([
    {
      kind: "user",
      label: "hurt",
      input: "最悪だ。消えて。",
    },
    {
      kind: "user",
      label: "calm-1",
      input: "こんにちは",
    },
    {
      kind: "user",
      label: "calm-2",
      input: "こんにちは",
    },
    {
      kind: "user",
      label: "calm-3",
      input: "こんにちは",
    },
    {
      kind: "user",
      label: "calm-4",
      input: "こんにちは",
    },
    {
      kind: "user",
      label: "calm-5",
      input: "こんにちは",
    },
    {
      kind: "user",
      label: "calm-6",
      input: "こんにちは",
    },
    {
      kind: "user",
      label: "calm-7",
      input: "こんにちは",
    },
    {
      kind: "user",
      label: "calm-8",
      input: "こんにちは",
    },
  ]);

  const lag = calculateStressRecoveryLag(run);

  assert.ok(lag !== null);
  assert.ok(lag > 0);
});

test("growth metrics can track visible autonomous activity across idle and proactive turns", () => {
  const run = runScenario([
    {
      kind: "user",
      label: "seed",
      input: "実装を記録して、仕様として残したい。",
    },
    {
      kind: "idle",
      label: "idle",
      hours: 8,
    },
    {
      kind: "proactive",
      label: "proactive",
      force: false,
    },
  ]);

  assert.equal(calculateAutonomousActivityVisibility(run), 1);
  assert.ok(summarizeGrowthMetrics(run).autonomousActivityVisibility >= 1);
});

test("growth metrics can measure idle consolidation coverage", () => {
  const run = runScenario(
    [
      {
        kind: "idle",
        label: "idle",
        hours: 18,
      },
    ],
    createArchivedMetricSnapshot(),
  );

  assert.equal(calculateIdleConsolidationCoverage(run), 1);
});

test("growth metrics can measure proactive maintenance rate", () => {
  const run = runScenario([
    {
      kind: "user",
      label: "blocked",
      input: "仕様の境界が未定で曖昧だ。まだ進められない。",
    },
    {
      kind: "idle",
      label: "wait",
      hours: 8,
    },
    {
      kind: "proactive",
      label: "repair",
      force: false,
    },
  ]);

  assert.equal(calculateProactiveMaintenanceRate(run), 1);
});

test("live growth metrics summarize archive, activity, and maintenance signals from a snapshot", () => {
  const snapshot = createArchivedMetricSnapshot();
  const trace = snapshot.traces.設計!;
  trace.lifecycle!.reopenCount = 1;
  trace.lifecycle!.reopenedAt = "2026-03-19T02:00:00.000Z";
  snapshot.initiative.history = [
    {
      kind: "idle_consolidation",
      timestamp: "2026-03-19T03:00:00.000Z",
      motive: null,
      topic: "設計",
      traceTopic: null,
      blocker: null,
      maintenanceAction: null,
      reopened: false,
      hours: 8,
      summary: "静かな時間で設計を寄せ直した。",
    },
    {
      kind: "proactive_emission",
      timestamp: "2026-03-19T04:00:00.000Z",
      motive: "continue_shared_work",
      topic: "設計",
      traceTopic: "設計",
      blocker: null,
      maintenanceAction: "promoted_decision",
      reopened: true,
      hours: null,
      summary: "設計へ戻ろうとした。",
    },
  ];

  const metrics = summarizeLiveGrowthMetrics(snapshot);

  assert.equal(metrics.archiveReopenRate, 1);
  assert.equal(metrics.archivedTraceShare, 1);
  assert.equal(metrics.autonomousActivityCount, 2);
  assert.equal(metrics.recentAutonomousActivityCount, 2);
  assert.equal(metrics.idleConsolidationShare, 0.5);
  assert.equal(metrics.proactiveMaintenanceRate, 1);
});

test("live growth metric helpers return zero when there is no trace or activity history", () => {
  const snapshot = createInitialSnapshot();

  assert.equal(calculateSnapshotArchiveReopenRate(snapshot), 0);
  assert.equal(calculateArchivedTraceShare(snapshot), 0);
  assert.equal(calculateProactiveMaintenanceRateFromSnapshot(snapshot), 0);
});

function createArchivedMetricSnapshot(): HachikaSnapshot {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.61;
  snapshot.body.boredom = 0.86;
  snapshot.identity.anchors = ["設計"];
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "decision",
    status: "resolved",
    lastAction: "resolved",
    summary: "「設計」は決定として残っている。",
    sourceMotive: "leave_trace",
    artifact: {
      memo: ["設計を残す"],
      fragments: ["API を分ける"],
      decisions: ["API を分ける"],
      nextSteps: [],
    },
    work: {
      focus: "API を分ける",
      confidence: 0.91,
      blockers: [],
      staleAt: null,
    },
    lifecycle: {
      phase: "archived",
      archivedAt: "2026-03-19T01:30:00.000Z",
      reopenedAt: null,
      reopenCount: 0,
    },
    salience: 0.84,
    mentions: 4,
    createdAt: "2026-03-19T00:00:00.000Z",
    lastUpdatedAt: "2026-03-19T01:30:00.000Z",
  };
  snapshot.purpose.lastResolved = {
    kind: "leave_trace",
    topic: "設計",
    summary: "設計を決まった形として残したい。",
    confidence: 0.88,
    progress: 1,
    createdAt: "2026-03-19T00:00:00.000Z",
    lastUpdatedAt: "2026-03-19T01:30:00.000Z",
    turnsActive: 3,
    outcome: "fulfilled",
    resolution: "設計はひとまず保存された。",
    resolvedAt: "2026-03-19T01:30:00.000Z",
  };
  return snapshot;
}
