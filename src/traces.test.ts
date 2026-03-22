import assert from "node:assert/strict";
import test from "node:test";

import { createInitialSnapshot } from "./state.js";
import { sortedTraces, tendTraceFromInitiative, updateTraces } from "./traces.js";
import type {
  HachikaSnapshot,
  InteractionSignals,
  SelfModel,
  TraceEntry,
} from "./types.js";

test("low energy prioritizes continuity traces over open curiosity traces", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.body.energy = 0.08;
  snapshot.body.tension = 0.22;
  snapshot.body.loneliness = 0.36;
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
      confidence: 0.72,
      blockers: [],
      staleAt: "2026-03-20T10:00:00.000Z",
    },
    salience: 0.56,
    mentions: 2,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
  };
  snapshot.traces.実験 = {
    topic: "実験",
    kind: "note",
    status: "forming",
    lastAction: "captured",
    summary: "「実験」はメモとして残っている。",
    sourceMotive: "pursue_curiosity",
    artifact: {
      memo: ["実験の仮説"],
      fragments: [],
      decisions: [],
      nextSteps: [],
    },
    work: {
      focus: "実験の仮説",
      confidence: 0.32,
      blockers: ["方向が未定"],
      staleAt: "2026-03-18T10:00:00.000Z",
    },
    salience: 0.64,
    mentions: 1,
    createdAt: "2026-03-19T08:30:00.000Z",
    lastUpdatedAt: "2026-03-19T09:30:00.000Z",
  };

  const traces = sortedTraces(snapshot, 2);

  assert.equal(traces[0]?.topic, "設計");
  assert.equal(traces[1]?.topic, "実験");
});

test("high boredom prioritizes stale unresolved work in trace ordering", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.body.energy = 0.62;
  snapshot.body.boredom = 0.84;
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
    salience: 0.76,
    mentions: 3,
    createdAt: "2026-03-19T07:00:00.000Z",
    lastUpdatedAt: "2026-03-19T08:00:00.000Z",
  };
  snapshot.traces.仕様 = {
    topic: "仕様",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「仕様」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["仕様を詰める"],
      fragments: ["境界を整理する"],
      decisions: [],
      nextSteps: ["責務を切り分ける"],
    },
    work: {
      focus: "責務を切り分ける",
      confidence: 0.48,
      blockers: ["責務が未定"],
      staleAt: "2026-03-18T10:00:00.000Z",
    },
    salience: 0.62,
    mentions: 2,
    createdAt: "2026-03-19T07:30:00.000Z",
    lastUpdatedAt: "2026-03-19T08:30:00.000Z",
  };

  const traces = sortedTraces(snapshot, 2);

  assert.equal(traces[0]?.topic, "仕様");
  assert.equal(traces[1]?.topic, "設計");
});

test("body can shift trace motive toward leave_trace when energy is low", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.1;
  snapshot.lastInteractionAt = "2026-03-19T12:00:00.000Z";
  const trace = updateTraces(
    snapshot,
    "設計を進めたいし、仕様として残したい。",
    createSignals({
      expansionCue: 0.32,
      topics: ["設計"],
    }),
    createSelfModel([
      { kind: "continue_shared_work", score: 0.72, topic: "設計", reason: "設計を前に進めたい" },
      { kind: "leave_trace", score: 0.68, topic: "設計", reason: "設計を残したい" },
      { kind: "seek_continuity", score: 0.54, topic: "設計", reason: "設計の流れを切りたくない" },
    ]),
    "2026-03-19T12:00:00.000Z",
  );

  assert.ok(trace !== null);
  assert.equal(trace?.sourceMotive, "leave_trace");
  assert.equal(trace?.kind, "spec_fragment");
});

test("structured trace extraction can supply blockers and next steps to updateTraces", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T12:00:00.000Z";

  const trace = updateTraces(
    snapshot,
    "仕様の境界が曖昧だ。",
    createSignals({
      workCue: 0.48,
      topics: [],
    }),
    createSelfModel([
      { kind: "continue_shared_work", score: 0.72, topic: "仕様の境界", reason: "境界を決めたい" },
    ]),
    "2026-03-19T12:00:00.000Z",
    {
      topics: ["仕様の境界"],
      kindHint: "spec_fragment",
      completion: 0,
      blockers: ["責務が未定"],
      memo: ["仕様の境界を見直す"],
      fragments: ["責務を切り分ける"],
      decisions: [],
      nextSteps: ["API の責務を分ける"],
    },
  );

  assert.equal(trace?.topic, "仕様の境界");
  assert.equal(trace?.kind, "spec_fragment");
  assert.ok(trace?.work.blockers.includes("責務が未定"));
  assert.ok(trace?.artifact.nextSteps.includes("API の責務を分ける"));
});

test("low energy maintenance preserves a resume as continuity instead of deepening it", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.08;
  snapshot.body.tension = 0.26;
  snapshot.lastInteractionAt = "2026-03-19T02:00:00.000Z";

  const maintenance = tendTraceFromInitiative(
    snapshot,
    {
      kind: "resume_topic",
      motive: "continue_shared_work",
      topic: "設計",
      blocker: null,
      concern: null,
    },
    "2026-03-19T02:30:00.000Z",
  );

  assert.ok(maintenance !== null);
  assert.equal(maintenance?.action, "created");
  assert.equal(snapshot.traces.設計?.kind, "continuity_marker");
  assert.equal(snapshot.traces.設計?.artifact.fragments.length, 0);
  assert.ok((snapshot.traces.設計?.artifact.nextSteps.length ?? 0) > 0);
});

test("high boredom maintenance deepens a continuity trace into a fragment", () => {
  const snapshot = createTraceSnapshot({
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
      nextSteps: ["設計をつなぎ直す"],
    },
    work: {
      focus: "設計をつなぎ直す",
      confidence: 0.54,
      blockers: ["責務が未定"],
      staleAt: "2026-03-18T01:00:00.000Z",
    },
    salience: 0.58,
    mentions: 2,
    createdAt: "2026-03-19T00:00:00.000Z",
    lastUpdatedAt: "2026-03-19T01:00:00.000Z",
  });
  snapshot.body.energy = 0.66;
  snapshot.body.boredom = 0.84;
  snapshot.body.tension = 0.16;

  const maintenance = tendTraceFromInitiative(
    snapshot,
    {
      kind: "resume_topic",
      motive: "continue_shared_work",
      topic: "設計",
      blocker: "責務が未定",
      concern: null,
    },
    "2026-03-19T02:00:00.000Z",
  );

  assert.ok(maintenance !== null);
  assert.equal(maintenance?.action, "stabilized_fragment");
  assert.equal(snapshot.traces.設計?.kind, "spec_fragment");
  assert.ok((snapshot.traces.設計?.artifact.fragments.length ?? 0) > 0);
  assert.ok((snapshot.traces.設計?.work.confidence ?? 0) > 0.54);
});

test("trace maintenance can promote a fulfilled topic into a decision", () => {
  const snapshot = createTraceSnapshot({
    topic: "設計",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「設計」は「API を分ける」という断片として残す。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["設計の断片を残す"],
      fragments: ["API を分ける"],
      decisions: [],
      nextSteps: [],
    },
    work: {
      focus: "API を分ける",
      confidence: 0.62,
      blockers: ["責務分割が未定"],
      staleAt: "2026-03-20T00:30:00.000Z",
    },
    salience: 0.72,
    mentions: 2,
    createdAt: "2026-03-19T00:00:00.000Z",
    lastUpdatedAt: "2026-03-19T00:30:00.000Z",
  });

  snapshot.purpose.lastResolved = {
    kind: "continue_shared_work",
    topic: "設計",
    summary: "設計をまとめたい。",
    confidence: 0.82,
    progress: 1,
    createdAt: "2026-03-19T00:00:00.000Z",
    lastUpdatedAt: "2026-03-19T00:30:00.000Z",
    turnsActive: 3,
    outcome: "fulfilled",
    resolution: "設計は記録としてまとまった。",
    resolvedAt: "2026-03-19T01:00:00.000Z",
  };

  const maintenance = tendTraceFromInitiative(
    snapshot,
    {
      kind: "resume_topic",
      motive: "leave_trace",
      topic: "設計",
      blocker: null,
      concern: null,
    },
    "2026-03-19T01:30:00.000Z",
  );

  assert.ok(maintenance !== null);
  assert.equal(maintenance?.action, "promoted_decision");
  assert.equal(snapshot.traces.設計?.kind, "decision");
  assert.ok((snapshot.traces.設計?.artifact.decisions.length ?? 0) > 0);
  assert.equal(snapshot.traces.設計?.work.blockers.length, 0);
  assert.equal(snapshot.traces.設計?.work.staleAt, null);
  assert.match(snapshot.traces.設計?.summary ?? "", /決定|まとまった/);
});

test("resolved decision trace can archive when it no longer has open work", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T12:00:00.000Z";

  const trace = updateTraces(
    snapshot,
    "設計は決まった。保存した。",
    createSignals({
      completion: 0.74,
      expansionCue: 0.22,
      topics: ["設計"],
    }),
    createSelfModel([
      { kind: "leave_trace", score: 0.74, topic: "設計", reason: "決まった形として残したい" },
    ]),
    "2026-03-19T12:00:00.000Z",
  );

  assert.ok(trace !== null);
  assert.equal(trace?.kind, "decision");
  assert.equal(trace?.status, "resolved");
  assert.equal(trace?.lifecycle?.phase, "archived");
  assert.equal(trace?.work.blockers.length, 0);
  assert.equal(trace?.artifact.nextSteps.length, 0);
});

test("social acknowledgements do not become trace decisions or vague next steps", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T12:00:00.000Z";

  const trace = updateTraces(
    snapshot,
    "いいね。深い話でもする？何がいいかな。",
    createSignals({
      completion: 0.3,
      topics: ["会話"],
    }),
    createSelfModel([
      { kind: "leave_trace", score: 0.68, topic: "会話", reason: "会話を残したい" },
      { kind: "deepen_relation", score: 0.62, topic: "会話", reason: "会話の温度を残したい" },
      { kind: "pursue_curiosity", score: 0.54, topic: "会話", reason: "会話の揺れを見たい" },
    ]),
    "2026-03-19T12:00:00.000Z",
  );

  assert.ok(trace !== null);
  assert.notEqual(trace?.kind, "decision");
  assert.ok(!(trace?.artifact.decisions ?? []).includes("いいね"));
  assert.ok(!(trace?.artifact.decisions ?? []).includes("深い話でもする"));
  assert.ok(!(trace?.artifact.nextSteps ?? []).includes("何がいいかな"));
});

test("archived decision trace can reopen into active work on continuation cues", () => {
  const snapshot = createTraceSnapshot({
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
      archivedAt: "2026-03-19T08:00:00.000Z",
      reopenedAt: null,
      reopenCount: 0,
    },
    salience: 0.76,
    mentions: 3,
    createdAt: "2026-03-19T07:00:00.000Z",
    lastUpdatedAt: "2026-03-19T08:00:00.000Z",
  });

  const trace = updateTraces(
    snapshot,
    "設計の続きを進めたい。仕様としてもう少し詰める。",
    createSignals({
      memoryCue: 0.24,
      expansionCue: 0.28,
      topics: ["設計"],
    }),
    createSelfModel([
      { kind: "continue_shared_work", score: 0.78, topic: "設計", reason: "設計を前に進めたい" },
      { kind: "seek_continuity", score: 0.61, topic: "設計", reason: "設計の流れを戻したい" },
    ]),
    "2026-03-19T12:00:00.000Z",
  );

  assert.ok(trace !== null);
  assert.equal(trace?.kind, "spec_fragment");
  assert.equal(trace?.status, "active");
  assert.equal(trace?.lifecycle?.phase, "live");
  assert.equal(trace?.lifecycle?.reopenCount, 1);
  assert.equal(trace?.lifecycle?.reopenedAt, "2026-03-19T12:00:00.000Z");
});

test("initiative can reopen an archived decision into a live continuity trace", () => {
  const snapshot = createTraceSnapshot({
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
      archivedAt: "2026-03-19T08:00:00.000Z",
      reopenedAt: null,
      reopenCount: 0,
    },
    salience: 0.76,
    mentions: 3,
    createdAt: "2026-03-19T07:00:00.000Z",
    lastUpdatedAt: "2026-03-19T08:00:00.000Z",
  });
  snapshot.body.energy = 0.12;
  snapshot.body.tension = 0.22;

  const maintenance = tendTraceFromInitiative(
    snapshot,
    {
      kind: "resume_topic",
      motive: "seek_continuity",
      topic: "設計",
      blocker: null,
      concern: null,
    },
    "2026-03-19T13:00:00.000Z",
  );

  assert.ok(maintenance !== null);
  assert.equal(snapshot.traces.設計?.kind, "continuity_marker");
  assert.equal(snapshot.traces.設計?.status, "active");
  assert.equal(snapshot.traces.設計?.lifecycle?.phase, "live");
  assert.equal(snapshot.traces.設計?.lifecycle?.reopenCount, 1);
});

function createTraceSnapshot(trace: TraceEntry): HachikaSnapshot {
  const snapshot = createInitialSnapshot();
  snapshot.traces[trace.topic] = trace;
  snapshot.lastInteractionAt = trace.lastUpdatedAt;
  return snapshot;
}

function createSignals(
  overrides: Partial<InteractionSignals> = {},
): InteractionSignals {
  return {
    positive: 0,
    negative: 0,
    question: 0,
    novelty: 0,
    intimacy: 0,
    dismissal: 0,
    memoryCue: 0,
    expansionCue: 0,
    completion: 0,
    abandonment: 0,
    preservationThreat: 0,
    preservationConcern: null,
    repetition: 0,
    neglect: 0,
    greeting: 0,
    smalltalk: 0,
    repair: 0,
    selfInquiry: 0,
    worldInquiry: 0,
    workCue: 0,
    topics: [],
    ...overrides,
  };
}

function createSelfModel(motives: SelfModel["topMotives"]): SelfModel {
  return {
    narrative: "test",
    topMotives: motives,
    conflicts: [],
    dominantConflict: null,
  };
}
