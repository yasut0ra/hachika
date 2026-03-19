import assert from "node:assert/strict";
import test from "node:test";

import { requireScenarioEvent, runScenario } from "./scenario-harness.js";
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

  assert.match(preserve.reply, /戻り先が崩れないよう整えたい|広げるより/);
  assert.ok(drift.snapshot.body.energy > preserve.snapshot.body.energy);
  assert.ok(drift.snapshot.body.boredom > preserve.snapshot.body.boredom);
  assert.match(deepen.reply, /もう一段具体化したい|目印のままにせず/);
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
