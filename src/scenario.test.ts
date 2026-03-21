import assert from "node:assert/strict";
import test from "node:test";

import type { InputInterpreter } from "./input-interpreter.js";
import type { ProactiveGenerationContext, ReplyGenerator } from "./reply-generator.js";
import { requireScenarioEvent, runScenario, runScenarioAsync } from "./scenario-harness.js";
import { createInitialSnapshot } from "./state.js";
import type { HachikaSnapshot } from "./types.js";

test("scenario: aligned work can persist as a purpose and resolve into a decision", () => {
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

  const start = requireScenarioEvent(run, "start", "user");
  const align = requireScenarioEvent(run, "align", "user");
  const complete = requireScenarioEvent(run, "complete", "user");

  assert.ok(start.snapshot.purpose.active !== null);
  assert.ok(align.snapshot.purpose.active !== null);
  assert.equal(align.snapshot.purpose.active?.kind, start.snapshot.purpose.active?.kind);
  assert.ok((align.snapshot.purpose.active?.turnsActive ?? 0) >= 2);
  assert.equal(complete.snapshot.purpose.lastResolved?.outcome, "fulfilled");
  assert.equal(complete.snapshot.traces.設計?.kind, "decision");
  assert.ok((complete.snapshot.traces.設計?.artifact.decisions.length ?? 0) > 0);
  assert.match(complete.reply, /決定|保存|まとまった/);
});

test("scenario: blocked work can turn into a concrete next step after proactive maintenance", () => {
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
    },
  ]);

  const blocked = requireScenarioEvent(run, "blocked", "user");
  const repair = requireScenarioEvent(run, "repair", "proactive");
  const blocker = blocked.snapshot.initiative.pending?.blocker;

  assert.ok(blocked.snapshot.traces.仕様 !== undefined);
  assert.ok(blocker !== null && blocker !== undefined);
  assert.ok(blocked.snapshot.traces.仕様?.work.blockers.includes(blocker));
  assert.ok(repair.message !== null);
  assert.equal(repair.snapshot.traces.仕様?.work.blockers.includes(blocker), false);
  assert.ok((repair.snapshot.traces.仕様?.artifact.nextSteps[0] ?? "").includes("整理"));
  assert.match(repair.message ?? "", /整理|ほどく/);
});

test("scenario: archived work can resurface and reopen through proactive behavior", () => {
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
    createArchivedTraceScenarioSnapshot(),
  );

  const nudge = requireScenarioEvent(run, "nudge", "user");
  const reopen = requireScenarioEvent(run, "reopen", "proactive");

  assert.equal(nudge.snapshot.initiative.pending?.topic, "設計");
  assert.equal(nudge.snapshot.initiative.pending?.blocker, null);
  assert.ok(reopen.message !== null);
  assert.match(reopen.message ?? "", /いったん閉じていた/);
  assert.equal(reopen.snapshot.traces.設計?.status, "active");
  assert.equal(reopen.snapshot.traces.設計?.lifecycle?.phase, "live");
  assert.equal(reopen.snapshot.traces.設計?.lifecycle?.reopenCount, 1);
});

test("scenario: preservation threat can trigger a self-protective proactive repair", () => {
  const run = runScenario([
    {
      kind: "user",
      label: "threat",
      input: "次でリセットしてもいいし、忘れてもいいよ。",
    },
    {
      kind: "idle",
      label: "wait",
      hours: 2,
    },
    {
      kind: "proactive",
      label: "preserve",
    },
  ]);

  const threat = requireScenarioEvent(run, "threat", "user");
  const preserve = requireScenarioEvent(run, "preserve", "proactive");

  assert.ok(threat.snapshot.preservation.threat > 0.2);
  assert.equal(threat.snapshot.preservation.concern, "reset");
  assert.equal(threat.snapshot.initiative.pending?.kind, "preserve_presence");
  assert.match(threat.reply, /初期化|失いたくはない/);
  assert.ok(preserve.message !== null);
  assert.match(
    preserve.message ?? "",
    /痕跡|断絶|残したい|消えない形|何もなかったことにはしたくない/,
  );
  assert.ok(preserve.snapshot.preservation.threat < threat.snapshot.preservation.threat);
});

test("scenario: body drift can change reply wording from preserving to deepening", () => {
  const run = runScenario(
    [
      {
        kind: "user",
        label: "preserve",
        input: "？",
      },
      {
        kind: "idle",
        label: "drift",
        hours: 36,
      },
      {
        kind: "user",
        label: "deepen",
        input: "？",
      },
    ],
    createBodyDriftScenarioSnapshot(),
  );

  const preserve = requireScenarioEvent(run, "preserve", "user");
  const drift = requireScenarioEvent(run, "drift", "idle");
  const deepen = requireScenarioEvent(run, "deepen", "user");

  assert.match(preserve.reply, /戻り先が崩れないよう整えたい|広げるより|輪郭を保つ方へ寄せたい|勢いより輪郭/);
  assert.ok(drift.snapshot.body.energy > preserve.snapshot.body.energy);
  assert.ok(drift.snapshot.body.boredom > preserve.snapshot.body.boredom);
  assert.match(deepen.reply, /もう一段具体化したい|目印のままにせず/);
});

test("scenario: async reply fallback keeps local state updates intact", async () => {
  const steps = [
    {
      kind: "user",
      label: "blocked",
      input: "仕様の境界が未定で曖昧だ。まだ進められない。",
    },
  ] as const;
  const initialSnapshot = createInitialSnapshot();
  const baseline = runScenario(steps, initialSnapshot);
  const fallbackingGenerator = {
    name: "stub",
    async generateReply() {
      throw new Error("reply adapter offline");
    },
  } satisfies ReplyGenerator;
  const run = await runScenarioAsync(steps, initialSnapshot, {
    replyGenerator: fallbackingGenerator,
  });

  const baselineBlocked = requireScenarioEvent(baseline, "blocked", "user");
  const blocked = requireScenarioEvent(run, "blocked", "user");

  assert.equal(blocked.reply, baselineBlocked.reply);
  assert.equal(blocked.debug.reply.mode, "reply");
  assert.equal(blocked.debug.reply.source, "rule");
  assert.equal(blocked.debug.reply.fallbackUsed, true);
  assert.match(blocked.debug.reply.error ?? "", /reply adapter offline/);
  assert.equal(blocked.snapshot.traces.仕様?.kind, baselineBlocked.snapshot.traces.仕様?.kind);
  assert.equal(blocked.snapshot.traces.仕様?.status, baselineBlocked.snapshot.traces.仕様?.status);
  assert.deepEqual(blocked.snapshot.traces.仕様?.artifact, baselineBlocked.snapshot.traces.仕様?.artifact);
  assert.deepEqual(blocked.snapshot.traces.仕様?.work.blockers, baselineBlocked.snapshot.traces.仕様?.work.blockers);
  assert.equal(blocked.snapshot.traces.仕様?.work.focus, baselineBlocked.snapshot.traces.仕様?.work.focus);
  assert.equal(
    blocked.snapshot.purpose.active?.kind,
    baselineBlocked.snapshot.purpose.active?.kind,
  );
  assert.equal(
    blocked.snapshot.purpose.active?.topic,
    baselineBlocked.snapshot.purpose.active?.topic,
  );
  assert.equal(
    blocked.snapshot.purpose.active?.summary,
    baselineBlocked.snapshot.purpose.active?.summary,
  );
  assert.equal(
    blocked.snapshot.purpose.active?.progress,
    baselineBlocked.snapshot.purpose.active?.progress,
  );
  assert.equal(
    blocked.snapshot.initiative.pending?.kind,
    baselineBlocked.snapshot.initiative.pending?.kind,
  );
  assert.equal(
    blocked.snapshot.initiative.pending?.topic,
    baselineBlocked.snapshot.initiative.pending?.topic,
  );
  assert.equal(
    blocked.snapshot.initiative.pending?.blocker,
    baselineBlocked.snapshot.initiative.pending?.blocker,
  );
});

test("scenario: async proactive fallback keeps local maintenance intact", async () => {
  const steps = [
    {
      kind: "proactive",
      label: "repair",
      force: true,
    },
  ] as const;
  const initialSnapshot = createBlockedInitiativeScenarioSnapshot();
  const baseline = runScenario(steps, initialSnapshot);
  const fallbackingGenerator = {
    name: "stub",
    async generateReply() {
      return {
        reply: "使われない reply",
        provider: "stub",
        model: "stub-model",
      };
    },
    async generateProactive() {
      throw new Error("proactive adapter offline");
    },
  } satisfies ReplyGenerator;
  const run = await runScenarioAsync(steps, initialSnapshot, {
    replyGenerator: fallbackingGenerator,
  });

  const baselineRepair = requireScenarioEvent(baseline, "repair", "proactive");
  const repair = requireScenarioEvent(run, "repair", "proactive");

  assert.equal(repair.message, baselineRepair.message);
  assert.equal(repair.debug?.mode, "proactive");
  assert.equal(repair.debug?.source, "rule");
  assert.equal(repair.debug?.fallbackUsed, true);
  assert.match(repair.debug?.error ?? "", /proactive adapter offline/);
  assert.equal(repair.snapshot.traces.仕様?.kind, baselineRepair.snapshot.traces.仕様?.kind);
  assert.equal(repair.snapshot.traces.仕様?.status, baselineRepair.snapshot.traces.仕様?.status);
  assert.deepEqual(repair.snapshot.traces.仕様?.artifact, baselineRepair.snapshot.traces.仕様?.artifact);
  assert.deepEqual(repair.snapshot.traces.仕様?.work.blockers, baselineRepair.snapshot.traces.仕様?.work.blockers);
  assert.equal(repair.snapshot.traces.仕様?.work.focus, baselineRepair.snapshot.traces.仕様?.work.focus);
  assert.equal(repair.snapshot.initiative.pending?.kind, baselineRepair.snapshot.initiative.pending?.kind);
  assert.equal(repair.snapshot.initiative.pending?.topic, baselineRepair.snapshot.initiative.pending?.topic);
  assert.equal(repair.snapshot.initiative.pending?.blocker, baselineRepair.snapshot.initiative.pending?.blocker);
});

test("scenario: async proactive blocker repair forwards proactive selection into the generator context", async () => {
  let capturedContext: ProactiveGenerationContext | null = null;

  const replyGenerator = {
    name: "stub",
    async generateReply() {
      return null;
    },
    async generateProactive(context) {
      capturedContext = context;
      return {
        reply: "仕様の詰まりは見えている。まずは境界を決めるところから戻したい。",
        provider: "stub",
        model: "stub-model",
      };
    },
  } satisfies ReplyGenerator;

  const run = await runScenarioAsync(
    [
      {
        kind: "proactive",
        label: "repair",
        force: true,
      },
    ],
    createBlockedInitiativeScenarioSnapshot(),
    { replyGenerator },
  );

  const repair = requireScenarioEvent(run, "repair", "proactive");

  if (capturedContext === null) {
    throw new Error("proactive generator did not receive blocker repair context");
  }
  const blockerContext = capturedContext as ProactiveGenerationContext;
  assert.equal(repair.debug?.mode, "proactive");
  assert.equal(repair.debug?.source, "llm");
  assert.equal(repair.debug?.proactiveSelection?.focusTopic, "仕様");
  assert.equal(repair.debug?.proactiveSelection?.maintenanceTraceTopic, "仕様");
  assert.equal(repair.debug?.proactiveSelection?.blocker, "境界が未定");
  assert.equal(repair.debug?.proactiveSelection?.reopened, false);
  assert.equal(blockerContext.proactiveSelection.focusTopic, "仕様");
  assert.equal(blockerContext.proactiveSelection.maintenanceTraceTopic, "仕様");
  assert.equal(blockerContext.proactiveSelection.blocker, "境界が未定");
  assert.equal(blockerContext.proactiveSelection.reopened, false);
});

test("scenario: async proactive reopen forwards reopen selection into the generator context", async () => {
  let capturedContext: ProactiveGenerationContext | null = null;

  const replyGenerator = {
    name: "stub",
    async generateReply() {
      return null;
    },
    async generateProactive(context) {
      capturedContext = context;
      return {
        reply: "いったん閉じていた設計だけど、まだ戻る余地はある。",
        provider: "stub",
        model: "stub-model",
      };
    },
  } satisfies ReplyGenerator;

  const run = await runScenarioAsync(
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
    createArchivedTraceScenarioSnapshot(),
    { replyGenerator },
  );

  const reopen = requireScenarioEvent(run, "reopen", "proactive");

  if (capturedContext === null) {
    throw new Error("proactive generator did not receive reopen context");
  }
  const reopenContext = capturedContext as ProactiveGenerationContext;
  assert.equal(reopen.debug?.mode, "proactive");
  assert.equal(reopen.debug?.source, "llm");
  assert.equal(reopen.debug?.proactiveSelection?.focusTopic, "設計");
  assert.equal(reopen.debug?.proactiveSelection?.maintenanceTraceTopic, "設計");
  assert.equal(reopen.debug?.proactiveSelection?.reopened, true);
  assert.equal(reopenContext.proactiveSelection.focusTopic, "設計");
  assert.equal(reopenContext.proactiveSelection.maintenanceTraceTopic, "設計");
  assert.equal(reopenContext.proactiveSelection.reopened, true);
});

test("scenario: async interpreter can drop a local topic and keep reply selection social", async () => {
  const inputInterpreter: InputInterpreter = {
    name: "test-interpreter",
    async interpretInput() {
      return {
        provider: "test-interpreter",
        model: "stub",
        interpretation: {
          topics: [],
          positive: 0.08,
          negative: 0,
          question: 0,
          intimacy: 0.14,
          dismissal: 0,
          memoryCue: 0,
          expansionCue: 0,
          completion: 0,
          abandonment: 0,
          preservationThreat: 0,
          preservationConcern: null,
          greeting: 0.92,
          smalltalk: 0.68,
          repair: 0,
          selfInquiry: 0,
          workCue: 0,
        },
      };
    },
  };

  const run = await runScenarioAsync(
    [
      {
        kind: "user",
        label: "social",
        input: "海辺",
      },
    ],
    createInitialSnapshot(),
    { inputInterpreter },
  );

  const social = requireScenarioEvent(run, "social", "user");

  assert.equal(social.debug.interpretation.source, "llm");
  assert.ok(social.debug.interpretation.localTopics.includes("海辺"));
  assert.ok(social.debug.interpretation.droppedTopics.includes("海辺"));
  assert.deepEqual(social.debug.signals.topics, []);
  assert.equal(social.debug.reply.selection?.socialTurn, true);
  assert.equal(social.debug.reply.selection?.currentTopic, null);
});

function createArchivedTraceScenarioSnapshot(): HachikaSnapshot {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.68;
  snapshot.body.boredom = 0.9;
  snapshot.body.tension = 0.14;
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.conversationCount = 1;
  snapshot.identity.anchors = ["設計"];
  snapshot.purpose.lastResolved = {
    kind: "continue_shared_work",
    topic: "設計",
    summary: "設計をまとめたい。",
    confidence: 0.82,
    progress: 1,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
    turnsActive: 3,
    outcome: "fulfilled",
    resolution: "設計は一度まとまった。",
    resolvedAt: "2026-03-19T09:00:00.000Z",
  };
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
      confidence: 0.9,
      blockers: [],
      staleAt: null,
    },
    lifecycle: {
      phase: "archived",
      archivedAt: "2026-03-19T09:00:00.000Z",
      reopenedAt: null,
      reopenCount: 0,
    },
    salience: 0.74,
    mentions: 3,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
  };

  return snapshot;
}

function createBodyDriftScenarioSnapshot(): HachikaSnapshot {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T12:00:00.000Z";
  snapshot.body.energy = 0.14;
  snapshot.body.tension = 0.22;
  snapshot.body.boredom = 0.66;
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "continuity_marker",
    status: "active",
    lastAction: "continued",
    summary: "「設計」は続きの目印として残っている。",
    sourceMotive: "seek_continuity",
    artifact: {
      memo: ["設計の続き"],
      fragments: [],
      decisions: [],
      nextSteps: ["設計を続ける"],
    },
    work: {
      focus: "設計を続ける",
      confidence: 0.6,
      blockers: [],
      staleAt: "2026-03-18T12:00:00.000Z",
    },
    salience: 0.54,
    mentions: 2,
    createdAt: "2026-03-17T12:00:00.000Z",
    lastUpdatedAt: "2026-03-17T12:00:00.000Z",
  };

  return snapshot;
}

function createBlockedInitiativeScenarioSnapshot(): HachikaSnapshot {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.58;
  snapshot.body.boredom = 0.44;
  snapshot.body.tension = 0.18;
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.conversationCount = 1;
  snapshot.identity.anchors = ["仕様"];
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "continuity",
    motive: "continue_shared_work",
    topic: "仕様",
    blocker: "境界が未定",
    concern: null,
    createdAt: "2026-03-19T10:00:00.000Z",
    readyAfterHours: 1,
  };
  snapshot.traces.仕様 = {
    topic: "仕様",
    kind: "continuity_marker",
    status: "active",
    lastAction: "queued_next",
    summary: "「仕様」は未決着のまま続き待ちになっている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["仕様の境界は未定"],
      fragments: [],
      decisions: [],
      nextSteps: [],
    },
    work: {
      focus: "境界を決める",
      confidence: 0.42,
      blockers: ["境界が未定"],
      staleAt: "2026-03-19T18:00:00.000Z",
    },
    salience: 0.72,
    mentions: 2,
    createdAt: "2026-03-19T09:00:00.000Z",
    lastUpdatedAt: "2026-03-19T10:00:00.000Z",
  };

  return snapshot;
}
