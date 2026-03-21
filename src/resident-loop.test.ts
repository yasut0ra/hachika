import assert from "node:assert/strict";
import test from "node:test";

import { createInitialSnapshot } from "./state.js";
import {
  describeResidentLoopConfig,
  readResidentLoopConfigFromEnv,
  runResidentLoopTick,
} from "./resident-loop.js";

test("resident loop can surface idle reactivation activity", async () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-20T10:00:00.000Z";
  snapshot.body.energy = 0.46;
  snapshot.body.boredom = 0.84;
  snapshot.body.tension = 0.18;
  snapshot.temperament.workDrive = 0.88;
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
      confidence: 0.92,
      blockers: [],
      staleAt: null,
    },
    lifecycle: {
      phase: "archived",
      archivedAt: "2026-03-20T09:00:00.000Z",
      reopenedAt: null,
      reopenCount: 0,
    },
    salience: 0.8,
    mentions: 4,
    createdAt: "2026-03-20T08:00:00.000Z",
    lastUpdatedAt: "2026-03-20T09:00:00.000Z",
  };

  const result = await runResidentLoopTick(snapshot, { idleHours: 18 });

  assert.ok(
    result.activities.some((activity) => activity.kind === "idle_reactivation"),
  );
  assert.equal(result.snapshot.initiative.history.length > 0, true);
});

test("resident loop can emit proactive wording and record the emission", async () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-20T10:00:00.000Z";
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "expansion",
    motive: "continue_shared_work",
    topic: "仕様",
    blocker: null,
    concern: null,
    createdAt: "2026-03-20T10:00:00.000Z",
    readyAfterHours: 0,
  };

  const result = await runResidentLoopTick(snapshot, { idleHours: 1 });

  assert.ok(result.proactiveMessage !== null);
  assert.ok(
    result.activities.some((activity) => activity.kind === "proactive_emission"),
  );
});

test("resident loop config reads env overrides", () => {
  const config = readResidentLoopConfigFromEnv({
    HACHIKA_LOOP_INTERVAL_MS: "9000",
    HACHIKA_LOOP_IDLE_HOURS_PER_TICK: "1.5",
  });

  assert.equal(config.intervalMs, 9000);
  assert.equal(config.idleHoursPerTick, 1.5);
  assert.equal(describeResidentLoopConfig(config), "interval:9000ms idlePerTick:1.5h");
});
