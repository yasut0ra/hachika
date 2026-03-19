import assert from "node:assert/strict";
import test from "node:test";

import { HachikaEngine } from "./engine.js";
import { createInitialSnapshot } from "./state.js";

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

test("blocked trace schedules a blocker-aware initiative", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("仕様の境界が未定で曖昧だ。まだ進められない。");
  const pending = result.snapshot.initiative.pending;

  assert.ok(pending !== null);
  assert.equal(pending?.topic, "仕様");
  assert.ok((pending?.blocker ?? "").includes("未定") || (pending?.blocker ?? "").includes("曖昧"));
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
