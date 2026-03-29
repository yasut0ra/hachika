import assert from "node:assert/strict";
import test from "node:test";

import type { ProactiveDirector } from "./proactive-director.js";
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
  assert.equal(result.snapshot.world.currentPlace, "studio");
  assert.notEqual(result.snapshot.world.clockHour, snapshot.world.clockHour);
});

test("resident loop can reactivate a current world object trace after quiet observation", async () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-20T10:00:00.000Z";
  snapshot.world.currentPlace = "archive";
  snapshot.world.objects.shelf!.linkedTraceTopics = ["仕様の境界"];
  snapshot.world.recentEvents = [
    {
      timestamp: "2026-03-20T09:50:00.000Z",
      kind: "observe",
      place: "archive",
      summary: "archive の棚のあいだを見ている。",
    },
  ];
  snapshot.body.energy = 0.52;
  snapshot.body.boredom = 0.72;
  snapshot.body.tension = 0.16;
  snapshot.temperament.workDrive = 0.82;
  snapshot.traces["仕様の境界"] = {
    topic: "仕様の境界",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「仕様の境界」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["仕様の境界を残す"],
      fragments: ["責務を分ける"],
      decisions: [],
      nextSteps: ["責務を分ける"],
    },
    work: {
      focus: "責務を分ける",
      confidence: 0.72,
      blockers: [],
      staleAt: null,
    },
    lifecycle: {
      phase: "live",
      archivedAt: null,
      reopenedAt: null,
      reopenCount: 0,
    },
    worldContext: {
      place: "archive",
      objectId: "shelf",
      linkedAt: "2026-03-20T09:45:00.000Z",
    },
    salience: 0.76,
    mentions: 3,
    createdAt: "2026-03-20T09:40:00.000Z",
    lastUpdatedAt: "2026-03-20T09:45:00.000Z",
  };

  const result = await runResidentLoopTick(snapshot, { idleHours: 12 });
  const reactivation = result.activities.find((activity) => activity.kind === "idle_reactivation");
  const emission = result.activities.find((activity) => activity.kind === "proactive_emission");

  assert.ok(result.proactiveMessage !== null);
  assert.equal(emission?.topic, "仕様の境界");
  assert.equal(emission?.place, "archive");
  assert.equal(emission?.worldAction, "touch");
  assert.match(reactivation?.summary ?? "", /棚/);
  assert.match(result.proactiveMessage ?? "", /棚/);
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
  assert.equal(result.snapshot.autonomousFeed.length, 1);
  assert.equal(result.snapshot.autonomousFeed[0]?.mode, "proactive");
  assert.equal(result.snapshot.autonomousFeed[0]?.source, "resident_loop");
  assert.equal(result.snapshot.autonomousFeed[0]?.text, result.proactiveMessage);
});

test("resident loop can suppress proactive emission through a proactive director", async () => {
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

  const proactiveDirector: ProactiveDirector = {
    name: "test-director",
    async directProactive() {
      return {
        directive: {
          emit: false,
          plan: null,
          summary: "suppress/quiet",
        },
        provider: "test-director",
        model: "stub",
      };
    },
  };

  const result = await runResidentLoopTick(snapshot, {
    idleHours: 1,
    proactiveDirector,
    replyGenerator: {
      name: "test-llm",
      async generateReply() {
        return null;
      },
      async generateProactive() {
        throw new Error("should not generate when suppressed");
      },
    },
  });

  assert.equal(result.proactiveMessage, null);
  assert.equal(
    result.activities.some((activity) => activity.kind === "proactive_emission"),
    false,
  );
  assert.equal(result.snapshot.autonomousFeed.length, 0);
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
