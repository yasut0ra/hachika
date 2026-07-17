import assert from "node:assert/strict";
import test from "node:test";

import type { AutonomyDirector } from "./autonomy-director.js";
import type { ProactiveDirector } from "./proactive-director.js";
import type { ReplyGenerator } from "./reply-generator.js";
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
  assert.ok(
    result.internalActivities.some((activity) => activity.kind === "idle_reactivation"),
  );
  assert.ok(
    result.internalActivities.some((activity) => activity.autonomyAction === "recall"),
  );
  assert.equal(
    result.outwardActivities.some((activity) => activity.kind === "idle_reactivation"),
    false,
  );
  assert.equal(result.snapshot.initiative.history.length > 0, true);
  assert.equal(result.snapshot.world.currentPlace, "studio");
  assert.notEqual(result.snapshot.world.clockHour, snapshot.world.clockHour);
});

test("resident loop writes at most one deterministic dream per local day", async () => {
  const snapshot = createInitialSnapshot();
  snapshot.memories = [
    {
      role: "user",
      text: "海の話をした",
      timestamp: "2026-07-16T09:00:00.000Z",
      topics: ["海"],
      sentiment: "neutral",
      kind: "turn",
    },
    {
      role: "hachika",
      text: "棚へ設計を置いた",
      timestamp: "2026-07-16T09:01:00.000Z",
      topics: ["設計"],
      sentiment: "neutral",
      kind: "turn",
    },
  ];

  const first = await runResidentLoopTick(snapshot, {
    idleHours: 0,
    now: new Date("2026-07-17T12:00:00.000Z"),
    timeZone: "UTC",
  });
  const duplicate = await runResidentLoopTick(first.snapshot, {
    idleHours: 0,
    now: new Date("2026-07-17T20:00:00.000Z"),
    timeZone: "UTC",
  });
  const nextDay = await runResidentLoopTick(duplicate.snapshot, {
    idleHours: 0,
    now: new Date("2026-07-18T12:00:00.000Z"),
    timeZone: "UTC",
  });

  assert.equal(
    first.snapshot.journal.filter((entry) => entry.source === "dream").length,
    1,
  );
  assert.equal(
    duplicate.snapshot.journal.filter((entry) => entry.source === "dream").length,
    1,
  );
  assert.equal(
    nextDay.snapshot.journal.filter((entry) => entry.source === "dream").length,
    2,
  );
});

test("resident loop evaluates one seeded world occurrence per local day", async () => {
  const first = await runResidentLoopTick(createInitialSnapshot(), {
    idleHours: 0,
    now: new Date("2026-08-02T12:00:00.000Z"),
    timeZone: "UTC",
    individualId: "individual-a",
  });
  const duplicate = await runResidentLoopTick(first.snapshot, {
    idleHours: 0,
    now: new Date("2026-08-02T20:00:00.000Z"),
    timeZone: "UTC",
    individualId: "individual-a",
  });

  assert.ok(first.worldEvent);
  assert.equal(first.worldEvent.kind, "occurrence");
  assert.equal(first.snapshot.world.lastDailyEventCheckDate, "2026-08-02");
  assert.equal(duplicate.worldEvent, null);
  assert.equal(
    duplicate.snapshot.world.recentEvents.filter(
      (event) => event.kind === "occurrence",
    ).length,
    1,
  );
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
  assert.ok(
    result.internalActivities.some((activity) => activity.kind === "idle_reactivation"),
  );
  assert.ok(
    result.outwardActivities.some((activity) => activity.kind === "proactive_emission"),
  );
  assert.equal(emission?.topic, "仕様の境界");
  assert.equal(reactivation?.autonomyAction, "recall");
  assert.equal(emission?.autonomyAction, "speak");
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
  assert.equal(result.internalActivities.length, 0);
  assert.ok(
    result.outwardActivities.some((activity) => activity.kind === "proactive_emission"),
  );
  assert.ok(
    result.outwardActivities.some((activity) => activity.autonomyAction === "speak"),
  );
  assert.equal(result.snapshot.autonomousFeed.length, 1);
  assert.equal(result.snapshot.autonomousFeed[0]?.mode, "proactive");
  assert.equal(result.snapshot.autonomousFeed[0]?.source, "resident_loop");
  assert.equal(result.snapshot.autonomousFeed[0]?.text, result.proactiveMessage);
});

test("resident loop can record a quiet observe action without speaking", async () => {
  const snapshot = createInitialSnapshot();
  const observedPlace = snapshot.world.currentPlace;
  snapshot.lastInteractionAt = "2026-03-20T10:00:00.000Z";
  snapshot.body.energy = 0.08;
  snapshot.body.loneliness = 0.04;
  snapshot.preservation.threat = 0.1;
  const proactiveDirector: ProactiveDirector = {
    name: "quiet-observe-director",
    async directProactive() {
      return {
        directive: {
          emit: false,
          plan: null,
          summary: "suppress/observe-only",
        },
        provider: "test-director",
        model: "stub",
      };
    },
  };

  const result = await runResidentLoopTick(snapshot, {
    idleHours: 8,
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
  const observation = result.internalActivities.find(
    (activity) => activity.autonomyAction === "observe",
  );

  assert.equal(result.proactiveMessage, null);
  assert.ok(observation);
  assert.equal(observation?.kind, "idle_consolidation");
  assert.equal(observation?.worldAction, "observe");
  assert.equal(observation?.topic, null);
  assert.equal(observation?.place, observedPlace);
});

test("resident loop clears stale pending and stays quiet while a direct referent question is unresolved", async () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-04-01T00:00:00.000Z";
  snapshot.body.energy = 0.66;
  snapshot.body.loneliness = 0.44;
  snapshot.preservation.threat = 0.52;
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "relation",
    motive: "deepen_relation",
    topic: "名前",
    stateTopic: null,
    blocker: null,
    concern: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    readyAfterHours: 0,
  };
  snapshot.discourse.openQuestions.push({
    target: "hachika_name",
    text: "あなたの名前は？",
    askedAt: "2026-04-01T00:00:00.000Z",
    askedBy: "user",
    answerExpectedFrom: "hachika",
    status: "open",
    resolvedAt: null,
  });

  const result = await runResidentLoopTick(snapshot, { idleHours: 8 });

  assert.equal(result.proactiveMessage, null);
  assert.equal(result.snapshot.initiative.pending, null);
  assert.ok(
    result.internalActivities.some(
      (activity) =>
        activity.kind === "idle_consolidation" &&
        activity.autonomyAction === "hold",
    ),
  );
  assert.equal(result.outwardActivities.length, 0);
});

test("resident loop can ask the user to resolve a user-owned open question", async () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-04-01T00:00:00.000Z";
  snapshot.body.energy = 0.66;
  snapshot.body.loneliness = 0.44;
  snapshot.discourse.openQuestions.push({
    target: "user_profile",
    text: "なんて言われたい?",
    askedAt: "2026-04-01T00:00:00.000Z",
    askedBy: "hachika",
    answerExpectedFrom: "user",
    status: "open",
    resolvedAt: null,
  });

  const result = await runResidentLoopTick(snapshot, {
    idleHours: 0,
    now: new Date("2026-04-01T02:00:00.000Z"),
  });

  assert.match(result.proactiveMessage ?? "", /なんて言われたい/u);
  assert.equal(result.outwardActivities.length, 1);
  assert.equal(result.outwardActivities[0]?.blocker, "なんて言われたい?");
  assert.equal(result.outwardActivities[0]?.topic, null);
});

test("resident loop keeps a user-owned open question probe when proactive director suppresses it", async () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-04-01T00:00:00.000Z";
  snapshot.body.energy = 0.66;
  snapshot.body.loneliness = 0.44;
  snapshot.discourse.openQuestions.push({
    target: "user_profile",
    text: "なんて言われたい?",
    askedAt: "2026-04-01T00:00:00.000Z",
    askedBy: "hachika",
    answerExpectedFrom: "user",
    status: "open",
    resolvedAt: null,
  });

  const replyGenerator: ReplyGenerator = {
    name: "test-reply",
    async generateReply() {
      return null;
    },
    async generateProactive(context) {
      return {
        reply: context.fallbackMessage,
        provider: "test-reply",
        model: "stub",
      };
    },
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
    idleHours: 0,
    now: new Date("2026-04-01T02:00:00.000Z"),
    replyGenerator,
    proactiveDirector,
  });

  assert.match(result.proactiveMessage ?? "", /なんて言われたい/u);
  assert.equal(result.outwardActivities[0]?.blocker, "なんて言われたい?");
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

test("resident loop can reshape internal autonomy action through an autonomy director", async () => {
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
  const autonomyDirector: AutonomyDirector = {
    name: "test-autonomy",
    async directAutonomy() {
      return {
        directive: {
          keep: true,
          action: "observe",
          outwardMode: "none",
          summary: "cool/observe",
        },
        provider: "test-autonomy",
        model: "stub",
      };
    },
  };

  const result = await runResidentLoopTick(snapshot, {
    idleHours: 18,
    autonomyDirector,
    replyGenerator: {
      name: "test-llm",
      async generateReply() {
        return null;
      },
      async generateProactive() {
        throw new Error("should not generate when outward is disabled");
      },
    },
  });

  assert.ok(
    result.internalActivities.some((activity) => activity.autonomyAction === "observe"),
  );
  assert.equal(
    result.internalActivities.some((activity) => activity.autonomyAction === "recall"),
    false,
  );
  assert.equal(result.proactiveMessage, null);
  assert.equal(result.outwardActivities.length, 0);
});

test("resident loop can materialize silent touch when autonomy director chooses touch", async () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-20T00:00:00.000Z";
  snapshot.body.energy = 0.84;
  snapshot.body.loneliness = 0.74;
  snapshot.attachment = 0.72;
  snapshot.state.continuity = 0.82;
  snapshot.temperament.traceHunger = 0.81;
  snapshot.initiative.pending = {
    kind: "resume_topic",
    motive: "seek_continuity",
    reason: "continuity",
    topic: "設計",
    stateTopic: "設計",
    blocker: null,
    concern: null,
    createdAt: "2026-03-20T00:00:00.000Z",
    readyAfterHours: 0,
    place: "archive",
    worldAction: "observe",
  };

  const autonomyDirector: AutonomyDirector = {
    name: "test-autonomy",
    async directAutonomy() {
      return {
        directive: {
          keep: true,
          action: "observe",
          outwardMode: "touch",
          summary: "observe/touch",
        },
        provider: "test-autonomy",
        model: "stub",
      };
    },
  };

  const result = await runResidentLoopTick(snapshot, {
    idleHours: 8,
    autonomyDirector,
    replyGenerator: {
      name: "test-llm",
      async generateReply() {
        return null;
      },
      async generateProactive() {
        throw new Error("should not generate when outward mode is touch");
      },
    },
  });

  assert.equal(result.proactiveMessage, null);
  assert.ok(
    result.outwardActivities.some(
      (activity) =>
        activity.kind === "proactive_emission" &&
        activity.autonomyAction === "touch" &&
        activity.worldAction === "touch",
    ),
  );
  assert.equal(result.snapshot.initiative.pending, null);
  assert.equal(result.snapshot.world.recentEvents.at(-1)?.kind, "touch");
});

test("resident loop prefers semantic autonomy plan over conflicting legacy autonomy fields", async () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-20T10:00:00.000Z";
  snapshot.body.energy = 0.5;
  snapshot.body.boredom = 0.72;
  snapshot.body.tension = 0.18;

  const autonomyDirector: AutonomyDirector = {
    name: "test-autonomy",
    async directAutonomy() {
      return {
        directive: {
          keep: false,
          action: "recall",
          outwardMode: "speak",
          semantic: {
            mode: "autonomy",
            topics: [
              {
                topic: "棚",
                source: "world",
                durability: "ephemeral",
                confidence: 0.61,
              },
            ],
            autonomyPlan: {
              keep: true,
              action: "observe",
              outwardMode: "none",
            },
            summary: "autonomy/observe",
          },
          summary: "legacy/recall/speak",
        },
        provider: "test-autonomy",
        model: "stub",
      };
    },
  };

  const result = await runResidentLoopTick(snapshot, {
    idleHours: 6,
    autonomyDirector,
    replyGenerator: {
      name: "test-llm",
      async generateReply() {
        return null;
      },
      async generateProactive() {
        throw new Error("should not generate when semantic autonomy keeps outward silent");
      },
    },
  });

  assert.equal(result.proactiveMessage, null);
  assert.ok(
    result.internalActivities.some((activity) => activity.autonomyAction === "observe"),
  );
  assert.equal(
    result.internalActivities.some((activity) => activity.autonomyAction === "recall"),
    false,
  );
  assert.equal(result.outwardActivities.length, 0);
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

test("resident loop defaults to wall-clock time", () => {
  const config = readResidentLoopConfigFromEnv({});

  assert.equal(config.intervalMs, 15_000);
  assert.equal(config.idleHoursPerTick, null);
  assert.equal(describeResidentLoopConfig(config), "interval:15000ms idle:wall-clock");
});

test("wall-clock resident ticks advance absence without rewinding timestamps", async () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-04-01T00:00:00.000Z";
  snapshot.initiative.lastProactiveAt = "2026-04-01T00:00:00.000Z";

  const result = await runResidentLoopTick(snapshot, {
    idleHours: 0.25,
    clockMode: "wall",
    now: new Date("2026-04-01T00:15:00.000Z"),
  });

  assert.equal(result.snapshot.idleClock.absenceHours, 0.25);
  assert.equal(result.snapshot.lastInteractionAt, "2026-04-01T00:00:00.000Z");
  assert.equal(
    result.snapshot.initiative.lastProactiveAt,
    "2026-04-01T00:00:00.000Z",
  );
});

test("wall-clock resident ticks continuously advance an existing presence", async () => {
  const snapshot = createInitialSnapshot();
  snapshot.presence = {
    action: "hold",
    focus: "設計",
    rationale: "unfinished_work",
    place: "studio",
    objectId: "desk",
    intensity: 0.64,
    startedAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    dwellHours: 2,
    residue: null,
  };

  const result = await runResidentLoopTick(snapshot, {
    idleHours: 0.25,
    clockMode: "wall",
    now: new Date("2026-04-01T00:15:00.000Z"),
  });

  assert.equal(result.snapshot.presence.action, "hold");
  assert.equal(result.snapshot.presence.dwellHours, 2.25);
  assert.equal(result.snapshot.presence.updatedAt, "2026-04-01T00:15:00.000Z");
  assert.equal(result.internalActivities.length, 0);
});
