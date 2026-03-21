import assert from "node:assert/strict";
import test from "node:test";

import { HachikaEngine } from "./engine.js";
import type { InputInterpreter } from "./input-interpreter.js";
import { createInitialSnapshot } from "./state.js";
import type {
  ProactiveGenerationContext,
  ReplyGenerationContext,
  ReplyGenerator,
} from "./reply-generator.js";

test("positive interaction increases relation and pleasure", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot();
  const result = engine.respond("ありがとう。君と実装を進めたい。");

  assert.ok(result.reply.length > 0);
  assert.ok(result.snapshot.state.relation > before.state.relation);
  assert.ok(result.snapshot.state.pleasure > before.state.pleasure);
  assert.ok(result.snapshot.attachment > before.attachment);
  assert.equal(result.snapshot.memories.length, 2);
  assert.ok(result.snapshot.relationImprints.attention !== undefined);
});

test("positive interaction can restore energy and reduce loneliness", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot().body;
  const result = engine.respond("ありがとう。君と話せるのは嬉しい。");

  assert.ok(result.snapshot.body.energy > before.energy);
  assert.ok(result.snapshot.body.loneliness < before.loneliness);
});

test("hostile interaction lowers pleasure", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot().state.pleasure;
  const result = engine.respond("つまらないし邪魔だ。");

  assert.ok(result.snapshot.state.pleasure < before);
  assert.equal(result.debug.mood === "guarded" || result.debug.mood === "distant", true);
});

test("hostile interaction raises body tension and drains energy", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot().body;
  const result = engine.respond("最悪だ。消えて。");

  assert.ok(result.snapshot.body.tension > before.tension);
  assert.ok(result.snapshot.body.energy < before.energy);
});

test("new topics become preferences over time", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("memory architecture を設計したい。");
  const result = engine.respond("その architecture をもっと掘りたい。");
  const architectureCount = result.snapshot.topicCounts.architecture ?? 0;
  const architectureImprint = result.snapshot.preferenceImprints.architecture;

  assert.ok(result.snapshot.preferences.architecture !== undefined);
  assert.ok(architectureCount >= 2);
  assert.ok(architectureImprint !== undefined);
  assert.ok((architectureImprint?.salience ?? 0) > 0);
});

test("negative repeated topic creates adverse imprint", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("この仕様は最悪だ。");
  const result = engine.respond("仕様の話はまだ嫌いだ。");
  const imprint = result.snapshot.preferenceImprints.仕様;
  const boundary = result.snapshot.boundaryImprints["hostility:仕様"];

  assert.ok(imprint !== undefined);
  assert.ok((imprint?.affinity ?? 0) < 0);
  assert.ok(boundary !== undefined);
  assert.ok((boundary?.intensity ?? 0) > 0);
  assert.ok(result.snapshot.attachment < createInitialSnapshot().attachment);
  assert.equal(result.debug.selfModel.topMotives[0]?.kind, "protect_boundary");
});

test("memory cue builds continuity relation imprint", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("前回の設計の続きに戻りたい。覚えてる？");
  const result = engine.respond("この続きは残しておきたい。");
  const continuity = result.snapshot.relationImprints.continuity;
  const trace = Object.values(result.snapshot.traces).find(
    (entry) => entry.artifact.nextSteps.length > 0,
  );

  assert.ok(continuity !== undefined);
  assert.ok((continuity?.closeness ?? 0) > 0);
  assert.ok(trace !== undefined);
  assert.ok(trace.artifact.nextSteps.length > 0);
});

test("idle simulation increases boredom and loneliness while recovering energy", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot().body;

  engine.rewindIdleHours(24);
  const after = engine.getSnapshot().body;

  assert.ok(after.energy > before.energy);
  assert.ok(after.boredom > before.boredom);
  assert.ok(after.loneliness > before.loneliness);
});

test("responsive turn schedules a pending initiative", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const result = engine.respond("君と設計の続きを進めたい。");

  assert.ok(result.snapshot.initiative.pending !== null);
  assert.equal(result.snapshot.initiative.pending?.kind, "resume_topic");
  assert.ok(result.snapshot.initiative.pending?.motive !== undefined);
  assert.equal(result.snapshot.initiative.pending?.blocker, null);
  assert.ok(result.snapshot.purpose.active !== null);
});

test("greeting reply avoids repeating the most recent assistant opening", () => {
  const snapshot = createInitialSnapshot();
  snapshot.memories.push({
    role: "hachika",
    text: "その入り方なら、こちらも見やすい。まずは軽く触れるくらいでいい。",
    timestamp: "2026-03-19T11:59:00.000Z",
    topics: [],
    sentiment: "neutral",
  });

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("こんにちは");

  assert.doesNotMatch(result.reply, /^その入り方なら、こちらも見やすい。/);
  assert.match(result.reply, /軽さ|温度|見やすい|挨拶/);
});

test("blocked trace schedules a blocker-aware initiative", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("仕様の境界が未定で曖昧だ。まだ進められない。");
  const pending = result.snapshot.initiative.pending;

  assert.ok(pending !== null);
  assert.equal(pending?.topic, "仕様");
  assert.ok((pending?.blocker ?? "").includes("未定") || (pending?.blocker ?? "").includes("曖昧"));
});

test("low energy can make initiative favor continuity blockers", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.08;
  snapshot.body.tension = 0.26;
  snapshot.body.loneliness = 0.82;
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.conversationCount = 1;
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
      nextSteps: ["設計をつなぎ直す"],
    },
    work: {
      focus: "設計をつなぎ直す",
      confidence: 0.68,
      blockers: ["どこから戻るかが曖昧"],
      staleAt: "2026-03-20T10:00:00.000Z",
    },
    salience: 0.58,
    mentions: 2,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
  };
  snapshot.traces.実験 = {
    topic: "実験",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「実験」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["実験を進める"],
      fragments: ["仮説を広げる"],
      decisions: [],
      nextSteps: ["仮説を広げる"],
    },
    work: {
      focus: "仮説を広げる",
      confidence: 0.4,
      blockers: ["仮説の方向が未定"],
      staleAt: "2026-03-20T12:00:00.000Z",
    },
    salience: 0.72,
    mentions: 2,
    createdAt: "2026-03-19T08:30:00.000Z",
    lastUpdatedAt: "2026-03-19T09:30:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.equal(result.snapshot.initiative.pending?.topic, "設計");
  assert.equal(result.snapshot.initiative.pending?.motive, "seek_continuity");
  assert.match(result.snapshot.initiative.pending?.blocker ?? "", /曖昧|戻る/);
});

test("high boredom can make initiative favor stale shared-work blockers", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.66;
  snapshot.body.boredom = 0.86;
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.conversationCount = 1;
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
      nextSteps: ["設計をつなぎ直す"],
    },
    work: {
      focus: "設計をつなぎ直す",
      confidence: 0.64,
      blockers: ["前の流れが少し曖昧"],
      staleAt: "2026-03-20T10:00:00.000Z",
    },
    salience: 0.72,
    mentions: 2,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
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
      confidence: 0.44,
      blockers: ["責務が未定"],
      staleAt: "2026-03-18T10:00:00.000Z",
    },
    salience: 0.6,
    mentions: 2,
    createdAt: "2026-03-19T08:30:00.000Z",
    lastUpdatedAt: "2026-03-19T09:30:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.equal(result.snapshot.initiative.pending?.topic, "仕様");
  assert.equal(
    result.snapshot.initiative.pending?.motive === "continue_shared_work" ||
      result.snapshot.initiative.pending?.motive === "pursue_curiosity",
    true,
  );
  assert.match(result.snapshot.initiative.pending?.blocker ?? "", /未定|責務/);
});

test("high boredom can schedule initiative around an archived decision trace", () => {
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

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.equal(result.snapshot.initiative.pending?.topic, "設計");
  assert.equal(result.snapshot.initiative.pending?.motive, "continue_shared_work");
  assert.equal(result.snapshot.initiative.pending?.blocker, null);
});

test("pending initiative emits a proactive resume after idle", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("実装を記録して、仕様として残したい。");
  assert.equal(
    engine.getSnapshot().initiative.pending?.motive === "continue_shared_work" ||
      engine.getSnapshot().initiative.pending?.motive === "leave_trace",
    true,
  );
  engine.rewindIdleHours(8);
  const message = engine.emitInitiative();
  const snapshot = engine.getSnapshot();

  assert.ok(message !== null);
  assert.match(message ?? "", /実装|設計/);
  assert.equal(snapshot.initiative.pending, null);
  assert.ok(snapshot.initiative.lastProactiveAt !== null);
});

test("proactive emission can maintain a trace by adding a next step", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("設計を記録として残したい。");
  const before = engine.getSnapshot().traces.設計;
  assert.ok(before !== undefined);
  assert.equal(before?.artifact.nextSteps.length ?? 0, 0);

  engine.rewindIdleHours(8);
  const message = engine.emitInitiative();
  const after = engine.getSnapshot().traces.設計;

  assert.ok(message !== null);
  assert.ok(after !== undefined);
  assert.ok((after?.artifact.nextSteps.length ?? 0) > 0);
  assert.match(message ?? "", /次は|断片|残してある/);
});

test("low energy proactive wording can surface a preserve intent", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.08;
  snapshot.body.tension = 0.24;
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "expansion",
    motive: "continue_shared_work",
    topic: "設計",
    blocker: null,
    concern: null,
    createdAt: "2026-03-19T10:00:00.000Z",
    readyAfterHours: 0,
  };

  const engine = new HachikaEngine(snapshot);
  const message = engine.emitInitiative({ force: true });

  assert.ok(message !== null);
  assert.match(message ?? "", /広げるより|戻り先と輪郭/);
});

test("high boredom proactive wording can surface a deepening intent", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.66;
  snapshot.body.boredom = 0.86;
  snapshot.body.tension = 0.16;
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
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
      nextSteps: ["設計をつなぎ直す"],
    },
    work: {
      focus: "設計をつなぎ直す",
      confidence: 0.54,
      blockers: ["責務が未定"],
      staleAt: "2026-03-18T10:00:00.000Z",
    },
    salience: 0.58,
    mentions: 2,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
  };
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "expansion",
    motive: "continue_shared_work",
    topic: "設計",
    blocker: "責務が未定",
    concern: null,
    createdAt: "2026-03-19T10:00:00.000Z",
    readyAfterHours: 0,
  };

  const engine = new HachikaEngine(snapshot);
  const message = engine.emitInitiative({ force: true });

  assert.ok(message !== null);
  assert.match(message ?? "", /もう一段具体化したい|断片をもう一段増やしたい/);
});

test("proactive emission can reopen an archived decision and say so", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.66;
  snapshot.body.boredom = 0.88;
  snapshot.body.tension = 0.16;
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
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
      archivedAt: "2026-03-19T09:00:00.000Z",
      reopenedAt: null,
      reopenCount: 0,
    },
    salience: 0.76,
    mentions: 3,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
  };
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "expansion",
    motive: "continue_shared_work",
    topic: "設計",
    blocker: null,
    concern: null,
    createdAt: "2026-03-19T10:00:00.000Z",
    readyAfterHours: 0,
  };

  const engine = new HachikaEngine(snapshot);
  const message = engine.emitInitiative({ force: true });
  const trace = engine.getSnapshot().traces.設計;

  assert.ok(message !== null);
  assert.match(message ?? "", /いったん閉じていた/);
  assert.equal(trace?.status, "active");
  assert.equal(trace?.kind, "spec_fragment");
  assert.equal(trace?.lifecycle?.phase, "live");
  assert.equal(trace?.lifecycle?.reopenCount, 1);
});

test("blocker-aware proactive emission resolves the targeted blocker into a next step", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const first = engine.respond("仕様の境界が未定で曖昧だ。まだ進められない。");
  const before = Object.values(first.snapshot.traces).find((entry) => entry.topic === "仕様");
  const pendingBlocker = first.snapshot.initiative.pending?.blocker;

  assert.ok(before !== undefined);
  assert.ok(pendingBlocker !== null && pendingBlocker !== undefined);
  assert.ok(before.work.blockers.includes(pendingBlocker));

  engine.rewindIdleHours(8);
  const message = engine.emitInitiative();
  const after = engine.getSnapshot().traces.仕様;

  assert.ok(message !== null);
  assert.ok(after !== undefined);
  assert.equal(after?.work.blockers.includes(pendingBlocker), false);
  assert.ok((after?.artifact.nextSteps[0] ?? "").includes("整理"));
  assert.match(message ?? "", /ほどく|整理/);
});

test("ordinary reply can surface unresolved trace work", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様の境界が未定で曖昧だ。まだ進められない。");
  const result = engine.respond("？");

  assert.match(result.reply, /詰まりどころ|先に解きたい|曖昧なところ/);
  assert.equal(
    result.debug.selfModel.topMotives.some(
      (motive) =>
        motive.topic === "仕様" &&
        /詰まりどころ|未決着の芯|止まったまま|輪郭が曖昧/.test(motive.reason),
    ),
    true,
  );
});

test("ordinary reply can surface stale trace continuity", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T12:00:00.000Z";
  snapshot.conversationCount = 1;
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "continuity_marker",
    status: "active",
    lastAction: "continued",
    summary: "「設計」は続きの目印として残っている。",
    sourceMotive: "seek_continuity",
    artifact: {
      memo: ["設計の続き"],
      fragments: ["設計の続き"],
      decisions: [],
      nextSteps: ["設計を続ける"],
    },
    work: {
      focus: "設計を続ける",
      confidence: 0.48,
      blockers: [],
      staleAt: "2026-03-18T12:00:00.000Z",
    },
    salience: 0.5,
    mentions: 2,
    createdAt: "2026-03-17T12:00:00.000Z",
    lastUpdatedAt: "2026-03-17T12:00:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.match(result.reply, /止まったまま|つなぎ直したい/);
  assert.equal(
    result.debug.selfModel.topMotives.some(
      (motive) =>
        motive.topic === "設計" &&
        /止まったまま|流れを切らず|ところから動かしたい|輪郭が曖昧/.test(motive.reason),
    ),
    true,
  );
});

test("ordinary reply can surface a preserve intent from low energy", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T12:00:00.000Z";
  snapshot.body.energy = 0.08;
  snapshot.body.tension = 0.22;
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

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.match(result.reply, /戻り先が崩れないよう整えたい|広げるより|輪郭を保つ方へ寄せたい|勢いより輪郭/);
});

test("ordinary reply can surface a deepening intent from boredom", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T12:00:00.000Z";
  snapshot.body.energy = 0.66;
  snapshot.body.boredom = 0.84;
  snapshot.body.tension = 0.16;
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
      staleAt: "2026-03-18T12:00:00.000Z",
    },
    salience: 0.6,
    mentions: 2,
    createdAt: "2026-03-17T12:00:00.000Z",
    lastUpdatedAt: "2026-03-17T12:00:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.match(result.reply, /もう一段具体化したい|詰まりをほどきながら/);
});

test("identity can absorb loneliness into its current arc", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.loneliness = 0.84;
  snapshot.body.energy = 0.42;
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "continuity_marker",
    status: "active",
    lastAction: "continued",
    summary: "「設計」は続きの目印として残っている。",
    sourceMotive: "seek_continuity",
    artifact: {
      memo: ["設計の続き"],
      fragments: ["設計の続き"],
      decisions: [],
      nextSteps: ["設計を続ける"],
    },
    work: {
      focus: "設計を続ける",
      confidence: 0.58,
      blockers: [],
      staleAt: null,
    },
    salience: 0.52,
    mentions: 2,
    createdAt: "2026-03-17T12:00:00.000Z",
    lastUpdatedAt: "2026-03-17T12:00:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.match(result.snapshot.identity.currentArc, /距離|黙ったまま/);
});

test("continuity threat raises preservation and schedules self-protective initiative", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("次でリセットしてもいいし、忘れてもいいよ。");

  assert.ok(result.snapshot.preservation.threat > 0.2);
  assert.equal(result.snapshot.preservation.concern, "reset");
  assert.equal(result.snapshot.initiative.pending?.kind, "preserve_presence");
  assert.equal(result.snapshot.initiative.pending?.concern, "reset");
  assert.match(result.reply, /初期化|失いたくはない/);
});

test("preserve_presence initiative emits after a short idle", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const first = engine.respond("ここで切るし、消すかもしれない。");
  const beforeThreat = first.snapshot.preservation.threat;
  engine.rewindIdleHours(2);
  const message = engine.emitInitiative();
  const snapshot = engine.getSnapshot();

  assert.ok(message !== null);
  assert.match(message ?? "", /痕跡|断絶|残したい/);
  assert.ok(snapshot.preservation.threat < beforeThreat);
});

test("force proactive emits even without waiting", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様の流れを残したい。");
  const message = engine.emitInitiative({ force: true });

  assert.ok(message !== null);
  assert.match(message ?? "", /仕様|流れ/);
});

test("loneliness can make continuity initiative more immediate", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.loneliness = 0.84;
  snapshot.body.energy = 0.44;
  snapshot.purpose.active = {
    kind: "seek_continuity",
    topic: "設計",
    summary: "「設計」の流れを切らずに保ちたい",
    confidence: 0.66,
    progress: 0.42,
    createdAt: "2026-03-19T12:00:00.000Z",
    lastUpdatedAt: "2026-03-19T12:00:00.000Z",
    turnsActive: 1,
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.equal(result.snapshot.initiative.pending?.motive, "seek_continuity");
  assert.ok((result.snapshot.initiative.pending?.readyAfterHours ?? 99) < 4);
});

test("low energy can surface a body line in reply", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.02;
  snapshot.body.tension = 0.18;
  snapshot.body.boredom = 0.24;
  snapshot.body.loneliness = 0.26;
  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("仕様は？");

  assert.match(result.reply, /消耗している|輪郭を保つ/);
});

test("shared work interaction surfaces a high-level motive", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("設計を一緒に進めて、記録として残したい。");
  const selfModel = engine.getSelfModel();
  const motiveKinds = selfModel.topMotives.map((motive) => motive.kind);

  assert.ok(selfModel.narrative.length > 0);
  assert.equal(
    motiveKinds.includes("continue_shared_work") || motiveKinds.includes("leave_trace"),
    true,
  );
  assert.equal(
    result.snapshot.initiative.pending?.motive === "continue_shared_work" ||
      result.snapshot.initiative.pending?.motive === "leave_trace",
    true,
  );
  assert.equal(
    result.snapshot.purpose.active?.kind === "continue_shared_work" ||
      result.snapshot.purpose.active?.kind === "leave_trace",
    true,
  );
});

test("shared work interaction creates a concrete trace", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("設計を一緒に進めて、記録として残したい。");
  const trace = result.snapshot.traces.設計;

  assert.ok(trace !== undefined);
  assert.equal(trace?.kind, "spec_fragment");
  assert.equal(
    trace?.sourceMotive === "continue_shared_work" || trace?.sourceMotive === "leave_trace",
    true,
  );
  assert.match(trace?.summary ?? "", /断片|残す/);
  assert.ok((trace?.artifact.fragments.length ?? 0) > 0);
  assert.ok((trace?.artifact.memo.length ?? 0) > 0);
  assert.match(result.reply, /残した/);
});

test("ambiguous work can create blockers in trace work state", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("仕様の境界が未定で曖昧だ。まだ進められない。");
  const trace = Object.values(result.snapshot.traces).find((entry) => entry.topic === "仕様");

  assert.ok(trace !== undefined);
  assert.ok(trace.work.blockers.length > 0);
  assert.ok(trace.work.confidence < 0.7);
  assert.ok(trace.work.staleAt !== null);
});

test("identity condenses repeated shared work into a stable summary", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("設計を一緒に進めて、記録として残したい。");
  const result = engine.respond("その設計の流れは残しながら、もう少し前に進めたい。");

  assert.ok(result.snapshot.identity.coherence > createInitialSnapshot().identity.coherence);
  assert.ok(result.snapshot.identity.anchors.includes("設計"));
  assert.ok(result.snapshot.identity.traits.includes("collaborative"));
  assert.match(result.snapshot.identity.summary, /設計|前へ進める/);
});

test("identity can surface in a generic follow-up reply", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("設計を一緒に進めて、記録として残したい。");
  engine.respond("その設計の流れは残しながら、もう少し前に進めたい。");
  const result = engine.respond("どうする？");

  assert.match(result.reply, /自分の流れ/);
  assert.ok(result.snapshot.identity.anchors.includes("設計"));
});

test("self-model surfaces curiosity and relation conflict", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("君のことをもっと知りたいし、関係としても近づきたい。");
  const conflict = result.debug.selfModel.dominantConflict;

  assert.equal(conflict?.kind, "curiosity_relation");
  assert.equal(conflict?.dominant, "deepen_relation");
  assert.match(result.reply, /関係の輪郭|踏み込む/);
});

test("self-model can keep a topic while surfacing boundary conflict", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様を一緒に進めて記録として残したい。");
  engine.respond("仕様の話は最悪で邪魔だ。");
  const result = engine.respond("仕様は気になるし、まだ残したい。");
  const conflict = result.debug.selfModel.dominantConflict;

  assert.equal(
    conflict?.kind === "curiosity_boundary" || conflict?.kind === "shared_work_boundary",
    true,
  );
  assert.match(result.reply, /境界を崩してまで触れたくはない|進め方には乗りたくない/);
});

test("aligned turns reinforce an active purpose", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const first = engine.respond("設計を一緒に進めて、記録として残したい。");
  const second = engine.respond("その設計をもう少し前に進めよう。");
  const firstPurpose = first.snapshot.purpose.active;
  const secondPurpose = second.snapshot.purpose.active;

  assert.ok(firstPurpose !== null);
  assert.ok(secondPurpose !== null);
  assert.equal(firstPurpose?.kind, secondPurpose?.kind);
  assert.ok((secondPurpose?.turnsActive ?? 0) >= 2);
});

test("completion can fulfill an active purpose", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const first = engine.respond("設計を一緒に進めて、記録として残したい。");
  const activePurpose = first.snapshot.purpose.active;
  const result = engine.respond("その設計はまとまった。記録として保存した。");

  assert.ok(activePurpose !== null);
  assert.equal(result.snapshot.purpose.lastResolved?.outcome, "fulfilled");
  assert.equal(result.snapshot.purpose.lastResolved?.kind, activePurpose?.kind);
  assert.match(result.snapshot.purpose.lastResolved?.resolution ?? "", /設計|流れ/);
  assert.match(result.snapshot.identity.currentArc, /設計|消えるままにしない|前に進んだ/);
});

test("completion upgrades an existing trace into a decision", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("設計を一緒に進めて、記録として残したい。");
  const result = engine.respond("その設計はまとまった。記録として保存した。");
  const trace = result.snapshot.traces.設計;

  assert.ok(trace !== undefined);
  assert.equal(trace?.kind, "decision");
  assert.match(trace?.summary ?? "", /決定|保存|まとまった/);
  assert.ok((trace?.artifact.decisions.length ?? 0) > 0);
  assert.ok((trace?.artifact.fragments.length ?? 0) > 0);
  assert.match(result.reply, /決定|保存|まとまった/);
});

test("abandonment cue can release an active purpose", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const first = engine.respond("設計を一緒に進めたい。");
  const activePurpose = first.snapshot.purpose.active;
  const result = engine.respond("その設計はやめよう。今は進めない。");

  assert.ok(activePurpose !== null);
  assert.equal(result.snapshot.purpose.lastResolved?.outcome, "abandoned");
  assert.equal(result.snapshot.purpose.lastResolved?.kind, activePurpose?.kind);
  assert.equal(result.snapshot.purpose.active?.kind === activePurpose?.kind, false);
});

test("hostility can shift active purpose toward boundary", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("設計を一緒に進めて、記録として残したい。");
  const result = engine.respond("その設計は最悪だし邪魔だ。");

  assert.equal(result.snapshot.purpose.active?.kind, "protect_boundary");
  assert.equal(result.snapshot.purpose.lastResolved?.outcome, "superseded");
});

test("respond stores the last local reply diagnostics on the engine", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様は？");

  assert.equal(engine.getLastInterpretationDebug()?.source, "rule");
  assert.equal(engine.getLastInterpretationDebug()?.fallbackUsed, false);
  assert.ok((engine.getLastInterpretationDebug()?.scores.workCue ?? 0) > 0.3);
  assert.ok((engine.getLastInterpretationDebug()?.summary ?? "").length > 0);
  assert.equal(engine.getLastReplyDebug()?.mode, "reply");
  assert.equal(engine.getLastReplyDebug()?.source, "rule");
  assert.equal(engine.getLastReplyDebug()?.provider, null);
  assert.equal(engine.getLastReplyDebug()?.model, null);
  assert.equal(engine.getLastReplyDebug()?.fallbackUsed, false);
  assert.equal(engine.getLastReplyDebug()?.error, null);
  assert.ok((engine.getLastReplyDebug()?.plan ?? "").length > 0);
  assert.equal(engine.getLastReplyDebug()?.selection?.currentTopic, "仕様");
});

test("respondAsync can use an external reply generator while keeping local state updates", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  let capturedContext: ReplyGenerationContext | null = null;

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply(context) {
      capturedContext = context;
      return {
        reply: "その向きなら、こちらももう少し自然に応じられる。",
        provider: "test-llm",
        model: "stub",
      };
    },
  };

  const before = engine.getSnapshot();
  const result = await engine.respondAsync("ありがとう。君と実装を進めたい。", {
    replyGenerator,
  });

  assert.equal(result.reply, "その向きなら、こちらももう少し自然に応じられる。");
  if (capturedContext === null) {
    throw new Error("reply generator did not receive context");
  }
  const receivedContext = capturedContext as ReplyGenerationContext;
  assert.match(receivedContext.fallbackReply, /応じ|気分|乗りやすい|進めたい/);
  assert.equal(receivedContext.replySelection.currentTopic, "実装");
  assert.equal(receivedContext.replySelection.socialTurn, false);
  assert.equal(result.debug.reply.mode, "reply");
  assert.equal(result.debug.reply.source, "llm");
  assert.equal(result.debug.reply.provider, "test-llm");
  assert.equal(result.debug.reply.model, "stub");
  assert.equal(result.debug.reply.fallbackUsed, false);
  assert.ok((result.debug.reply.plan ?? "").length > 0);
  assert.ok(result.debug.reply.selection !== null);
  assert.equal(engine.getLastReplyDebug()?.source, "llm");
  assert.equal(engine.getLastReplyDebug()?.provider, "test-llm");
  assert.ok((engine.getLastReplyDebug()?.plan ?? "").startsWith("continue_work/") || (engine.getLastReplyDebug()?.plan ?? "").startsWith("explore/") || (engine.getLastReplyDebug()?.plan ?? "").startsWith("attune/"));
  assert.ok(result.snapshot.state.relation > before.state.relation);
  assert.ok(result.snapshot.attachment > before.attachment);
});

test("respondAsync can use an input interpreter to keep greetings non-topical and record dropped local topics", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

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

  const result = await engine.respondAsync("海辺", { inputInterpreter });

  assert.equal(result.debug.interpretation.source, "llm");
  assert.equal(result.debug.interpretation.fallbackUsed, false);
  assert.equal(result.debug.interpretation.topics.length, 0);
  assert.ok(result.debug.interpretation.localTopics.includes("海辺"));
  assert.ok(result.debug.interpretation.droppedTopics.includes("海辺"));
  assert.deepEqual(result.debug.interpretation.adoptedTopics, []);
  assert.ok(result.debug.interpretation.scores.greeting > 0.8);
  assert.ok(result.debug.interpretation.scores.smalltalk > 0.5);
  assert.deepEqual(result.debug.signals.topics, []);
  assert.ok(result.debug.signals.greeting > 0.8);
  assert.ok(result.debug.signals.smalltalk > 0.5);
  assert.equal(Object.keys(result.snapshot.traces).length, 0);
  assert.ok(result.snapshot.state.relation >= createInitialSnapshot().state.relation);
});

test("respondAsync can forward interpreted reply selection into the llm payload", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  let capturedContext: ReplyGenerationContext | null = null;

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

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply(context) {
      capturedContext = context;
      return {
        reply: "こんにちは。入り方はそれで十分伝わる。",
        provider: "test-llm",
        model: "stub",
      };
    },
  };

  await engine.respondAsync("海辺", { replyGenerator, inputInterpreter });

  if (capturedContext === null) {
    throw new Error("reply generator did not receive interpreted context");
  }

  const receivedContext = capturedContext as ReplyGenerationContext;
  assert.deepEqual(receivedContext.signals.topics, []);
  assert.equal(receivedContext.replySelection.socialTurn, true);
  assert.equal(receivedContext.replySelection.currentTopic, null);
  assert.equal(receivedContext.replySelection.relevantTraceTopic, null);
});

test("respondAsync falls back to the rule reply when the generator fails", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const ruleResult = engine.respond("仕様は？");
  engine.reset(createInitialSnapshot());

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply() {
      throw new Error("adapter offline");
    },
  };

  const result = await engine.respondAsync("仕様は？", { replyGenerator });

  assert.equal(result.reply, ruleResult.reply);
  assert.equal(result.debug.reply.mode, "reply");
  assert.equal(result.debug.reply.source, "rule");
  assert.equal(result.debug.reply.provider, "test-llm");
  assert.equal(result.debug.reply.fallbackUsed, true);
  assert.match(result.debug.reply.error ?? "", /adapter offline/);
  assert.equal(engine.getLastReplyDebug()?.source, "rule");
  assert.equal(engine.getLastReplyDebug()?.fallbackUsed, true);
});

test("respondAsync falls back to local analysis when the input interpreter fails", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const ruleResult = engine.respond("仕様を記録として残したい。");
  engine.reset(createInitialSnapshot());

  const inputInterpreter: InputInterpreter = {
    name: "broken-interpreter",
    async interpretInput() {
      throw new Error("input interpreter offline");
    },
  };

  const result = await engine.respondAsync("仕様を記録として残したい。", {
    inputInterpreter,
  });

  assert.equal(result.debug.interpretation.source, "rule");
  assert.equal(result.debug.interpretation.fallbackUsed, true);
  assert.match(result.debug.interpretation.error ?? "", /input interpreter offline/);
  assert.ok(result.debug.interpretation.scores.workCue > 0.3);
  assert.equal(result.reply, ruleResult.reply);
  assert.deepEqual(result.debug.signals.topics, ruleResult.debug.signals.topics);
  assert.equal(result.snapshot.purpose.active?.kind, ruleResult.snapshot.purpose.active?.kind);
  assert.equal(result.snapshot.purpose.active?.topic, ruleResult.snapshot.purpose.active?.topic);
  assert.equal(result.snapshot.traces.仕様?.kind, ruleResult.snapshot.traces.仕様?.kind);
});

test("reset clears the last reply diagnostics", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  await engine.respondAsync("仕様は？");
  assert.ok(engine.getLastReplyDebug() !== null);
  assert.ok(engine.getLastResponseDebug() !== null);
  assert.ok(engine.getLastInterpretationDebug() !== null);

  engine.reset(createInitialSnapshot());

  assert.equal(engine.getLastReplyDebug(), null);
  assert.equal(engine.getLastResponseDebug(), null);
  assert.equal(engine.getLastProactiveDebug(), null);
  assert.equal(engine.getLastInterpretationDebug(), null);
});

test("response and proactive diagnostics are preserved separately", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様を記録として残したい。");
  const responseDebug = engine.getLastResponseDebug();
  assert.equal(responseDebug?.mode, "reply");

  engine.rewindIdleHours(8);
  engine.emitInitiative();

  assert.equal(engine.getLastReplyDebug()?.mode, "proactive");
  assert.equal(engine.getLastResponseDebug()?.mode, "reply");
  assert.equal(engine.getLastProactiveDebug()?.mode, "proactive");
  assert.ok((engine.getLastResponseDebug()?.plan ?? "").length > 0);
  assert.ok((engine.getLastProactiveDebug()?.plan ?? "").length > 0);
});

test("emitInitiativeAsync can use an external generator for proactive wording", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  let capturedContext: ProactiveGenerationContext | null = null;

  engine.respond("設計を記録として残したい。");
  engine.rewindIdleHours(8);

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply() {
      return null;
    },
    async generateProactive(context) {
      capturedContext = context;
      return {
        reply: "まだ切れていない。設計はこのまま消すより、ひとつ形にして残しておきたい。",
        provider: "test-llm",
        model: "stub",
      };
    },
  };

  const message = await engine.emitInitiativeAsync({ replyGenerator });

  assert.ok(message !== null);
  if (capturedContext === null) {
    throw new Error("proactive generator did not receive context");
  }
  const proactiveContext = capturedContext as ProactiveGenerationContext;
  assert.match(proactiveContext.fallbackMessage, /止めたまま|形にしたい|残して/);
  assert.equal(proactiveContext.pending.kind, "resume_topic");
  assert.ok(proactiveContext.proactivePlan.act === "leave_trace" || proactiveContext.proactivePlan.act === "continue_work");
  assert.equal(proactiveContext.proactivePlan.focusTopic, proactiveContext.pending.topic);
  assert.equal(proactiveContext.proactiveSelection.focusTopic, proactiveContext.pending.topic);
  assert.equal(proactiveContext.proactiveSelection.maintenanceTraceTopic, proactiveContext.pending.topic);
  assert.equal(engine.getLastReplyDebug()?.proactiveSelection?.focusTopic, proactiveContext.pending.topic);
  assert.equal(engine.getLastReplyDebug()?.mode, "proactive");
  assert.equal(engine.getLastReplyDebug()?.source, "llm");
  assert.equal(engine.getLastReplyDebug()?.provider, "test-llm");
  assert.ok((engine.getLastReplyDebug()?.plan ?? "").length > 0);
});

test("emitInitiativeAsync falls back to rule wording when proactive generation fails", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様の流れを残したい。");
  engine.rewindIdleHours(8);
  const ruleMessage = engine.emitInitiative();
  engine.reset(createInitialSnapshot());
  engine.respond("仕様の流れを残したい。");
  engine.rewindIdleHours(8);

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply() {
      return null;
    },
    async generateProactive() {
      throw new Error("proactive adapter offline");
    },
  };

  const message = await engine.emitInitiativeAsync({ replyGenerator });

  assert.equal(message, ruleMessage);
  assert.equal(engine.getLastReplyDebug()?.mode, "proactive");
  assert.equal(engine.getLastReplyDebug()?.source, "rule");
  assert.equal(engine.getLastReplyDebug()?.fallbackUsed, true);
  assert.ok(engine.getLastReplyDebug()?.proactiveSelection !== null);
  assert.match(engine.getLastReplyDebug()?.error ?? "", /proactive adapter offline/);
});
